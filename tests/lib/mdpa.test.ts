import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  folioToStrap,
  parseAddressForGIS,
  searchByAddressGIS,
  buildMdpaCriteriaWhere,
  searchByCriteria,
  parseMdpaPropertyInfo,
  overlayMdpaOnExtracted,
} from "../../lib/mdpa";
import type { ExtractedProperty } from "../../lib/property-pipeline";

// ─── folioToStrap ─────────────────────────────────────────────────────────────

describe("folioToStrap", () => {
  it("formats a standard 13-digit folio", () => {
    expect(folioToStrap("0131250780010")).toBe("01-3125-078-0010");
  });

  it("formats a second known Miami-Dade folio", () => {
    // from lib/mdpa.ts JSDoc example
    expect(folioToStrap("0141370650001")).toBe("01-4137-065-0001");
  });

  it("pads a 12-digit folio with a leading zero", () => {
    // "131250780010" is 12 chars — padStart(13, "0") gives "0131250780010"
    expect(folioToStrap("131250780010")).toBe("01-3125-078-0010");
  });

  it("pads a short folio all the way to 13 digits", () => {
    expect(folioToStrap("1")).toBe("00-0000-000-0001");
  });

  it("handles all-zeros folio", () => {
    expect(folioToStrap("0000000000000")).toBe("00-0000-000-0000");
  });

  it("handles all-nines folio", () => {
    expect(folioToStrap("9999999999999")).toBe("99-9999-999-9999");
  });

  it("formats a Doral-area industrial folio (section 30)", () => {
    expect(folioToStrap("3040150110010")).toBe("30-4015-011-0010");
  });
});

// ─── parseAddressForGIS ───────────────────────────────────────────────────────

