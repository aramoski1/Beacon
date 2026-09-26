// Palm Beach County Property Appraiser — server-only
//
// Address search and parcel detail use Palm Beach County's public ArcGIS
// table PAO.PROPINFO_PUB (confirmed live: the Parcels/Parcels MapServer layer
// itself only exposes FID/Shape/Id/Cached — the actual attribute data lives
// in this separate table under the "labels" service):
//   https://maps.co.palm-beach.fl.us/arcgis/rest/services/Parcels/labels/MapServer/1
//
// PCN (parcel control number) is stored as a flat, undashed digit string.
// Confirmed against multiple live records that it is 17 digits, grouped
// 2-2-2-2-2-3-4 for display (e.g. "74434321230066120" -> "74-43-43-21-23-006-6120")
// — this differs from the commonly-cited 15-digit "XX-XX-XX-XX-XXX-XXXX"
// shorthand, which is one segment short of the real format.
//
// No building-square-footage field exists in this table (unlike Broward's
// TOT_LVG_AREA / Miami-Dade's BuildingActualArea) — size_sqft is left null
// rather than guessed. ACRES (land size) is the only size field available,
// surfaced as building_composition.lot_size_sqft via unit conversion.
//
// PROPERTY_USE is a free-text description (e.g. "WAREH/DIST TERM"), not a
// numeric DOR code like Broward's DOR_UC/PA_UC — classified by keyword
// instead of numeric range; see propertyUseToType.
//
// parseAddressForGIS is shared from lib/mdpa since address parsing logic is identical.

import { parseAddressForGIS } from "./mdpa";
import { normalizeOwnerName, personNameMatchesOwnerField } from "@/lib/owner-contacts";
import { entityOwnerNamesMatch } from "./mdpa-owner-search";

export { parseAddressForGIS };

const PBCPA_URL =
  "https://maps.co.palm-beach.fl.us/arcgis/rest/services/Parcels/labels/MapServer/1/query";

const SEARCH_FIELDS = "PARCEL_NUMBER,SITE_ADDR_STR,MUNICIPALITY";

const DETAIL_FIELDS = [
  "PARCEL_NUMBER",
  "OWNER_NAME1",
  "OWNER_NAME2",
  "SITE_ADDR_STR",
  "MUNICIPALITY",
  "PADDR1",
  "PADDR2",
  "PADDR3",
  "CITYNAME",
  "STATE",
  "ZIP1",
  "ZIP2",
  "ACRES",
  "SALE_DATE",
  "PRICE",
  "TOTAL_MARKET",
  "ASSESSED_VAL",
  "PROPERTY_USE",
].join(",");

const RESULT_RECORD_COUNT = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

export type PBParcel = {
  folio: string;   // PCN, 17-digit, no dashes: "74434321230066120"
  strap: string;   // Display format: "74-43-43-21-23-006-6120"
  address: string; // From SITE_ADDR_STR: "610 CLEMATIS ST 612"
  city: string;    // From MUNICIPALITY: "WEST PALM BEACH"
};

export type PBRecord = {
  PARCEL_NUMBER: string;
  OWNER_NAME1: string | null;
  OWNER_NAME2: string | null;
  SITE_ADDR_STR: string | null;
  MUNICIPALITY: string | null;
  PADDR1: string | null;
  PADDR2: string | null;
  PADDR3: string | null;
  CITYNAME: string | null;
  STATE: string | null;
  ZIP1: string | null;
  ZIP2: string | null;
  ACRES: number | null;
  SALE_DATE: number | null; // epoch ms (esriFieldTypeDate), UTC midnight for the calendar date
  PRICE: number | null;
  TOTAL_MARKET: number | null;
  ASSESSED_VAL: number | null;
  PROPERTY_USE: string | null;
};

// ─── PCN format ───────────────────────────────────────────────────────────────

// "74434321230066120" -> "74-43-43-21-23-006-6120"
export function folioToStrap(folio: string): string {
  const f = folio.replace(/-/g, "").padStart(17, "0");
  return `${f.slice(0, 2)}-${f.slice(2, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}-${f.slice(8, 10)}-${f.slice(10, 13)}-${f.slice(13, 17)}`;
}

// ─── GIS address search ───────────────────────────────────────────────────────

export type GISSearchResult =
  | { kind: "ok"; parcels: PBParcel[] }
  | { kind: "error"; message: string }
  | { kind: "too_many_candidates" };

