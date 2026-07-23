import { describe, it, expect, vi, afterEach } from "vitest";
import {
  folioToStrap,
  parseAddressForGIS,
  searchByAddressGIS,
  getPropertyDetail,
  extractOwnerMailing,
  type BCPAParcel,
  type BCPARecord,
  type GISSearchResult,
} from "../../lib/bcpa";

function okParcels(result: GISSearchResult): BCPAParcel[] {
  if (result.kind !== "ok") throw new Error(`Expected kind "ok", got "${result.kind}"`);
  return result.parcels;
}
import { detectCounty, parseCityFromAddress } from "../../lib/county-router";

// ─── folioToStrap ─────────────────────────────────────────────────────────────

describe("folioToStrap (Broward)", () => {
  it("formats a standard 12-digit Broward folio", () => {
    expect(folioToStrap("494101070090")).toBe("49-4101-07-0090");
  });

  it("formats the known Sherman St folio", () => {
    expect(folioToStrap("514209051449")).toBe("51-4209-05-1449");
  });

  it("accepts a folio that already has dashes and strips them", () => {
    expect(folioToStrap("49-4101-07-0090")).toBe("49-4101-07-0090");
  });

  it("pads a short folio to 12 digits", () => {
    expect(folioToStrap("1")).toBe("00-0000-00-0001");
  });

  it("handles all-zeros folio", () => {
    expect(folioToStrap("000000000000")).toBe("00-0000-00-0000");
  });

  it("handles all-nines folio", () => {
    expect(folioToStrap("999999999999")).toBe("99-9999-99-9999");
  });

  it("formats a Fort Lauderdale downtown folio", () => {
    expect(folioToStrap("504210040010")).toBe("50-4210-04-0010");
  });
});

// ─── parseAddressForGIS (re-exported from mdpa) ───────────────────────────────

describe("parseAddressForGIS applied to Broward addresses", () => {
  it("parses 200 W Broward Blvd", () => {
    expect(parseAddressForGIS("200 W Broward Blvd")).toEqual({
      houseNum: 200,
      streetKeyword: "BROWARD",
      directional: "W",
      streetType: "BLVD",
    });
  });

  it("parses 3200 N Federal Hwy", () => {
    expect(parseAddressForGIS("3200 N Federal Hwy")).toEqual({
      houseNum: 3200,
      streetKeyword: "FEDERAL",
      directional: "N",
      streetType: "HWY",
    });
  });

  it("parses a numbered street: 1000 SE 3rd Ave", () => {
    expect(parseAddressForGIS("1000 SE 3rd Ave")).toEqual({
      houseNum: 1000,
      streetKeyword: "3RD",
      directional: "SE",
      streetType: "AVE",
    });
  });

  it("parses 2116 Sherman St (no directional)", () => {
    expect(parseAddressForGIS("2116 Sherman St")).toEqual({
      houseNum: 2116,
      streetKeyword: "SHERMAN",
      directional: null,
      streetType: "ST",
    });
  });

  it("strips city / state after comma", () => {
    expect(parseAddressForGIS("200 W Broward Blvd, Fort Lauderdale FL 33301")).toEqual({
      houseNum: 200,
      streetKeyword: "BROWARD",
      directional: "W",
      streetType: "BLVD",
    });
  });

  it("returns null when no house number is present", () => {
    expect(parseAddressForGIS("Broward Blvd")).toBeNull();
  });
});

// ─── searchByAddressGIS — WHERE clause construction ──────────────────────────

