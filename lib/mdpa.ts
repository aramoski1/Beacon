// Miami-Dade Property Appraiser — server-only
//
// Address search uses the Miami-Dade ArcGIS GIS layer (public, no auth needed).
// The old PaServicesProxy GetPropertySearchByAddress operation is broken — it
// returns "111 NW 1 ST" for every query regardless of input. The new MDPA app
// uses GetAddress, which requires browser-rendered session cookies and can't be
// called server-side.
//
// Folio detail still uses PaServicesProxy (GetPropertySearchByFolio still works).

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
