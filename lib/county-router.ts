// County router — selects the right property appraiser lookup based on county.
//
// Supported counties: Miami-Dade, Broward, Palm Beach.
// Others can be added by extending SupportedCounty and the city maps, then
// wiring up the county-specific lib (lib/<county>cpa.ts, etc.).
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
  type GISSearchResult,
} from "./bcpa";

import {
  searchByAddressGIS as pbcpaSearch,
  getPropertyDetail as pbcpaDetail,
  extractOwnerMailing as pbcpaExtractMailing,
} from "./pbcpa";

import {
  searchByAddressGIS as magisSearch,
  getPropertyDetail as magisDetail,
  extractOwnerMailing as magisExtractMailing,
} from "./magis";

// ─── Types ────────────────────────────────────────────────────────────────────

// "massachusetts" is not a county like the other three — MassGIS covers the
// entire state through one statewide service (lib/magis.ts), so a single
// bucket routes every supported MA city/town there. Named to match the
// SupportedCounty type's existing per-region-bucket shape rather than
// renaming the type for one entry.
export type SupportedCounty = "miami-dade" | "broward" | "palm-beach" | "massachusetts";

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

const PALM_BEACH: ReadonlySet<string> = new Set([
  "WEST PALM BEACH",
  "BOCA RATON",
  "DELRAY BEACH",
  "BOYNTON BEACH",
  "JUPITER",
  "WELLINGTON",
  "PALM BEACH GARDENS",
  "LAKE WORTH",
  "LAKE WORTH BEACH",
  "ROYAL PALM BEACH",
  "GREENACRES",
  "RIVIERA BEACH",
  "NORTH PALM BEACH",
  "PALM BEACH",
  "PALM SPRINGS",
  "LANTANA",
  "TEQUESTA",
  "JUNO BEACH",
  "JUPITER INLET COLONY",
  "HIGHLAND BEACH",
  "OCEAN RIDGE",
  "GULF STREAM",
  "MANALAPAN",
  "SOUTH PALM BEACH",
  "HYPOLUXO",
  "ATLANTIS",
  "HAVERHILL",
  "GLEN RIDGE",
  "CLOUD LAKE",
  "GOLFVIEW",
  "MANGONIA PARK",
  "BELLE GLADE",
  "PAHOKEE",
  "SOUTH BAY",
  "LOXAHATCHEE GROVES",
  "CANAL POINT",
]);

