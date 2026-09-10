// Deterministic accuracy layer for prospect sentence search.
// Claude proposes LeadSearchCriteria; this module canonicalizes cities,
// infers markets, and drops GIS-impossible combinations before searchLeads.

import {
  SUPPORTED_MARKETS,
  type LeadSearchCriteria,
  type PropertyTypeFilter,
  type SupportedMarket,
} from "@/lib/lead-finder";

export type IgnoredLeadTerm = { term: string; reason: string };

export type RefineLeadResult =
  | { ok: true; criteria: LeadSearchCriteria; ignored: IgnoredLeadTerm[] }
  | { ok: false; error: string; ignored: IgnoredLeadTerm[] };

type CityEntry = { aliases: string[]; canonical: string; market: SupportedMarket };

const CITY_ENTRIES: CityEntry[] = [
  // Miami-Dade
  { aliases: ["miami"], canonical: "Miami", market: "miami-dade" },
  { aliases: ["hialeah"], canonical: "Hialeah", market: "miami-dade" },
  { aliases: ["doral"], canonical: "Doral", market: "miami-dade" },
  { aliases: ["medley"], canonical: "Medley", market: "miami-dade" },
  { aliases: ["coral gables"], canonical: "Coral Gables", market: "miami-dade" },
  { aliases: ["miami beach"], canonical: "Miami Beach", market: "miami-dade" },
  { aliases: ["miami lakes"], canonical: "Miami Lakes", market: "miami-dade" },
  { aliases: ["miami gardens"], canonical: "Miami Gardens", market: "miami-dade" },
  { aliases: ["north miami"], canonical: "North Miami", market: "miami-dade" },
  { aliases: ["north miami beach"], canonical: "North Miami Beach", market: "miami-dade" },
  { aliases: ["aventura"], canonical: "Aventura", market: "miami-dade" },
  { aliases: ["homestead"], canonical: "Homestead", market: "miami-dade" },
  { aliases: ["sweetwater"], canonical: "Sweetwater", market: "miami-dade" },
  { aliases: ["opa locka", "opalocka"], canonical: "Opa-locka", market: "miami-dade" },
  { aliases: ["cutler bay"], canonical: "Cutler Bay", market: "miami-dade" },
  { aliases: ["palmetto bay"], canonical: "Palmetto Bay", market: "miami-dade" },
  { aliases: ["pinecrest"], canonical: "Pinecrest", market: "miami-dade" },
  { aliases: ["key biscayne"], canonical: "Key Biscayne", market: "miami-dade" },
  { aliases: ["hialeah gardens"], canonical: "Hialeah Gardens", market: "miami-dade" },
  { aliases: ["south miami"], canonical: "South Miami", market: "miami-dade" },
  { aliases: ["west miami"], canonical: "West Miami", market: "miami-dade" },
  { aliases: ["florida city"], canonical: "Florida City", market: "miami-dade" },
  { aliases: ["sunny isles", "sunny isles beach"], canonical: "Sunny Isles Beach", market: "miami-dade" },
  // Broward
  { aliases: ["fort lauderdale", "ft lauderdale", "ft. lauderdale"], canonical: "Fort Lauderdale", market: "broward" },
  { aliases: ["hollywood"], canonical: "Hollywood", market: "broward" },
  { aliases: ["pembroke pines"], canonical: "Pembroke Pines", market: "broward" },
  { aliases: ["miramar"], canonical: "Miramar", market: "broward" },
  { aliases: ["coral springs"], canonical: "Coral Springs", market: "broward" },
  { aliases: ["pompano", "pompano beach"], canonical: "Pompano Beach", market: "broward" },
  { aliases: ["davie"], canonical: "Davie", market: "broward" },
  { aliases: ["plantation"], canonical: "Plantation", market: "broward" },
  { aliases: ["sunrise"], canonical: "Sunrise", market: "broward" },
  { aliases: ["deerfield beach", "deerfield"], canonical: "Deerfield Beach", market: "broward" },
  { aliases: ["weston"], canonical: "Weston", market: "broward" },
  { aliases: ["tamarac"], canonical: "Tamarac", market: "broward" },
  { aliases: ["margate"], canonical: "Margate", market: "broward" },
  { aliases: ["coconut creek"], canonical: "Coconut Creek", market: "broward" },
  { aliases: ["oakland park"], canonical: "Oakland Park", market: "broward" },
  { aliases: ["lauderhill"], canonical: "Lauderhill", market: "broward" },
  { aliases: ["dania", "dania beach"], canonical: "Dania Beach", market: "broward" },
  { aliases: ["hallandale", "hallandale beach"], canonical: "Hallandale Beach", market: "broward" },
  { aliases: ["parkland"], canonical: "Parkland", market: "broward" },
  { aliases: ["cooper city"], canonical: "Cooper City", market: "broward" },
  { aliases: ["wilton manors"], canonical: "Wilton Manors", market: "broward" },
  // Palm Beach
  { aliases: ["west palm beach", "west palm", "wpb"], canonical: "West Palm Beach", market: "palm-beach" },
  { aliases: ["boca raton", "boca"], canonical: "Boca Raton", market: "palm-beach" },
  { aliases: ["delray beach", "delray"], canonical: "Delray Beach", market: "palm-beach" },
  { aliases: ["boynton beach", "boynton"], canonical: "Boynton Beach", market: "palm-beach" },
  { aliases: ["lake worth", "lake worth beach"], canonical: "Lake Worth", market: "palm-beach" },
  { aliases: ["wellington"], canonical: "Wellington", market: "palm-beach" },
  { aliases: ["jupiter"], canonical: "Jupiter", market: "palm-beach" },
  { aliases: ["palm beach gardens"], canonical: "Palm Beach Gardens", market: "palm-beach" },
  { aliases: ["riviera beach"], canonical: "Riviera Beach", market: "palm-beach" },
  { aliases: ["royal palm beach"], canonical: "Royal Palm Beach", market: "palm-beach" },
  { aliases: ["greenacres"], canonical: "Greenacres", market: "palm-beach" },
  { aliases: ["palm springs"], canonical: "Palm Springs", market: "palm-beach" },
  { aliases: ["palm beach"], canonical: "Palm Beach", market: "palm-beach" },
  // Massachusetts
  { aliases: ["boston"], canonical: "Boston", market: "massachusetts" },
  { aliases: ["cambridge"], canonical: "Cambridge", market: "massachusetts" },
  { aliases: ["somerville"], canonical: "Somerville", market: "massachusetts" },
  { aliases: ["worcester"], canonical: "Worcester", market: "massachusetts" },
  { aliases: ["springfield"], canonical: "Springfield", market: "massachusetts" },
  { aliases: ["quincy"], canonical: "Quincy", market: "massachusetts" },
  { aliases: ["newton"], canonical: "Newton", market: "massachusetts" },
  { aliases: ["brookline"], canonical: "Brookline", market: "massachusetts" },
  { aliases: ["waltham"], canonical: "Waltham", market: "massachusetts" },
  { aliases: ["lowell"], canonical: "Lowell", market: "massachusetts" },
  { aliases: ["framingham"], canonical: "Framingham", market: "massachusetts" },
  { aliases: ["medford"], canonical: "Medford", market: "massachusetts" },
  { aliases: ["brockton"], canonical: "Brockton", market: "massachusetts" },
  { aliases: ["new bedford"], canonical: "New Bedford", market: "massachusetts" },
  { aliases: ["fall river"], canonical: "Fall River", market: "massachusetts" },
];