function sortParcels(
  parcels: PBParcel[],
  houseNum: number,
  dir: string | null,
  streetType: string | null
): PBParcel[] {
  if (!(dir || streetType) || parcels.length <= 1) return parcels;
  const dirPrefix = dir ? `${houseNum} ${dir} ` : null;
  const typeSuffix = streetType ? ` ${streetType}` : null;
  return [...parcels].sort((a, b) => {
    const score = (p: PBParcel) =>
      (dirPrefix && p.address.startsWith(dirPrefix) ? 2 : 0) +
      (typeSuffix && p.address.endsWith(typeSuffix) ? 1 : 0);
    return score(b) - score(a);
  });
}

// Tax roll data often stores a numbered street without its ordinal suffix
// ("21ST" -> "21", "3RD" -> "3", "42ND" -> "42"). Returns the bare form, or
// null when the keyword isn't a numbered-street-with-suffix.
function bareNumberedStreetForm(kw: string): string | null {
  const m = kw.match(/^(\d+)(ST|ND|RD|TH)$/);
  return m ? m[1] : null;
}

// Word-boundary check for numbered streets ("3RD" must not match "13RD") —
// used for the primary keyword as parsed.
function matchesKeyword(kw: string, addr: string): boolean {
  const isNumbered = /^\d/.test(kw);
  return isNumbered ? addr.includes(` ${kw}`) || addr.endsWith(kw) : addr.includes(kw);
}

// Stricter boundary check for the bare-number fallback only (ordinal suffix
// stripped, e.g. "21ST" -> "21"). A plain digit keyword has no letter suffix
// to disambiguate it, so without this "21" would also match "210"/"213" on
// the same street. Requires the keyword not be immediately followed by
// another digit.
function matchesBareNumberedKeyword(kw: string, addr: string): boolean {
  return new RegExp(`(^|\\s)${kw}(?!\\d)`).test(addr);
}

type PbCandidateResult =
  | { kind: "ok"; parcels: PBParcel[] }
  | { kind: "error"; message: string }
  | { kind: "too_many_candidates" };

// Shared fetch + parse against the table for a given WHERE clause, filtered
// by a caller-supplied address matcher.
async function fetchPbcpaWhere(
  where: string,
  matches: (addr: string) => boolean
): Promise<PbCandidateResult> {
  const url = new URL(PBCPA_URL);
  url.searchParams.set("where", where);
  url.searchParams.set("outFields", SEARCH_FIELDS);
  url.searchParams.set("f", "json");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "OBJECTID");
  url.searchParams.set("resultRecordCount", String(RESULT_RECORD_COUNT));

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    return { kind: "error", message: `GIS search failed: HTTP ${res.status}` };
  }

  const data = (await res.json()) as {
    features?: { attributes: { PARCEL_NUMBER: string; SITE_ADDR_STR: string; MUNICIPALITY: string } }[];
    error?: { message: string };
  };

  if (data.error) {
    return { kind: "error", message: data.error.message };
  }

  const parcels: PBParcel[] = (data.features ?? []).map((f) => {
    const attr = f.attributes;
    const folio = String(attr.PARCEL_NUMBER ?? "").replace(/-/g, "");
    return {
      folio,
      strap: folioToStrap(folio),
      address: (attr.SITE_ADDR_STR ?? "").trim().toUpperCase(),
      city: (attr.MUNICIPALITY ?? "").trim().toUpperCase(),
    };
  });

  const filtered = parcels.filter((p) => matches(p.address));

  if (filtered.length > 0) {
    return { kind: "ok", parcels: filtered };
  }

  // Full page of non-matching rows — can't isolate without a tighter query.
  if (parcels.length >= RESULT_RECORD_COUNT) {
    return { kind: "too_many_candidates" };
  }

  return { kind: "ok", parcels: [] };
}

async function fetchPbcpaCandidate(
  houseNum: number,
  dir: string | null,
  kw: string,
  matches: (addr: string) => boolean
): Promise<PbCandidateResult> {
  // Tight server-side WHERE: house number + street keyword (+ directional when present).
  const prefix = dir ? `${houseNum} ${dir} ${kw}` : `${houseNum} ${kw}`;
  return fetchPbcpaWhere(`SITE_ADDR_STR LIKE '${prefix}%'`, matches);
}

