// Broward County Property Appraiser — server-only
//
// Address search uses the Florida DOR Statewide Cadastral Feature Service (public, no auth).
// This covers all 67 Florida counties and has structured owner/address/building data.
// BCPA folios are 12 digits (no dashes); display format is XX-XXXX-XX-XXXX (2-4-2-4).
//
// GIS address search uses PHY_ADDR1 LIKE pattern against the statewide feature service.
// Folio detail is fetched from the same service by PARCEL_ID exact match.
//
// parseAddressForGIS is shared from lib/mdpa since address parsing logic is identical.

import { parseAddressForGIS } from "./mdpa";

export { parseAddressForGIS };

const STATEWIDE_URL =
  "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query";

// Broward County is CO_NO = 16 in the DOR statewide cadastral dataset.
// ArcGIS equality ( = ) fails on this service for both numeric and string fields
// even when the SQL is syntactically valid. BETWEEN is the reliable workaround.
const BROWARD_CO_NO = 16;

const SEARCH_FIELDS = "PARCEL_ID,PHY_ADDR1,PHY_CITY";

const DETAIL_FIELDS = [
  "PARCEL_ID",
  "OWN_NAME",
  "OWN_ADDR1",
  "OWN_ADDR2",
  "OWN_CITY",
  "OWN_STATE",
  "OWN_ZIPCD",
  "PHY_ADDR1",
  "PHY_CITY",
  "PHY_ZIPCD",
  "TOT_LVG_AR",
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

// ─── Types ────────────────────────────────────────────────────────────────────

export type BCPAParcel = {
  folio: string;  // 12-digit, no dashes: "494101070090"
  strap: string;  // Display format: "49-4101-07-0090"
  address: string; // From PHY_ADDR1: "200 W BROWARD BLVD"
  city: string;    // From PHY_CITY: "FORT LAUDERDALE"
};

export type BCPARecord = {
  PARCEL_ID: string;
  OWN_NAME: string | null;
  OWN_ADDR1: string | null;
  OWN_ADDR2: string | null;
  OWN_CITY: string | null;
  OWN_STATE: string | null;
  OWN_ZIPCD: number | null;
  PHY_ADDR1: string | null;
  PHY_CITY: string | null;
  PHY_ZIPCD: number | null;
  TOT_LVG_AR: number | null;
  DOR_UC: string | null;
  PA_UC: string | null;
  ACT_YR_BLT: number | null;
  EFF_YR_BLT: number | null;
  SALE_PRC1: number | null;
  SALE_YR1: number | null;
  SALE_MO1: string | null;
  LND_SQFOOT: number | null;
  JV: number | null;
  NO_BULDNG: number | null;
};

// ─── Folio format ─────────────────────────────────────────────────────────────

// Converts a 12-digit BCPA folio to the dashed strap display format.
// "494101070090" → "49-4101-07-0090"
export function folioToStrap(folio: string): string {
  const f = folio.replace(/-/g, "").padStart(12, "0");
  return `${f.slice(0, 2)}-${f.slice(2, 6)}-${f.slice(6, 8)}-${f.slice(8, 12)}`;
}

// ─── GIS address search ───────────────────────────────────────────────────────

export type GISSearchResult =
  | { kind: "ok"; parcels: BCPAParcel[] }
  | { kind: "error"; message: string }
  | { kind: "too_many_candidates" };

const PAGE_SIZE = 25;
const MAX_PAGES = 8; // 200 parcels max per lookup

type PageOutcome =
  | { kind: "page"; parcels: BCPAParcel[]; exceededTransferLimit: boolean }
  | { kind: "http_error"; status: number }
  | { kind: "gis_error"; message: string };

async function fetchPage(where: string, page: number): Promise<PageOutcome> {
  const url = new URL(STATEWIDE_URL);
  url.searchParams.set("where", where);
  url.searchParams.set("outFields", SEARCH_FIELDS);
  url.searchParams.set("f", "json");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  if (page > 0) url.searchParams.set("resultOffset", String(page * PAGE_SIZE));

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return { kind: "http_error", status: res.status };

  const data = (await res.json()) as {
    features?: { attributes: { PARCEL_ID: string; PHY_ADDR1: string; PHY_CITY: string } }[];
    exceededTransferLimit?: boolean;
    error?: { message: string };
  };

  if (data.error) return { kind: "gis_error", message: data.error.message };

  const parcels: BCPAParcel[] = (data.features ?? []).map((f) => {
    const attr = f.attributes;
    const folio = (attr.PARCEL_ID ?? "").replace(/-/g, "");
    return {
      folio,
      strap: folioToStrap(folio),
      address: (attr.PHY_ADDR1 ?? "").trim().toUpperCase(),
      city: (attr.PHY_CITY ?? "").trim().toUpperCase(),
    };
  });

  return { kind: "page", parcels, exceededTransferLimit: data.exceededTransferLimit ?? false };
}

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
 * @param city        City name extracted from the address — used as a server-side PHY_CITY LIKE
 *                    filter to collapse most lookups to a single page. Falls back to paginated
 *                    house-number-only search if the service rejects the city filter or the
 *                    result set still exceeds a page.
 *
 * Returns:
 *   { kind: "ok"; parcels }           — success (parcels may be empty = genuine miss)
 *   { kind: "error"; message }        — service failure; caller should log + surface to user
 *   { kind: "too_many_candidates" }   — pagination exhausted with more results still available;
 *                                       a real property exists but can't be isolated without city
 */
export async function searchByAddressGIS(
  rawAddress: string,
  city?: string
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

  // The statewide ArcGIS service only accepts LIKE patterns of the form
  // 'houseNum %' on PHY_ADDR1 — any keyword after the house number causes
  // "Invalid query parameters". CO_NO equality also fails; BETWEEN is the
  // reliable workaround. All street filtering happens in JS post-fetch.
  const baseWhere = `CO_NO BETWEEN ${BROWARD_CO_NO} AND ${BROWARD_CO_NO} AND PHY_ADDR1 LIKE '${houseNum} %'`;

  // JS-side keyword match — word-boundary check for numbered streets ("3RD" must not match "13RD")
  const isNumbered = /^\d/.test(kw);
  const matchesKeyword = (addr: string): boolean =>
    isNumbered ? addr.includes(` ${kw}`) || addr.endsWith(kw) : addr.includes(kw);

  // ── City-scoped fast path ──────────────────────────────────────────────────
  // PHY_CITY LIKE is tested differently from PHY_ADDR1 keyword embeds and may
  // be accepted where those are rejected. A city + house number is precise
  // enough that a single page covers all candidates; no pagination needed.
  if (city) {
    const cityUpper = city.toUpperCase().trim();
    const outcome = await fetchPage(
      `${baseWhere} AND PHY_CITY LIKE '${cityUpper}%'`,
      0
    );

    if (outcome.kind === "page") {
      const filtered = outcome.parcels.filter((p) => matchesKeyword(p.address));
      if (filtered.length > 0) {
        return { kind: "ok", parcels: sortParcels(filtered, houseNum, dir, streetType) };
      }
      // PHY_CITY is frequently blank in the statewide dataset — a city-filtered
      // miss does NOT mean the parcel doesn't exist. Fall through to paginated
      // house-number search in all non-match cases.
    }
    // http_error, gis_error, empty, or no keyword match — fall through to paginated search
  }

  // ── Paginated house-number-only search ────────────────────────────────────
  for (let page = 0; page < MAX_PAGES; page++) {
    const outcome = await fetchPage(baseWhere, page);

    if (outcome.kind === "http_error") {
      return { kind: "error", message: `GIS search failed: HTTP ${outcome.status}` };
    }
    if (outcome.kind === "gis_error") {
      return { kind: "error", message: outcome.message };
    }
    if (outcome.parcels.length === 0) {
      return { kind: "ok", parcels: [] };
    }

    const filtered = outcome.parcels.filter((p) => matchesKeyword(p.address));
    if (filtered.length > 0) {
      return { kind: "ok", parcels: sortParcels(filtered, houseNum, dir, streetType) };
    }

    if (!outcome.exceededTransferLimit) {
      return { kind: "ok", parcels: [] };
    }
  }

  // Pagination exhausted — the target parcel exists but can't be isolated
  // without a city to narrow the house-number result set.
  return { kind: "too_many_candidates" };
}

// ─── Folio detail ─────────────────────────────────────────────────────────────
// Fetches the full parcel record from the statewide service by exact PARCEL_ID match.
// Unlike MDPA's raw JSON proxy, the statewide service returns structured attributes.

export async function getPropertyDetail(folio: string): Promise<BCPARecord | null> {
  const cleanFolio = folio.replace(/-/g, "");

  const url = new URL(STATEWIDE_URL);
  // Use LIKE without wildcards for exact match — ArcGIS equality (=) fails on this
  // service for both string and numeric fields; LIKE with no wildcards is equivalent.
  url.searchParams.set("where", `PARCEL_ID LIKE '${cleanFolio}'`);
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

/** Owner mailing address from a BCPARecord (DOR statewide dataset). */
export function extractOwnerMailing(raw: unknown): string | null {
  const r = raw as BCPARecord | null;
  if (!r) return null;

  const parts: string[] = [];
  if (r.OWN_ADDR1?.trim()) parts.push(r.OWN_ADDR1.trim());
  if (r.OWN_ADDR2?.trim()) parts.push(r.OWN_ADDR2.trim());

  const zip = r.OWN_ZIPCD != null ? String(Math.round(r.OWN_ZIPCD)).padStart(5, "0") : null;
  const cityState =
    r.OWN_CITY?.trim() && r.OWN_STATE?.trim()
      ? `${r.OWN_CITY.trim()}, ${r.OWN_STATE.trim()}${zip ? " " + zip : ""}`
      : null;
  if (cityState) parts.push(cityState);

  return parts.length > 0 ? parts.join(", ") : null;
}