// Massachusetts — Boston metro coverage: Suffolk, Middlesex, Norfolk, and
// Essex counties (task-scoped initial rollout; MassGIS itself covers all of
// Massachusetts, so widening this set later needs no new integration, only
// more city names). One combined set is enough for routing purposes — we
// only need "is this a city we cover," not which of the four counties it's
// in, since all four route to the same statewide service.
const MASSACHUSETTS: ReadonlySet<string> = new Set([
  // Suffolk County
  "BOSTON",
  "CHELSEA",
  "REVERE",
  "WINTHROP",
  // Middlesex County
  "ACTON",
  "ARLINGTON",
  "ASHBY",
  "ASHLAND",
  "AYER",
  "BEDFORD",
  "BELMONT",
  "BILLERICA",
  "BOXBOROUGH",
  "BURLINGTON",
  "CAMBRIDGE",
  "CARLISLE",
  "CHELMSFORD",
  "CONCORD",
  "DRACUT",
  "DUNSTABLE",
  "EVERETT",
  "FRAMINGHAM",
  "GROTON",
  "HOLLISTON",
  "HOPKINTON",
  "HUDSON",
  "LEXINGTON",
  "LINCOLN",
  "LITTLETON",
  "LOWELL",
  "MALDEN",
  "MARLBOROUGH",
  "MAYNARD",
  "MEDFORD",
  "MELROSE",
  "NATICK",
  "NEWTON",
  "NORTH READING",
  "PEPPERELL",
  "READING",
  "SHERBORN",
  "SHIRLEY",
  "SOMERVILLE",
  "STONEHAM",
  "STOW",
  "SUDBURY",
  "TEWKSBURY",
  "TOWNSEND",
  "TYNGSBOROUGH",
  "WAKEFIELD",
  "WALTHAM",
  "WATERTOWN",
  "WAYLAND",
  "WESTFORD",
  "WESTON",
  "WILMINGTON",
  "WINCHESTER",
  "WOBURN",
  // Norfolk County
  "AVON",
  "BELLINGHAM",
  "BRAINTREE",
  "BROOKLINE",
  "CANTON",
  "COHASSET",
  "DEDHAM",
  "DOVER",
  "FOXBOROUGH",
  "FRANKLIN",
  "HOLBROOK",
  "MEDFIELD",
  "MEDWAY",
  "MILLIS",
  "MILTON",
  "NEEDHAM",
  "NORFOLK",
  "NORWOOD",
  "PLAINVILLE",
  "QUINCY",
  "RANDOLPH",
  "SHARON",
  "STOUGHTON",
  "WALPOLE",
  "WELLESLEY",
  "WESTWOOD",
  "WEYMOUTH",
  "WRENTHAM",
  // Essex County
  "AMESBURY",
  "ANDOVER",
  "BEVERLY",
  "BOXFORD",
  "DANVERS",
  "ESSEX",
  "GEORGETOWN",
  "GLOUCESTER",
  "GROVELAND",
  "HAMILTON",
  "HAVERHILL",
  "IPSWICH",
  "LAWRENCE",
  "LYNN",
  "LYNNFIELD",
  "MANCHESTER-BY-THE-SEA",
  "MARBLEHEAD",
  "MERRIMAC",
  "METHUEN",
  "MIDDLETON",
  "NAHANT",
  "NEWBURY",
  "NEWBURYPORT",
  "NORTH ANDOVER",
  "PEABODY",
  "ROCKPORT",
  "ROWLEY",
  "SALEM",
  "SALISBURY",
  "SAUGUS",
  "SWAMPSCOTT",
  "TOPSFIELD",
  "WENHAM",
  "WEST NEWBURY",
]);

// ─── City extraction ──────────────────────────────────────────────────────────

/**
 * Extracts the city name from a free-form address string.
 *
 * Handles all common formats:
 *   "2116 Sherman St, Hollywood"           → "Hollywood"
 *   "2116 Sherman St, Hollywood, FL"       → "Hollywood"
 *   "2116 Sherman St, Hollywood, FL 33020" → "Hollywood"
 *   "2116 Sherman St, Hollywood FL 33020"  → "Hollywood"
 *
 * Strategy: take the segment immediately after the first comma (street/city
 * boundary), stop at the next comma if present, then strip any trailing
 * state abbreviation and ZIP code.
 */