// The county sometimes files a whole block under ONE record whose own address
// is itself a range that merely CONTAINS the numbers a broker typed (verified
// for Broward — see lib/bcpa.ts). Last resort after both range endpoints
// miss: widen to a block-level prefix (drop the last 2 digits) and keep only
// candidates that are an exact match or a recorded range overlapping
// [houseNum, houseNumAlt].
function parseRecordedAddressRange(addr: string): { start: number; end: number } | null {
  const m = addr.match(/^(\d+)-(\d+)\s/);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  return start <= end ? { start, end } : null;
}

async function fetchPbcpaBlockRangeCandidate(
  houseNum: number,
  houseNumAlt: number,
  dir: string | null,
  kw: string
): Promise<PbCandidateResult> {
  const digits = String(houseNum);
  if (digits.length <= 2) return { kind: "ok", parcels: [] };
  const blockPrefix = digits.slice(0, -2);

  const where = dir
    ? `SITE_ADDR_STR LIKE '${blockPrefix}%${dir} ${kw}%'`
    : `SITE_ADDR_STR LIKE '${blockPrefix}%${kw}%'`;

  const overlapsQueriedRange = (addr: string): boolean => {
    const range = parseRecordedAddressRange(addr);
    if (range) return houseNum <= range.end && houseNumAlt >= range.start;
    return matchesKeyword(String(houseNum), addr) || matchesKeyword(String(houseNumAlt), addr);
  };

  return fetchPbcpaWhere(where, (addr) => overlapsQueriedRange(addr) && matchesKeyword(kw, addr));
}

/**
 * Search Palm Beach parcels by address.
 *
 * @param rawAddress  Street address, optionally with city suffix.
 * @param _city       Reserved for county-router compatibility; unused — the
 *                    table accepts a tight house-number + keyword WHERE.
 *
 * Returns:
 *   { kind: "ok"; parcels }           — success (parcels may be empty = genuine miss)
 *   { kind: "error"; message }        — service failure; caller should log + surface to user
 *   { kind: "too_many_candidates" }   — result page saturated with no keyword match after
 *                                       JS filter; parcel may exist but can't be isolated
 *
 * Retries before giving up on a genuine miss (same real-world formats fixed
 * for Broward — see lib/bcpa.ts):
 *   - hyphenated house-number ranges ("2317-2321 X Rd") try 2317, then 2321,
 *     then (last resort) a block-level search for a recorded range that contains them
 *   - numbered streets with an ordinal suffix ("21ST") also try the bare form ("21"),
 *     since SITE_ADDR_STR may store either
 */
export async function searchByAddressGIS(
  rawAddress: string,
  _city?: string
): Promise<GISSearchResult> {
  const parsed = parseAddressForGIS(rawAddress);
  if (!parsed) {
    throw new Error(
      "Could not parse a street number from that address. Include the building number (e.g. '301 N Olive Ave')."
    );
  }

  const { houseNum, houseNumAlt, streetKeyword, directional, streetType } = parsed;
  const kw = streetKeyword.toUpperCase();
  const dir = directional?.toUpperCase() ?? null;
  const bareKw = bareNumberedStreetForm(kw);

  const houseCandidates = houseNumAlt !== undefined ? [houseNum, houseNumAlt] : [houseNum];
  const kwCandidates = bareKw && bareKw !== kw ? [kw, bareKw] : [kw];

  let sawTooMany = false;
  for (const hn of houseCandidates) {
    for (const candidateKw of kwCandidates) {
      const matcher = candidateKw === bareKw
        ? (addr: string) => matchesBareNumberedKeyword(candidateKw, addr)
        : (addr: string) => matchesKeyword(candidateKw, addr);
      const result = await fetchPbcpaCandidate(hn, dir, candidateKw, matcher);
      if (result.kind === "error") return result;
      if (result.kind === "too_many_candidates") {
        sawTooMany = true;
        continue;
      }
      if (result.parcels.length > 0) {
        return { kind: "ok", parcels: sortParcels(result.parcels, hn, dir, streetType) };
      }
    }
  }

  if (houseNumAlt !== undefined) {
    const blockResult = await fetchPbcpaBlockRangeCandidate(houseNum, houseNumAlt, dir, kw);
    if (blockResult.kind === "error") return blockResult;
    if (blockResult.kind === "too_many_candidates") {
      sawTooMany = true;
    } else if (blockResult.parcels.length > 0) {
      return { kind: "ok", parcels: sortParcels(blockResult.parcels, houseNum, dir, streetType) };
    }
  }

  return sawTooMany ? { kind: "too_many_candidates" } : { kind: "ok", parcels: [] };
}

