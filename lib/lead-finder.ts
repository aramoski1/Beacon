// Lead finder — cross-market "buy box" criteria search.
//
// Orchestrates the criteria-search entry point added to each market's own
// GIS module (lib/mdpa.ts, lib/bcpa.ts, lib/pbcpa.ts, lib/magis.ts). Each
// market's WHERE-clause construction, pagination, and field mapping lives in
// that market's own file — this module does not re-implement any of it, it
// only calls searchByCriteria per selected market, normalizes each market's
// result shape into one LeadMatch shape, and adds the honesty caveats the
// product requires (Palm Beach's missing building-SF/year-built fields,
// Massachusetts's less-consistent use-code/building-SF data).

import * as mdpa from "./mdpa";
import * as bcpa from "./bcpa";
import * as pbcpa from "./pbcpa";
import * as magis from "./magis";
import * as mdpaOwnerSearch from "./mdpa-owner-search";
import * as magisOwnerSearch from "./magis-owner-search";
import { mdpaSearchModeForName } from "./mdpa-owner-search";

export type SupportedMarket = "miami-dade" | "broward" | "palm-beach" | "massachusetts";

export type PropertyTypeFilter =
  | "residential" | "multifamily" | "retail" | "office" | "industrial" | "land";

export const SUPPORTED_MARKETS: SupportedMarket[] = [
  "miami-dade", "broward", "palm-beach", "massachusetts",
];

export const MARKET_LABELS: Record<SupportedMarket, string> = {
  "miami-dade": "Miami-Dade",
  broward: "Broward",
  "palm-beach": "Palm Beach",
  massachusetts: "Massachusetts",
};

export const MARKET_SOURCE_LABELS: Record<SupportedMarket, string> = {
  "miami-dade": "Miami-Dade Property Appraiser (MDC.PaGis)",
  broward: "Broward County Property Appraiser",
  "palm-beach": "Palm Beach County Property Appraiser",
  massachusetts: "Massachusetts statewide parcels (MassGIS)",
};

export type LeadSearchCriteria = {
  markets: SupportedMarket[];
  cities?: string[];
  buildingSqftMin?: number;
  buildingSqftMax?: number;
  landSqftMin?: number;
  landSqftMax?: number;
  propertyType?: PropertyTypeFilter;
  assessedValueMin?: number;
  assessedValueMax?: number;
  yearBuiltMin?: number;
  yearBuiltMax?: number;
  /** Last sale within the last N years — "ownership recently changed" signal. */
  soldWithinYears?: number;
  /** Last sale at least N years ago — "long-held" signal. */
  heldAtLeastYears?: number;
  /**
   * Owner holds at least N parcels in the SAME market (live GIS owner-name
   * count, not a Beacon-book portfolio) — filters out matches below the
   * threshold and annotates every kept match with its real count. Expensive
   * (one extra owner-search query per distinct owner in the result set), so
   * only applied when set.
   */
  ownerPortfolioMin?: number;
  /**
   * Lease expiring within N days, cross-referenced against the broker's own
   * book. searchLeads itself never reads this field — it needs DB access
   * this pure GIS-orchestration module doesn't have, so
   * app/prospect/actions.ts's runLeadSearch applies it as a post-processing
   * step after calling searchLeads. Kept on this shared criteria type (not a
   * separate parameter) so it saves/loads with a buy box like every other
   * filter.
   */
  leaseExpiringWithinDays?: number;
};

export type LeadMatch = {
  market: SupportedMarket;
  source: string;
  folio: string;
  strap: string;
  address: string | null;
  city: string | null;
  ownerName: string | null;
  buildingSqft: number | null;
  landSqft: number | null;
  useCode: string | null;
  useDescription: string | null;
  assessedValue: number | null;
  yearBuilt: number | null;
  /** ISO YYYY-MM-DD where the source gives a full date; "YYYY" when the
   *  market only tracks sale year (Broward). Null when unknown. */
  lastSaleDate: string | null;
  /** Populated only when ownerPortfolioMin was set on the search. */
  ownerPortfolioCount: number | null;
  /**
   * Cross-referenced against the broker's OWN lease_abstracts (by address) —
   * this lib has no DB access, so these always come back null here.
   * app/prospect/actions.ts annotates/filters on them after calling
   * searchLeads, since a lead can only carry lease data once it (or an
   * address match) is already in the broker's book.
   */
  leaseExpirationDate: string | null;
  leaseDaysUntilExpiry: number | null;
};

