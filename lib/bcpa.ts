// Broward County Property Appraiser — server-only
//
// Address search and folio detail use Broward County's own parcel FeatureServer
// (public, no auth). BCPA folios are 12 digits (no dashes); display format is
// XX-XXXX-XX-XXXX (2-4-2-4).
//
// Sale dates on this service are year + month only (SALE_YR1 / SALE_MO1) — no day.
// Callers must not invent a calendar day when mapping those fields.
//
// parseAddressForGIS is shared from lib/mdpa since address parsing logic is identical.

import { parseAddressForGIS } from "./mdpa";
import { normalizeOwnerName, personNameMatchesOwnerField } from "@/lib/owner-contacts";
import { entityOwnerNamesMatch } from "./mdpa-owner-search";

export { parseAddressForGIS };

const BCPA_URL =
  "https://services5.arcgis.com/wI5GZmCtnUU8ueya/arcgis/rest/services/Broward_County_Parcel_Boundary/FeatureServer/1/query";

const SEARCH_FIELDS = "PARCELNO,PHY_ADDR1,PHY_CITY";

const DETAIL_FIELDS = [
  "PARCELNO",
  "OWN_NAME",
  "OWN_ADDR1",
  "OWN_ADDR2",
  "OWN_CITY",
  "OWN_STATE",
  "OWN_ZIPCD",
  "PHY_ADDR1",
  "PHY_CITY",
  "PHY_ZIPCD",
  "TOT_LVG_AREA",
  "DOR_UC",
  "PA_UC",
  "ACT_YR_BLT",
  "EFF_YR_BLT",
  "SALE_PRC1",
  "SALE_YR1",
  "SALE_MO1",
  "LND_SQFOOT",
  "JV",
  "NO_BULDNG",
].join(",");

const RESULT_RECORD_COUNT = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

export type BCPAParcel = {
  folio: string;  // 12-digit, no dashes: "514209051449"
  strap: string;  // Display format: "51-4209-05-1449"
  address: string; // From PHY_ADDR1: "2116 SHERMAN ST"
  city: string;    // From PHY_CITY: "HOLLYWOOD"
};

export type BCPARecord = {
  PARCELNO: string;
  OWN_NAME: string | null;
  OWN_ADDR1: string | null;
  OWN_ADDR2: string | null;
  OWN_CITY: string | null;
  OWN_STATE: string | null;
  OWN_ZIPCD: number | string | null;
  PHY_ADDR1: string | null;
  PHY_CITY: string | null;
  PHY_ZIPCD: number | string | null;
  TOT_LVG_AREA: number | null;
  DOR_UC: string | null;
  PA_UC: string | null;
  ACT_YR_BLT: number | null;
  EFF_YR_BLT: number | null;
  SALE_PRC1: number | null;
  SALE_YR1: number | null;
  SALE_MO1: string | number | null;
  LND_SQFOOT: number | null;
  JV: number | null;
  NO_BULDNG: number | null;
};

// ─── Folio format ─────────────────────────────────────────────────────────────

// Converts a 12-digit BCPA folio to the dashed strap display format.
// "514209051449" → "51-4209-05-1449"
export function folioToStrap(folio: string): string {
  const f = folio.replace(/-/g, "").padStart(12, "0");
  return `${f.slice(0, 2)}-${f.slice(2, 6)}-${f.slice(6, 8)}-${f.slice(8, 12)}`;
}

// ─── GIS address search ───────────────────────────────────────────────────────

export type GISSearchResult =
  | { kind: "ok"; parcels: BCPAParcel[] }
  | { kind: "error"; message: string }
  | { kind: "too_many_candidates" };

function sortParcels(
  parcels: BCPAParcel[],
  houseNum: number,
  dir: string | null,
  streetType: string | null
): BCPAParcel[] {
  if (!(dir || streetType) || parcels.length <= 1) return parcels;
  const dirPrefix = dir ? `${houseNum} ${dir} ` : null;
  const typeSuffix = streetType ? ` ${streetType}` : null;
  return [...parcels].sort((a, b) => {
    const score = (p: BCPAParcel) =>
      (dirPrefix && p.address.startsWith(dirPrefix) ? 2 : 0) +
      (typeSuffix && p.address.endsWith(typeSuffix) ? 1 : 0);
    return score(b) - score(a);
  });
}

