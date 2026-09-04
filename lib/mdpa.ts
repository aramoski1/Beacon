// Miami-Dade Property Appraiser — server-only
//
// Address search uses the Miami-Dade ArcGIS GIS layer (public, no auth needed).
// The old PaServicesProxy GetPropertySearchByAddress operation is broken — it
// returns "111 NW 1 ST" for every query regardless of input. The new MDPA app
// uses GetAddress, which requires browser-rendered session cookies and can't be
// called server-side.
//
// Folio detail still uses PaServicesProxy (GetPropertySearchByFolio still works).

import type { ExtractedProperty } from "@/lib/property-pipeline";

const PA_BASE =
  "https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx";

const GIS_ADDRESS_URL =
  "https://gis.miamidade.gov/arcgis/rest/services/AddressSearchMap_PropertiesWithZip/MapServer/0/query";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GISParcel = {
  folio: string;   // 13-digit, no dashes: "0131250780010"
  strap: string;   // Display format XX-XXXX-XXX-XXXX: "01-3125-078-0010"
  address: string; // Reconstructed: "3401 N MIAMI AVE"
};

// ─── GIS address search ───────────────────────────────────────────────────────

// Converts a 13-digit GIS folio to the dashed strap format used by MDPA detail.
// "0141370650001" → "01-4137-065-0001"
export function folioToStrap(folio: string): string {
  const f = folio.padStart(13, "0");
  return `${f.slice(0, 2)}-${f.slice(2, 6)}-${f.slice(6, 9)}-${f.slice(9, 13)}`;
}

// Strips dashes for the MDPA detail endpoint.
// "01-4137-065-0001" → "0141370650001"
function stripDashes(strap: string): string {
  return strap.replace(/-/g, "");
}

// Directional prefixes and street type suffixes to skip when extracting the
// distinctive street name keyword for the GIS LIKE query.
const DIRS  = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
const TYPES = new Set([
  "AVE","BLVD","ST","DR","CT","RD","LN","WAY","TER","PL","CIR","TRL",
  "PKWY","HWY","EXPY","PTE","PT","CV","GLN","RUN","VIS","LOOP","PASS",
]);

// Some real addresses spell out a small building number instead of using a
// digit — "One Westinghouse Plaza", "Two International Place", "One
// Biscayne Tower". Confirmed live against MassGIS: the parcel itself is
// stored numerically ("1 WESTINGHOUSE PZ..."), so the broker-typed spelled
// form just needs converting before the GIS query is built. Not a
// Massachusetts-specific convention (Miami has the same pattern), so this
// lives in the shared parser, not a per-state workaround. Only single/low
// double-digit spellings are real-world office-address conventions — this
// never needs to go higher.
const SPELLED_OUT_NUMBERS: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10,
  ELEVEN: 11, TWELVE: 12, THIRTEEN: 13, FOURTEEN: 14, FIFTEEN: 15, SIXTEEN: 16, SEVENTEEN: 17,
  EIGHTEEN: 18, NINETEEN: 19, TWENTY: 20,
};