export type MarketOutcome =
  | { market: SupportedMarket; kind: "ok"; matches: LeadMatch[]; totalCount: number }
  | { market: SupportedMarket; kind: "too_many"; count: number }
  | { market: SupportedMarket; kind: "error"; message: string };

export type LeadSearchResult = {
  outcomes: MarketOutcome[];
  matches: LeadMatch[];
  /** Honest per-search data-reliability notices — always show these, never suppress. */
  caveats: string[];
};

// Applied per-market inside each module's own searchByCriteria (returnCountOnly
// pre-check) — kept here too so the "too many" threshold used for messaging
// matches the one actually enforced.
const MAX_RESULTS_PER_MARKET = 100;

// Miami-Dade's DOS_1 and Massachusetts's LS_DATE are both YYYYMMDD strings —
// normalized here to ISO YYYY-MM-DD so LeadMatch has one consistent format
// wherever a full date is actually known.
function isoFromYyyymmdd(raw: string | null): string | null {
  if (!raw || raw.length !== 8) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function buildCaveats(criteria: LeadSearchCriteria): string[] {
  const caveats: string[] = [];

  if (
    criteria.markets.includes("palm-beach") &&
    (criteria.buildingSqftMin != null ||
      criteria.buildingSqftMax != null ||
      criteria.yearBuiltMin != null ||
      criteria.yearBuiltMax != null)
  ) {
    caveats.push(
      "Palm Beach has no building-square-footage or year-built data available — those two filters were not applied to Palm Beach results, so Palm Beach matches may include properties outside your building-size or year-built range.",
    );
  }

  if (criteria.markets.includes("massachusetts")) {
    caveats.push(
      "Massachusetts use-code and building-square-footage data is less consistent than the Florida counties (definitions vary town to town) — treat Massachusetts matches as a looser fit than Florida matches.",
    );
  }

  return caveats;
}

async function searchMiamiDade(criteria: LeadSearchCriteria): Promise<MarketOutcome> {
  const result = await mdpa.searchByCriteria(
    {
      buildingSqftMin: criteria.buildingSqftMin,
      buildingSqftMax: criteria.buildingSqftMax,
      landSqftMin: criteria.landSqftMin,
      landSqftMax: criteria.landSqftMax,
      propertyType: criteria.propertyType,
      assessedValueMin: criteria.assessedValueMin,
      assessedValueMax: criteria.assessedValueMax,
      yearBuiltMin: criteria.yearBuiltMin,
      yearBuiltMax: criteria.yearBuiltMax,
      cities: criteria.cities,
      soldWithinYears: criteria.soldWithinYears,
      heldAtLeastYears: criteria.heldAtLeastYears,
    },
    MAX_RESULTS_PER_MARKET,
  );
  if (result.kind === "too_many") return { market: "miami-dade", kind: "too_many", count: result.count };
  if (result.kind === "error") return { market: "miami-dade", kind: "error", message: result.message };
  return {
    market: "miami-dade",
    kind: "ok",
    totalCount: result.totalCount,
    matches: result.matches.map((m) => ({
      market: "miami-dade",
      source: MARKET_SOURCE_LABELS["miami-dade"],
      folio: m.folio,
      strap: m.strap,
      address: m.address,
      city: m.city,
      ownerName: m.ownerName,
      buildingSqft: m.buildingSqft,
      landSqft: m.landSqft,
      useCode: m.useCode,
      useDescription: m.useDescription,
      assessedValue: m.assessedValue,
      yearBuilt: m.yearBuilt,
      lastSaleDate: isoFromYyyymmdd(m.lastSaleDate),
      ownerPortfolioCount: null,
      leaseExpirationDate: null,
      leaseDaysUntilExpiry: null,
    })),
  };
}

async function searchBroward(criteria: LeadSearchCriteria): Promise<MarketOutcome> {
  const result = await bcpa.searchByCriteria(
    {
      buildingSqftMin: criteria.buildingSqftMin,
      buildingSqftMax: criteria.buildingSqftMax,
      landSqftMin: criteria.landSqftMin,
      landSqftMax: criteria.landSqftMax,
      propertyType: criteria.propertyType,
      assessedValueMin: criteria.assessedValueMin,
      assessedValueMax: criteria.assessedValueMax,
      yearBuiltMin: criteria.yearBuiltMin,
      yearBuiltMax: criteria.yearBuiltMax,
      cities: criteria.cities,
      soldWithinYears: criteria.soldWithinYears,
      heldAtLeastYears: criteria.heldAtLeastYears,
    },
    MAX_RESULTS_PER_MARKET,
  );
  if (result.kind === "too_many") return { market: "broward", kind: "too_many", count: result.count };
  if (result.kind === "error") return { market: "broward", kind: "error", message: result.message };
  return {
    market: "broward",
    kind: "ok",
    totalCount: result.totalCount,
    matches: result.matches.map((m) => ({
      market: "broward",
      source: MARKET_SOURCE_LABELS.broward,
      folio: m.folio,
      strap: m.strap,
      address: m.address,
      city: m.city,
      ownerName: m.ownerName,
      buildingSqft: m.buildingSqft,
      landSqft: m.landSqft,
      useCode: m.useCode,
      useDescription: null,
      assessedValue: m.assessedValue,
      yearBuilt: m.yearBuilt,
      // Broward's SALE_YR1 is year-only granularity — represented as a bare
      // "YYYY" string rather than fabricating a month/day.
      lastSaleDate: m.lastSaleYear != null ? String(m.lastSaleYear) : null,
      ownerPortfolioCount: null,
      leaseExpirationDate: null,
      leaseDaysUntilExpiry: null,
    })),
  };
}

async function searchPalmBeach(criteria: LeadSearchCriteria): Promise<MarketOutcome> {
  const result = await pbcpa.searchByCriteria(
    {
      landSqftMin: criteria.landSqftMin,
      landSqftMax: criteria.landSqftMax,
      propertyType: criteria.propertyType,
      assessedValueMin: criteria.assessedValueMin,
      assessedValueMax: criteria.assessedValueMax,
      cities: criteria.cities,
      soldWithinYears: criteria.soldWithinYears,
      heldAtLeastYears: criteria.heldAtLeastYears,
    },
    MAX_RESULTS_PER_MARKET,
  );
  if (result.kind === "too_many") return { market: "palm-beach", kind: "too_many", count: result.count };
  if (result.kind === "error") return { market: "palm-beach", kind: "error", message: result.message };
  return {
    market: "palm-beach",
    kind: "ok",
    totalCount: result.totalCount,
    matches: result.matches.map((m) => ({
      market: "palm-beach",
      source: MARKET_SOURCE_LABELS["palm-beach"],
      folio: m.folio,
      strap: m.strap,
      address: m.address,
      city: m.city,
      ownerName: m.ownerName,
      buildingSqft: m.buildingSqft,
      landSqft: m.landSqft,
      useCode: null,
      useDescription: m.useDescription,
      assessedValue: m.assessedValue,
      yearBuilt: m.yearBuilt,
      lastSaleDate: m.lastSaleDate,
      ownerPortfolioCount: null,
      leaseExpirationDate: null,
      leaseDaysUntilExpiry: null,
    })),
  };
}

async function searchMassachusetts(criteria: LeadSearchCriteria): Promise<MarketOutcome> {
  const result = await magis.searchByCriteria(
    {
      buildingSqftMin: criteria.buildingSqftMin,
      buildingSqftMax: criteria.buildingSqftMax,
      landSqftMin: criteria.landSqftMin,
      landSqftMax: criteria.landSqftMax,
      propertyType: criteria.propertyType,
      assessedValueMin: criteria.assessedValueMin,
      assessedValueMax: criteria.assessedValueMax,
      yearBuiltMin: criteria.yearBuiltMin,
      yearBuiltMax: criteria.yearBuiltMax,
      cities: criteria.cities,
      soldWithinYears: criteria.soldWithinYears,
      heldAtLeastYears: criteria.heldAtLeastYears,
    },
    MAX_RESULTS_PER_MARKET,
  );
  if (result.kind === "too_many") return { market: "massachusetts", kind: "too_many", count: result.count };
  if (result.kind === "error") return { market: "massachusetts", kind: "error", message: result.message };
  return {
    market: "massachusetts",
    kind: "ok",
    totalCount: result.totalCount,
    matches: result.matches.map((m) => ({
      market: "massachusetts",
      source: MARKET_SOURCE_LABELS.massachusetts,
      folio: m.folio,
      strap: m.strap,
      address: m.address,
      city: m.city,
      ownerName: m.ownerName,
      buildingSqft: m.buildingSqft,
      landSqft: m.landSqft,
      useCode: m.useCode,
      useDescription: m.useDescription,
      assessedValue: m.assessedValue,
      yearBuilt: m.yearBuilt,
      lastSaleDate: isoFromYyyymmdd(m.lastSaleDate),
      ownerPortfolioCount: null,
      leaseExpirationDate: null,
      leaseDaysUntilExpiry: null,
    })),
  };
}

async function searchOneMarket(market: SupportedMarket, criteria: LeadSearchCriteria): Promise<MarketOutcome> {
  try {
    switch (market) {
      case "miami-dade": return await searchMiamiDade(criteria);
      case "broward": return await searchBroward(criteria);
      case "palm-beach": return await searchPalmBeach(criteria);
      case "massachusetts": return await searchMassachusetts(criteria);
    }
  } catch (err) {
    return { market, kind: "error", message: err instanceof Error ? err.message : "Search failed" };
  }
}

// Reuses the SAME owner-name search functions the owner-portfolio discovery
// flow already uses (one per market) — no new WHERE-clause/pagination logic,
// just counting how many parcels that owner name already turns up in the
// same live county/state data. mdpaSearchModeForName is a generic
// name-shape heuristic (already reused across all 4 markets elsewhere in
// this codebase), not Miami-Dade-specific.
async function ownerParcelCount(market: SupportedMarket, ownerName: string): Promise<number> {
  const mode = mdpaSearchModeForName(ownerName);
  switch (market) {
    case "miami-dade": return (await mdpaOwnerSearch.searchParcelsByOwnerName(ownerName, mode)).length;
    case "broward": return (await bcpa.searchParcelsByOwnerName(ownerName, mode)).length;
    case "palm-beach": return (await pbcpa.searchParcelsByOwnerName(ownerName, mode)).length;
    case "massachusetts": return (await magisOwnerSearch.searchParcelsByOwnerName(ownerName, mode)).length;
  }
}

/**
 * Annotates every match with its owner's real live parcel count in that
 * market, then drops matches below the threshold. A match with no owner
 * name on record is dropped rather than assumed to pass — this filter can
 * only honestly include what it could verify.
 */
async function applyOwnerPortfolioFilter(
  outcomes: MarketOutcome[],
  ownerPortfolioMin: number,
): Promise<MarketOutcome[]> {
  const distinctOwners = new Map<string, { market: SupportedMarket; ownerName: string }>();
  for (const outcome of outcomes) {
    if (outcome.kind !== "ok") continue;
    for (const m of outcome.matches) {
      if (!m.ownerName) continue;
      const key = `${m.market}:${m.ownerName}`;
      if (!distinctOwners.has(key)) distinctOwners.set(key, { market: m.market, ownerName: m.ownerName });
    }
  }

  const counts = new Map<string, number>();
  await Promise.all(
    [...distinctOwners.entries()].map(async ([key, { market, ownerName }]) => {
      counts.set(key, await ownerParcelCount(market, ownerName));
    }),
  );

  return outcomes.map((outcome) => {
    if (outcome.kind !== "ok") return outcome;
    const matches = outcome.matches
      .map((m) => ({ ...m, ownerPortfolioCount: m.ownerName ? (counts.get(`${m.market}:${m.ownerName}`) ?? 0) : 0 }))
      .filter((m) => (m.ownerPortfolioCount ?? 0) >= ownerPortfolioMin);
    return { ...outcome, matches };
  });
}

/**
 * Run a buy-box criteria search across the selected markets. Each market
 * counts real matches before fetching (returnCountOnly) and returns a
 * "too_many" only when a market exceeds 2,000 matches. Otherwise the first
 * 100 rows are returned with the true totalCount so the broker can page.
 */
export async function searchLeads(criteria: LeadSearchCriteria): Promise<LeadSearchResult> {
  const markets = criteria.markets.length > 0 ? criteria.markets : SUPPORTED_MARKETS;
  let outcomes = await Promise.all(markets.map((market) => searchOneMarket(market, criteria)));
  if (criteria.ownerPortfolioMin != null) {
    outcomes = await applyOwnerPortfolioFilter(outcomes, criteria.ownerPortfolioMin);
  }
  const matches = outcomes.flatMap((o) => (o.kind === "ok" ? o.matches : []));
  const caveats = buildCaveats(criteria);
  return { outcomes, matches, caveats };
}
