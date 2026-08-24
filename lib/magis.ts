// Massachusetts (MassGIS) — server-only
//
// Unlike Florida (one ArcGIS service per county), Massachusetts is covered
// by a SINGLE statewide hosted feature layer maintained by MassGIS:
//   https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0
// (Not "L3_TAXPAR_POLY_ASSESS_gdb" — that exact service name doesn't exist
// under MassGIS's ArcGIS Online org; this is the real, currently-hosted
// layer with the same statewide standardized-parcel scope.)
//
// Confirmed live (layer metadata + sample queries against real Boston-area
// parcels): the assessor extract is NOT a separate related table requiring
// a join — `relationships: []` and no `tables[]` on the service root. Every
// field (address, owner, value, sale, use) is directly on this one polygon
// layer's attributes, queryable in a single request. This is the one
// structural way Massachusetts is SIMPLER than Florida, not harder.
//
// LOC_ID is MassGIS's statewide standardized parcel identifier (e.g.
// "F_790618_2965662") — used here as both folio and strap, since (unlike
// Florida's raw-digit-PCN vs. dashed-display-strap split) there is no
// separate raw/display format to convert between.
//
// USE_CODE is NOT a clean, consistent numeric code the way Broward/Miami-
// Dade's DOR code is — confirmed live via a groupByFieldsForStatistics
// query across the whole table: the same code (e.g. "1021") maps to
// different USE_DESC values in different towns ("Condo", "Boarding House",
// "Condominium-Association" all under "1021"), because each town's local
// assessor system supplies its own code. Classification here goes off the
// free-text USE_DESC instead, the same approach lib/pbcpa.ts uses for
// Palm Beach's free-text PROPERTY_USE — see useDescToType.
//
// LS_DATE is a YYYYMMDD STRING field (esriFieldTypeString), NOT the
// standard esriFieldTypeDate epoch-ms encoding Palm Beach's SALE_DATE uses
// — confirmed against the live field metadata and sample records (e.g.
// "20210120"). See maSaleDate.
//
// Because this is ONE table for the entire state (not a pre-scoped
// per-county service like MDPA/BCPA/PBCPA), the address search WHERE
// clause must filter on CITY as well as house-number + street keyword —
// otherwise a common address like "100 Main St" would collide across
// dozens of unrelated towns. This is the one respect in which
// searchByAddressGIS's city parameter is NOT just reserved-for-
// compatibility (as it is in lib/bcpa.ts/lib/pbcpa.ts) but load-bearing.
//
// parseAddressForGIS is shared from lib/mdpa since address parsing logic is identical.

import { parseAddressForGIS } from "./mdpa";

export { parseAddressForGIS };

const MAGIS_URL =
  "https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0/query";

const SEARCH_FIELDS = "LOC_ID,MAP_PAR_ID,SITE_ADDR,CITY";

const DETAIL_FIELDS = [
  "LOC_ID",
  "MAP_PAR_ID",
  "SITE_ADDR",
  "CITY",
  "ZIP",
  "OWNER1",
  "OWN_ADDR",
  "OWN_CITY",
  "OWN_STATE",
  "OWN_ZIP",
  "OWN_CO",
  "LOT_SIZE",
  "LOT_UNITS",
  "LS_DATE",
  "LS_PRICE",
  "LS_BOOK",
  "LS_PAGE",
  "USE_CODE",
  "USE_DESC",
  "TOTAL_VAL",
  "LAND_VAL",
  "BLDG_VAL",
  "OTHER_VAL",
  "YEAR_BUILT",
  "BLD_AREA",
  "RES_AREA",
  "UNITS",
  "STORIES",
  "NUM_ROOMS",
  "STYLE",
].join(",");

const RESULT_RECORD_COUNT = 100;
// Statewide scale headroom: a common street name within one large town could
// plausibly exceed one page even with the CITY filter applied (unlike
// Florida's already county-scoped services, where pbcpa.ts/bcpa.ts never
// need to page the address search at all) — page forward via resultOffset
// before giving up as too_many_candidates, using the same
// exceededTransferLimit signal lib/pbcpa.ts's owner-name search already
// relies on for pagination.
const MAX_ADDRESS_PAGES = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

export type MAParcel = {
  folio: string;   // LOC_ID: "F_790618_2965662"
  strap: string;   // Same as folio — LOC_ID has no separate raw/display split
  address: string; // From SITE_ADDR: "1105 SARATOGA ST"
  city: string;    // From CITY: "BOSTON"
};