const CITY_BY_ALIAS = new Map<string, CityEntry>();
for (const entry of CITY_ENTRIES) {
  for (const alias of entry.aliases) CITY_BY_ALIAS.set(alias, entry);
}

const VALID_TYPES = new Set<PropertyTypeFilter>([
  "residential", "multifamily", "retail", "office", "industrial", "land",
]);

const MARKET_QUERY: { re: RegExp; market: SupportedMarket }[] = [
  { re: /\bmiami[-\s]?dade\b/, market: "miami-dade" },
  { re: /\bbroward\b/, market: "broward" },
  { re: /\bpalm\s+beach\b|\bpbc\b/, market: "palm-beach" },
  { re: /\bmassachusetts\b|\bmass\b(?!\s*sf)|\bmassgis\b/, market: "massachusetts" },
];

const UNSUPPORTED_TERMS: { re: RegExp; term: string; reason: string }[] = [
  { re: /\bdocks?\b|\bloading\s+docks?\b|\bdock\s+doors?\b/, term: "docks", reason: "County tax rolls do not include dock doors." },
  { re: /\bclear\s+height\b|\bceiling\s+height\b/, term: "clear height", reason: "County tax rolls do not include clear height." },
  { re: /\bnear\s+(the\s+)?airport\b/, term: "near the airport", reason: "County tax rolls have no proximity or airport filter." },
];