describe("searchByAddressGIS (Broward)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type FakeFeature = { PARCELNO: string; PHY_ADDR1: string; PHY_CITY: string };

  function stubFetch(features: FakeFeature[] = []) {
    const capturedUrls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrls.push(url);
      return {
        ok: true,
        json: async () => ({
          features: features.map((f) => ({ attributes: f })),
        }),
      } as unknown as Response;
    });
    return capturedUrls;
  }

  function stubFetchError(body: { error?: { message: string } } | null, httpOk = true, status = 200) {
    vi.stubGlobal("fetch", async () => ({
      ok: httpOk,
      status,
      json: async () => body ?? {},
    }) as unknown as Response);
  }

  function whereFrom(rawUrl: string): string {
    return new URL(rawUrl).searchParams.get("where") ?? "";
  }

  function serviceFrom(rawUrl: string): string {
    return new URL(rawUrl).pathname;
  }

  // ── WHERE clause structure ────────────────────────────────────────────────
  // Tight server WHERE: house number + keyword (+ directional when present).

  it("points at the Broward County parcel FeatureServer", async () => {
    const urls = stubFetch([
      { PARCELNO: "494101070090", PHY_ADDR1: "200 W BROWARD BLVD", PHY_CITY: "FORT LAUDERDALE" },
    ]);
    await searchByAddressGIS("200 W Broward Blvd");
    expect(serviceFrom(urls[0])).toContain("Broward_County_Parcel_Boundary");
  });

  it("200 W Broward Blvd — WHERE embeds house number, directional, and keyword", async () => {
    const urls = stubFetch([
      { PARCELNO: "494101070090", PHY_ADDR1: "200 W BROWARD BLVD", PHY_CITY: "FORT LAUDERDALE" },
    ]);
    await searchByAddressGIS("200 W Broward Blvd");
    expect(whereFrom(urls[0])).toBe("PHY_ADDR1 LIKE '200 W BROWARD%'");
  });

  it("2116 Sherman St — WHERE embeds house number and keyword (no directional)", async () => {
    const urls = stubFetch([
      { PARCELNO: "514209051449", PHY_ADDR1: "2116 SHERMAN ST", PHY_CITY: "HOLLYWOOD" },
    ]);
    await searchByAddressGIS("2116 Sherman St");
    expect(whereFrom(urls[0])).toBe("PHY_ADDR1 LIKE '2116 SHERMAN%'");
  });

  it("1000 SE 3rd Ave — WHERE embeds house number, directional, and numbered keyword", async () => {
    const urls = stubFetch([
      { PARCELNO: "494101070090", PHY_ADDR1: "1000 SE 3RD AVE", PHY_CITY: "FORT LAUDERDALE" },
    ]);
    await searchByAddressGIS("1000 SE 3rd Ave");
    expect(whereFrom(urls[0])).toBe("PHY_ADDR1 LIKE '1000 SE 3RD%'");
  });

  it("100 Himmarshee St — WHERE embeds house number and keyword", async () => {
    const urls = stubFetch([
      { PARCELNO: "494101070090", PHY_ADDR1: "100 HIMMARSHEE ST", PHY_CITY: "FORT LAUDERDALE" },
    ]);
    await searchByAddressGIS("100 Himmarshee St");
    expect(whereFrom(urls[0])).toBe("PHY_ADDR1 LIKE '100 HIMMARSHEE%'");
  });

  it("city argument does not change the WHERE (no city fast path)", async () => {
    const urls = stubFetch([
      { PARCELNO: "514209051449", PHY_ADDR1: "2116 SHERMAN ST", PHY_CITY: "HOLLYWOOD" },
    ]);
    await searchByAddressGIS("2116 Sherman St, Hollywood", "Hollywood");
    expect(whereFrom(urls[0])).toBe("PHY_ADDR1 LIKE '2116 SHERMAN%'");
    expect(whereFrom(urls[0])).not.toContain("PHY_CITY");
    expect(urls).toHaveLength(1);
  });

  // ── result mapping and JS-side filtering ──────────────────────────────────

  it("maps returned features to BCPAParcel with folio, strap, address, city", async () => {
    stubFetch([
      {
        PARCELNO: "514209051449",
        PHY_ADDR1: "2116 SHERMAN ST",
        PHY_CITY: "HOLLYWOOD",
      },
    ]);
    const parcels = okParcels(await searchByAddressGIS("2116 Sherman St"));
    expect(parcels).toHaveLength(1);
    expect(parcels[0].folio).toBe("514209051449");
    expect(parcels[0].strap).toBe("51-4209-05-1449");
    expect(parcels[0].address).toBe("2116 SHERMAN ST");
    expect(parcels[0].city).toBe("HOLLYWOOD");
  });

  it("filters out results whose address does not contain the street keyword", async () => {
    stubFetch([
      { PARCELNO: "494101070090", PHY_ADDR1: "200 W BROWARD BLVD", PHY_CITY: "FORT LAUDERDALE" },
      { PARCELNO: "494101070091", PHY_ADDR1: "200 NW 1ST AVE", PHY_CITY: "FORT LAUDERDALE" },
    ]);
    const parcels = okParcels(await searchByAddressGIS("200 W Broward Blvd"));
    expect(parcels).toHaveLength(1);
    expect(parcels[0].address).toBe("200 W BROWARD BLVD");
  });

  it("numbered keyword word-boundary: '3RD' should not match '13RD'", async () => {
    stubFetch([
      { PARCELNO: "494101070090", PHY_ADDR1: "200 SE 3RD AVE", PHY_CITY: "FORT LAUDERDALE" },
      { PARCELNO: "494101070091", PHY_ADDR1: "200 SE 13RD AVE", PHY_CITY: "FORT LAUDERDALE" },
    ]);
    const parcels = okParcels(await searchByAddressGIS("200 SE 3rd Ave"));
    const addresses = parcels.map((p) => p.address);
    expect(addresses).toContain("200 SE 3RD AVE");
    expect(addresses).not.toContain("200 SE 13RD AVE");
  });

  it("returns { kind: 'ok', parcels: [] } when no features (genuine miss)", async () => {
    stubFetch([]);
    const result = await searchByAddressGIS("200 W Broward Blvd");
    expect(result.kind).toBe("ok");
    expect(okParcels(result)).toHaveLength(0);
  });

  it("returns { kind: 'error' } on GIS HTTP error (does not throw)", async () => {
    stubFetchError(null, false, 503);
    const result = await searchByAddressGIS("200 W Broward Blvd");
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toContain("503");
  });

  it("returns { kind: 'error' } on GIS JSON error response (does not throw)", async () => {
    stubFetchError({ error: { message: "Cannot perform query. Invalid query parameters." } });
    const result = await searchByAddressGIS("200 W Broward Blvd");
    expect(result.kind).toBe("error");
  });

  it("throws when address has no house number", async () => {
    stubFetch();
    await expect(searchByAddressGIS("Broward Blvd")).rejects.toThrow();
  });

  it("returns { kind: 'too_many_candidates' } when a full page has no keyword match", async () => {
    const junk = Array.from({ length: 50 }, (_, i) => ({
      PARCELNO: `4941010700${String(i).padStart(2, "0")}`,
      PHY_ADDR1: `200 W OAK ST UNIT ${i}`,
      PHY_CITY: "FORT LAUDERDALE",
    }));
    // Keyword filter removes all (OAK ≠ BROWARD) and page is saturated
    stubFetch(junk);
    const result = await searchByAddressGIS("200 W Broward Blvd");
    expect(result.kind).toBe("too_many_candidates");
  });

  // ── sorting: directional (2pts) + street-type suffix (1pt) ───────────────

  it("prefers the result with matching street type suffix", async () => {
    stubFetch([
      { PARCELNO: "494101070091", PHY_ADDR1: "200 W BROWARD DR", PHY_CITY: "FORT LAUDERDALE" },
      { PARCELNO: "494101070090", PHY_ADDR1: "200 W BROWARD BLVD", PHY_CITY: "FORT LAUDERDALE" },
    ]);
    const parcels = okParcels(await searchByAddressGIS("200 W Broward Blvd"));
    expect(parcels[0].address).toBe("200 W BROWARD BLVD");
  });

  it("prefers the result with matching directional prefix over non-matching", async () => {
    stubFetch([
      { PARCELNO: "494101070091", PHY_ADDR1: "200 SW BROWARD BLVD", PHY_CITY: "FORT LAUDERDALE" },
      { PARCELNO: "494101070090", PHY_ADDR1: "200 W BROWARD BLVD", PHY_CITY: "FORT LAUDERDALE" },
    ]);
    const parcels = okParcels(await searchByAddressGIS("200 W Broward Blvd"));
    expect(parcels[0].address).toBe("200 W BROWARD BLVD");
  });
});