/**
 * Search Broward parcels by address.
 *
 * @param rawAddress  Street address, optionally with city suffix (e.g. "2116 Sherman St, Hollywood").
 * @param _city       Reserved for county-router compatibility; unused — the Broward parcel
 *                    service accepts a tight house-number + keyword WHERE, so city scoping
 *                    is no longer needed.
 *
 * Returns:
 *   { kind: "ok"; parcels }           — success (parcels may be empty = genuine miss)
 *   { kind: "error"; message }        — service failure; caller should log + surface to user
 *   { kind: "too_many_candidates" }   — result page saturated with no keyword match after
 *                                       JS filter; parcel may exist but can't be isolated
 */
export async function searchByAddressGIS(
  rawAddress: string,
  _city?: string
): Promise<GISSearchResult> {
  const parsed = parseAddressForGIS(rawAddress);
  if (!parsed) {
    throw new Error(
      "Could not parse a street number from that address. Include the building number (e.g. '200 W Broward Blvd')."
    );
  }

  const { houseNum, streetKeyword, directional, streetType } = parsed;
  const kw = streetKeyword.toUpperCase();
  const dir = directional?.toUpperCase() ?? null;

  // Tight server-side WHERE: house number + street keyword (+ directional when present).
  // Confirmed working on this service, e.g. PHY_ADDR1 LIKE '2116 SHERMAN%'.
  const prefix = dir ? `${houseNum} ${dir} ${kw}` : `${houseNum} ${kw}`;
  const where = `PHY_ADDR1 LIKE '${prefix}%'`;

  // JS-side keyword match — word-boundary check for numbered streets ("3RD" must not match "13RD")
  const isNumbered = /^\d/.test(kw);
  const matchesKeyword = (addr: string): boolean =>
    isNumbered ? addr.includes(` ${kw}`) || addr.endsWith(kw) : addr.includes(kw);

  const url = new URL(BCPA_URL);
  url.searchParams.set("where", where);
  url.searchParams.set("outFields", SEARCH_FIELDS);
  url.searchParams.set("f", "json");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", String(RESULT_RECORD_COUNT));

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    return { kind: "error", message: `GIS search failed: HTTP ${res.status}` };
  }

  const data = (await res.json()) as {
    features?: { attributes: { PARCELNO: string; PHY_ADDR1: string; PHY_CITY: string } }[];
    error?: { message: string };
  };

  if (data.error) {
    return { kind: "error", message: data.error.message };
  }

  const parcels: BCPAParcel[] = (data.features ?? []).map((f) => {
    const attr = f.attributes;
    const folio = String(attr.PARCELNO ?? "").replace(/-/g, "");
    return {
      folio,
      strap: folioToStrap(folio),
      address: (attr.PHY_ADDR1 ?? "").trim().toUpperCase(),
      city: (attr.PHY_CITY ?? "").trim().toUpperCase(),
    };
  });

  const filtered = parcels.filter((p) => matchesKeyword(p.address));

  if (filtered.length > 0) {
    return { kind: "ok", parcels: sortParcels(filtered, houseNum, dir, streetType) };
  }

  // Full page of non-matching rows — can't isolate without a tighter query.
  if (parcels.length >= RESULT_RECORD_COUNT) {
    return { kind: "too_many_candidates" };
  }

  return { kind: "ok", parcels: [] };
}

// ─── Folio detail ─────────────────────────────────────────────────────────────
// Fetches the full parcel record by exact PARCELNO match.

export async function getPropertyDetail(folio: string): Promise<BCPARecord | null> {
  const cleanFolio = folio.replace(/-/g, "");

  const url = new URL(BCPA_URL);
  url.searchParams.set("where", `PARCELNO='${cleanFolio}'`);
  url.searchParams.set("outFields", DETAIL_FIELDS);
  url.searchParams.set("f", "json");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", "1");

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`BCPA folio lookup failed: HTTP ${res.status}`);

  const data = (await res.json()) as {
    features?: { attributes: BCPARecord }[];
    error?: { message: string };
  };

  if (data.error) throw new Error(`GIS error: ${data.error.message}`);
  if (!data.features || data.features.length === 0) return null;

  return data.features[0].attributes;
}

