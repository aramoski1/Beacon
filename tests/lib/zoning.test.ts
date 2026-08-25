import { describe, it, expect, vi, afterEach } from "vitest";
import { getZoningInfo } from "../../lib/zoning";

type Route = { match: string; features: Record<string, unknown>[] } | { match: string; ok: false; status: number };

function stubFetch(routes: Route[], censusMatches: { x: number; y: number }[] | null = [{ x: -71.08, y: 42.35 }]) {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("geocoding.geo.census.gov")) {
      return {
        ok: true,
        json: async () => ({
          result: { addressMatches: (censusMatches ?? []).map((c) => ({ coordinates: c })) },
        }),
      } as unknown as Response;
    }
    for (const route of routes) {
      if (url.includes(route.match)) {
        if ("ok" in route && route.ok === false) {
          return { ok: false, status: route.status } as unknown as Response;
        }
        const r = route as { match: string; features: Record<string, unknown>[] };
        return { ok: true, json: async () => ({ features: r.features.map((a) => ({ attributes: a })) }) } as unknown as Response;
      }
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getZoningInfo — Miami-Dade", () => {
  it("resolves via folio point, prefers municipal zoning when it matches", async () => {
    stubFetch([
      { match: "AddressSearchMap_PropertiesWithZip", features: [{ POINT_X: 903178, POINT_Y: 516808 }] },
      { match: "MD_Zoning/MapServer/2", features: [{ ZONE: "T3-R", MUNICNAME: "MIAMI" }] },
      { match: "MD_Zoning/MapServer/1", features: [] },
    ]);
    const res = await getZoningInfo({
      county: "miami-dade",
      address: "1911 33rd Ct",
      city: "Miami",
      strap: "01-4109-010-1000",
    });
    expect(res).toEqual({
      kind: "ok",
      source: "Miami-Dade County Zoning (gisweb.miamidade.gov)",
      zone: expect.objectContaining({ code: "T3-R", municipality: "MIAMI" }),
      geocoded: false,
    });
  });

  it("falls back to unincorporated layer (with description/overlay) when municipal has no match", async () => {
    stubFetch([
      { match: "AddressSearchMap_PropertiesWithZip", features: [{ POINT_X: 903178, POINT_Y: 516808 }] },
      { match: "MD_Zoning/MapServer/2", features: [] },
      {
        match: "MD_Zoning/MapServer/1",
        features: [{ ZONE: "BU-2", SHORT_DESC: "General Business", ZONE_DESC: "General Business District", MUNC: null, OVLY: "WPC" }],
      },
    ]);
    const res = await getZoningInfo({ county: "miami-dade", address: "100 Main St", city: null, strap: "0100000000000" });
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.zone.code).toBe("BU-2");
    expect(res.zone.overlay).toBe("WPC");
    expect(res.zone.municipality).toBe("Unincorporated Miami-Dade County");
  });

  it("falls back to the Census geocoder (and flags geocoded:true) when no folio point is found", async () => {
    stubFetch(
      [
        { match: "AddressSearchMap_PropertiesWithZip", features: [] },
        { match: "MD_Zoning/MapServer/2", features: [{ ZONE: "SFR", MUNICNAME: "CORAL GABLES" }] },
        { match: "MD_Zoning/MapServer/1", features: [] },
      ],
      [{ x: -80.27, y: 25.72 }]
    );
    const res = await getZoningInfo({ county: "miami-dade", address: "100 Main St", city: "Coral Gables", strap: null });
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.geocoded).toBe(true);
  });

  it("reports unavailable (not a fabricated zone) when neither layer matches", async () => {
    stubFetch([
      { match: "AddressSearchMap_PropertiesWithZip", features: [{ POINT_X: 1, POINT_Y: 1 }] },
      { match: "MD_Zoning/MapServer/2", features: [] },
      { match: "MD_Zoning/MapServer/1", features: [] },
    ]);
    const res = await getZoningInfo({ county: "miami-dade", address: "1 Nowhere St", city: null, strap: "0000000000000" });
    expect(res.kind).toBe("unavailable");
  });

  it("surfaces GIS failures as kind:error, not a silent miss", async () => {
    stubFetch([
      { match: "AddressSearchMap_PropertiesWithZip", ok: false, status: 500 },
    ]);
    const res = await getZoningInfo({ county: "miami-dade", address: "1 Main St", city: null, strap: "0000000000000" });
    expect(res.kind).toBe("error");
  });
});