export function parseCityFromAddress(address: string): string | undefined {
  const firstComma = address.indexOf(",");
  if (firstComma === -1) return undefined;

  const afterStreet = address.slice(firstComma + 1);
  const nextComma = afterStreet.indexOf(",");
  const segment = (nextComma !== -1 ? afterStreet.slice(0, nextComma) : afterStreet).trim();

  // Strip trailing "FL", "FL 33020", or "FL 33020-1234"
  const city = segment.replace(/\s+[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/i, "").trim();
  return city || undefined;
}

// ─── County detection ─────────────────────────────────────────────────────────

/** Returns the county for a given city name, or null if unknown. Case-insensitive. */
export function detectCounty(city: string): SupportedCounty | null {
  const normalized = city.toUpperCase().trim();
  if (MIAMI_DADE.has(normalized)) return "miami-dade";
  if (BROWARD.has(normalized)) return "broward";
  if (PALM_BEACH.has(normalized)) return "palm-beach";
  if (MASSACHUSETTS.has(normalized)) return "massachusetts";
  return null;
}

// ─── Routed search result ─────────────────────────────────────────────────────

export type RoutedSearchResult =
  | { kind: "ok"; parcels: RoutedParcel[] }
  | { kind: "error"; message: string }
  | { kind: "too_many_candidates" };

// Re-export so callers can narrow without importing from bcpa directly.
export type { GISSearchResult };

// ─── Unified search / detail / mailing ───────────────────────────────────────

/**
 * Address search — returns candidate parcels for broker confirmation.
 * Returns a tagged result so callers can distinguish service failures from
 * genuine misses and surface "too many candidates" to the user.
 */
export async function searchParcelsByAddress(
  rawAddress: string,
  county: SupportedCounty
): Promise<RoutedSearchResult> {
  if (county === "miami-dade") {
    try {
      const parcels = await mdpaSearch(rawAddress);
      return { kind: "ok", parcels: parcels.map((p) => ({ ...p, county: "miami-dade" as const })) };
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }

  // Broward / Palm Beach / Massachusetts — city is parsed once here. Broward
  // and Palm Beach no longer need it for server-side filtering (tight keyword
  // WHERE, already scoped to the right county by which service is called);
  // Massachusetts DOES need it — MassGIS is one statewide table, so without a
  // CITY filter a common address collides across every town (see lib/magis.ts).
  const city = parseCityFromAddress(rawAddress);

  if (county === "massachusetts") {
    // magisSearch throws (not just rejects with a GISSearchResult) when the
    // address can't be parsed into a house number/keyword — same
    // degrade-to-{kind:"error"} handling as the other branches.
    try {
      const result = await magisSearch(rawAddress, city);
      if (result.kind !== "ok") return result;
      return {
        kind: "ok",
        parcels: result.parcels.map((p) => ({
          folio: p.folio,
          strap: p.strap,
          address: p.address,
          county: "massachusetts" as const,
        })),
      };
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }

  if (county === "palm-beach") {
    // pbcpaSearch throws (not just rejects with a GISSearchResult) when the
    // address can't be parsed into a house number/keyword — mirror the
    // Miami-Dade branch above so that throw degrades to a friendly
    // { kind: "error" } instead of an uncaught server crash.
    try {
      const result = await pbcpaSearch(rawAddress, city);
      if (result.kind !== "ok") return result;
      return {
        kind: "ok",
        parcels: result.parcels.map((p) => ({
          folio: p.folio,
          strap: p.strap,
          address: p.address,
          county: "palm-beach" as const,
        })),
      };
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }

  // bcpaSearch has the same throw-on-unparseable-address behavior as pbcpaSearch.
  try {
    const result = await bcpaSearch(rawAddress, city);
    if (result.kind !== "ok") return result;
    return {
      kind: "ok",
      parcels: result.parcels.map((p) => ({
        folio: p.folio,
        strap: p.strap,
        address: p.address,
        county: "broward" as const,
      })),
    };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fetches the raw detail record for a confirmed strap/folio.
 * For Miami-Dade, pass the dashed strap (e.g. "01-4137-065-0001").
 * For Broward and Palm Beach, pass either the undashed folio/PCN or the dashed strap (both are accepted).
 * For Massachusetts, pass the LOC_ID (e.g. "F_790618_2965662").
 * Returns the raw record as-is; callers use extractMailingAddress to pull specific fields.
 */
export async function fetchParcelDetail(
  strapOrFolio: string,
  county: SupportedCounty
): Promise<unknown> {
  if (county === "miami-dade") {
    return mdpaDetail(strapOrFolio);
  }
  if (county === "palm-beach") {
    return pbcpaDetail(strapOrFolio);
  }
  if (county === "massachusetts") {
    return magisDetail(strapOrFolio);
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
  if (county === "palm-beach") {
    return pbcpaExtractMailing(raw);
  }
  if (county === "massachusetts") {
    return magisExtractMailing(raw);
  }
  return bcpaExtractMailing(raw);
}