// ─── getPropertyDetail ────────────────────────────────────────────────────────

describe("getPropertyDetail (Broward)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queries by PARCELNO exact match", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        json: async () => ({
          features: [
            {
              attributes: {
                PARCELNO: "514209051449",
                OWN_NAME: "PB2 REAL ESTATE LLC",
                TOT_LVG_AREA: 7776,
              },
            },
          ],
        }),
      } as unknown as Response;
    });
    const rec = await getPropertyDetail("514209051449");
    expect(new URL(urls[0]).searchParams.get("where")).toBe("PARCELNO='514209051449'");
    expect(rec?.PARCELNO).toBe("514209051449");
    expect(rec?.OWN_NAME).toBe("PB2 REAL ESTATE LLC");
    expect(rec?.TOT_LVG_AREA).toBe(7776);
  });
});

// ─── extractOwnerMailing ─────────────────────────────────────────────────────

describe("extractOwnerMailing (Broward)", () => {
  function record(overrides: Partial<BCPARecord> = {}): BCPARecord {
    return {
      PARCELNO: "494101070090",
      OWN_NAME: "SMITH ENTERPRISES LLC",
      OWN_ADDR1: "PO BOX 12345",
      OWN_ADDR2: null,
      OWN_CITY: "FORT LAUDERDALE",
      OWN_STATE: "FL",
      OWN_ZIPCD: 33301,
      PHY_ADDR1: "200 W BROWARD BLVD",
      PHY_CITY: "FORT LAUDERDALE",
      PHY_ZIPCD: 33301,
      TOT_LVG_AREA: 50000,
      DOR_UC: "039",
      PA_UC: null,
      ACT_YR_BLT: 1985,
      EFF_YR_BLT: 1990,
      SALE_PRC1: 5000000,
      SALE_YR1: 2019,
      SALE_MO1: "06",
      LND_SQFOOT: 25000,
      JV: 8500000,
      NO_BULDNG: 1,
      ...overrides,
    };
  }

  it("formats addr1 + city, state, zip", () => {
    expect(extractOwnerMailing(record())).toBe(
      "PO BOX 12345, FORT LAUDERDALE, FL 33301"
    );
  });

  it("includes addr2 when present", () => {
    expect(extractOwnerMailing(record({ OWN_ADDR2: "SUITE 400" }))).toBe(
      "PO BOX 12345, SUITE 400, FORT LAUDERDALE, FL 33301"
    );
  });

  it("pads 4-digit zip to 5 digits", () => {
    const result = extractOwnerMailing(record({ OWN_ZIPCD: 7701 }));
    expect(result).toContain("07701");
  });

  it("returns null when all address fields are null", () => {
    expect(
      extractOwnerMailing(
        record({ OWN_ADDR1: null, OWN_ADDR2: null, OWN_CITY: null, OWN_STATE: null, OWN_ZIPCD: null })
      )
    ).toBeNull();
  });

  it("returns null for null input", () => {
    expect(extractOwnerMailing(null)).toBeNull();
  });

  it("omits zip when OWN_ZIPCD is null", () => {
    const result = extractOwnerMailing(record({ OWN_ZIPCD: null }));
    expect(result).toBe("PO BOX 12345, FORT LAUDERDALE, FL");
  });
});