// ─── Owner mailing address extraction ────────────────────────────────────────

/** Owner mailing address from a BCPARecord (Broward County parcel service). */
export function extractOwnerMailing(raw: unknown): string | null {
  const r = raw as BCPARecord | null;
  if (!r) return null;

  const parts: string[] = [];
  if (r.OWN_ADDR1?.trim()) parts.push(r.OWN_ADDR1.trim());
  if (r.OWN_ADDR2?.trim()) parts.push(r.OWN_ADDR2.trim());

  const zipRaw = r.OWN_ZIPCD;
  const zip =
    zipRaw != null && String(zipRaw).trim() !== ""
      ? String(zipRaw).replace(/\D/g, "").padStart(5, "0").slice(0, 5)
      : null;
  const cityState =
    r.OWN_CITY?.trim() && r.OWN_STATE?.trim()
      ? `${r.OWN_CITY.trim()}, ${r.OWN_STATE.trim()}${zip ? " " + zip : ""}`
      : null;
  if (cityState) parts.push(cityState);

  return parts.length > 0 ? parts.join(", ") : null;
}

// ─── Owner name search (tax roll portfolio discovery) ────────────────────────
// Same FeatureServer as address search / folio detail above, filtered by
// OWN_NAME instead of PHY_ADDR1/PARCELNO. Broward's parcel service only
// exposes a single owner field (no OWNER2/OWNER3 like Miami-Dade), so the
// WHERE clause and match verification are simpler than lib/mdpa-owner-search.ts.
// entityOwnerNamesMatch is reused from there since it operates on generic
// owner-name strings, not Miami-Dade-specific data.

export type BcpaSearchMode = "entity" | "person";

export type BcpaOwnerParcelHit = {
  folio: string;
  strap: string;
  ownerName: string;
  address: string | null;
  city: string | null;
  buildingSqft: number | null;
};

type OwnerSearchAttributes = {
  PARCELNO?: string;
  OWN_NAME?: string | null;
  PHY_ADDR1?: string | null;
  PHY_CITY?: string | null;
  TOT_LVG_AREA?: number | null;
};

const OWNER_SEARCH_FIELDS = "PARCELNO,OWN_NAME,PHY_ADDR1,PHY_CITY,TOT_LVG_AREA";

const OWNER_PAGE_SIZE = 1000;
const OWNER_MAX_PARCELS = 3000;

const ENTITY_STOP_WORDS = new Set([
  "LLC", "INC", "CORP", "LP", "LLP", "LLLP", "LTD", "CO", "PA", "PL", "PLLC",
  "THE", "AND", "OF", "A", "FL", "FLORIDA",
]);

function sanitizeOwnerLikeToken(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function ownerEntitySearchTokens(query: string): string[] {
  const upper = sanitizeOwnerLikeToken(query).toUpperCase();
  let tokens = upper
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !ENTITY_STOP_WORDS.has(w));
  if (tokens.length === 0) {
    tokens = upper.split(/\s+/).filter((w) => w.length >= 2);
  }
  tokens.sort((a, b) => b.length - a.length);
  return tokens.slice(0, 2);
}

function buildOwnerWhereClause(query: string, mode: BcpaSearchMode): string {
  const safe = sanitizeOwnerLikeToken(query);
  if (safe.length < 2) {
    throw new Error("Owner name is too short to search the tax roll.");
  }

  if (mode === "person") {
    const parts = safe.split(/\s+/).filter((p) => p.length >= 2);
    if (parts.length === 0) {
      throw new Error("Owner name is too short to search the tax roll.");
    }
    const andParts = parts
      .map((p) => `UPPER(OWN_NAME) LIKE UPPER('%${p}%')`)
      .join(" AND ");
    return `(${andParts})`;
  }

  const tokens = ownerEntitySearchTokens(query);
  if (tokens.length === 0) {
    throw new Error("Could not build a tax roll search from that owner name.");
  }
  const andParts = tokens.map((p) => `UPPER(OWN_NAME) LIKE '%${p}%'`).join(" AND ");
  return `(${andParts})`;
}

