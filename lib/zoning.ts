// Zoning / FAR lookup — server-only
//
// Verified live against each region's real, public, no-auth GIS service before
// writing any of this (see conversation notes — not repeated here). The
// coverage genuinely differs by region, and this module reports that honestly
// via ZoningResult rather than guessing or fabricating a value:
//
// - Miami-Dade: FULL countywide coverage. One service
//   (gisweb.miamidade.gov/arcgis/rest/services/LandManagement/MD_Zoning) has
//   both "Unincorporated Zoning" (layer 1, has ZONE_DESC/SHORT_DESC/OVLY) and
//   "Municipal Zoning" (layer 2, ZONE code only — confirmed live it covers
//   every municipality, not just the City of Miami, e.g. Coral Gables' "SFR").
//   No FOLIO field on either layer — requires a point, sourced from Miami-Dade's
//   own AddressSearchMap_PropertiesWithZip layer (which IS folio-keyed and
//   carries POINT_X/POINT_Y in the same state-plane SR, so no external
//   geocoder is needed here).
//
// - Broward: UNINCORPORATED ONLY. The county's own
//   "Broward_Municipal_Service_District_Zoning" FeatureServer is FOLIO-keyed
//   (no spatial join needed) and includes real ordinance-backed fields
//   (ZONING code + DESCRIPTION, e.g. "RS-6, One Family Detached, 6 units per
//   acre") — but "Municipal Service District" means unincorporated Broward
//   only. Fort Lauderdale, Hollywood, Pompano Beach, etc. each run their own
//   zoning code with no countywide GIS layer; a lookup for those cities
//   returns "unavailable", not a guess.
//
// - Palm Beach: UNINCORPORATED ONLY. The county's own zoning layer
//   (maps.co.palm-beach.fl.us .../OpenData/Planning_Open_Data/MapServer/9) is
//   polygon-only with no FOLIO field and no parcel-geometry service exposed
//   anywhere in Palm Beach's own REST catalog (confirmed live — the
//   PAO.PROPINFO_PUB table lib/pbcpa.ts already uses has no geometry, and
//   Parcels/Parcels/MapServer/0 has geometry but no attributes). Falls back to
//   the free Census geocoder (lib/geocode.ts) for a point. Same incorporated-
//   city gap as Broward.
//
// - Massachusetts: the MAPC Zoning Atlas
//   (geo.mapc.org/server/rest/services/gisdata/Zoning_Atlas_v01) covers all
//   101 Metro Boston municipalities — comprehensive for Beacon's MA coverage
//   area, and the only region with real numeric FAR/height/density fields
//   (far_eff, mxht_eff, mxdu_eff, dupac_eff, mnls_eff — verified against the
//   National Zoning Atlas methodology: "_eff" is the resolved effective value,
//   "_spec" is the raw code text for exceptions). Also needs a geocoded point
//   (its own polygon layer has no FOLIO/LOC_ID field either).
//
// None of these values are ever invented: a numeric field that's null in the
// source (common — DUpAC is populated for only ~20% of MAPC zones) is
// surfaced as null, not computed or guessed.

import type { SupportedCounty } from "./county-router";
import { geocodeAddress } from "./geocode";

const MD_ADDRESS_URL =
  "https://gis.miamidade.gov/arcgis/rest/services/AddressSearchMap_PropertiesWithZip/MapServer/0/query";
const MD_ZONING_MUNICIPAL_URL =
  "https://gisweb.miamidade.gov/arcgis/rest/services/LandManagement/MD_Zoning/MapServer/2/query";
const MD_ZONING_UNINCORPORATED_URL =
  "https://gisweb.miamidade.gov/arcgis/rest/services/LandManagement/MD_Zoning/MapServer/1/query";
const MD_STATE_PLANE_WKID = 102658;

const BC_ZONING_URL =
  "https://services.arcgis.com/JMAJrTsHNLrSsWf5/arcgis/rest/services/Broward_Municipal_Service_District_Zoning/FeatureServer/2/query";

const PB_ZONING_URL =
  "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Planning_Open_Data/MapServer/9/query";

const MA_ZONING_URL =
  "https://geo.mapc.org/server/rest/services/gisdata/Zoning_Atlas_v01/MapServer/2/query";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ZoningInfo = {
  code: string | null;
  name: string | null;
  municipality: string | null;
  useDescription: string | null;
  overlay: string | null;
  farEffective: number | null;
  maxHeightFt: number | null;
  maxDwellingUnits: number | null;
  dwellingUnitsPerAcre: number | null;
  minLotSizeSqft: number | null;
};