describe("parseAddressForGIS", () => {
  // ── Happy path ─────────────────────────────────────────────────────────────

  it("extracts house number and first non-dir/non-type keyword", () => {
    expect(parseAddressForGIS("200 S Biscayne Blvd")).toEqual({
      houseNum: 200,
      streetKeyword: "BISCAYNE",
      directional: "S",
      streetType: "BLVD",
    });
  });

  it("strips everything after the first comma (city / state / zip)", () => {
    expect(parseAddressForGIS("200 S Biscayne Blvd, Miami FL 33131")).toEqual({
      houseNum: 200,
      streetKeyword: "BISCAYNE",
      directional: "S",
      streetType: "BLVD",
    });
  });

  it("is case-insensitive — lowercased input parses correctly", () => {
    expect(parseAddressForGIS("1221 brickell ave")).toEqual({
      houseNum: 1221,
      streetKeyword: "BRICKELL",
      directional: null,
      streetType: "AVE",
    });
  });

  it("handles all eight directional prefixes (N S E W NE NW SE SW)", () => {
    for (const dir of ["N", "S", "E", "W", "NE", "NW", "SE", "SW"]) {
      const result = parseAddressForGIS(`100 ${dir} Miami Ave`);
      expect(result, `direction ${dir}`).toEqual({
        houseNum: 100,
        streetKeyword: "MIAMI",
        directional: dir,
        streetType: "AVE",
      });
    }
  });

  it("skips directionals that appear after the street name", () => {
    // "500 Brickell Ave SW" — first word BRICKELL is not a dir → directional=null
    // last word SW is not a TYPES token → streetType=null
    expect(parseAddressForGIS("500 Brickell Ave SW")).toEqual({
      houseNum: 500,
      streetKeyword: "BRICKELL",
      directional: null,
      streetType: null,
    });
  });

  it("returns first non-dir/non-type word when suite indicator appears mid-string", () => {
    // APT is not in DIRS or TYPES, but BRICKELL comes first so it's the keyword
    expect(parseAddressForGIS("1221 Brickell Ave Apt 4B, Miami FL")).toEqual({
      houseNum: 1221,
      streetKeyword: "BRICKELL",
      directional: null,
      streetType: null,
    });
  });

  it("uses named street number (≥2 digits) as keyword when no word name present", () => {
    // "3401 NW 12 Ave" — only non-dir/non-type token is "12" (length 2 → valid)
    expect(parseAddressForGIS("3401 NW 12 Ave")).toEqual({
      houseNum: 3401,
      streetKeyword: "12",
      directional: "NW",
      streetType: "AVE",
    });
  });

  it("strips non-alphanumeric chars from the keyword", () => {
    // "200 NW 42nd Ave" — "42ND" has no non-alnum chars, passes through
    expect(parseAddressForGIS("200 NW 42nd Ave")).toEqual({
      houseNum: 200,
      streetKeyword: "42ND",
      directional: "NW",
      streetType: "AVE",
    });
  });

  it("handles extra internal whitespace in input", () => {
    expect(parseAddressForGIS("200   S   Biscayne   Blvd")).toEqual({
      houseNum: 200,
      streetKeyword: "BISCAYNE",
      directional: "S",
      streetType: "BLVD",
    });
  });

  it("uses the mdpa.ts JSDoc example address correctly", () => {
    expect(parseAddressForGIS("3401 N Miami Ave")).toEqual({
      houseNum: 3401,
      streetKeyword: "MIAMI",
      directional: "N",
      streetType: "AVE",
    });
  });

  // ── Null cases ─────────────────────────────────────────────────────────────

  it("returns null when input has no leading house number", () => {
    expect(parseAddressForGIS("Biscayne Blvd")).toBeNull();
  });

  it("returns null when house number is missing but city is present", () => {
    expect(parseAddressForGIS("Brickell Ave, Miami FL")).toBeNull();
  });

  it("returns null when address starts with a street name (no house #)", () => {
    expect(parseAddressForGIS("NW 12 Ave")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseAddressForGIS("")).toBeNull();
  });

  it("returns null when every word is a directional or type suffix", () => {
    // "100 N ST" → rest = "N ST", both filtered → words = []
    expect(parseAddressForGIS("100 N ST")).toBeNull();
  });

  it("returns null when the only keyword is a single digit (< 2 chars)", () => {
    // "3401 NW 2 Ave" → keyword "2", length 1 < 2 → null
    expect(parseAddressForGIS("3401 NW 2 Ave")).toBeNull();
  });

  it("returns null for '111 NW 1 ST' — the broken PA proxy default address", () => {
    // "1 ST" → keyword "1", length 1 < 2 → null
    // This is the infamous bad address; the GIS lookup correctly rejects it.
    expect(parseAddressForGIS("111 NW 1 ST")).toBeNull();
  });

  it("returns null for a single-digit named street with directional", () => {
    // Miami's "1 SE 3 Ave" pattern — "3" is length 1 < 2
    expect(parseAddressForGIS("1 SE 3 Ave")).toBeNull();
  });
});

// ─── parseAddressForGIS — units, suites, and directional edge cases ───────────

describe("parseAddressForGIS — units and suites", () => {
  // When a unit/suite appears BEFORE the comma, it is present in the street
  // string and must not displace the street name as the keyword.

  it("ignores Ste suffix before street type", () => {
    // words after filter: ["BRICKELL", "STE", "500"]  → first = "BRICKELL"
    expect(parseAddressForGIS("777 Brickell Ave Ste 500")).toEqual({
      houseNum: 777,
      streetKeyword: "BRICKELL",
      directional: null,
      streetType: null,
    });
  });

  it("ignores Suite word before street type", () => {
    // words: ["BRICKELL", "SUITE", "200"]  → first = "BRICKELL"
    expect(parseAddressForGIS("1221 Brickell Ave Suite 200")).toEqual({
      houseNum: 1221,
      streetKeyword: "BRICKELL",
      directional: null,
      streetType: null,
    });
  });

  it("ignores suite number when suite appears after the first comma (city tail)", () => {
    // comma-strip removes ", Suite 200, Miami FL" → street = "1221 Brickell Ave"
    expect(parseAddressForGIS("1221 Brickell Ave, Suite 200, Miami FL")).toEqual({
      houseNum: 1221,
      streetKeyword: "BRICKELL",
      directional: null,
      streetType: "AVE",
    });
  });

  it("ignores hash-unit notation — #500 trails the street name", () => {
    // words: ["BRICKELL", "#500" → cleaned to "500"]  → first = "BRICKELL"
    expect(parseAddressForGIS("100 Brickell Ave #500")).toEqual({
      houseNum: 100,
      streetKeyword: "BRICKELL",
      directional: null,
      streetType: null,
    });
  });

  it("unit on named street still extracts the street keyword first", () => {
    // "3401 N Miami Ave Suite 10, Miami" → street = "3401 N Miami Ave Suite 10"
    // words: ["MIAMI", "SUITE", "10"]  → first = "MIAMI"
    expect(parseAddressForGIS("3401 N Miami Ave Suite 10, Miami")).toEqual({
      houseNum: 3401,
      streetKeyword: "MIAMI",
      directional: "N",
      streetType: null,
    });
  });

  it("Unit word does not crash when it is the only non-dir/non-type token", () => {
    // "100 N Unit, Miami" → words = ["UNIT"] → keyword = "UNIT" (length 4, valid)
    expect(parseAddressForGIS("100 N Unit, Miami")).toEqual({
      houseNum: 100,
      streetKeyword: "UNIT",
      directional: "N",
      streetType: null,
    });
  });
});