// ─── Folio detail ─────────────────────────────────────────────────────────────
// Fetches the full parcel record by exact PARCEL_NUMBER match.

export async function getPropertyDetail(folio: string): Promise<PBRecord | null> {
  const cleanFolio = folio.replace(/-/g, "");

  const url = new URL(PBCPA_URL);
  url.searchParams.set("where", `PARCEL_NUMBER='${cleanFolio}'`);
  url.searchParams.set("outFields", DETAIL_FIELDS);
  url.searchParams.set("f", "json");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "OBJECTID");
  url.searchParams.set("resultRecordCount", "1");

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`PBCPA folio lookup failed: HTTP ${res.status}`);

  const data = (await res.json()) as {
    features?: { attributes: PBRecord }[];
    error?: { message: string };
  };

  if (data.error) throw new Error(`GIS error: ${data.error.message}`);
  if (!data.features || data.features.length === 0) return null;

  return data.features[0].attributes;
}

// ─── Owner name ───────────────────────────────────────────────────────────────
// OWNER_NAME1 sometimes ends with a trailing "&" marking a second owner
// carried in OWNER_NAME2 (either a spouse's name split across fields, or an
// entirely separate co-owning entity) — confirmed live, e.g.
// "MACHADO MARLON O &" / "MACHADO EDNA L", and "8386 BLACKBURN LLC &" /
// "1333 LAS PALMAS PARTNERS LLC". The stored owner_name only needs the
// primary name, consistent with how Broward's single OWN_NAME field and
// Miami-Dade's primary OwnerInfos[0] are used — so strip the marker rather
// than invent a combined string not represented anywhere else in the data
// model. This is the ONLY owner-name transformation performed: no reordering,
// no case changes — the raw county text otherwise flows unchanged into
// normalizeOwnerName/entityOwnerNamesMatch/isEntityOwnerName exactly the way
// Miami-Dade's and Broward's owner names already do, so entity resolution
// (lib/entities.ts upsertEntityByName) and portfolio matching
// (lib/mdpa-owner-search.ts entityOwnerNamesMatch) stay consistent across all
// three counties without any county-specific matching logic.
export function primaryOwnerName(raw: unknown): string | null {
  const r = raw as PBRecord | null;
  const name = r?.OWNER_NAME1?.trim();
  if (!name) return null;
  const cleaned = name.replace(/\s*&\s*$/, "").trim();
  return cleaned || null;
}

// ─── Owner mailing address ────────────────────────────────────────────────────

/** Owner mailing address from a PBRecord, built from discrete fields (not the
 * pre-concatenated PADDR3) so the output shape matches Miami-Dade/Broward's
 * "ADDR1[, ADDR2], CITY, STATE ZIP" convention. */
export function extractOwnerMailing(raw: unknown): string | null {
  const r = raw as PBRecord | null;
  if (!r) return null;

  const parts: string[] = [];
  if (r.PADDR1?.trim()) parts.push(r.PADDR1.trim());
  if (r.PADDR2?.trim()) parts.push(r.PADDR2.trim());

  const zip1 = r.ZIP1?.trim();
  const zip2 = r.ZIP2?.trim();
  const zip = zip1 ? (zip2 ? `${zip1}-${zip2}` : zip1) : null;
  const cityState =
    r.CITYNAME?.trim() && r.STATE?.trim()
      ? `${r.CITYNAME.trim()}, ${r.STATE.trim()}${zip ? " " + zip : ""}`
      : null;
  if (cityState) parts.push(cityState);

  return parts.length > 0 ? parts.join(", ") : null;
}

// ─── Sale date ────────────────────────────────────────────────────────────────

/** SALE_DATE is epoch milliseconds at UTC midnight for the calendar date
 * (standard ArcGIS esriFieldTypeDate encoding) — unlike Broward, which only
 * has year+month, this gives full day-level precision. */