function scanUnsupportedTerms(query: string, existing: IgnoredLeadTerm[]): IgnoredLeadTerm[] {
  const ignored = [...existing];
  const q = query.toLowerCase();
  for (const { re, term, reason } of UNSUPPORTED_TERMS) {
    if (re.test(q) && !ignored.some((i) => i.term.toLowerCase() === term.toLowerCase())) {
      ignored.push({ term, reason });
    }
  }
  return ignored;
}

export function cityKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleCaseCity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function resolveCity(raw: string): { canonical: string; market: SupportedMarket | null } {
  const key = cityKey(raw);
  const hit = CITY_BY_ALIAS.get(key);
  if (hit) return { canonical: hit.canonical, market: hit.market };
  // Longer alias first is already unique keys; try dropping "fl"/"florida"
  const stripped = key.replace(/\bfl\b|\bflorida\b|\bma\b|\bmass\b/g, "").trim();
  if (stripped && stripped !== key) {
    const again = CITY_BY_ALIAS.get(stripped);
    if (again) return { canonical: again.canonical, market: again.market };
  }
  return { canonical: titleCaseCity(raw), market: null };
}

export function marketsNamedInQuery(query: string): SupportedMarket[] {
  const q = query.toLowerCase();
  const found: SupportedMarket[] = [];
  for (const { re, market } of MARKET_QUERY) {
    if (re.test(q) && !found.includes(market)) found.push(market);
  }
  return found;
}

function swapIfInverted(min: number | undefined, max: number | undefined): [number | undefined, number | undefined] {
  if (min != null && max != null && min > max) return [max, min];
  return [min, max];
}

function hasSelectiveFilter(c: LeadSearchCriteria): boolean {
  return Boolean(
    (c.cities && c.cities.length > 0) ||
    c.buildingSqftMin != null || c.buildingSqftMax != null ||
    c.landSqftMin != null || c.landSqftMax != null ||
    c.assessedValueMin != null || c.assessedValueMax != null ||
    c.yearBuiltMin != null || c.yearBuiltMax != null ||
    c.soldWithinYears != null || c.heldAtLeastYears != null ||
    c.ownerPortfolioMin != null ||
    c.leaseExpiringWithinDays != null,
  );
}

function magisHasNonTypeFilter(c: LeadSearchCriteria): boolean {
  return Boolean(
    c.buildingSqftMin != null || c.buildingSqftMax != null ||
    c.landSqftMin != null || c.landSqftMax != null ||
    c.assessedValueMin != null || c.assessedValueMax != null ||
    c.yearBuiltMin != null || c.yearBuiltMax != null ||
    (c.cities && c.cities.length > 0) ||
    c.soldWithinYears != null || c.heldAtLeastYears != null,
  );
}

const num = (v: unknown): number | undefined =>
  (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function sanitizeLeadCriteria(input: unknown): LeadSearchCriteria | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Record<string, unknown>;
  const markets = Array.isArray(c.markets)
    ? c.markets.filter((m): m is SupportedMarket =>
        typeof m === "string" && (SUPPORTED_MARKETS as string[]).includes(m),
      )
    : [];
  const propertyType = c.propertyType;
  return {
    markets,
    cities: Array.isArray(c.cities) ? c.cities.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : undefined,
    buildingSqftMin: num(c.buildingSqftMin),
    buildingSqftMax: num(c.buildingSqftMax),
    landSqftMin: num(c.landSqftMin),
    landSqftMax: num(c.landSqftMax),
    propertyType: typeof propertyType === "string" && VALID_TYPES.has(propertyType as PropertyTypeFilter)
      ? (propertyType as PropertyTypeFilter)
      : undefined,
    assessedValueMin: num(c.assessedValueMin),
    assessedValueMax: num(c.assessedValueMax),
    yearBuiltMin: num(c.yearBuiltMin),
    yearBuiltMax: num(c.yearBuiltMax),
    soldWithinYears: num(c.soldWithinYears),
    heldAtLeastYears: num(c.heldAtLeastYears),
    ownerPortfolioMin: num(c.ownerPortfolioMin),
    leaseExpiringWithinDays: num(c.leaseExpiringWithinDays),
  };
}