describe("parseAddressForGIS — directional edge cases", () => {
  it("NW before two-digit numbered street yields the street number as keyword", () => {
    // "7900 NW 36 St, Miami" → words = ["36"] (NW→DIRS, ST→TYPES)
    expect(parseAddressForGIS("7900 NW 36 St, Miami")).toEqual({
      houseNum: 7900,
      streetKeyword: "36",
      directional: "NW",
      streetType: "ST",
    });
  });

  it("NE before two-digit numbered street yields keyword", () => {
    expect(parseAddressForGIS("2000 NE 26 St")).toEqual({
      houseNum: 2000,
      streetKeyword: "26",
      directional: "NE",
      streetType: "ST",
    });
  });

  it("returns null for SW before single-digit numbered street (keyword too short)", () => {
    // "355 SW 8 St" → words = ["8"], length 1 < 2 → null
    expect(parseAddressForGIS("355 SW 8 St, Miami")).toBeNull();
  });

  it("SE directional before a named street works correctly", () => {
    // "100 SE Biscayne Blvd" → words = ["BISCAYNE"] (SE→DIRS, BLVD→TYPES)
    expect(parseAddressForGIS("100 SE Biscayne Blvd")).toEqual({
      houseNum: 100,
      streetKeyword: "BISCAYNE",
      directional: "SE",
      streetType: "BLVD",
    });
  });

  it("directional-only address without house number returns null", () => {
    // "N Biscayne Blvd" — no leading digit
    expect(parseAddressForGIS("N Biscayne Blvd")).toBeNull();
  });

  it("compound directional at end does not become the keyword", () => {
    // "500 Alhambra Cir NW" — first word ALHAMBRA is not a dir → directional=null
    // last word NW is not a TYPES token → streetType=null
    // CIR is in TYPES and is filtered from the keyword candidates
    expect(parseAddressForGIS("500 Alhambra Cir NW")).toEqual({
      houseNum: 500,
      streetKeyword: "ALHAMBRA",
      directional: null,
      streetType: null,
    });
  });
});