function ownerParcelMatchesQuery(
  ownerName: string | null | undefined,
  query: string,
  mode: BcpaSearchMode,
): boolean {
  if (!ownerName?.trim()) return false;
  if (mode === "entity") return entityOwnerNamesMatch(query, ownerName);
  return personNameMatchesOwnerField(query, ownerName);
}

function hitFromOwnerAttributes(attrs: OwnerSearchAttributes): BcpaOwnerParcelHit | null {
  const folioRaw = attrs.PARCELNO?.trim();
  if (!folioRaw) return null;
  const folio = folioRaw.replace(/-/g, "").padStart(12, "0");
  const ownerName = attrs.OWN_NAME?.trim();
  if (!ownerName) return null;

  const sqft = attrs.TOT_LVG_AREA;
  return {
    folio,
    strap: folioToStrap(folio),
    ownerName,
    address: attrs.PHY_ADDR1?.trim() || null,
    city: attrs.PHY_CITY?.trim() || null,
    buildingSqft: typeof sqft === "number" && sqft > 0 ? Math.round(sqft) : null,
  };
}

async function fetchOwnerParcelsPage(
  where: string,
  offset: number,
): Promise<{ features: { attributes: OwnerSearchAttributes }[]; exceededTransferLimit?: boolean }> {
  const url = new URL(BCPA_URL);
  url.searchParams.set("where", where);
  url.searchParams.set("outFields", OWNER_SEARCH_FIELDS);
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", String(OWNER_PAGE_SIZE));
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("f", "json");

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`Broward tax roll owner search failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    features?: { attributes: OwnerSearchAttributes }[];
    error?: { message: string };
    exceededTransferLimit?: boolean;
  };

  if (data.error) {
    throw new Error(`Tax roll search error: ${data.error.message}`);
  }

  return {
    features: data.features ?? [],
    exceededTransferLimit: data.exceededTransferLimit,
  };
}

/** Search Broward tax roll by owner / entity name (OWN_NAME). */
export async function searchParcelsByOwnerName(
  query: string,
  mode: BcpaSearchMode,
): Promise<BcpaOwnerParcelHit[]> {
  const where = buildOwnerWhereClause(query, mode);

  const byFolio = new Map<string, BcpaOwnerParcelHit>();
  let offset = 0;

  while (byFolio.size < OWNER_MAX_PARCELS) {
    const { features, exceededTransferLimit } = await fetchOwnerParcelsPage(where, offset);
    if (features.length === 0) break;

    for (const f of features) {
      if (!ownerParcelMatchesQuery(f.attributes.OWN_NAME, query, mode)) continue;
      const hit = hitFromOwnerAttributes(f.attributes);
      if (hit) byFolio.set(hit.folio, hit);
    }

    offset += features.length;
    if (features.length < OWNER_PAGE_SIZE) break;
    if (exceededTransferLimit && offset >= OWNER_MAX_PARCELS) break;
  }

  return [...byFolio.values()].sort((a, b) =>
    (a.address ?? a.folio).localeCompare(b.address ?? b.folio),
  );
}

/** Run multiple tax roll owner searches and merge by folio. */
export async function searchParcelsByOwnerQueries(
  queries: { query: string; mode: BcpaSearchMode }[],
): Promise<BcpaOwnerParcelHit[]> {
  const byFolio = new Map<string, BcpaOwnerParcelHit>();
  const seen = new Set<string>();

  for (const { query, mode } of queries) {
    const trimmed = query.trim();
    if (!trimmed) continue;
    const key = `${mode}:${normalizeOwnerName(trimmed)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const hits = await searchParcelsByOwnerName(trimmed, mode);
    for (const hit of hits) {
      byFolio.set(hit.folio, hit);
    }
  }

  return [...byFolio.values()].sort((a, b) =>
    (a.address ?? a.folio).localeCompare(b.address ?? b.folio),
  );
}