export function pbSaleDate(epochMs: number | null | undefined): string | null {
  if (epochMs == null) return null;
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ─── Property type ────────────────────────────────────────────────────────────
// PROPERTY_USE is free text (e.g. "WAREH/DIST TERM", "OFFICE BLDG-NON
// MEDICAL 1 TO 3 STORIES"), not a numeric DOR code — classified by keyword.
// Checked in order from most to least specific commercial category so e.g.
// "WAREH/DIST TERM CONDO" resolves to industrial (not multifamily) and
// "STORE/OFFICE/RESIDENTIAL" resolves to mixed-use (not retail). Domain of
// ~120 real PROPERTY_USE values confirmed live; unmatched values fall back to
// "other" rather than guess.
export function propertyUseToType(use: string | null | undefined): string {
  if (!use?.trim()) return "other";
  const u = use.trim().toUpperCase();

  if (/(STORE\/OFF|STORE\/OFFICE)/.test(u)) return "mixed-use";
  if (u.startsWith("VACANT") && /INDUS/.test(u)) return "industrial";
  if (u.startsWith("VACANT") || u.startsWith("AG ")) return "land";
  if (/(WAREH|MFG|SELF STORAGE|OPEN STORAGE|LUMBER|PROCESSING|BOTTLER|PACKING|AIRPORT|MARINA|WORKING WATERFRONT)/.test(u)) return "industrial";
  if (/(OFFICE|OFF BLDG|MEDIC|FINANCIAL|INSURANCE)/.test(u)) return "office";
  if (/(STORE|SHOPPING|SH CTR|SUPERMARKET|RESTAURANT|AUTO SALES|SERVICE STATION|SERVICE SHOPS|NIGHT CLUB|THTR|THEATER|DEPARTMENT STORE)/.test(u)) return "retail";
  if (/(MULTIFAMILY|^MFR|CONDOMINIUM|COOPERATIVE|APARTMENT)/.test(u)) return "multifamily";
  if (/(SINGLE FAMILY|TOWNHOUSE|MOBILE HOME|MISC RESIDENCE|ZERO LOT LINE)/.test(u)) return "residential";
  return "other";
}

// ─── Owner name search (tax roll portfolio discovery) ────────────────────────
// Same PAO.PROPINFO_PUB table as address search / folio detail above, filtered
// by OWNER_NAME1/OWNER_NAME2 instead of SITE_ADDR_STR/PARCEL_NUMBER. Palm Beach
// exposes two owner fields (vs. Miami-Dade's three, Broward's one) — the WHERE
// clause and match verification follow lib/bcpa.ts's shape rather than
// lib/mdpa-owner-search.ts's. entityOwnerNamesMatch is reused from
// mdpa-owner-search.ts since it operates on generic owner-name strings, not
// Miami-Dade-specific data. No building-square-footage field exists in this
// table (see file header) — buildingSqft is always null for Palm Beach hits.

export type PbcpaSearchMode = "entity" | "person";

export type PbcpaOwnerParcelHit = {
  folio: string;
  strap: string;
  ownerName: string;
  address: string | null;
  city: string | null;
  buildingSqft: number | null;
};

type OwnerSearchAttributes = {
  PARCEL_NUMBER?: string;
  OWNER_NAME1?: string | null;
  OWNER_NAME2?: string | null;
  SITE_ADDR_STR?: string | null;
  MUNICIPALITY?: string | null;
};

const OWNER_SEARCH_FIELDS = "PARCEL_NUMBER,OWNER_NAME1,OWNER_NAME2,SITE_ADDR_STR,MUNICIPALITY";

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

function buildOwnerWhereClause(query: string, mode: PbcpaSearchMode): string {
  const safe = sanitizeOwnerLikeToken(query);
  if (safe.length < 2) {
    throw new Error("Owner name is too short to search the tax roll.");
  }

  if (mode === "person") {
    const parts = safe.split(/\s+/).filter((p) => p.length >= 2);
    if (parts.length === 0) {
      throw new Error("Owner name is too short to search the tax roll.");
    }
    const fieldClauses = ["OWNER_NAME1", "OWNER_NAME2"].map((field) => {
      const andParts = parts.map((p) => `UPPER(${field}) LIKE UPPER('%${p}%')`).join(" AND ");
      return `(${andParts})`;
    });
    return `(${fieldClauses.join(" OR ")})`;
  }

  const tokens = ownerEntitySearchTokens(query);
  if (tokens.length === 0) {
    throw new Error("Could not build a tax roll search from that owner name.");
  }
  const fieldClauses = ["OWNER_NAME1", "OWNER_NAME2"].map((field) => {
    const andParts = tokens.map((p) => `UPPER(${field}) LIKE '%${p}%'`).join(" AND ");
    return `(${andParts})`;
  });
  return `(${fieldClauses.join(" OR ")})`;
}

function ownerNames(attrs: OwnerSearchAttributes): string[] {
  return [attrs.OWNER_NAME1, attrs.OWNER_NAME2]
    .map((n) => n?.trim())
    .filter((n): n is string => !!n);
}

function ownerParcelMatchesQuery(
  attrs: OwnerSearchAttributes,
  query: string,
  mode: PbcpaSearchMode,
): boolean {
  const names = ownerNames(attrs);
  if (names.length === 0) return false;
  if (mode === "entity") return names.some((name) => entityOwnerNamesMatch(query, name));
  return names.some((name) => personNameMatchesOwnerField(query, name));
}

function hitFromOwnerAttributes(attrs: OwnerSearchAttributes): PbcpaOwnerParcelHit | null {
  const folioRaw = attrs.PARCEL_NUMBER?.trim();
  if (!folioRaw) return null;
  const folio = folioRaw.replace(/-/g, "");
  const ownerName = attrs.OWNER_NAME1?.trim() || attrs.OWNER_NAME2?.trim();
  if (!ownerName) return null;

  return {
    folio,
    strap: folioToStrap(folio),
    ownerName,
    address: attrs.SITE_ADDR_STR?.trim() || null,
    city: attrs.MUNICIPALITY?.trim() || null,
    buildingSqft: null,
  };
}

async function fetchOwnerParcelsPage(
  where: string,
  offset: number,
): Promise<{ features: { attributes: OwnerSearchAttributes }[]; exceededTransferLimit?: boolean }> {
  const url = new URL(PBCPA_URL);
  url.searchParams.set("where", where);
  url.searchParams.set("outFields", OWNER_SEARCH_FIELDS);
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "OBJECTID");
  url.searchParams.set("resultRecordCount", String(OWNER_PAGE_SIZE));
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("f", "json");

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`Palm Beach tax roll owner search failed: HTTP ${res.status}`);
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