// ─── Live Broward parcel service ──────────────────────────────────────────────

describe("live Broward parcel service", () => {
  it("2116 Sherman St resolves to PARCELNO 514209051449 / PB2 REAL ESTATE LLC", async () => {
    const result = await searchByAddressGIS("2116 Sherman St");
    const parcels = okParcels(result);
    expect(parcels.length).toBeGreaterThanOrEqual(1);
    expect(parcels[0].folio).toBe("514209051449");
    expect(parcels[0].address).toContain("SHERMAN");

    const detail = await getPropertyDetail(parcels[0].folio);
    expect(detail).not.toBeNull();
    expect(detail!.PARCELNO).toBe("514209051449");
    expect(detail!.OWN_NAME).toBe("PB2 REAL ESTATE LLC");
    expect(detail!.TOT_LVG_AREA).toBe(7776);
  }, 30_000);

  it("2116 Sherman St, Hollywood resolves the same parcel with city present", async () => {
    const result = await searchByAddressGIS("2116 Sherman St, Hollywood", "Hollywood");
    const parcels = okParcels(result);
    expect(parcels[0].folio).toBe("514209051449");

    const detail = await getPropertyDetail(parcels[0].folio);
    expect(detail!.OWN_NAME).toBe("PB2 REAL ESTATE LLC");
  }, 30_000);
});