// Parses a broker-typed address into the components used for GIS search.
// Returns null if a house number cannot be extracted.
export function parseAddressForGIS(
  raw: string
): {
  houseNum: number;
  // Second number in a hyphenated house-number range (e.g. "2317-2321 Stirling
  // Rd" -> 2321). Commercial parcels are often addressed as a range; callers
  // should retry with this number if houseNum finds nothing. Consuming the
  // whole "2317-2321" prefix here also keeps "-2321" from leaking into the
  // street-keyword parsing below.
  houseNumAlt?: number;
  streetKeyword: string;
  directional: string | null;
  streetType: string | null;
} | null {
  const street = raw.replace(/,.*$/, "").trim();

  const numMatch = street.match(/^(\d+)(?:-(\d+))?/);
  let houseNum: number;
  let houseNumAlt: number | undefined;
  let restStart: number;

  if (numMatch) {
    houseNum = parseInt(numMatch[1], 10);
    houseNumAlt = numMatch[2] ? parseInt(numMatch[2], 10) : undefined;
    restStart = numMatch[0].length;
  } else {
    const wordMatch = street.match(/^([A-Za-z]+)\b/);
    const spelledOut = wordMatch ? SPELLED_OUT_NUMBERS[wordMatch[1].toUpperCase()] : undefined;
    if (spelledOut === undefined) return null;
    houseNum = spelledOut;
    restStart = wordMatch![0].length;
  }

  const rest = street.slice(restStart).trim().toUpperCase();
  const allWords = rest.split(/\s+/).filter((w) => w.length > 0);

  // Peel off a leading directional prefix, if present
  let directional: string | null = null;
  const remaining = [...allWords];
  if (remaining.length > 0 && DIRS.has(remaining[0])) {
    directional = remaining.shift()!;
  }

  // Capture a trailing street type suffix (only the last token)
  let streetType: string | null = null;
  if (remaining.length > 0 && TYPES.has(remaining[remaining.length - 1])) {
    streetType = remaining[remaining.length - 1];
  }

  // Keyword: first remaining word that is neither a directional nor a type suffix
  const words = remaining.filter((w) => !DIRS.has(w) && !TYPES.has(w));
  if (words.length === 0) return null;

  // Keep only alphanumeric chars to avoid SQL injection via the GIS LIKE clause
  const streetKeyword = words[0].replace(/[^A-Z0-9]/g, "");
  if (streetKeyword.length < 2) return null;

  return { houseNum, houseNumAlt, streetKeyword, directional, streetType };
}