describe("getZoningInfo — Broward", () => {
  it("looks up zoning directly by FOLIO, no geocoding needed", async () => {
    stubFetch([
      { match: "Broward_Municipal_Service_District_Zoning", features: [{ ZONING: "B-3", DESCRIPTION: "Intense Commercial Business", AREANAME: "Broadview Park" }] },
    ]);
    const res = await getZoningInfo({ county: "broward", address: "1417 SW 40 Ave", city: "Fort Lauderdale", strap: "504113020591" });
    expect(res).toEqual({
      kind: "ok",
      source: expect.stringContaining("Broward"),
      zone: expect.objectContaining({ code: "B-3", useDescription: "Intense Commercial Business" }),
      geocoded: false,
    });
  });

  it("reports unavailable and names the incorporated city when the county layer has no match", async () => {
    stubFetch([{ match: "Broward_Municipal_Service_District_Zoning", features: [] }]);
    const res = await getZoningInfo({ county: "broward", address: "100 E Las Olas Blvd", city: "Fort Lauderdale", strap: "504200000000" });
    expect(res.kind).toBe("unavailable");
    if (res.kind === "unavailable") expect(res.reason).toContain("Fort Lauderdale");
  });

  it("reports unavailable without querying when there is no folio on record", async () => {
    stubFetch([]);
    const res = await getZoningInfo({ county: "broward", address: "100 E Las Olas Blvd", city: "Fort Lauderdale", strap: null });
    expect(res.kind).toBe("unavailable");
  });
});

describe("getZoningInfo — Palm Beach", () => {
  it("geocodes then spatially joins against the county zoning layer", async () => {
    stubFetch(
      [{ match: "Planning_Open_Data/MapServer/9", features: [{ FCODE: "RS", FNAME: "Single Family Residential", ZONING_DESC: "Residential, Single Family" }] }],
      [{ x: -80.0759, y: 26.5233 }]
    );
    const res = await getZoningInfo({ county: "palm-beach", address: "627 SW 4th Ave", city: "Boynton Beach", strap: "08434529010190251" });
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.zone.code).toBe("RS");
    expect(res.zone.municipality).toBe("Unincorporated Palm Beach County");
    // Palm Beach always resolves via the free Census geocoder (no exposed
    // parcel geometry) — callers must flag this as approximate, never treat
    // it as an exact parcel-boundary match.
    expect(res.geocoded).toBe(true);
  });

  it("reports unavailable when the geocoded point falls outside the county's own zoning polygons (incorporated city)", async () => {
    stubFetch(
      [{ match: "Planning_Open_Data/MapServer/9", features: [] }],
      [{ x: -80.0759, y: 26.5233 }]
    );
    const res = await getZoningInfo({ county: "palm-beach", address: "627 SW 4th Ave", city: "Boynton Beach", strap: null });
    expect(res.kind).toBe("unavailable");
    if (res.kind === "unavailable") expect(res.reason).toContain("Boynton Beach");
  });

  it("reports unavailable (not error) when the address can't be geocoded at all", async () => {
    stubFetch([{ match: "Planning_Open_Data/MapServer/9", features: [] }], []);
    const res = await getZoningInfo({ county: "palm-beach", address: "asdlkfj", city: null, strap: null });
    expect(res.kind).toBe("unavailable");
  });
});

describe("getZoningInfo — Massachusetts", () => {
  it("returns real FAR/height/density fields from the MAPC Zoning Atlas, nulling absent ones", async () => {
    stubFetch(
      [{
        match: "Zoning_Atlas_v01/MapServer/2",
        features: [{
          zo_code: "35B-8-120c (BP)",
          zo_name: "Boston Proper",
          muni: "Boston",
          zo_usede: null,
          far_eff: 8,
          mxht_eff: 120,
          mxdu_eff: null,
          dupac_eff: null,
          mnls_eff: 0,
        }],
      }],
      [{ x: -71.0796, y: 42.3494 }]
    );
    const res = await getZoningInfo({ county: "massachusetts", address: "700 Boylston St", city: "Boston", strap: "F_790618_2965662" });
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.zone).toMatchObject({
      code: "35B-8-120c (BP)",
      municipality: "Boston",
      farEffective: 8,
      maxHeightFt: 120,
      maxDwellingUnits: null,
      dwellingUnitsPerAcre: null,
    });
    expect(res.geocoded).toBe(true);
  });

  it("reports unavailable, citing MAPC coverage, for a town outside the Atlas", async () => {
    stubFetch(
      [{ match: "Zoning_Atlas_v01/MapServer/2", features: [] }],
      [{ x: -70.5, y: 42.5 }]
    );
    const res = await getZoningInfo({ county: "massachusetts", address: "1 Main St", city: "Rockport", strap: null });
    expect(res.kind).toBe("unavailable");
    if (res.kind === "unavailable") expect(res.reason).toContain("MAPC");
  });
});