// ─── detectCounty ─────────────────────────────────────────────────────────────

describe("detectCounty", () => {
  it("identifies Fort Lauderdale as Broward", () => {
    expect(detectCounty("Fort Lauderdale")).toBe("broward");
  });

  it("identifies Pompano Beach as Broward", () => {
    expect(detectCounty("Pompano Beach")).toBe("broward");
  });

  it("identifies Hollywood as Broward", () => {
    expect(detectCounty("Hollywood")).toBe("broward");
  });

  it("identifies Miami as Miami-Dade", () => {
    expect(detectCounty("Miami")).toBe("miami-dade");
  });

  it("identifies Coral Gables as Miami-Dade", () => {
    expect(detectCounty("Coral Gables")).toBe("miami-dade");
  });

  it("is case-insensitive", () => {
    expect(detectCounty("fort lauderdale")).toBe("broward");
    expect(detectCounty("MIAMI BEACH")).toBe("miami-dade");
  });

  it("returns null for an unknown city", () => {
    expect(detectCounty("Palm Beach")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(detectCounty("")).toBeNull();
  });
});

// ─── parseCityFromAddress ──────────────────────────────────────────────────────

describe("parseCityFromAddress", () => {
  it("extracts city when only city follows street", () => {
    expect(parseCityFromAddress("2116 Sherman St, Hollywood")).toBe("Hollywood");
  });

  it("extracts city when state follows city after a comma", () => {
    expect(parseCityFromAddress("2116 Sherman St, Hollywood, FL")).toBe("Hollywood");
  });

  it("extracts city when state and ZIP follow city after a comma", () => {
    expect(parseCityFromAddress("2116 Sherman St, Hollywood, FL 33020")).toBe("Hollywood");
  });

  it("extracts city when state and ZIP are in the same segment as the city (no comma before FL)", () => {
    expect(parseCityFromAddress("2116 Sherman St, Hollywood FL 33020")).toBe("Hollywood");
  });

  it("returns undefined when there is no comma", () => {
    expect(parseCityFromAddress("2116 Sherman St")).toBeUndefined();
  });

  it("routes all four Hollywood formats to Broward", () => {
    const formats = [
      "2116 Sherman St, Hollywood",
      "2116 Sherman St, Hollywood, FL",
      "2116 Sherman St, Hollywood, FL 33020",
      "2116 Sherman St, Hollywood FL 33020",
    ];
    for (const addr of formats) {
      const city = parseCityFromAddress(addr);
      expect(city, `city extracted from "${addr}"`).toBeTruthy();
      expect(detectCounty(city!), `county for "${addr}"`).toBe("broward");
    }
  });

  it("handles multi-word cities", () => {
    expect(parseCityFromAddress("200 W Broward Blvd, Fort Lauderdale, FL 33301")).toBe("Fort Lauderdale");
  });

  it("strips hyphenated ZIP extension", () => {
    expect(parseCityFromAddress("200 W Broward Blvd, Fort Lauderdale FL 33301-1234")).toBe("Fort Lauderdale");
  });
});