export type ZoningResult =
  | { kind: "ok"; source: string; zone: ZoningInfo; geocoded: boolean }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };

function emptyZone(): ZoningInfo {
  return {
    code: null,
    name: null,
    municipality: null,
    useDescription: null,
    overlay: null,
    farEffective: null,
    maxHeightFt: null,
    maxDwellingUnits: null,
    dwellingUnitsPerAcre: null,
    minLotSizeSqft: null,
  };
}

async function queryFeatures(
  url: string,
  params: Record<string, string>
): Promise<Record<string, unknown>[]> {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("f", "json");

  const res = await fetch(u.toString(), { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`GIS query failed: HTTP ${res.status}`);

  const data = (await res.json()) as {
    features?: { attributes: Record<string, unknown> }[];
    error?: { message: string };
  };
  if (data.error) throw new Error(`GIS error: ${data.error.message}`);
  return (data.features ?? []).map((f) => f.attributes);
}

function pointGeometryParam(x: number, y: number, wkid: number) {
  return JSON.stringify({ x, y, spatialReference: { wkid } });
}

// ─── Miami-Dade ───────────────────────────────────────────────────────────────

async function getMiamiDadePoint(
  folioDigits: string
): Promise<{ x: number; y: number } | null> {
  const rows = await queryFeatures(MD_ADDRESS_URL, {
    where: `FOLIO='${folioDigits.replace(/'/g, "''")}'`,
    outFields: "POINT_X,POINT_Y",
    resultRecordCount: "1",
    returnGeometry: "false",
  });
  const row = rows[0];
  if (!row) return null;
  const x = row.POINT_X as number | undefined;
  const y = row.POINT_Y as number | undefined;
  if (x == null || y == null) return null;
  return { x, y };
}

async function getMiamiDadeZoning(
  strap: string | null,
  address: string,
  city: string | null
): Promise<ZoningResult> {
  const folioDigits = strap?.replace(/\D/g, "") ?? "";
  let point: { x: number; y: number; wkid: number } | null = null;
  let geocoded = false;

  if (folioDigits) {
    const p = await getMiamiDadePoint(folioDigits);
    if (p) point = { ...p, wkid: MD_STATE_PLANE_WKID };
  }
  if (!point) {
    const geo = await geocodeAddress(address, city, "FL");
    if (geo) { point = { x: geo.lon, y: geo.lat, wkid: 4326 }; geocoded = true; }
  }
  if (!point) {
    return { kind: "unavailable", reason: "Could not determine a location for this address to look up zoning." };
  }

  const geomParam = pointGeometryParam(point.x, point.y, point.wkid);
  const common = {
    geometry: geomParam,
    geometryType: "esriGeometryPoint",
    inSR: String(point.wkid),
    spatialRel: "esriSpatialRelIntersects",
    returnGeometry: "false",
  };

  const [municipal, unincorporated] = await Promise.all([
    queryFeatures(MD_ZONING_MUNICIPAL_URL, { ...common, outFields: "ZONE,MUNICNAME" }),
    queryFeatures(MD_ZONING_UNINCORPORATED_URL, { ...common, outFields: "ZONE,ZONE_DESC,SHORT_DESC,MUNC,OVLY" }),
  ]);

  if (municipal[0]) {
    const zone = emptyZone();
    zone.code = (municipal[0].ZONE as string) ?? null;
    zone.municipality = (municipal[0].MUNICNAME as string) ?? null;
    return { kind: "ok", source: "Miami-Dade County Zoning (gisweb.miamidade.gov)", zone, geocoded };
  }
  if (unincorporated[0]) {
    const zone = emptyZone();
    zone.code = (unincorporated[0].ZONE as string) ?? null;
    zone.name = (unincorporated[0].SHORT_DESC as string) ?? null;
    zone.useDescription = (unincorporated[0].ZONE_DESC as string) ?? null;
    zone.municipality = (unincorporated[0].MUNC as string) ?? "Unincorporated Miami-Dade County";
    zone.overlay = (unincorporated[0].OVLY as string) ?? null;
    return { kind: "ok", source: "Miami-Dade County Zoning (gisweb.miamidade.gov)", zone, geocoded };
  }

  return {
    kind: "unavailable",
    reason: "No zoning polygon found at this location — the address may not have geocoded precisely enough.",
  };
}

// ─── Broward ──────────────────────────────────────────────────────────────────

async function getBrowardZoning(strap: string | null, city: string | null): Promise<ZoningResult> {
  const folioDigits = strap?.replace(/\D/g, "") ?? "";
  if (!folioDigits) {
    return { kind: "unavailable", reason: "No Broward folio on record for this property." };
  }

  const rows = await queryFeatures(BC_ZONING_URL, {
    where: `FOLIO='${folioDigits.replace(/'/g, "''")}'`,
    outFields: "ZONING,DESCRIPTION,AREANAME",
    returnGeometry: "false",
  });

  if (!rows[0]) {
    return {
      kind: "unavailable",
      reason: `Broward County only publishes zoning GIS data for unincorporated county land (the Municipal Service District). ${city ?? "This city"} is an incorporated municipality with its own zoning code, not covered by this integration.`,
    };
  }

  const zone = emptyZone();
  zone.code = (rows[0].ZONING as string) ?? null;
  zone.useDescription = (rows[0].DESCRIPTION as string) ?? null;
  zone.municipality = (rows[0].AREANAME as string) ?? "Unincorporated Broward County";
  return { kind: "ok", source: "Broward County Zoning — Municipal Service District (ArcGIS Online)", zone, geocoded: false };
}

// ─── Palm Beach ───────────────────────────────────────────────────────────────

async function getPalmBeachZoning(address: string, city: string | null): Promise<ZoningResult> {
  const geo = await geocodeAddress(address, city, "FL");
  if (!geo) {
    return { kind: "unavailable", reason: "Could not determine a location for this address to look up zoning." };
  }

  const rows = await queryFeatures(PB_ZONING_URL, {
    geometry: pointGeometryParam(geo.lon, geo.lat, 4326),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "ZONING_DESC,FNAME,FCODE",
    returnGeometry: "false",
  });

  if (!rows[0]) {
    return {
      kind: "unavailable",
      reason: `Palm Beach County only publishes zoning GIS data for unincorporated county land. ${city ?? "This city"} is an incorporated municipality with its own zoning code, not covered by this integration.`,
    };
  }

  const zone = emptyZone();
  zone.code = (rows[0].FCODE as string) ?? null;
  zone.name = (rows[0].FNAME as string) ?? null;
  zone.useDescription = (rows[0].ZONING_DESC as string) ?? null;
  zone.municipality = "Unincorporated Palm Beach County";
  return { kind: "ok", source: "Palm Beach County Planning Zoning (maps.co.palm-beach.fl.us)", zone, geocoded: true };
}

// ─── Massachusetts ────────────────────────────────────────────────────────────

async function getMassachusettsZoning(address: string, city: string | null): Promise<ZoningResult> {
  const geo = await geocodeAddress(address, city, "MA");
  if (!geo) {
    return { kind: "unavailable", reason: "Could not determine a location for this address to look up zoning." };
  }

  const rows = await queryFeatures(MA_ZONING_URL, {
    geometry: pointGeometryParam(geo.lon, geo.lat, 4326),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "zo_code,zo_name,muni,zo_usede,far_eff,mxht_eff,mxdu_eff,dupac_eff,mnls_eff",
    returnGeometry: "false",
  });

  if (!rows[0]) {
    return {
      kind: "unavailable",
      reason: `${city ?? "This municipality"} isn't covered by the MAPC Zoning Atlas (it covers the 101 cities/towns of Metro Boston).`,
    };
  }

  const r = rows[0];
  const zone = emptyZone();
  zone.code = (r.zo_code as string) ?? null;
  zone.name = (r.zo_name as string) ?? null;
  zone.municipality = (r.muni as string) ?? null;
  zone.useDescription = (r.zo_usede as string) ?? null;
  zone.farEffective = (r.far_eff as number) ?? null;
  zone.maxHeightFt = (r.mxht_eff as number) ?? null;
  zone.maxDwellingUnits = (r.mxdu_eff as number) ?? null;
  zone.dwellingUnitsPerAcre = (r.dupac_eff as number) ?? null;
  zone.minLotSizeSqft = (r.mnls_eff as number) ?? null;
  return { kind: "ok", source: "MAPC Zoning Atlas (geo.mapc.org)", zone, geocoded: true };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function getZoningInfo(input: {
  county: SupportedCounty;
  address: string;
  city: string | null;
  strap: string | null;
}): Promise<ZoningResult> {
  try {
    if (input.county === "miami-dade") {
      return await getMiamiDadeZoning(input.strap, input.address, input.city);
    }
    if (input.county === "broward") {
      return await getBrowardZoning(input.strap, input.city);
    }
    if (input.county === "palm-beach") {
      return await getPalmBeachZoning(input.address, input.city);
    }
    return await getMassachusettsZoning(input.address, input.city);
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
