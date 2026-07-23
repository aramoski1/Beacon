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

export async function searchByAddressGIS(rawAddress: string): Promise<BCPAParcel[]> {
  const parsed = parseAddressForGIS(rawAddress);
  if (!parsed) {
    throw new Error(
      "Could not parse a street number from that address. Include the building number (e.g. '200 W Broward Blvd')."
    );
  }

  const { houseNum, streetKeyword, directional, streetType } = parsed;
  const kw = streetKeyword.toUpperCase();
  const dir = directional?.toUpperCase() ?? null;

  // Progressive WHERE patterns — ArcGIS on this service allows trailing-% LIKE
  // but rejects wildcards in the middle of a value. Build the tightest possible
  // prefix from the parsed components and fall back to looser patterns only when
  // the server returns no features. CO_NO equality fails; BETWEEN is the workaround.
  const patterns: { where: string; limit: number }[] = [];

  if (dir) {
    // Tightest: house + directional + street keyword
    patterns.push({
      where: `CO_NO BETWEEN ${BROWARD_CO_NO} AND ${BROWARD_CO_NO} AND PHY_ADDR1 LIKE '${houseNum} ${dir} ${kw}%'`,
      limit: 15,
    });
  }
  // Medium: house + street keyword (no directional — handles cases where GIS omits it)
  patterns.push({
    where: `CO_NO BETWEEN ${BROWARD_CO_NO} AND ${BROWARD_CO_NO} AND PHY_ADDR1 LIKE '${houseNum} ${kw}%'`,
    limit: 15,
  });
  // Last resort: house number only — raise the cap so JS filtering has enough candidates
  patterns.push({
    where: `CO_NO BETWEEN ${BROWARD_CO_NO} AND ${BROWARD_CO_NO} AND PHY_ADDR1 LIKE '${houseNum} %'`,
    limit: 25,
  });

  // JS-side keyword match — word-boundary check for numbered streets ("3RD" must not match "13RD")
  const isNumbered = /^\d/.test(kw);
  const matchesKeyword = (addr: string): boolean =>
    isNumbered ? addr.includes(` ${kw}`) || addr.endsWith(kw) : addr.includes(kw);

  for (const { where, limit } of patterns) {
    const url = new URL(STATEWIDE_URL);
    url.searchParams.set("where", where);
    url.searchParams.set("outFields", SEARCH_FIELDS);
    url.searchParams.set("f", "json");
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("resultRecordCount", String(limit));

    const res = await fetch(url.toString(), {
      next: { revalidate: 0 },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`BCPA statewide GIS search failed: HTTP ${res.status}`);

    const data = (await res.json()) as {
      features?: { attributes: { PARCEL_ID: string; PHY_ADDR1: string; PHY_CITY: string } }[];
      error?: { message: string };
    };

    if (data.error) throw new Error(`GIS error: ${data.error.message}`);
    if (!data.features || data.features.length === 0) continue;

    const parcels: BCPAParcel[] = data.features.map((f) => {
      const attr = f.attributes;
      const folio = (attr.PARCEL_ID ?? "").replace(/-/g, "");
      return {
        folio,
        strap: folioToStrap(folio),
        address: (attr.PHY_ADDR1 ?? "").trim().toUpperCase(),
        city: (attr.PHY_CITY ?? "").trim().toUpperCase(),
      };
    });

    const filtered = parcels.filter((p) => matchesKeyword(p.address));
    // Nothing matched the street keyword — try the next (looser) pattern rather than
    // returning unrelated parcels that happen to share the house number.
    if (filtered.length === 0) continue;

    // Sort: directional match (2 pts) + street-type suffix match (1 pt)
    if ((dir || streetType) && filtered.length > 1) {
      const dirPrefix = dir ? `${houseNum} ${dir} ` : null;
      const typeSuffix = streetType ? ` ${streetType}` : null;
      filtered.sort((a, b) => {
        const score = (p: BCPAParcel) =>
          (dirPrefix && p.address.startsWith(dirPrefix) ? 2 : 0) +
          (typeSuffix && p.address.endsWith(typeSuffix) ? 1 : 0);
        return score(b) - score(a);
      });
    }

    return filtered;
  }

  return [];
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