export async function searchByAddressGIS(
  rawAddress: string
): Promise<GISParcel[]> {
  const parsed = parseAddressForGIS(rawAddress);
  if (!parsed) {
    throw new Error(
      "Could not parse a street number from that address. Include the building number (e.g. '200 S Biscayne Blvd')."
    );
  }

  const { houseNum, streetKeyword, directional, streetType } = parsed;

  // Numbered street keywords (e.g. "2ND", "91ST") need word-boundary anchoring
  // to prevent substring false positives: "SW 142ND PL" must not match "2ND".
  // Named streets (e.g. "BISCAYNE", "LE") keep the simple %keyword% pattern.
  const isNumbered = /^\d/.test(streetKeyword);
  const keywordClause = isNumbered
    ? `(sname LIKE '% ${streetKeyword}%' OR sname LIKE '${streetKeyword} %')`
    : `sname LIKE '%${streetKeyword}%'`;

  let where = `hse_num=${houseNum} AND ${keywordClause}`;
  if (directional) {
    // Eliminates cross-directional matches (NW vs SW, W vs NW, etc.)
    where += ` AND sname LIKE '${directional} %'`;
  }

  const url = new URL(GIS_ADDRESS_URL);
  url.searchParams.set("where", where);
  url.searchParams.set("outFields", "FOLIO,SNAME,HSE_NUM");
  url.searchParams.set("f", "json");
  url.searchParams.set("resultRecordCount", "15");

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Miami-Dade GIS search failed: HTTP ${res.status}`);

  const data = (await res.json()) as {
    features?: { attributes: { FOLIO: string; SNAME: string; HSE_NUM: number } }[];
    error?: { message: string };
  };

  if (data.error) throw new Error(`GIS error: ${data.error.message}`);
  if (!data.features || data.features.length === 0) return [];

  const parcels = data.features.map((f) => {
    const attr = f.attributes;
    const strap = folioToStrap(attr.FOLIO);
    const address = `${attr.HSE_NUM} ${attr.SNAME}`;
    return { folio: attr.FOLIO, strap, address };
  });

  // When multiple parcels survive the WHERE filter, prefer the one whose street
  // name ends with the expected type suffix (e.g. "W 33RD ST" before "W 33RD PL").
  if (streetType && parcels.length > 1) {
    const typeSuffix = ` ${streetType}`;
    parcels.sort((a, b) => {
      const aScore = a.address.endsWith(typeSuffix) ? 1 : 0;
      const bScore = b.address.endsWith(typeSuffix) ? 1 : 0;
      return bScore - aScore;
    });
  }

  return parcels;
}

// ─── Folio detail ─────────────────────────────────────────────────────────────
// Still uses the PA proxy — GetPropertySearchByFolio continues to work.

export async function getPropertyDetail(strap: string): Promise<unknown> {
  const url = new URL(PA_BASE);
  url.searchParams.set("Operation", "GetPropertySearchByFolio");
  url.searchParams.set("clientAppName", "PropertySearch");
  url.searchParams.set("folioNumber", stripDashes(strap));

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`MDPA folio lookup failed: HTTP ${res.status}`);
  return res.json();
}

/** Owner mailing address from MDPA folio JSON (root MailingAddress, with OwnerInfos fallback). */
export function extractOwnerMailing(raw: unknown): string | null {
  const d = raw as {
    MailingAddress?: {
      Address1?: string;
      Address2?: string;
      Address3?: string;
      City?: string;
      State?: string;
      ZipCode?: string;
    };
    OwnerInfos?: Array<{
      MailingAddress1?: string;
      MailingAddress2?: string;
      City?: string;
      State?: string;
      ZipCode?: string;
    }>;
  };

  const root = d?.MailingAddress;
  if (root) {
    const parts: string[] = [];
    for (const line of [root.Address1, root.Address2, root.Address3]) {
      if (line?.trim()) parts.push(line.trim());
    }
    const cityState =
      root.City?.trim() && root.State?.trim()
        ? `${root.City.trim()}, ${root.State.trim()}${root.ZipCode?.trim() ? " " + root.ZipCode.trim() : ""}`
        : null;
    if (cityState) parts.push(cityState);
    if (parts.length > 0) return parts.join(", ");
  }

  const ownerInfo = d?.OwnerInfos?.[0];
  if (!ownerInfo) return null;
  const parts: string[] = [];
  if (ownerInfo.MailingAddress1?.trim()) parts.push(ownerInfo.MailingAddress1.trim());
  if (ownerInfo.MailingAddress2?.trim()) parts.push(ownerInfo.MailingAddress2.trim());
  const cityState =
    ownerInfo.City?.trim() && ownerInfo.State?.trim()
      ? `${ownerInfo.City.trim()}, ${ownerInfo.State.trim()}${ownerInfo.ZipCode?.trim() ? " " + ownerInfo.ZipCode.trim() : ""}`
      : null;
  if (cityState) parts.push(cityState);
  return parts.length > 0 ? parts.join(", ") : null;
}

// ─── Criteria search (lead finder) ────────────────────────────────────────────
//
// Uses MDC.PaGis (MD_ComparableSales/MapServer/5) — Miami-Dade's own Property
// Appraiser GIS attribute layer, the same one that backs the county's public
// "Comparable Sales" tool. This is a DIFFERENT service from the
// AddressSearchMap_PropertiesWithZip layer used by searchByAddressGIS above,
// which only exposes FOLIO/SNAME/HSE_NUM — confirmed live it has no
// building/land/value/use/year fields at all, so it cannot support criteria
// search. FOLIO format here is identical to address search's (13-digit,
// convertible via folioToStrap), so matches plug directly into the existing
// enrichment pipeline.
//
// DOR_CODE_CUR is a 4-character code (e.g. "4837", "8940") — confirmed live
// its first two digits are the standard statewide Florida DOR use-code
// category (48 = warehousing, 89 = municipal), the same category ranges
// dorCodeToPropertyType already uses elsewhere in this codebase (see
// app/properties/[id]/actions.ts, lib/bcpa-folio-ingest.ts). Filtered here by
// 2-digit prefix (LIKE 'NN%') rather than an exact 4-digit match, since the
// trailing two digits are a finer county-specific sub-code, not part of the
// standard scheme.

export type PropertyTypeFilter =
  | "residential" | "multifamily" | "retail" | "office" | "industrial" | "land";

function intRange(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

// Mirrors dorCodeToPropertyType's category ranges exactly (see
// app/properties/[id]/actions.ts) — duplicated as a literal table here rather
// than imported, since that function lives in a page-scoped actions file,
// not a shared lib module.
const DOR_CATEGORY_CODES: Record<PropertyTypeFilter, number[]> = {
  residential: [1],
  multifamily: [3, 4, 8],
  retail: intRange(20, 28),
  office: intRange(30, 39),
  industrial: intRange(40, 49),
  land: intRange(11, 18),
};

function dorPrefixClause(field: string, type: PropertyTypeFilter): string {
  const prefixes = DOR_CATEGORY_CODES[type].map((c) => String(c).padStart(2, "0"));
  return "(" + prefixes.map((p) => `${field} LIKE '${p}%'`).join(" OR ") + ")";
}

const MDPA_CRITERIA_URL =
  "https://gis.miamidade.gov/arcgis/rest/services/MD_ComparableSales/MapServer/5/query";

const CRITERIA_FIELDS = [
  "FOLIO", "TRUE_SITE_ADDR", "TRUE_SITE_CITY", "TRUE_OWNER1",
  "DOR_CODE_CUR", "DOR_DESC", "BUILDING_ACTUAL_AREA", "LOT_SIZE",
  "YEAR_BUILT", "ASSESSED_VAL_CUR", "DOS_1",
].join(",");

const CRITERIA_PAGE_SIZE = 200;

// DOS_1 ("date of sale", most recent) is a YYYYMMDD string (confirmed live,
// e.g. "20210623") — zero-padded so a plain string comparison against another
// YYYYMMDD string sorts correctly, no date parsing needed in the WHERE clause.
function yyyymmddYearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

export type MdpaCriteria = {
  buildingSqftMin?: number;
  buildingSqftMax?: number;
  landSqftMin?: number;
  landSqftMax?: number;
  propertyType?: PropertyTypeFilter;
  assessedValueMin?: number;
  assessedValueMax?: number;
  yearBuiltMin?: number;
  yearBuiltMax?: number;
  /** Matched against TRUE_SITE_CITY (uppercased, exact match per city). */
  cities?: string[];
  /** Last sale within the last N years — a live "ownership recently changed" signal. */
  soldWithinYears?: number;
  /** Last sale at least N years ago — a "long-held" signal. */
  heldAtLeastYears?: number;
};

export type MdpaCriteriaMatch = {
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
  lastSaleDate: string | null;
};

export type CriteriaSearchResult =
  | { kind: "ok"; matches: MdpaCriteriaMatch[]; totalCount: number }
  | { kind: "too_many"; count: number }
  | { kind: "error"; message: string };

/** Exported for testing — builds the ArcGIS WHERE clause from broker criteria. */
export function buildMdpaCriteriaWhere(criteria: MdpaCriteria): string {
  const clauses: string[] = [];

  if (criteria.buildingSqftMin != null || criteria.buildingSqftMax != null) {
    clauses.push(`BUILDING_ACTUAL_AREA BETWEEN ${criteria.buildingSqftMin ?? 0} AND ${criteria.buildingSqftMax ?? 999_999_999}`);
  }
  if (criteria.landSqftMin != null || criteria.landSqftMax != null) {
    clauses.push(`LOT_SIZE BETWEEN ${criteria.landSqftMin ?? 0} AND ${criteria.landSqftMax ?? 999_999_999}`);
  }
  if (criteria.assessedValueMin != null || criteria.assessedValueMax != null) {
    clauses.push(`ASSESSED_VAL_CUR BETWEEN ${criteria.assessedValueMin ?? 0} AND ${criteria.assessedValueMax ?? 999_999_999_999}`);
  }
  if (criteria.yearBuiltMin != null || criteria.yearBuiltMax != null) {
    clauses.push(`YEAR_BUILT BETWEEN ${criteria.yearBuiltMin ?? 1800} AND ${criteria.yearBuiltMax ?? 2100}`);
  }
  if (criteria.propertyType) {
    clauses.push(dorPrefixClause("DOR_CODE_CUR", criteria.propertyType));
  }
  if (criteria.cities && criteria.cities.length > 0) {
    const cityList = criteria.cities.map((c) => `'${c.replace(/'/g, "''").toUpperCase()}'`).join(",");
    clauses.push(`UPPER(TRUE_SITE_CITY) IN (${cityList})`);
  }
  if (criteria.soldWithinYears != null) {
    clauses.push(`DOS_1 >= '${yyyymmddYearsAgo(criteria.soldWithinYears)}'`);
  }
  if (criteria.heldAtLeastYears != null) {
    clauses.push(`DOS_1 <= '${yyyymmddYearsAgo(criteria.heldAtLeastYears)}'`);
  }
  // Excludes rows this layer itself flags as not real standalone parcels
  // (e.g. reference-only condo master records, cancelled folios) — confirmed
  // live these flags exist on this layer; without this a lead list could
  // include a non-addressable record.
  clauses.push(`(REFERENCE_ONLY_FLAG IS NULL OR REFERENCE_ONLY_FLAG <> 'Y')`);
  clauses.push(`(CANCEL_FLAG IS NULL OR CANCEL_FLAG <> 'Y')`);

  return clauses.length > 0 ? clauses.join(" AND ") : "1=1";
}