export type MARecord = {
  LOC_ID: string;
  MAP_PAR_ID: string | null;
  SITE_ADDR: string | null;
  CITY: string | null;
  ZIP: string | null;
  OWNER1: string | null;
  OWN_ADDR: string | null;
  OWN_CITY: string | null;
  OWN_STATE: string | null;
  OWN_ZIP: string | null;
  OWN_CO: string | null;
  LOT_SIZE: number | null;
  LOT_UNITS: string | null;
  LS_DATE: string | null;  // "YYYYMMDD" — see maSaleDate
  LS_PRICE: number | null;
  LS_BOOK: string | null;
  LS_PAGE: string | null;
  USE_CODE: string | null;
  USE_DESC: string | null;
  TOTAL_VAL: number | null;
  LAND_VAL: number | null;
  BLDG_VAL: number | null;
  OTHER_VAL: number | null;
  YEAR_BUILT: number | null;
  BLD_AREA: number | null;
  RES_AREA: number | null;
  UNITS: number | null;
  STORIES: string | null;
  NUM_ROOMS: number | null;
  STYLE: string | null;
};

// ─── GIS address search ───────────────────────────────────────────────────────

export type GISSearchResult =
  | { kind: "ok"; parcels: MAParcel[] }
  | { kind: "error"; message: string }
  | { kind: "too_many_candidates" };

// Word-boundary check for numbered streets ("3RD" must not match "13RD") —
// same convention as lib/bcpa.ts / lib/pbcpa.ts.
function matchesKeyword(kw: string, addr: string): boolean {
  const isNumbered = /^\d/.test(kw);
  return isNumbered ? addr.includes(` ${kw}`) || addr.endsWith(kw) : addr.includes(kw);
}

// Tax roll data often stores a numbered street without its ordinal suffix
// ("21ST" -> "21"). Returns the bare form, or null when not applicable.
function bareNumberedStreetForm(kw: string): string | null {
  const m = kw.match(/^(\d+)(ST|ND|RD|TH)$/);
  return m ? m[1] : null;
}

function matchesBareNumberedKeyword(kw: string, addr: string): boolean {
  return new RegExp(`(^|\\s)${kw}(?!\\d)`).test(addr);
}

type MaCandidateResult =
  | { kind: "ok"; parcels: MAParcel[] }
  | { kind: "error"; message: string }
  | { kind: "too_many_candidates" };

async function fetchMagisPage(
  where: string,
  offset: number,
): Promise<{ features: { attributes: { LOC_ID: string; MAP_PAR_ID: string; SITE_ADDR: string; CITY: string } }[]; exceededTransferLimit?: boolean; error?: string }> {
  const url = new URL(MAGIS_URL);
  url.searchParams.set("where", where);
  url.searchParams.set("outFields", SEARCH_FIELDS);
  url.searchParams.set("f", "json");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "OBJECTID");
  url.searchParams.set("resultRecordCount", String(RESULT_RECORD_COUNT));
  url.searchParams.set("resultOffset", String(offset));

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return { features: [], error: `GIS search failed: HTTP ${res.status}` };

  const data = (await res.json()) as {
    features?: { attributes: { LOC_ID: string; MAP_PAR_ID: string; SITE_ADDR: string; CITY: string } }[];
    error?: { message: string };
    exceededTransferLimit?: boolean;
  };
  if (data.error) return { features: [], error: data.error.message };

  return { features: data.features ?? [], exceededTransferLimit: data.exceededTransferLimit };
}

// Shared fetch + paginate + filter for a given tight WHERE clause.
async function fetchMagisWhere(
  where: string,
  matches: (addr: string) => boolean,
): Promise<MaCandidateResult> {
  let offset = 0;
  let sawFullPage = false;

  for (let page = 0; page < MAX_ADDRESS_PAGES; page++) {
    const { features, exceededTransferLimit, error } = await fetchMagisPage(where, offset);
    if (error) return { kind: "error", message: error };

    const parcels: MAParcel[] = features.map((f) => {
      const attr = f.attributes;
      return {
        folio: String(attr.LOC_ID ?? "").trim(),
        strap: String(attr.LOC_ID ?? "").trim(),
        address: (attr.SITE_ADDR ?? "").trim().toUpperCase(),
        city: (attr.CITY ?? "").trim().toUpperCase(),
      };
    });

    const filtered = parcels.filter((p) => matches(p.address));
    if (filtered.length > 0) return { kind: "ok", parcels: filtered };

    if (features.length >= RESULT_RECORD_COUNT) {
      sawFullPage = true;
      offset += features.length;
      if (exceededTransferLimit === false) break; // service itself says there's no more to page through
      continue;
    }

    break; // short page — genuinely exhausted, no match
  }

  if (sawFullPage) return { kind: "too_many_candidates" };
  return { kind: "ok", parcels: [] };
}