export function refineLeadCriteria(
  raw: LeadSearchCriteria,
  query: string,
  priorIgnored: IgnoredLeadTerm[] = [],
): RefineLeadResult {
  const ignored = scanUnsupportedTerms(query, priorIgnored);
  const q = query.toLowerCase();

  const [buildingSqftMin, buildingSqftMax] = swapIfInverted(raw.buildingSqftMin, raw.buildingSqftMax);
  const [landSqftMin, landSqftMax] = swapIfInverted(raw.landSqftMin, raw.landSqftMax);
  const [assessedValueMin, assessedValueMax] = swapIfInverted(raw.assessedValueMin, raw.assessedValueMax);
  const [yearBuiltMin, yearBuiltMax] = swapIfInverted(raw.yearBuiltMin, raw.yearBuiltMax);

  let soldWithinYears = raw.soldWithinYears;
  let heldAtLeastYears = raw.heldAtLeastYears;
  if (soldWithinYears != null && heldAtLeastYears != null) {
    const preferHeld = /\bheld\b|\blong[-\s]?held\b|\blong[-\s]?term\b/.test(q);
    if (preferHeld) soldWithinYears = undefined;
    else heldAtLeastYears = undefined;
  }

  const resolvedCities: string[] = [];
  const cityMarkets = new Set<SupportedMarket>();
  for (const city of raw.cities ?? []) {
    const { canonical, market } = resolveCity(city);
    if (!resolvedCities.some((c) => c.toLowerCase() === canonical.toLowerCase())) {
      resolvedCities.push(canonical);
    }
    if (market) cityMarkets.add(market);
  }

  const namedMarkets = marketsNamedInQuery(query);
  let markets: SupportedMarket[];
  if (cityMarkets.size > 0) {
    markets = [...cityMarkets];
    if (namedMarkets.length > 0) {
      const intersect = markets.filter((m) => namedMarkets.includes(m));
      if (intersect.length > 0) markets = intersect;
    }
  } else if (namedMarkets.length > 0) {
    markets = namedMarkets;
  } else if (raw.markets.length > 0) {
    markets = [...raw.markets];
  } else {
    markets = [...SUPPORTED_MARKETS];
  }

  const namedPalmBeach = namedMarkets.includes("palm-beach") || cityMarkets.has("palm-beach");
  const needsBuildingOrYear =
    buildingSqftMin != null || buildingSqftMax != null || yearBuiltMin != null || yearBuiltMax != null;
  if (needsBuildingOrYear && markets.includes("palm-beach") && !namedPalmBeach) {
    markets = markets.filter((m) => m !== "palm-beach");
    ignored.push({
      term: "Palm Beach",
      reason: "Palm Beach has no building square footage or year built — it was left out of this search.",
    });
  }

  const criteria: LeadSearchCriteria = {
    markets,
    cities: resolvedCities.length > 0 ? resolvedCities : undefined,
    buildingSqftMin,
    buildingSqftMax,
    landSqftMin,
    landSqftMax,
    propertyType: raw.propertyType,
    assessedValueMin,
    assessedValueMax,
    yearBuiltMin,
    yearBuiltMax,
    soldWithinYears,
    heldAtLeastYears,
    ownerPortfolioMin: raw.ownerPortfolioMin,
    leaseExpiringWithinDays: raw.leaseExpiringWithinDays,
  };

  if (criteria.markets.includes("massachusetts") && criteria.propertyType && !magisHasNonTypeFilter(criteria)) {
    criteria.markets = criteria.markets.filter((m) => m !== "massachusetts");
    ignored.push({
      term: "Massachusetts",
      reason: "Massachusetts cannot search by property type alone — add a city, size, year, or sale filter, or it stays out.",
    });
  }

  if (criteria.leaseExpiringWithinDays != null) {
    ignored.push({
      term: "lease expiring",
      reason: "Only properties you already have a lease abstract for.",
    });
  }

  if (criteria.markets.length === 0) {
    return { ok: false, error: "No market left to search after applying what the tax roll can actually filter.", ignored };
  }

  if (!hasSelectiveFilter(criteria) && criteria.markets.length > 1) {
    return {
      ok: false,
      error: "Add a city or a size, year, sale, or value constraint — a type-only search across multiple markets is too broad.",
      ignored,
    };
  }

  return { ok: true, criteria, ignored };
}