function mdpaCriteriaMatchFromAttrs(a: Record<string, unknown>): MdpaCriteriaMatch | null {
  const folio = String(a.FOLIO ?? "").trim();
  if (!folio) return null;
  return {
    folio,
    strap: folioToStrap(folio),
    address: (a.TRUE_SITE_ADDR as string | null)?.trim() || null,
    city: (a.TRUE_SITE_CITY as string | null)?.trim() || null,
    ownerName: (a.TRUE_OWNER1 as string | null)?.trim() || null,
    buildingSqft: (a.BUILDING_ACTUAL_AREA as number | null) ?? null,
    landSqft: (a.LOT_SIZE as number | null) ?? null,
    useCode: (a.DOR_CODE_CUR as string | null) ?? null,
    useDescription: (a.DOR_DESC as string | null) ?? null,
    assessedValue: (a.ASSESSED_VAL_CUR as number | null) ?? null,
    yearBuilt: (a.YEAR_BUILT as number | null) ?? null,
    lastSaleDate: (a.DOS_1 as string | null) ?? null,
  };
}

/**
 * Criteria-based parcel search for the lead finder (see lib/lead-finder.ts).
 * Counts matches first (returnCountOnly — instant, no record transfer) so a
 * too-broad search returns the real total instead of silently truncating;
 * only paginates through actual records when the count is within maxResults.
 */
