// County router — selects the right property appraiser lookup based on county.
//
// Supported counties: Miami-Dade, Broward.
// Palm Beach and others can be added by extending SupportedCounty and the
// city maps, then wiring up the county-specific lib (lib/pbcpa.ts, etc.).
//
// Usage:
//   const county = detectCounty(property.city);
//   const parcels = await searchParcelsByAddress(address, county);
//   const detail  = await fetchParcelDetail(strap, county);
//   const mailing = extractMailingAddress(detail, county);

import {
  searchByAddressGIS as mdpaSearch,
  getPropertyDetail as mdpaDetail,
  extractOwnerMailing as mdpaExtractMailing,
} from "./mdpa";

import {
  searchByAddressGIS as bcpaSearch,
  getPropertyDetail as bcpaDetail,
  extractOwnerMailing as bcpaExtractMailing,
} from "./bcpa";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SupportedCounty = "miami-dade" | "broward";

export type RoutedParcel = {
  folio: string;
  strap: string;
  address: string;
  county: SupportedCounty;
};

// ─── City → county map ────────────────────────────────────────────────────────

const MIAMI_DADE: ReadonlySet<string> = new Set([
  "MIAMI",
  "MIAMI BEACH",
  "CORAL GABLES",
  "HIALEAH",
  "HIALEAH GARDENS",
  "NORTH MIAMI",
  "NORTH MIAMI BEACH",
  "MIAMI GARDENS",
  "MIAMI LAKES",
  "MIAMI SHORES",
  "MIAMI SPRINGS",
  "OPA-LOCKA",
  "OPA LOCKA",
  "HOMESTEAD",
  "FLORIDA CITY",
  "DORAL",
  "AVENTURA",
  "SUNNY ISLES BEACH",
  "BAL HARBOUR",
  "BAY HARBOR ISLANDS",
  "SURFSIDE",
  "BISCAYNE PARK",
  "EL PORTAL",
  "GOLDEN BEACH",
  "INDIAN CREEK",
  "KEY BISCAYNE",
  "MEDLEY",
  "NORTH BAY VILLAGE",
  "PALMETTO BAY",
  "PINECREST",
  "SOUTH MIAMI",
  "SWEETWATER",
  "VIRGINIA GARDENS",
  "WEST MIAMI",
  "CUTLER BAY",
  "KENDALL",
  "WESTCHESTER",
  "COCONUT GROVE",
  "LITTLE HAVANA",
  "BRICKELL",
  "WYNWOOD",
  "DOWNTOWN MIAMI",
]);

const BROWARD: ReadonlySet<string> = new Set([
  "FORT LAUDERDALE",
  "HOLLYWOOD",
  "POMPANO BEACH",
  "CORAL SPRINGS",
  "MIRAMAR",
  "PEMBROKE PINES",
  "SUNRISE",
  "DEERFIELD BEACH",
  "PLANTATION",
  "LAUDERHILL",
  "WESTON",
  "DAVIE",
  "TAMARAC",
  "MARGATE",
  "COCONUT CREEK",
  "NORTH LAUDERDALE",
  "HALLANDALE BEACH",
  "DANIA BEACH",
  "OAKLAND PARK",
  "WILTON MANORS",
  "LAUDERDALE LAKES",
  "LAUDERDALE-BY-THE-SEA",
  "LIGHTHOUSE POINT",
  "PARKLAND",
  "COOPER CITY",
  "SOUTHWEST RANCHES",
  "SEA RANCH LAKES",
  "HILLSBORO BEACH",
  "LAZY LAKE",
  "WEST PARK",
  "PEMBROKE PARK",
  "NORTH ANDREWS GARDENS",
]);

// ─── County detection ─────────────────────────────────────────────────────────

/** Returns the county for a given city name, or null if unknown. Case-insensitive. */
export function detectCounty(city: string): SupportedCounty | null {
  const normalized = city.toUpperCase().trim();
  if (MIAMI_DADE.has(normalized)) return "miami-dade";
  if (BROWARD.has(normalized)) return "broward";
  return null;
}

// ─── Unified search / detail / mailing ───────────────────────────────────────

/**
 * Address search — returns candidate parcels for broker confirmation.
 * county determines which property appraiser's GIS to query.
 */
export async function searchParcelsByAddress(
  rawAddress: string,
  county: SupportedCounty
): Promise<RoutedParcel[]> {
  if (county === "miami-dade") {
    const parcels = await mdpaSearch(rawAddress);
    return parcels.map((p) => ({ ...p, county: "miami-dade" as const }));
  }
  const parcels = await bcpaSearch(rawAddress);
  return parcels.map((p) => ({ folio: p.folio, strap: p.strap, address: p.address, county: "broward" as const }));
}

/**
 * Fetches the raw detail record for a confirmed strap/folio.
 * For Miami-Dade, pass the dashed strap (e.g. "01-4137-065-0001").
 * For Broward, pass either the 12-digit folio or the dashed strap (both are accepted).
 * Returns the raw record as-is; callers use extractMailingAddress to pull specific fields.
 */
export async function fetchParcelDetail(
  strapOrFolio: string,
  county: SupportedCounty
): Promise<unknown> {
  if (county === "miami-dade") {
    return mdpaDetail(strapOrFolio);
  }
  return bcpaDetail(strapOrFolio);
}

/**
 * Extracts the owner mailing address from a raw detail record.
 * Delegates to the county-specific extractor.
 */
export function extractMailingAddress(
  raw: unknown,
  county: SupportedCounty
): string | null {
  if (county === "miami-dade") {
    return mdpaExtractMailing(raw);
  }
  return bcpaExtractMailing(raw);
}
