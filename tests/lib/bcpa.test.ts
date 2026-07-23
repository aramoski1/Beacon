import { describe, it, expect, vi, afterEach } from "vitest";
import {
  folioToStrap,
  parseAddressForGIS,
  searchByAddressGIS,
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
    // 49-4101-07-0090
    expect(folioToStrap("494101070090")).toBe("49-4101-07-0090");
  });

  it("formats a second known Broward folio", () => {
    // 49-4306-11-0220
    expect(folioToStrap("494306110220")).toBe("49-4306-11-0220");
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
    // 50-4210-04-0010 → 504210040010
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

  it("parses an address without a directional", () => {
    expect(parseAddressForGIS("101 NE 3rd Ave")).toEqual({
      houseNum: 101,
      streetKeyword: "3RD",
      directional: "NE",
      streetType: "AVE",
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

  type FakeFeature = { PARCEL_ID: string; PHY_ADDR1: string; PHY_CITY: string };
  type FakePage = {
    features?: FakeFeature[];
    exceededTransferLimit?: boolean;
    error?: { message: string };
  };

  function stubFetch(features: FakeFeature[] = [], opts: { exceededTransferLimit?: boolean } = {}) {
    const capturedUrls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrls.push(url);
      return {
        ok: true,
        json: async () => ({
          features: features.map((f) => ({ attributes: f })),
          ...(opts.exceededTransferLimit ? { exceededTransferLimit: true } : {}),
        }),
      } as unknown as Response;
    });
    return capturedUrls;
  }

  // Returns different responses per call — for testing pagination.
  function stubFetchPages(pages: FakePage[]) {
    const capturedUrls: string[] = [];
    let callCount = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrls.push(url);
      const page = pages[callCount] ?? { features: [] };
      callCount++;
      return {
        ok: true,
        json: async () => ({
          features: (page.features ?? []).map((f) => ({ attributes: f })),
          ...(page.exceededTransferLimit ? { exceededTransferLimit: true } : {}),
          ...(page.error ? { error: page.error } : {}),
        }),
      } as unknown as Response;
    });
    return capturedUrls;
  }

  function whereFrom(rawUrl: string): string {
    return new URL(rawUrl).searchParams.get("where") ?? "";
  }

  // ── WHERE clause structure ────────────────────────────────────────────────
  // Server WHERE is house-number-only LIKE. The service rejects any keyword or
  // directional after the house number with "Invalid query parameters". All
  // address filtering beyond the house number happens in JS post-fetch.

  it("200 W Broward Blvd — WHERE uses Broward CO_NO BETWEEN filter", async () => {
    const urls = stubFetch([{ PARCEL_ID: "494101070090", PHY_ADDR1: "200 W BROWARD BLVD", PHY_CITY: "FORT LAUDERDALE" }]);
    await searchByAddressGIS("200 W Broward Blvd");
    const where = whereFrom(urls[0]);
    expect(where).toContain("CO_NO BETWEEN 16 AND 16");
  });

  it("200 W Broward Blvd — WHERE uses house-number-only LIKE (no keyword in server query)", async () => {
    const urls = stubFetch([{ PARCEL_ID: "494101070090", PHY_ADDR1: "200 W BROWARD BLVD", PHY_CITY: "FORT LAUDERDALE" }]);
    await searchByAddressGIS("200 W Broward Blvd");
    const where = whereFrom(urls[0]);
    expect(where).toContain("PHY_ADDR1 LIKE '200 %'");
  });

  it("200 W Broward Blvd — WHERE does NOT embed keyword or directional in server query", async () => {
    const urls = stubFetch([{ PARCEL_ID: "494101070090", PHY_ADDR1: "200 W BROWARD BLVD", PHY_CITY: "FORT LAUDERDALE" }]);
    await searchByAddressGIS("200 W Broward Blvd");
    const where = whereFrom(urls[0]);
    expect(where).not.toContain("BROWARD");
    expect(where).not.toContain("200 W BROWARD");
  });

  it("1000 SE 3rd Ave — WHERE uses house number 1000 prefix only", async () => {
    const urls = stubFetch([{ PARCEL_ID: "494101070090", PHY_ADDR1: "1000 SE 3RD AVE", PHY_CITY: "FORT LAUDERDALE" }]);
    await searchByAddressGIS("1000 SE 3rd Ave");
    const where = whereFrom(urls[0]);
    expect(where).toContain("PHY_ADDR1 LIKE '1000 %'");
    expect(where).not.toContain("3RD");
  });

  it("100 Himmarshee St — WHERE uses house number 100 only (no keyword in server query)", async () => {
    const urls = stubFetch([{ PARCEL_ID: "494101070090", PHY_ADDR1: "100 HIMMARSHEE ST", PHY_CITY: "FORT LAUDERDALE" }]);
    await searchByAddressGIS("100 Himmarshee St");
    const where = whereFrom(urls[0]);
    expect(where).toContain("CO_NO BETWEEN 16 AND 16");
    expect(where).toContain("PHY_ADDR1 LIKE '100 %'");
    expect(where).not.toContain("HIMMARSHEE");
  });

  // ── city filter ───────────────────────────────────────────────────────────

  it("city provided — WHERE includes PHY_CITY LIKE filter on first attempt", async () => {
    const urls = stubFetch([{ PARCEL_ID: "514404020010", PHY_ADDR1: "2116 SHERMAN ST", PHY_CITY: "HOLLYWOOD" }]);
    await searchByAddressGIS("2116 Sherman St, Hollywood", "Hollywood");
    const where = whereFrom(urls[0]);
    expect(where).toContain("PHY_ADDR1 LIKE '2116 %'");
    expect(where).toContain("PHY_CITY LIKE 'HOLLYWOOD%'");
  });

  it("city provided — returns result on first page without paginating", async () => {
    const urls = stubFetch([{ PARCEL_ID: "514404020010", PHY_ADDR1: "2116 SHERMAN ST", PHY_CITY: "HOLLYWOOD" }]);
    const result = await searchByAddressGIS("2116 Sherman St, Hollywood", "Hollywood");
    expect(okParcels(result)).toHaveLength(1);
    expect(urls).toHaveLength(1); // no second fetch
  });

  it("city filter rejected (gis_error) — falls back to paginated house-only search", async () => {
    const urls = stubFetchPages([
      { error: { message: "Cannot perform query. Invalid query parameters." } },
      { features: [{ PARCEL_ID: "514404020010", PHY_ADDR1: "2116 SHERMAN ST", PHY_CITY: "HOLLYWOOD" }] },
    ]);
    const result = await searchByAddressGIS("2116 Sherman St", "Hollywood");
    expect(okParcels(result)).toHaveLength(1);
    // First call had city filter, second call is the house-only paginated fallback
    expect(whereFrom(urls[0])).toContain("PHY_CITY LIKE 'HOLLYWOOD%'");
    expect(whereFrom(urls[1])).not.toContain("PHY_CITY");
  });

  it("city provided — empty result from city filter is a genuine miss (no pagination)", async () => {
    const urls = stubFetch([]); // city filter returns zero features
    const result = await searchByAddressGIS("2116 Sherman St, Hollywood", "Hollywood");
    expect(result.kind).toBe("ok");
    expect(okParcels(result)).toHaveLength(0);
    expect(urls).toHaveLength(1); // no pagination attempt
  });

  // ── result mapping and JS-side filtering ──────────────────────────────────

  it("maps returned features to BCPAParcel with folio, strap, address, city", async () => {
    stubFetch([
      {
        PARCEL_ID: "494101070090",
        PHY_ADDR1: "200 W BROWARD BLVD",
        PHY_CITY: "FORT LAUDERDALE",
      },
    ]);
    const parcels = okParcels(await searchByAddressGIS("200 W Broward Blvd"));
    expect(parcels).toHaveLength(1);
    expect(parcels[0].folio).toBe("494101070090");
    expect(parcels[0].strap).toBe("49-4101-07-0090");
    expect(parcels[0].address).toBe("200 W BROWARD BLVD");
    expect(parcels[0].city).toBe("FORT LAUDERDALE");
  });

  it("filters out results whose address does not contain the street keyword", async () => {
    stubFetch([
      { PARCEL_ID: "494101070090", PHY_ADDR1: "200 W BROWARD BLVD", PHY_CITY: "FORT LAUDERDALE" },
      { PARCEL_ID: "494101070091", PHY_ADDR1: "200 NW 1ST AVE", PHY_CITY: "FORT LAUDERDALE" },
    ]);
    const parcels = okParcels(await searchByAddressGIS("200 W Broward Blvd"));
    // "1ST AVE" doesn't include "BROWARD" keyword → filtered out
    expect(parcels).toHaveLength(1);
    expect(parcels[0].address).toBe("200 W BROWARD BLVD");
  });

  it("numbered keyword word-boundary: '3RD' should not match '13RD'", async () => {
    stubFetch([
      { PARCEL_ID: "494101070090", PHY_ADDR1: "200 SE 3RD AVE", PHY_CITY: "FORT LAUDERDALE" },
      { PARCEL_ID: "494101070091", PHY_ADDR1: "200 SE 13RD AVE", PHY_CITY: "FORT LAUDERDALE" },
    ]);
    const parcels = okParcels(await searchByAddressGIS("200 SE 3rd Ave"));
    // JS word-boundary check: " 3RD" must match "SE 3RD" but not "13RD"
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
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 503 }) as Response);
    const result = await searchByAddressGIS("200 W Broward Blvd");
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toContain("503");
  });

  it("returns { kind: 'error' } on GIS JSON error response (does not throw)", async () => {
    stubFetchPages([{ error: { message: "Cannot perform query. Invalid query parameters." } }]);
    const result = await searchByAddressGIS("200 W Broward Blvd");
    expect(result.kind).toBe("error");
  });

  it("throws when address has no house number", async () => {
    stubFetch();
    await expect(searchByAddressGIS("Broward Blvd")).rejects.toThrow();
  });

  // ── pagination ───────────────────────────────────────────────────────────

  it("fetches page 2 when page 1 has no keyword match and exceededTransferLimit is true", async () => {
    const wrongStreet = [
      { PARCEL_ID: "494101070099", PHY_ADDR1: "2116 NW 1ST AVE", PHY_CITY: "FORT LAUDERDALE" },
      { PARCEL_ID: "494101070098", PHY_ADDR1: "2116 SW 2ND ST", PHY_CITY: "FORT LAUDERDALE" },
    ];
    const urls = stubFetchPages([
      { features: wrongStreet, exceededTransferLimit: true },
      { features: [{ PARCEL_ID: "514404020010", PHY_ADDR1: "2116 SHERMAN ST", PHY_CITY: "HOLLYWOOD" }] },
    ]);
    const parcels = okParcels(await searchByAddressGIS("2116 Sherman St"));
    expect(parcels).toHaveLength(1);
    expect(parcels[0].address).toBe("2116 SHERMAN ST");
    // Second fetch should have resultOffset=25
    expect(new URL(urls[1]).searchParams.get("resultOffset")).toBe("25");
  });

  it("stops paging when exceededTransferLimit is absent (no more results)", async () => {
    const urls = stubFetchPages([
      {
        features: [{ PARCEL_ID: "494101070099", PHY_ADDR1: "200 W OAK ST", PHY_CITY: "FORT LAUDERDALE" }],
        // no exceededTransferLimit → stop after this page
      },
    ]);
    const result = await searchByAddressGIS("200 W Broward Blvd");
    expect(result.kind).toBe("ok");
    expect(okParcels(result)).toHaveLength(0);
    expect(urls).toHaveLength(1); // should not make a second fetch call
  });

  it("returns { kind: 'ok', parcels: [] } (not junk) when no page returns a keyword match", async () => {
    const wrongStreet = [
      { PARCEL_ID: "494101070099", PHY_ADDR1: "200 W OAK ST", PHY_CITY: "FORT LAUDERDALE" },
      { PARCEL_ID: "494101070098", PHY_ADDR1: "200 W ELM AVE", PHY_CITY: "FORT LAUDERDALE" },
    ];
    stubFetchPages([
      { features: wrongStreet, exceededTransferLimit: true },
      { features: wrongStreet, exceededTransferLimit: true },
      { features: wrongStreet }, // last page, no more results
    ]);
    const result = await searchByAddressGIS("200 W Broward Blvd");
    expect(result.kind).toBe("ok");
    expect(okParcels(result)).toHaveLength(0);
  });

  it("returns { kind: 'too_many_candidates' } when MAX_PAGES exhausted with exceededTransferLimit still true", async () => {
    const wrongStreet = [
      { PARCEL_ID: "494101070099", PHY_ADDR1: "200 W OAK ST", PHY_CITY: "FORT LAUDERDALE" },
    ];
    // All 8 pages return exceededTransferLimit without a keyword match
    stubFetchPages(Array.from({ length: 8 }, () => ({ features: wrongStreet, exceededTransferLimit: true })));
    const result = await searchByAddressGIS("200 W Broward Blvd");
    expect(result.kind).toBe("too_many_candidates");
  });

  // ── sorting: directional (2pts) + street-type suffix (1pt) ───────────────

  it("prefers the result with matching street type suffix", async () => {
    stubFetch([
      { PARCEL_ID: "494101070091", PHY_ADDR1: "200 W BROWARD DR", PHY_CITY: "FORT LAUDERDALE" },
      { PARCEL_ID: "494101070090", PHY_ADDR1: "200 W BROWARD BLVD", PHY_CITY: "FORT LAUDERDALE" },
    ]);
    const parcels = okParcels(await searchByAddressGIS("200 W Broward Blvd"));
    expect(parcels[0].address).toBe("200 W BROWARD BLVD");
  });

  it("prefers the result with matching directional prefix over non-matching", async () => {
    stubFetch([
      { PARCEL_ID: "494101070091", PHY_ADDR1: "200 SW BROWARD BLVD", PHY_CITY: "FORT LAUDERDALE" },
      { PARCEL_ID: "494101070090", PHY_ADDR1: "200 W BROWARD BLVD", PHY_CITY: "FORT LAUDERDALE" },
    ]);
    const parcels = okParcels(await searchByAddressGIS("200 W Broward Blvd"));
    expect(parcels[0].address).toBe("200 W BROWARD BLVD");
  });
});

// ─── extractOwnerMailing ─────────────────────────────────────────────────────

describe("extractOwnerMailing (Broward)", () => {
  function record(overrides: Partial<BCPARecord> = {}): BCPARecord {
    return {
      PARCEL_ID: "494101070090",
      OWN_NAME: "SMITH ENTERPRISES LLC",
      OWN_ADDR1: "PO BOX 12345",
      OWN_ADDR2: null,
      OWN_CITY: "FORT LAUDERDALE",
      OWN_STATE: "FL",
      OWN_ZIPCD: 33301,
      PHY_ADDR1: "200 W BROWARD BLVD",
      PHY_CITY: "FORT LAUDERDALE",
      PHY_ZIPCD: 33301,
      TOT_LVG_AR: 50000,
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