describe("parseAddressForGIS — missing or invalid house numbers", () => {
  it("returns null for a PO Box address (no leading digit)", () => {
    expect(parseAddressForGIS("PO Box 12345")).toBeNull();
  });

  it("returns null for a city-only string", () => {
    // "Miami FL 33131" — no leading digit
    expect(parseAddressForGIS("Miami FL 33131")).toBeNull();
  });

  it("returns null for an intersection (no leading number)", () => {
    // "NW 36 St & NW 79 Ave" — starts with NW, not a digit
    expect(parseAddressForGIS("NW 36 St & NW 79 Ave")).toBeNull();
  });

  it("returns null when house number is present but only dirs/types follow", () => {
    // "100 N AVE" → words after filter = [] → null
    expect(parseAddressForGIS("100 N AVE")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(parseAddressForGIS("   ")).toBeNull();
  });
});

// ─── regression — previously-failing GIS cases ───────────────────────────────
// Each of the 5 addresses below returned the wrong top-1 folio before the fix.
// Root causes: directional confusion (NW vs SW) and numbered-street substring
// false positives ("2ND" matching "142ND", "91ST" matching "191ST", etc.).
// Fix: (a) extract directional from parse result, add sname LIKE 'NW %' filter;
//      (b) word-boundary-anchor numbered keywords with a leading-space LIKE;
//      (c) re-rank results by street type suffix match when type is known.

describe("regression — previously-failing GIS cases", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(features: { FOLIO: string; SNAME: string; HSE_NUM: number }[] = []) {
    const capturedUrls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrls.push(url);
      return {
        ok: true,
        json: async () => ({ features: features.map((f) => ({ attributes: f })) }),
      } as unknown as Response;
    });
    return capturedUrls;
  }

  function whereFrom(rawUrl: string): string {
    return new URL(rawUrl).searchParams.get("where") ?? "";
  }

  // ── 5110 NW 2nd Ave ──────────────────────────────────────────────────────

  it("5110 NW 2nd Ave — parse extracts NW directional and AVE type", () => {
    expect(parseAddressForGIS("5110 NW 2nd Ave")).toEqual({
      houseNum: 5110,
      streetKeyword: "2ND",
      directional: "NW",
      streetType: "AVE",
    });
  });

  it("5110 NW 2nd Ave — WHERE anchors 2ND at word boundary and filters to NW", async () => {
    const urls = stubFetch();
    await searchByAddressGIS("5110 NW 2nd Ave");
    const where = whereFrom(urls[0]);
    expect(where).toContain("% 2ND%");
    expect(where).toContain("sname LIKE 'NW %'");
  });

  // ── 8721 NW 91ST ST ───────────────────────────────────────────────────────

  it("8721 NW 91ST ST — parse extracts NW directional and ST type", () => {
    expect(parseAddressForGIS("8721 NW 91ST ST")).toEqual({
      houseNum: 8721,
      streetKeyword: "91ST",
      directional: "NW",
      streetType: "ST",
    });
  });

  it("8721 NW 91ST ST — WHERE anchors 91ST at word boundary and filters to NW", async () => {
    const urls = stubFetch();
    await searchByAddressGIS("8721 NW 91ST ST");
    const where = whereFrom(urls[0]);
    expect(where).toContain("% 91ST%");
    expect(where).toContain("sname LIKE 'NW %'");
  });

  // ── 9801 NW 106TH ST ──────────────────────────────────────────────────────

  it("9801 NW 106TH ST — parse extracts NW directional and ST type", () => {
    expect(parseAddressForGIS("9801 NW 106TH ST")).toEqual({
      houseNum: 9801,
      streetKeyword: "106TH",
      directional: "NW",
      streetType: "ST",
    });
  });

  it("9801 NW 106TH ST — WHERE filters to NW streets", async () => {
    const urls = stubFetch();
    await searchByAddressGIS("9801 NW 106TH ST");
    const where = whereFrom(urls[0]);
    expect(where).toContain("sname LIKE 'NW %'");
  });

  // ── 1040 W 33RD ST ────────────────────────────────────────────────────────

  it("1040 W 33RD ST — parse extracts W directional and ST type", () => {
    expect(parseAddressForGIS("1040 W 33RD ST")).toEqual({
      houseNum: 1040,
      streetKeyword: "33RD",
      directional: "W",
      streetType: "ST",
    });
  });

  it("1040 W 33RD ST — WHERE filters to W streets", async () => {
    const urls = stubFetch();
    await searchByAddressGIS("1040 W 33RD ST");
    const where = whereFrom(urls[0]);
    expect(where).toContain("sname LIKE 'W %'");
  });

  it("1040 W 33RD ST — type re-ranking puts ST before PL", async () => {
    stubFetch([
      { FOLIO: "0100000000001", SNAME: "W 33RD PL", HSE_NUM: 1040 },
      { FOLIO: "0100000000002", SNAME: "W 33RD ST", HSE_NUM: 1040 },
    ]);
    const parcels = await searchByAddressGIS("1040 W 33RD ST");
    expect(parcels[0].address).toBe("1040 W 33RD ST");
  });

  // ── 8811 NW 93RD ST ───────────────────────────────────────────────────────

  it("8811 NW 93RD ST — parse extracts NW directional and ST type", () => {
    expect(parseAddressForGIS("8811 NW 93RD ST")).toEqual({
      houseNum: 8811,
      streetKeyword: "93RD",
      directional: "NW",
      streetType: "ST",
    });
  });

  it("8811 NW 93RD ST — WHERE filters to NW streets", async () => {
    const urls = stubFetch();
    await searchByAddressGIS("8811 NW 93RD ST");
    const where = whereFrom(urls[0]);
    expect(where).toContain("sname LIKE 'NW %'");
  });
});

