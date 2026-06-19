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
function folioToStrap(folio: string): string {
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

// Parses a broker-typed address into the components used for GIS search.
// Returns null if a house number cannot be extracted.
function parseAddressForGIS(
  raw: string
): { houseNum: number; streetKeyword: string } | null {
  // Strip city / state / zip tail
  const street = raw.replace(/,.*$/, "").trim();

  // House number must be the first token
  const numMatch = street.match(/^(\d+)/);
  if (!numMatch) return null;
  const houseNum = parseInt(numMatch[1], 10);

  // Remaining words after the number
  const rest = street.slice(numMatch[0].length).trim().toUpperCase();
  const words = rest
    .split(/\s+/)
    .filter((w) => w.length > 0 && !DIRS.has(w) && !TYPES.has(w));

  if (words.length === 0) return null;

  // Keep only alphanumeric chars to avoid SQL injection via the GIS LIKE clause
  const streetKeyword = words[0].replace(/[^A-Z0-9]/g, "");
  if (streetKeyword.length < 2) return null;

  return { houseNum, streetKeyword };
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

  const { houseNum, streetKeyword } = parsed;
  const where = `hse_num=${houseNum} AND sname LIKE '%${streetKeyword}%'`;

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

  return data.features.map((f) => {
    const attr = f.attributes;
    const strap = folioToStrap(attr.FOLIO);
    const address = `${attr.HSE_NUM} ${attr.SNAME}`;
    return { folio: attr.FOLIO, strap, address };
  });
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