async function fetchMagisCandidate(
  houseNum: number,
  city: string | null,
  kw: string,
  matches: (addr: string) => boolean,
): Promise<MaCandidateResult> {
  const cityClause = city ? `UPPER(CITY)=UPPER('${city.replace(/'/g, "''")}') AND ` : "";
  const where = `${cityClause}UPPER(SITE_ADDR) LIKE UPPER('${houseNum} ${kw}%')`;
  return fetchMagisWhere(where, matches);
}

/**
 * Search Massachusetts parcels by address (statewide — Boston and every
 * other MA city/town in one query surface).
 *
 * @param rawAddress  Street address, optionally with city suffix.
 * @param city        The MA city/town to scope the search to. Unlike
 *                    lib/bcpa.ts/lib/pbcpa.ts (where this parameter is
 *                    reserved-but-unused because those services are already
 *                    county-scoped), this is load-bearing here: without it,
 *                    a common address collides across every town in the
 *                    state. lib/county-router.ts always supplies it (the
 *                    router only routes here after recognizing a MA
 *                    city/town in the first place). A best-effort,
 *                    unscoped, whole-state search still runs if it's
 *                    omitted, at higher risk of too_many_candidates.
 *
 * Returns the same typed union lib/bcpa.ts/lib/pbcpa.ts use:
 *   { kind: "ok"; parcels }           — success (parcels may be empty = genuine miss)
 *   { kind: "error"; message }        — service failure; caller should log + surface to user
 *   { kind: "too_many_candidates" }   — ambiguous even after paging; parcel may exist but can't be isolated
 */
export async function searchByAddressGIS(
  rawAddress: string,
  city?: string,
): Promise<GISSearchResult> {
  const parsed = parseAddressForGIS(rawAddress);
  if (!parsed) {
    throw new Error(
      "Could not parse a street number from that address. Include the building number (e.g. '1 City Hall Sq')."
    );
  }

  const { houseNum, houseNumAlt, streetKeyword, directional } = parsed;
  // SITE_ADDR includes the directional as part of the free-text street name
  // (e.g. "1105 Saratoga ST" has none; a directional address would read
  // "123 N Main ST") — fold it back into the keyword the same way the
  // house-number+keyword prefix already anchors the match, rather than a
  // separate AND clause, since MassGIS towns format directionals
  // inconsistently (confirmed no live counter-example needed one; kept
  // simple and re-verified against every live query in this file's tests).
  const kw = directional ? `${directional.toUpperCase()} ${streetKeyword.toUpperCase()}` : streetKeyword.toUpperCase();
  const bareKw = bareNumberedStreetForm(streetKeyword.toUpperCase());
  const cityUpper = city?.trim() ? city.trim().toUpperCase() : null;

  const houseCandidates = houseNumAlt !== undefined ? [houseNum, houseNumAlt] : [houseNum];
  const kwCandidates = bareKw && bareKw !== streetKeyword.toUpperCase()
    ? [kw, directional ? `${directional.toUpperCase()} ${bareKw}` : bareKw]
    : [kw];

  let sawTooMany = false;
  for (const hn of houseCandidates) {
    for (const candidateKw of kwCandidates) {
      const bareForm = bareKw && (candidateKw === bareKw || candidateKw.endsWith(` ${bareKw}`));
      const matcher = bareForm
        ? (addr: string) => matchesBareNumberedKeyword(bareKw!, addr)
        : (addr: string) => matchesKeyword(streetKeyword.toUpperCase(), addr);
      const result = await fetchMagisCandidate(hn, cityUpper, candidateKw, matcher);
      if (result.kind === "error") return result;
      if (result.kind === "too_many_candidates") {
        sawTooMany = true;
        continue;
      }
      if (result.parcels.length > 0) return { kind: "ok", parcels: result.parcels };
    }
  }

  return sawTooMany ? { kind: "too_many_candidates" } : { kind: "ok", parcels: [] };
}

// ─── Parcel detail ────────────────────────────────────────────────────────────
// Fetches the full parcel record by exact LOC_ID match.

export async function getPropertyDetail(locId: string): Promise<MARecord | null> {
  const url = new URL(MAGIS_URL);
  url.searchParams.set("where", `LOC_ID='${locId.replace(/'/g, "''")}'`);
  url.searchParams.set("outFields", DETAIL_FIELDS);
  url.searchParams.set("f", "json");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", "1");

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`MassGIS parcel lookup failed: HTTP ${res.status}`);

  const data = (await res.json()) as {
    features?: { attributes: MARecord }[];
    error?: { message: string };
  };
  if (data.error) throw new Error(`GIS error: ${data.error.message}`);
  if (!data.features || data.features.length === 0) return null;

  return data.features[0].attributes;
}