// ─── buildMdpaCriteriaWhere ───────────────────────────────────────────────────

describe("buildMdpaCriteriaWhere", () => {
  it("always includes the standing reference/cancel exclusion flags, even with no criteria", () => {
    const where = buildMdpaCriteriaWhere({});
    expect(where).toContain("REFERENCE_ONLY_FLAG");
    expect(where).toContain("CANCEL_FLAG");
  });

  it("builds a building-SF BETWEEN clause", () => {
    const where = buildMdpaCriteriaWhere({ buildingSqftMin: 5000, buildingSqftMax: 20000 });
    expect(where).toContain("BUILDING_ACTUAL_AREA BETWEEN 5000 AND 20000");
  });

  it("builds a land-SF BETWEEN clause", () => {
    const where = buildMdpaCriteriaWhere({ landSqftMin: 1000, landSqftMax: 50000 });
    expect(where).toContain("LOT_SIZE BETWEEN 1000 AND 50000");
  });

  it("builds an assessed-value BETWEEN clause", () => {
    const where = buildMdpaCriteriaWhere({ assessedValueMin: 100000, assessedValueMax: 900000 });
    expect(where).toContain("ASSESSED_VAL_CUR BETWEEN 100000 AND 900000");
  });

  it("builds a year-built BETWEEN clause", () => {
    const where = buildMdpaCriteriaWhere({ yearBuiltMin: 1990, yearBuiltMax: 2010 });
    expect(where).toContain("YEAR_BUILT BETWEEN 1990 AND 2010");
  });

  it("maps industrial property type to zero-padded 2-digit DOR_CODE_CUR prefixes 40-49", () => {
    const where = buildMdpaCriteriaWhere({ propertyType: "industrial" });
    expect(where).toContain("DOR_CODE_CUR LIKE '40%'");
    expect(where).toContain("DOR_CODE_CUR LIKE '49%'");
    expect(where).not.toContain("DOR_CODE_CUR LIKE '39%'");
    expect(where).not.toContain("DOR_CODE_CUR LIKE '50%'");
  });

  it("maps residential property type to the single code 01", () => {
    const where = buildMdpaCriteriaWhere({ propertyType: "residential" });
    expect(where).toContain("DOR_CODE_CUR LIKE '01%'");
  });

  it("maps multifamily property type to codes 03, 04, 08", () => {
    const where = buildMdpaCriteriaWhere({ propertyType: "multifamily" });
    expect(where).toContain("DOR_CODE_CUR LIKE '03%'");
    expect(where).toContain("DOR_CODE_CUR LIKE '04%'");
    expect(where).toContain("DOR_CODE_CUR LIKE '08%'");
  });

  it("uppercases and quotes city filters, escaping embedded quotes", () => {
    const where = buildMdpaCriteriaWhere({ cities: ["miami", "o'brien city"] });
    expect(where).toContain("UPPER(TRUE_SITE_CITY) IN ('MIAMI','O''BRIEN CITY')");
  });

  describe("sale-date signals", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-15T00:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("builds a soldWithinYears clause as DOS_1 >= N years before today", () => {
      const where = buildMdpaCriteriaWhere({ soldWithinYears: 2 });
      expect(where).toContain("DOS_1 >= '20240615'");
    });

    it("builds a heldAtLeastYears clause as DOS_1 <= N years before today", () => {
      const where = buildMdpaCriteriaWhere({ heldAtLeastYears: 10 });
      expect(where).toContain("DOS_1 <= '20160615'");
    });
  });
});