// ArcGIS sometimes returns an error object with an empty message (confirmed
// live on Massachusetts's service — see lib/magis.ts) — falls back to
// `details` so the broker never sees a blank error badge.
function extractArcgisErrorMessage(err: { message: string; details?: string[] }): string {
  if (err.message) return err.message;
  if (err.details && err.details.length > 0) return err.details.join("; ");
  return "Unknown error from the county service.";
}

export async function searchByCriteria(
  criteria: MdpaCriteria,
  maxResults = 200,
): Promise<CriteriaSearchResult> {
  const where = buildMdpaCriteriaWhere(criteria);

  const countUrl = new URL(MDPA_CRITERIA_URL);
  countUrl.searchParams.set("where", where);
  countUrl.searchParams.set("returnCountOnly", "true");
  countUrl.searchParams.set("f", "json");

  const countRes = await fetch(countUrl.toString(), { next: { revalidate: 0 } });
  if (!countRes.ok) return { kind: "error", message: `Miami-Dade criteria search failed: HTTP ${countRes.status}` };
  const countData = (await countRes.json()) as { count?: number; error?: { message: string; details?: string[] } };
  if (countData.error) return { kind: "error", message: extractArcgisErrorMessage(countData.error) };

  const totalCount = countData.count ?? 0;
  if (totalCount === 0) return { kind: "ok", matches: [], totalCount: 0 };
  if (totalCount > maxResults) return { kind: "too_many", count: totalCount };

  const matches: MdpaCriteriaMatch[] = [];
  let offset = 0;
  while (matches.length < totalCount) {
    const url = new URL(MDPA_CRITERIA_URL);
    url.searchParams.set("where", where);
    url.searchParams.set("outFields", CRITERIA_FIELDS);
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("orderByFields", "FOLIO");
    url.searchParams.set("resultRecordCount", String(CRITERIA_PAGE_SIZE));
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("f", "json");

    const res = await fetch(url.toString(), {
      next: { revalidate: 0 },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { kind: "error", message: `Miami-Dade criteria search failed: HTTP ${res.status}` };
    const data = (await res.json()) as {
      features?: { attributes: Record<string, unknown> }[];
      error?: { message: string; details?: string[] };
    };
    if (data.error) return { kind: "error", message: extractArcgisErrorMessage(data.error) };

    const features = data.features ?? [];
    if (features.length === 0) break;
    for (const f of features) {
      const match = mdpaCriteriaMatchFromAttrs(f.attributes);
      if (match) matches.push(match);
    }
    offset += features.length;
    if (features.length < CRITERIA_PAGE_SIZE) break;
  }

  return { kind: "ok", matches, totalCount };
}

export type MdpaPropertyInfo = {
  yearBuilt: number | null;
  lotSize: number | null;
  stories: number | null;
  units: number | null;
  assessedValue: number | null;
  buildingArea: number | null;
};

function mdpaNumber(info: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const raw = info[key];
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Read structured building fields from MDPA folio JSON — no model required. */
export function parseMdpaPropertyInfo(raw: unknown): MdpaPropertyInfo {
  const info = (raw as { PropertyInfo?: Record<string, unknown> } | null)?.PropertyInfo ?? {};
  return {
    yearBuilt: mdpaNumber(info, "YearBuilt", "ActualYearBuilt", "EffectiveYearBuilt"),
    lotSize: mdpaNumber(info, "LotSize"),
    stories: mdpaNumber(info, "Stories", "ActualStories"),
    units: mdpaNumber(info, "Units", "NoOfUnits"),
    assessedValue: mdpaNumber(info, "AssessedValue"),
    buildingArea: mdpaNumber(info, "BuildingActualArea", "BuildingAdjustedArea"),
  };
}

/** Fill empty extract fields from MDPA PropertyInfo so custom aliases (Year Built) can copy them. */
export function overlayMdpaOnExtracted(
  fields: ExtractedProperty,
  raw: unknown,
): ExtractedProperty {
  const info = parseMdpaPropertyInfo(raw);
  const bc = { ...(fields.building_composition ?? {}) };
  if (bc.year_built == null && info.yearBuilt != null) bc.year_built = info.yearBuilt;
  if (bc.lot_size_sqft == null && info.lotSize != null) bc.lot_size_sqft = info.lotSize;
  if (bc.stories == null && info.stories != null) bc.stories = info.stories;
  if (bc.units == null && info.units != null) bc.units = info.units;
  if (bc.assessed_value == null && info.assessedValue != null) bc.assessed_value = info.assessedValue;
  return {
    ...fields,
    size_sqft: fields.size_sqft ?? info.buildingArea,
    building_composition: bc,
  };
}