/** Search Palm Beach tax roll by owner / entity name (OWNER_NAME1/OWNER_NAME2). */
export async function searchParcelsByOwnerName(
  query: string,
  mode: PbcpaSearchMode,
): Promise<PbcpaOwnerParcelHit[]> {
  const where = buildOwnerWhereClause(query, mode);

  const byFolio = new Map<string, PbcpaOwnerParcelHit>();
  let offset = 0;

  while (byFolio.size < OWNER_MAX_PARCELS) {
    const { features, exceededTransferLimit } = await fetchOwnerParcelsPage(where, offset);
    if (features.length === 0) break;

    for (const f of features) {
      if (!ownerParcelMatchesQuery(f.attributes, query, mode)) continue;
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

// ─── Criteria search (lead finder) ────────────────────────────────────────────
//
// Reuses PBCPA_URL and the same offset-loop pagination shape used above.
// Palm Beach has NO building-square-footage field and NO year-built field in
// this table at all (see file header) — buildingSqftMin/Max and
// yearBuiltMin/Max are therefore not applicable here and simply have nothing
// to filter on; the caller (lib/lead-finder.ts) is responsible for telling
// the broker those two criteria weren't applied to Palm Beach results,
// rather than this module silently pretending they were honored.
//
// PROPERTY_USE is free text, not a numeric code, so property-type filtering
// uses a LIKE-based OR clause built from the SAME keyword groups
// propertyUseToType (above) checks by regex — kept in sync manually since
// ArcGIS's WHERE dialect has no regex support, only LIKE.

const CRITERIA_PAGE_SIZE = 200;

export type PropertyTypeFilter =
  | "residential" | "multifamily" | "retail" | "office" | "industrial" | "land";

const PROPERTY_USE_KEYWORDS: Record<Exclude<PropertyTypeFilter, "land">, string[]> = {
  residential: ["SINGLE FAMILY", "TOWNHOUSE", "MOBILE HOME", "MISC RESIDENCE", "ZERO LOT LINE"],
  multifamily: ["MULTIFAMILY", "CONDOMINIUM", "COOPERATIVE", "APARTMENT"],
  retail: ["STORE", "SHOPPING", "SH CTR", "SUPERMARKET", "RESTAURANT", "AUTO SALES", "SERVICE STATION", "SERVICE SHOPS", "NIGHT CLUB", "THTR", "THEATER", "DEPARTMENT STORE"],
  office: ["OFFICE", "OFF BLDG", "MEDIC", "FINANCIAL", "INSURANCE"],
  industrial: ["WAREH", "MFG", "SELF STORAGE", "OPEN STORAGE", "LUMBER", "PROCESSING", "BOTTLER", "PACKING", "AIRPORT", "MARINA", "WORKING WATERFRONT"],
};

function propertyTypeClause(type: PropertyTypeFilter): string {
  if (type === "land") {
    // Mirrors propertyUseToType: VACANT is land unless it's VACANT INDUS
    // (industrial), and "AG " (agricultural) also counts as land.
    return `((PROPERTY_USE LIKE 'VACANT%' AND PROPERTY_USE NOT LIKE '%INDUS%') OR PROPERTY_USE LIKE 'AG %')`;
  }
  const keywords = PROPERTY_USE_KEYWORDS[type];
  return "(" + keywords.map((k) => `PROPERTY_USE LIKE '%${k.replace(/'/g, "''")}%'`).join(" OR ") + ")";
}

const CRITERIA_FIELDS = [
  "PARCEL_NUMBER", "SITE_ADDR_STR", "MUNICIPALITY", "OWNER_NAME1",
  "ACRES", "ASSESSED_VAL", "PROPERTY_USE", "MONTHS_SINCE_SALE", "SALE_DATE",
].join(",");

export type PbcpaCriteria = {
  // Not applicable for Palm Beach (no building-SF field) — accepted only so
  // callers can pass a shared criteria shape; ignored here.
  buildingSqftMin?: number;
  buildingSqftMax?: number;
  landSqftMin?: number;
  landSqftMax?: number;
  propertyType?: PropertyTypeFilter;
  assessedValueMin?: number;
  assessedValueMax?: number;
  // Not applicable for Palm Beach (no year-built field) — ignored here.
  yearBuiltMin?: number;
  yearBuiltMax?: number;
  /** Matched against MUNICIPALITY (uppercased, exact match per city). */
  cities?: string[];
  /** Last sale within the last N years — a live "ownership recently changed" signal. */
  soldWithinYears?: number;
  /** Last sale at least N years ago — a "long-held" signal. */
  heldAtLeastYears?: number;
};

export type PbcpaCriteriaMatch = {
  folio: string;
  strap: string;
  address: string | null;
  city: string | null;
  ownerName: string | null;
  buildingSqft: null;
  landSqft: number | null;
  useDescription: string | null;
  assessedValue: number | null;
  yearBuilt: null;
  monthsSinceSale: number | null;
  lastSaleDate: string | null;
};

export type CriteriaSearchResult =
  | { kind: "ok"; matches: PbcpaCriteriaMatch[]; totalCount: number }
  | { kind: "too_many"; count: number }
  | { kind: "error"; message: string };

// ArcGIS sometimes returns an error object with an empty message (confirmed
// live on Massachusetts's service — see lib/magis.ts) — falls back to
// `details` so the broker never sees a blank error badge.
function extractArcgisErrorMessage(err: { message: string; details?: string[] }): string {
  if (err.message) return err.message;
  if (err.details && err.details.length > 0) return err.details.join("; ");
  return "Unknown error from the county service.";
}

const ACRE_TO_SQFT = 43_560;

/** Exported for testing — builds the ArcGIS WHERE clause from broker criteria. */
export function buildPbcpaCriteriaWhere(criteria: PbcpaCriteria): string {
  const clauses: string[] = [];

  if (criteria.landSqftMin != null || criteria.landSqftMax != null) {
    const minAcres = (criteria.landSqftMin ?? 0) / ACRE_TO_SQFT;
    const maxAcres = (criteria.landSqftMax ?? 999_999_999) / ACRE_TO_SQFT;
    clauses.push(`ACRES BETWEEN ${minAcres} AND ${maxAcres}`);
  }
  if (criteria.assessedValueMin != null || criteria.assessedValueMax != null) {
    clauses.push(`ASSESSED_VAL BETWEEN ${criteria.assessedValueMin ?? 0} AND ${criteria.assessedValueMax ?? 999_999_999_999}`);
  }
  if (criteria.propertyType) {
    clauses.push(propertyTypeClause(criteria.propertyType));
  }
  if (criteria.cities && criteria.cities.length > 0) {
    const cityList = criteria.cities.map((c) => `'${c.replace(/'/g, "''").toUpperCase()}'`).join(",");
    clauses.push(`UPPER(MUNICIPALITY) IN (${cityList})`);
  }
  // MONTHS_SINCE_SALE is a precomputed field on this layer (confirmed live) —
  // used directly rather than date arithmetic, since Palm Beach exposes it
  // ready-made.
  if (criteria.soldWithinYears != null) {
    clauses.push(`MONTHS_SINCE_SALE <= ${criteria.soldWithinYears * 12}`);
  }
  if (criteria.heldAtLeastYears != null) {
    clauses.push(`MONTHS_SINCE_SALE >= ${criteria.heldAtLeastYears * 12}`);
  }

  return clauses.length > 0 ? clauses.join(" AND ") : "1=1";
}

function pbcpaCriteriaMatchFromAttrs(a: Record<string, unknown>): PbcpaCriteriaMatch | null {
  const folio = String(a.PARCEL_NUMBER ?? "").trim();
  if (!folio) return null;
  const acres = a.ACRES as number | null;
  return {
    folio,
    strap: folioToStrap(folio),
    address: (a.SITE_ADDR_STR as string | null)?.trim() || null,
    city: (a.MUNICIPALITY as string | null)?.trim() || null,
    ownerName: (a.OWNER_NAME1 as string | null)?.trim() || null,
    buildingSqft: null,
    landSqft: typeof acres === "number" ? Math.round(acres * ACRE_TO_SQFT) : null,
    useDescription: (a.PROPERTY_USE as string | null) ?? null,
    assessedValue: (a.ASSESSED_VAL as number | null) ?? null,
    yearBuilt: null,
    monthsSinceSale: (a.MONTHS_SINCE_SALE as number | null) ?? null,
    lastSaleDate: pbSaleDate(a.SALE_DATE as number | null),
  };
}

/**
 * Criteria-based parcel search for the lead finder (see lib/lead-finder.ts).
 * Counts matches first (returnCountOnly) so a too-broad search returns the
 * real total instead of silently truncating.
 */
export async function searchByCriteria(
  criteria: PbcpaCriteria,
  maxResults = 200,
): Promise<CriteriaSearchResult> {
  const where = buildPbcpaCriteriaWhere(criteria);

  const countUrl = new URL(PBCPA_URL);
  countUrl.searchParams.set("where", where);
  countUrl.searchParams.set("returnCountOnly", "true");
  countUrl.searchParams.set("f", "json");

  const countRes = await fetch(countUrl.toString(), { next: { revalidate: 0 } });
  if (!countRes.ok) return { kind: "error", message: `Palm Beach criteria search failed: HTTP ${countRes.status}` };
  const countData = (await countRes.json()) as { count?: number; error?: { message: string; details?: string[] } };
  if (countData.error) return { kind: "error", message: extractArcgisErrorMessage(countData.error) };

  const totalCount = countData.count ?? 0;
  if (totalCount === 0) return { kind: "ok", matches: [], totalCount: 0 };
  if (totalCount > 2000) return { kind: "too_many", count: totalCount };

  const fetchLimit = Math.min(totalCount, maxResults);
  const matches: PbcpaCriteriaMatch[] = [];
  let offset = 0;
  while (matches.length < fetchLimit) {
    const url = new URL(PBCPA_URL);
    url.searchParams.set("where", where);
    url.searchParams.set("outFields", CRITERIA_FIELDS);
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("orderByFields", "OBJECTID");
    url.searchParams.set("resultRecordCount", String(CRITERIA_PAGE_SIZE));
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("f", "json");

    const res = await fetch(url.toString(), {
      next: { revalidate: 0 },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { kind: "error", message: `Palm Beach criteria search failed: HTTP ${res.status}` };
    const data = (await res.json()) as {
      features?: { attributes: Record<string, unknown> }[];
      error?: { message: string; details?: string[] };
    };
    if (data.error) return { kind: "error", message: extractArcgisErrorMessage(data.error) };

    const features = data.features ?? [];
    if (features.length === 0) break;
    for (const f of features) {
      const match = pbcpaCriteriaMatchFromAttrs(f.attributes);
      if (match) matches.push(match);
    }
    offset += features.length;
    if (features.length < CRITERIA_PAGE_SIZE) break;
  }

  return { kind: "ok", matches, totalCount };
}

/** Run multiple tax roll owner searches and merge by folio. */
export async function searchParcelsByOwnerQueries(
  queries: { query: string; mode: PbcpaSearchMode }[],
): Promise<PbcpaOwnerParcelHit[]> {
  const byFolio = new Map<string, PbcpaOwnerParcelHit>();
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