// ─── searchByCriteria (Miami-Dade) ────────────────────────────────────────────

describe("searchByCriteria (Miami-Dade)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a too_many outcome with the real count when the count exceeds maxResults, without fetching records", async () => {
    let fetchCalls = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      fetchCalls += 1;
      expect(new URL(url).searchParams.get("returnCountOnly")).toBe("true");
      return { ok: true, json: async () => ({ count: 5000 }) } as unknown as Response;
    });
    const result = await searchByCriteria({ buildingSqftMin: 1000 }, 200);
    expect(result).toEqual({ kind: "too_many", count: 5000 });
    expect(fetchCalls).toBe(1); // only the count call, never paginates
  });

  it("returns ok with zero matches when the count is zero, without fetching records", async () => {
    let fetchCalls = 0;
    vi.stubGlobal("fetch", async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => ({ count: 0 }) } as unknown as Response;
    });
    const result = await searchByCriteria({ buildingSqftMin: 999_999 }, 200);
    expect(result).toEqual({ kind: "ok", matches: [], totalCount: 0 });
    expect(fetchCalls).toBe(1);
  });

  it("paginates through multiple pages until all matches are collected", async () => {
    const PAGE_SIZE = 200;
    const totalCount = PAGE_SIZE + 1; // forces exactly one full page, then a second partial page
    vi.stubGlobal("fetch", async (url: string) => {
      const params = new URL(url).searchParams;
      if (params.get("returnCountOnly") === "true") {
        return { ok: true, json: async () => ({ count: totalCount }) } as unknown as Response;
      }
      const offset = Number(params.get("resultOffset"));
      if (offset === 0) {
        const features = Array.from({ length: PAGE_SIZE }, (_, i) => ({
          attributes: { FOLIO: String(i + 1).padStart(13, "0"), TRUE_SITE_ADDR: `${i} TEST ST` },
        }));
        return { ok: true, json: async () => ({ features }) } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({ features: [{ attributes: { FOLIO: "9999999999999", TRUE_SITE_ADDR: "LAST ST" } }] }),
      } as unknown as Response;
    });
    const result = await searchByCriteria({}, 500);
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.totalCount).toBe(totalCount);
    expect(result.matches).toHaveLength(totalCount);
    expect(result.matches[0].folio).toBe("0000000000001");
    expect(result.matches[PAGE_SIZE].folio).toBe("9999999999999");
    expect(result.matches[0].strap).toBe(folioToStrap("0000000000001"));
  });

  it("skips a feature with a blank/missing FOLIO", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const params = new URL(url).searchParams;
      if (params.get("returnCountOnly") === "true") {
        return { ok: true, json: async () => ({ count: 1 }) } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({ features: [{ attributes: { FOLIO: "" } }] }),
      } as unknown as Response;
    });
    const result = await searchByCriteria({}, 200);
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.matches).toEqual([]);
  });
});

describe("parseMdpaPropertyInfo", () => {
  it("reads YearBuilt from PropertyInfo", () => {
    expect(parseMdpaPropertyInfo({
      PropertyInfo: { YearBuilt: 2019, BuildingActualArea: 42180, LotSize: 87120 },
    })).toEqual({
      yearBuilt: 2019,
      lotSize: 87120,
      stories: null,
      units: null,
      assessedValue: null,
      buildingArea: 42180,
    });
  });
});

describe("overlayMdpaOnExtracted", () => {
  it("fills empty year_built from PropertyInfo without clobbering size", () => {
    const extracted: ExtractedProperty = {
      address: "3880 W 104TH ST",
      city: "Hialeah",
      submarket: null,
      owner_name: "TEST LLC",
      ownership_type: "institutional",
      size_sqft: 42000,
      property_type: "industrial",
      last_sale_date: null,
      last_sale_price: null,
      building_composition: { year_built: null, lot_size_sqft: null },
      confidence_flags: [],
    };
    const out = overlayMdpaOnExtracted(extracted, { PropertyInfo: { YearBuilt: 2019 } });
    expect(out.building_composition.year_built).toBe(2019);
    expect(out.size_sqft).toBe(42000);
  });
});