// ─── Owner name ───────────────────────────────────────────────────────────────
// OWNER1 is a single field (unlike Palm Beach's OWNER_NAME1/OWNER_NAME2 split)
// with no trailing-marker convention observed in live records — returned
// trimmed and otherwise UNCHANGED. This is deliberate: the raw MassGIS text
// flows into the exact same normalizeOwnerName()/entityOwnerNamesMatch()
// pipeline lib/owner-contacts.ts and lib/mdpa-owner-search.ts already apply
// to Florida owner names, so entity resolution (lib/entities.ts
// upsertEntityByName) and portfolio matching work identically across states
// without any Massachusetts-specific matching logic. Do not add
// state-specific transforms here without also updating that shared pipeline
// — see tests/lib/magis.test.ts's normalizeOwnerName cross-state test.
export function primaryOwnerName(raw: unknown): string | null {
  const r = raw as MARecord | null;
  const name = r?.OWNER1?.trim();
  return name || null;
}

// ─── Owner mailing address ────────────────────────────────────────────────────

/** Owner mailing address from a MARecord, built from discrete fields to
 * match the "ADDR1[, ADDR2/CO], CITY, STATE ZIP" convention used for
 * Florida (lib/pbcpa.ts extractOwnerMailing, lib/bcpa.ts equivalent). */
export function extractOwnerMailing(raw: unknown): string | null {
  const r = raw as MARecord | null;
  if (!r) return null;

  const parts: string[] = [];
  if (r.OWN_ADDR?.trim()) parts.push(r.OWN_ADDR.trim());
  if (r.OWN_CO?.trim()) parts.push(r.OWN_CO.trim());

  const cityState =
    r.OWN_CITY?.trim() && r.OWN_STATE?.trim()
      ? `${r.OWN_CITY.trim()}, ${r.OWN_STATE.trim()}${r.OWN_ZIP?.trim() ? " " + r.OWN_ZIP.trim() : ""}`
      : null;
  if (cityState) parts.push(cityState);

  return parts.length > 0 ? parts.join(", ") : null;
}

// ─── Sale date ────────────────────────────────────────────────────────────────

/** LS_DATE is a YYYYMMDD STRING field (esriFieldTypeString), NOT the epoch-ms
 * esriFieldTypeDate encoding Palm Beach's SALE_DATE uses — confirmed against
 * live field metadata and sample records (e.g. "20210120"). A "00000000"/
 * all-zero placeholder (seen on some municipally-owned parcels with no real
 * recorded sale) is treated as "no sale on file", not a literal date. */
export function maSaleDate(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  if (y === "0000" || mo === "00" || d === "00") return null;
  return `${y}-${mo}-${d}`;
}

// ─── Property type ────────────────────────────────────────────────────────────
// USE_DESC is free text, and USE_CODE is NOT a reliable numeric code (see
// file header) — classified by keyword, mirroring lib/pbcpa.ts's
// propertyUseToType. Domain confirmed live via a
// groupByFieldsForStatistics(USE_CODE, USE_DESC) query across the whole
// table (~2000 distinct combinations); categories below cover the
// highest-frequency real values. Unmatched values (government, charitable,
// religious, educational, conservation, cemetery — all real, common
// USE_DESC categories in this data) fall back to "other" rather than guess,
// the same policy lib/pbcpa.ts/lib/bcpa.ts use.
export function useDescToType(desc: string | null | undefined): string {
  if (!desc?.trim()) return "other";
  const u = desc.trim().toUpperCase();

  // Checked before the generic land/vacant catch-all below, mirroring
  // lib/pbcpa.ts's "VACANT INDUSTRIAL -> industrial before VACANT -> land".
  if (/DEVELOPABLE INDUSTRIAL/.test(u)) return "industrial";
  if (/DEVELOPABLE|VACANT|AGRICULTURAL|HORTICULTURAL|CRANBERRY BOG|CHAPTER 61/.test(u)) return "land";

  // Checked before the generic CONDO->multifamily rule below, so
  // "COMMERCIAL CONDO"/"CONDO-OFFICE"/"CONDO OFC" resolve to office.
  if (/OFFICE|BANK BUILDING/.test(u)) return "office";

  if (/DISCOUNT STORE|DEPARTMENT STORE|EATING AND DRINKING|RESTAURANT|AUTOMOTIVE|AUTO REPAIR|GASOLINE|FUEL SERVICE|CAR WASH/.test(u)) return "retail";

  if (/MANUFACTURING/.test(u)) return "industrial";

  if (/APARTMENT|CONDO|COOPERATIVE|AFFORDABLE HOUSING/.test(u)) return "multifamily";

  if (/SINGLE FAMILY|TWO-FAMILY|THREE-FAMILY|BUNGALOW/.test(u)) return "residential";

  return "other";
}
