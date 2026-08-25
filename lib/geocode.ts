// US Census Bureau Geocoder — server-only
//
// Free, keyless, no rate-limit paywall (unlike Esri's World Geocoding Service,
// which requires an ArcGIS API key tied to a metered account). Used only as a
// fallback to get a lat/lon point for a spatial zoning lookup (lib/zoning.ts)
// when the county itself doesn't expose parcel geometry over REST (Palm Beach,
// Massachusetts) — Miami-Dade and Broward never need this, since their own
// GIS layers already carry either a point or a FOLIO-keyed zoning row.
//
// Confirmed live: https://geocoding.geo.census.gov/geocoder/locations/onelineaddress
// returns real WGS84 (wkid 4326) coordinates for a one-line US address with no
// API key or auth of any kind.

const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

export type GeocodePoint = { lat: number; lon: number };

export async function geocodeAddress(
  address: string,
  city?: string | null,
  state = "MA"
): Promise<GeocodePoint | null> {
  const oneLine = city ? `${address}, ${city}, ${state}` : `${address}, ${state}`;

  const url = new URL(CENSUS_GEOCODER_URL);
  url.searchParams.set("address", oneLine);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`Census geocoder failed: HTTP ${res.status}`);

  const data = (await res.json()) as {
    result?: { addressMatches?: { coordinates: { x: number; y: number } }[] };
  };
  const match = data.result?.addressMatches?.[0];
  if (!match) return null;

  return { lat: match.coordinates.y, lon: match.coordinates.x };
}
