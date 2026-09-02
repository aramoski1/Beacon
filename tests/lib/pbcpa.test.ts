import { describe, it, expect, vi, afterEach } from "vitest";
import {
  folioToStrap,
  searchByAddressGIS,
  getPropertyDetail,
  extractOwnerMailing,
  primaryOwnerName,
  propertyUseToType,
  pbSaleDate,
  searchParcelsByOwnerName,
  searchParcelsByOwnerQueries,
  buildPbcpaCriteriaWhere,
  searchByCriteria,
  type PBParcel,
  type PBRecord,
  type GISSearchResult,
} from "../../lib/pbcpa";
import { parseAddressForGIS } from "../../lib/mdpa";
import { detectCounty } from "../../lib/county-router";

function okParcels(result: GISSearchResult): PBParcel[] {
  if (result.kind !== "ok") throw new Error(`Expected kind "ok", got "${result.kind}"`);
  return result.parcels;
}

// ─── folioToStrap (PCN format) ────────────────────────────────────────────────
// Format confirmed against multiple live PAO.PROPINFO_PUB records: 17 digits,
// grouped 2-2-2-2-2-3-4 — one segment more than the commonly-cited 15-digit
// "XX-XX-XX-XX-XXX-XXXX" shorthand.

describe("folioToStrap (Palm Beach)", () => {
  it("formats a real 17-digit Palm Beach PCN (610 Clematis St condo)", () => {
    expect(folioToStrap("74434321230066120")).toBe("74-43-43-21-23-006-6120");
  });

  it("formats a real PCN with leading zero (627 SW 4th Ave, Boynton Beach)", () => {
    expect(folioToStrap("08434529010190251")).toBe("08-43-45-29-01-019-0251");
  });

  it("formats a real PCN (600 Datura St, West Palm Beach)", () => {
    expect(folioToStrap("74434321010300010")).toBe("74-43-43-21-01-030-0010");
  });

  it("pads a short folio to 17 digits", () => {
    expect(folioToStrap("1")).toBe("00-00-00-00-00-000-0001");
  });

  it("accepts a folio that already has dashes and strips them", () => {
    expect(folioToStrap("08-43-45-29-01-019-0251")).toBe("08-43-45-29-01-019-0251");
  });
});

// ─── parseAddressForGIS reuse ─────────────────────────────────────────────────
// Not redefined — imported straight from lib/mdpa, same as lib/bcpa.ts. Sanity
// check that Palm Beach's confirmed live address shapes parse the same way.

describe("parseAddressForGIS applied to Palm Beach addresses", () => {
  it("parses a directional address: 627 SW 4th Ave", () => {
    expect(parseAddressForGIS("627 SW 4th Ave")).toEqual({
      houseNum: 627,
      streetKeyword: "4TH",
      directional: "SW",
      streetType: "AVE",
    });
  });

  it("parses a non-directional address: 600 Datura St", () => {
    expect(parseAddressForGIS("600 Datura St")).toEqual({
      houseNum: 600,
      streetKeyword: "DATURA",
      directional: null,
      streetType: "ST",
    });
  });

  it("parses a hyphenated house-number range the same way as Broward", () => {
    expect(parseAddressForGIS("301-305 Clematis St")).toEqual({
      houseNum: 301,
      houseNumAlt: 305,
      streetKeyword: "CLEMATIS",
      directional: null,
      streetType: "ST",
    });
  });
});

// ─── searchByAddressGIS — WHERE clause construction + retries ────────────────

describe("searchByAddressGIS (Palm Beach)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type FakeFeature = { PARCEL_NUMBER: string; SITE_ADDR_STR: string; MUNICIPALITY: string };

  function stubFetch(features: FakeFeature[] = []) {
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

  function stubFetchSequence(pages: FakeFeature[][]) {
    const capturedUrls: string[] = [];
    let call = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrls.push(url);
      const features = pages[call] ?? [];
      call++;
      return {
        ok: true,
        json: async () => ({ features: features.map((f) => ({ attributes: f })) }),
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

  it("points at the Palm Beach PAO.PROPINFO_PUB table", async () => {
    const urls = stubFetch([
      { PARCEL_NUMBER: "08434529010190251", SITE_ADDR_STR: "627 SW 4TH AVE", MUNICIPALITY: "BOYNTON BEACH" },
    ]);
    await searchByAddressGIS("627 SW 4th Ave");
    expect(serviceFrom(urls[0])).toContain("Parcels/labels/MapServer/1");
  });

  it("627 SW 4th Ave — WHERE embeds house number, directional, and numbered keyword", async () => {
    const urls = stubFetch([
      { PARCEL_NUMBER: "08434529010190251", SITE_ADDR_STR: "627 SW 4TH AVE", MUNICIPALITY: "BOYNTON BEACH" },
    ]);
    await searchByAddressGIS("627 SW 4th Ave");
    expect(whereFrom(urls[0])).toBe("SITE_ADDR_STR LIKE '627 SW 4TH%'");
  });

  it("600 Datura St — WHERE embeds house number and keyword (no directional)", async () => {
    const urls = stubFetch([
      { PARCEL_NUMBER: "74434321010300010", SITE_ADDR_STR: "600 DATURA ST", MUNICIPALITY: "WEST PALM BEACH" },
    ]);
    await searchByAddressGIS("600 Datura St");
    expect(whereFrom(urls[0])).toBe("SITE_ADDR_STR LIKE '600 DATURA%'");
  });

  it("maps returned features to PBParcel with folio, strap, address, city", async () => {
    stubFetch([
      { PARCEL_NUMBER: "08434529010190251", SITE_ADDR_STR: "627 SW 4TH AVE", MUNICIPALITY: "BOYNTON BEACH" },
    ]);
    const parcels = okParcels(await searchByAddressGIS("627 SW 4th Ave"));
    expect(parcels).toHaveLength(1);
    expect(parcels[0].folio).toBe("08434529010190251");
    expect(parcels[0].strap).toBe("08-43-45-29-01-019-0251");
    expect(parcels[0].address).toBe("627 SW 4TH AVE");
    expect(parcels[0].city).toBe("BOYNTON BEACH");
  });

  it("returns { kind: 'ok', parcels: [] } when no features (genuine miss)", async () => {
    stubFetch([]);
    const result = await searchByAddressGIS("600 Datura St");
    expect(result.kind).toBe("ok");
    expect(okParcels(result)).toHaveLength(0);
  });

  it("returns { kind: 'error' } on GIS HTTP error (does not throw)", async () => {
    stubFetchError(null, false, 503);
    const result = await searchByAddressGIS("600 Datura St");
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toContain("503");
  });

  it("throws when address has no house number", async () => {
    stubFetch();
    await expect(searchByAddressGIS("Datura St")).rejects.toThrow();
  });

  it("returns { kind: 'too_many_candidates' } when a full page has no keyword match", async () => {
    const junk = Array.from({ length: 50 }, (_, i) => ({
      PARCEL_NUMBER: `0843452901${String(i).padStart(2, "0")}`,
      SITE_ADDR_STR: `600 OAK ST UNIT ${i}`,
      MUNICIPALITY: "BOYNTON BEACH",
    }));
    stubFetch(junk);
    const result = await searchByAddressGIS("600 Datura St");
    expect(result.kind).toBe("too_many_candidates");
  });

  // ── retries: same real-world formats fixed for Broward ──────────────────────

  it("hyphenated range — retries with the second house number when the first finds nothing", async () => {
    const urls = stubFetchSequence([
      [],
      [{ PARCEL_NUMBER: "74434321230066121", SITE_ADDR_STR: "305 CLEMATIS ST", MUNICIPALITY: "WEST PALM BEACH" }],
    ]);
    const result = await searchByAddressGIS("301-305 Clematis St");
    expect(urls).toHaveLength(2);
    expect(whereFrom(urls[0])).toBe("SITE_ADDR_STR LIKE '301 CLEMATIS%'");
    expect(whereFrom(urls[1])).toBe("SITE_ADDR_STR LIKE '305 CLEMATIS%'");
    expect(okParcels(result)[0].address).toBe("305 CLEMATIS ST");
  });

  it("hyphenated range — falls back to a block-level search for a recorded containing range", async () => {
    const urls = stubFetchSequence([
      [],
      [],
      [
        { PARCEL_NUMBER: "74434321230066120", SITE_ADDR_STR: "301-363 CLEMATIS ST", MUNICIPALITY: "WEST PALM BEACH" },
        { PARCEL_NUMBER: "74434321230066199", SITE_ADDR_STR: "381-385 CLEMATIS ST", MUNICIPALITY: "WEST PALM BEACH" },
      ],
    ]);
    const result = await searchByAddressGIS("301-305 Clematis St");
    expect(urls).toHaveLength(3);
    expect(whereFrom(urls[2])).toBe("SITE_ADDR_STR LIKE '3%CLEMATIS%'");
    const parcels = okParcels(result);
    expect(parcels).toHaveLength(1);
    expect(parcels[0].address).toBe("301-363 CLEMATIS ST");
  });

  it("numbered street with ordinal suffix — retries with the bare number when dropped in the tax roll", async () => {
    const urls = stubFetchSequence([
      [],
      [{ PARCEL_NUMBER: "08434529010190251", SITE_ADDR_STR: "627 SW 4 AVE", MUNICIPALITY: "BOYNTON BEACH" }],
    ]);
    const result = await searchByAddressGIS("627 SW 4th Ave");
    expect(urls).toHaveLength(2);
    expect(whereFrom(urls[0])).toBe("SITE_ADDR_STR LIKE '627 SW 4TH%'");
    expect(whereFrom(urls[1])).toBe("SITE_ADDR_STR LIKE '627 SW 4%'");
    expect(okParcels(result)[0].address).toBe("627 SW 4 AVE");
  });

  it("does not retry when the first attempt already matches", async () => {
    const urls = stubFetchSequence([
      [{ PARCEL_NUMBER: "08434529010190251", SITE_ADDR_STR: "627 SW 4TH AVE", MUNICIPALITY: "BOYNTON BEACH" }],
    ]);
    const result = await searchByAddressGIS("627 SW 4th Ave");
    expect(urls).toHaveLength(1);
    expect(okParcels(result)[0].address).toBe("627 SW 4TH AVE");
  });
});

// ─── getPropertyDetail ────────────────────────────────────────────────────────

describe("getPropertyDetail (Palm Beach)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queries by PARCEL_NUMBER exact match", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        json: async () => ({
          features: [
            {
              attributes: {
                PARCEL_NUMBER: "08434529010190251",
                OWNER_NAME1: "JEAN FRANCIS &",
                OWNER_NAME2: "JEAN PIERRE CLAUDETTE JEAN",
              },
            },
          ],
        }),
      } as unknown as Response;
    });
    const rec = await getPropertyDetail("08434529010190251");
    expect(new URL(urls[0]).searchParams.get("where")).toBe("PARCEL_NUMBER='08434529010190251'");
    expect(rec?.PARCEL_NUMBER).toBe("08434529010190251");
    expect(rec?.OWNER_NAME1).toBe("JEAN FRANCIS &");
  });
});

// ─── extractOwnerMailing ──────────────────────────────────────────────────────

describe("extractOwnerMailing (Palm Beach)", () => {
  function record(overrides: Partial<PBRecord> = {}): PBRecord {
    return {
      PARCEL_NUMBER: "08434529010190251",
      OWNER_NAME1: "JEAN FRANCIS &",
      OWNER_NAME2: "JEAN PIERRE CLAUDETTE JEAN",
      SITE_ADDR_STR: "627 SW 4TH AVE",
      MUNICIPALITY: "BOYNTON BEACH",
      PADDR1: "627 SW 4TH AVE",
      PADDR2: null,
      PADDR3: "BOYNTON BEACH FL 33426 4705",
      CITYNAME: "BOYNTON BEACH",
      STATE: "FL",
      ZIP1: "33426",
      ZIP2: "4705",
      ACRES: 0.1729,
      SALE_DATE: 1401926400000,
      PRICE: 149000,
      TOTAL_MARKET: 354452,
      ASSESSED_VAL: 196057,
      PROPERTY_USE: "SINGLE FAMILY",
      ...overrides,
    };
  }

  it("builds from discrete PADDR1/CITYNAME/STATE/ZIP fields (matches Broward's comma-joined convention)", () => {
    expect(extractOwnerMailing(record())).toBe("627 SW 4TH AVE, BOYNTON BEACH, FL 33426-4705");
  });

  it("includes PADDR2 when present", () => {
    expect(extractOwnerMailing(record({ PADDR2: "UNIT 5" }))).toBe(
      "627 SW 4TH AVE, UNIT 5, BOYNTON BEACH, FL 33426-4705"
    );
  });

  it("omits the +4 extension when ZIP2 is absent", () => {
    expect(extractOwnerMailing(record({ ZIP2: null }))).toBe("627 SW 4TH AVE, BOYNTON BEACH, FL 33426");
  });

  it("returns null when all address fields are null", () => {
    expect(
      extractOwnerMailing(record({ PADDR1: null, PADDR2: null, CITYNAME: null, STATE: null, ZIP1: null, ZIP2: null }))
    ).toBeNull();
  });

  it("returns null for null input", () => {
    expect(extractOwnerMailing(null)).toBeNull();
  });
});

// ─── primaryOwnerName ─────────────────────────────────────────────────────────
// Confirmed live: OWNER_NAME1 sometimes ends with a trailing "&" marking a
// second owner in OWNER_NAME2 (spouse or a wholly separate co-owning entity).

describe("primaryOwnerName (Palm Beach)", () => {
  it("strips a trailing '&' from an individual owner", () => {
    expect(primaryOwnerName({ OWNER_NAME1: "MACHADO MARLON O &" })).toBe("MACHADO MARLON O");
  });

  it("strips a trailing '&' from an entity owner", () => {
    expect(primaryOwnerName({ OWNER_NAME1: "8386 BLACKBURN LLC &" })).toBe("8386 BLACKBURN LLC");
  });

  it("leaves a name with no trailing marker unchanged", () => {
    expect(primaryOwnerName({ OWNER_NAME1: "WEINBERG ROBERT A TR" })).toBe("WEINBERG ROBERT A TR");
  });

  it("returns null for a blank or missing OWNER_NAME1", () => {
    expect(primaryOwnerName({ OWNER_NAME1: null })).toBeNull();
    expect(primaryOwnerName({ OWNER_NAME1: "  " })).toBeNull();
    expect(primaryOwnerName(null)).toBeNull();
  });
});

// ─── propertyUseToType ────────────────────────────────────────────────────────
// Domain of ~120 real PROPERTY_USE values confirmed live against
// PAO.PROPINFO_PUB; representative cases from each bucket below.

describe("propertyUseToType (Palm Beach)", () => {
  it("classifies industrial uses", () => {
    expect(propertyUseToType("WAREH/DIST TERM")).toBe("industrial");
    expect(propertyUseToType("WAREH/DIST TERM CONDO")).toBe("industrial");
    expect(propertyUseToType("HEAVY MFG")).toBe("industrial");
    expect(propertyUseToType("SELF STORAGE")).toBe("industrial");
    expect(propertyUseToType("VACANT INDUSTRIAL")).toBe("industrial");
    expect(propertyUseToType("VACANT INDUS CONDO")).toBe("industrial");
  });

  it("classifies office uses", () => {
    expect(propertyUseToType("OFFICE BLDG-NON MEDICAL 1 TO 3 STORIES")).toBe("office");
    expect(propertyUseToType("OFF BLDG- NON MEDIC 4 STORIES & UP CONDO")).toBe("office");
    expect(propertyUseToType("MEDICAL OFFICE- BUILDING UP TO 4 STORIES")).toBe("office");
    expect(propertyUseToType("FINANCIAL")).toBe("office");
  });

  it("classifies retail uses, including the 'SH CTR' shopping-center abbreviation", () => {
    expect(propertyUseToType("STORES")).toBe("retail");
    expect(propertyUseToType("SHOPPING CENTER REGIONAL")).toBe("retail");
    expect(propertyUseToType("SH CTR CMMITY CONDO")).toBe("retail");
    expect(propertyUseToType("RESTAURANT")).toBe("retail");
    expect(propertyUseToType("DEPARTMENT STORE")).toBe("retail");
  });

  it("classifies mixed-use before it can fall through to retail's STORE keyword", () => {
    expect(propertyUseToType("STORE/OFFICE/RESIDENTIAL")).toBe("mixed-use");
    expect(propertyUseToType("STORE/OFF/RES CONDO")).toBe("mixed-use");
  });

  it("classifies multifamily uses", () => {
    expect(propertyUseToType("CONDOMINIUM")).toBe("multifamily");
    expect(propertyUseToType("COOPERATIVE")).toBe("multifamily");
    expect(propertyUseToType("MULTIFAMILY < 5 UNITS")).toBe("multifamily");
    expect(propertyUseToType("MFR 5 TO 9 UNITS")).toBe("multifamily");
  });

  it("classifies residential uses", () => {
    expect(propertyUseToType("SINGLE FAMILY")).toBe("residential");
    expect(propertyUseToType("TOWNHOUSE")).toBe("residential");
    expect(propertyUseToType("MOBILE HOME/MANUFACTURED HOME")).toBe("residential");
  });

  it("classifies vacant/agricultural land uses (but not vacant industrial)", () => {
    expect(propertyUseToType("VACANT")).toBe("land");
    expect(propertyUseToType("VACANT COMMERCIAL LAND")).toBe("land");
    expect(propertyUseToType("AG Classification CROP SOIL CLASS 1")).toBe("land");
  });

  it("falls back to 'other' for unrecognized or missing values, rather than guessing", () => {
    expect(propertyUseToType("HOTEL CONDO")).toBe("other");
    expect(propertyUseToType("MUNICIPAL")).toBe("other");
    expect(propertyUseToType(null)).toBe("other");
    expect(propertyUseToType("")).toBe("other");
  });
});

// ─── pbSaleDate ───────────────────────────────────────────────────────────────

describe("pbSaleDate (Palm Beach)", () => {
  it("converts a real SALE_DATE epoch-ms value to an ISO date", () => {
    expect(pbSaleDate(1595808000000)).toBe("2020-07-27");
    expect(pbSaleDate(1401926400000)).toBe("2014-06-05");
  });

  it("returns null for null/undefined", () => {
    expect(pbSaleDate(null)).toBeNull();
    expect(pbSaleDate(undefined)).toBeNull();
  });
});

// ─── searchParcelsByOwnerName (Palm Beach tax roll owner search) ─────────────

describe("searchParcelsByOwnerName (Palm Beach)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type FakeOwnerFeature = {
    PARCEL_NUMBER: string;
    OWNER_NAME1: string;
    OWNER_NAME2?: string | null;
    SITE_ADDR_STR?: string;
    MUNICIPALITY?: string;
  };

  function stubOwnerFetch(pages: FakeOwnerFeature[][]) {
    const capturedUrls: string[] = [];
    let call = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrls.push(url);
      const features = pages[call] ?? [];
      call++;
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

  it("builds an entity WHERE clause across OWNER_NAME1/OWNER_NAME2 using the top 2 significant tokens", async () => {
    const urls = stubOwnerFetch([[]]);
    await searchParcelsByOwnerName("Acme Holdings LLC", "entity");
    expect(whereFrom(urls[0])).toBe(
      "((UPPER(OWNER_NAME1) LIKE '%HOLDINGS%' AND UPPER(OWNER_NAME1) LIKE '%ACME%') OR (UPPER(OWNER_NAME2) LIKE '%HOLDINGS%' AND UPPER(OWNER_NAME2) LIKE '%ACME%'))",
    );
  });

  it("builds a person WHERE clause across OWNER_NAME1/OWNER_NAME2 ANDing every name part", async () => {
    const urls = stubOwnerFetch([[]]);
    await searchParcelsByOwnerName("John Smith", "person");
    expect(whereFrom(urls[0])).toBe(
      "((UPPER(OWNER_NAME1) LIKE UPPER('%John%') AND UPPER(OWNER_NAME1) LIKE UPPER('%Smith%')) OR (UPPER(OWNER_NAME2) LIKE UPPER('%John%') AND UPPER(OWNER_NAME2) LIKE UPPER('%Smith%')))",
    );
  });

  it("maps matching features to PbcpaOwnerParcelHit with folio, strap, and null building sqft", async () => {
    stubOwnerFetch([
      [
        {
          PARCEL_NUMBER: "08434520180001140",
          OWNER_NAME1: "MODENA CAPITAL INVESTMENTS LLC",
          SITE_ADDR_STR: "1210 OLD BOYNTON RD 114",
          MUNICIPALITY: "BOYNTON BEACH",
        },
      ],
    ]);
    const hits = await searchParcelsByOwnerName("Modena Capital Investments LLC", "entity");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({
      folio: "08434520180001140",
      strap: "08-43-45-20-18-000-1140",
      ownerName: "MODENA CAPITAL INVESTMENTS LLC",
      address: "1210 OLD BOYNTON RD 114",
      city: "BOYNTON BEACH",
      buildingSqft: null,
    });
  });

  it("falls back to OWNER_NAME2 when OWNER_NAME1 is blank", async () => {
    stubOwnerFetch([
      [{ PARCEL_NUMBER: "1", OWNER_NAME1: "", OWNER_NAME2: "SMITH JOHN" }],
    ]);
    const hits = await searchParcelsByOwnerName("John Smith", "person");
    expect(hits.map((h) => h.ownerName)).toEqual(["SMITH JOHN"]);
  });

  it("filters out rows whose owner fields do not actually match the entity query (LIKE false positives)", async () => {
    stubOwnerFetch([
      [
        { PARCEL_NUMBER: "1", OWNER_NAME1: "ACME HOLDINGS LLC" },
        { PARCEL_NUMBER: "2", OWNER_NAME1: "BETA ACME PARTNERS LLC" },
      ],
    ]);
    const hits = await searchParcelsByOwnerName("Acme Holdings LLC", "entity");
    expect(hits.map((h) => h.ownerName)).toEqual(["ACME HOLDINGS LLC"]);
  });

  it("filters person search to owners containing every name part", async () => {
    stubOwnerFetch([
      [
        { PARCEL_NUMBER: "1", OWNER_NAME1: "SMITH JOHN" },
        { PARCEL_NUMBER: "2", OWNER_NAME1: "SMITH JANE" },
      ],
    ]);
    const hits = await searchParcelsByOwnerName("John Smith", "person");
    expect(hits.map((h) => h.ownerName)).toEqual(["SMITH JOHN"]);
  });

  it("dedupes by folio when the same parcel appears twice", async () => {
    stubOwnerFetch([
      [
        { PARCEL_NUMBER: "1", OWNER_NAME1: "ACME HOLDINGS LLC", SITE_ADDR_STR: "A" },
        { PARCEL_NUMBER: "1", OWNER_NAME1: "ACME HOLDINGS LLC", SITE_ADDR_STR: "A" },
      ],
    ]);
    const hits = await searchParcelsByOwnerName("Acme Holdings LLC", "entity");
    expect(hits).toHaveLength(1);
  });

  it("throws when the owner name is too short to search", async () => {
    stubOwnerFetch([[]]);
    await expect(searchParcelsByOwnerName("A", "entity")).rejects.toThrow();
  });

  it("skips rows with both owner fields blank", async () => {
    stubOwnerFetch([[{ PARCEL_NUMBER: "1", OWNER_NAME1: "" }]]);
    const hits = await searchParcelsByOwnerName("Acme Holdings LLC", "entity");
    expect(hits).toHaveLength(0);
  });
});

describe("searchParcelsByOwnerQueries (Palm Beach)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("merges hits from multiple queries by folio and dedupes repeated queries", async () => {
    let call = 0;
    vi.stubGlobal("fetch", async () => {
      call++;
      const features =
        call === 1
          ? [{ PARCEL_NUMBER: "1", OWNER_NAME1: "ACME HOLDINGS LLC", SITE_ADDR_STR: "A ST" }]
          : [{ PARCEL_NUMBER: "2", OWNER_NAME1: "JOHN SMITH", SITE_ADDR_STR: "B ST" }];
      return {
        ok: true,
        json: async () => ({ features: features.map((f) => ({ attributes: f })) }),
      } as unknown as Response;
    });

    const hits = await searchParcelsByOwnerQueries([
      { query: "Acme Holdings LLC", mode: "entity" },
      { query: "acme holdings llc", mode: "entity" }, // duplicate — should be skipped
      { query: "John Smith", mode: "person" },
    ]);

    expect(hits.map((h) => h.folio).sort()).toEqual(["1", "2"]);
    // Only 2 fetch calls: the duplicate normalized query was skipped before any fetch.
    expect(call).toBe(2);
  });
});

// ─── detectCounty ─────────────────────────────────────────────────────────────

describe("detectCounty — Palm Beach cities", () => {
  it("identifies West Palm Beach, Boca Raton, Delray Beach, Boynton Beach, Jupiter, Wellington as Palm Beach", () => {
    for (const city of ["West Palm Beach", "Boca Raton", "Delray Beach", "Boynton Beach", "Jupiter", "Wellington"]) {
      expect(detectCounty(city), city).toBe("palm-beach");
    }
  });

  it("is case-insensitive for Palm Beach cities", () => {
    expect(detectCounty("west palm beach")).toBe("palm-beach");
    expect(detectCounty("BOCA RATON")).toBe("palm-beach");
  });

  it("still returns null for a genuinely unsupported city", () => {
    expect(detectCounty("Orlando")).toBeNull();
  });

  it("does not misclassify Miami-Dade/Broward cities as Palm Beach", () => {
    expect(detectCounty("Miami")).toBe("miami-dade");
    expect(detectCounty("Fort Lauderdale")).toBe("broward");
  });
});

// ─── Live Palm Beach parcel service ───────────────────────────────────────────

describe.skipIf(!!process.env.CI)("live Palm Beach parcel service", () => {
  it("627 SW 4th Ave, Boynton Beach resolves to PCN 08434529010190251", async () => {
    const result = await searchByAddressGIS("627 SW 4th Ave");
    const parcels = okParcels(result);
    expect(parcels.length).toBeGreaterThanOrEqual(1);
    expect(parcels[0].folio).toBe("08434529010190251");

    const detail = await getPropertyDetail(parcels[0].folio);
    expect(detail).not.toBeNull();
    expect(detail!.PARCEL_NUMBER).toBe("08434529010190251");
  }, 30_000);

  // Confirmed live: SAINTE GEORGE INVESTMENTS LLC owns multiple condo units at
  // 2701 NW 2nd Ave, Boca Raton — a real multi-parcel portfolio for exercising
  // owner-name discovery end to end against the live PAO.PROPINFO_PUB table.
  it("SAINTE GEORGE INVESTMENTS LLC resolves to multiple parcels at 2701 NW 2nd Ave, Boca Raton", async () => {
    const hits = await searchParcelsByOwnerName("Sainte George Investments LLC", "entity");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.every((h) => h.ownerName === "SAINTE GEORGE INVESTMENTS LLC")).toBe(true);
    expect(hits.every((h) => h.address?.startsWith("2701 NW 2ND AVE"))).toBe(true);
  }, 30_000);
});

// ─── buildPbcpaCriteriaWhere ──────────────────────────────────────────────────

describe("buildPbcpaCriteriaWhere", () => {
  it("returns 1=1 when no criteria given", () => {
    expect(buildPbcpaCriteriaWhere({})).toBe("1=1");
  });

  it("ignores buildingSqftMin/Max and yearBuiltMin/Max entirely (no such fields exist for Palm Beach)", () => {
    const where = buildPbcpaCriteriaWhere({
      buildingSqftMin: 5000,
      buildingSqftMax: 20000,
      yearBuiltMin: 1990,
      yearBuiltMax: 2010,
    });
    expect(where).toBe("1=1");
  });

  it("converts a land-SF range to an ACRES BETWEEN clause", () => {
    const where = buildPbcpaCriteriaWhere({ landSqftMin: 43560, landSqftMax: 87120 });
    expect(where).toBe("ACRES BETWEEN 1 AND 2");
  });

  it("builds an assessed-value BETWEEN clause on ASSESSED_VAL", () => {
    const where = buildPbcpaCriteriaWhere({ assessedValueMin: 100000, assessedValueMax: 900000 });
    expect(where).toContain("ASSESSED_VAL BETWEEN 100000 AND 900000");
  });

  it("maps industrial property type to a LIKE-OR clause over the same keywords as propertyUseToType", () => {
    const where = buildPbcpaCriteriaWhere({ propertyType: "industrial" });
    expect(where).toContain("PROPERTY_USE LIKE '%WAREH%'");
    expect(where).toContain("PROPERTY_USE LIKE '%MARINA%'");
  });

  it("maps land property type to VACANT-but-not-INDUS plus AG prefix", () => {
    const where = buildPbcpaCriteriaWhere({ propertyType: "land" });
    expect(where).toContain("PROPERTY_USE LIKE 'VACANT%'");
    expect(where).toContain("PROPERTY_USE NOT LIKE '%INDUS%'");
    expect(where).toContain("PROPERTY_USE LIKE 'AG %'");
  });

  it("uppercases and quotes city filters against MUNICIPALITY", () => {
    const where = buildPbcpaCriteriaWhere({ cities: ["west palm beach"] });
    expect(where).toContain("UPPER(MUNICIPALITY) IN ('WEST PALM BEACH')");
  });

  it("builds a soldWithinYears clause as MONTHS_SINCE_SALE <= N*12 (the precomputed field this layer exposes)", () => {
    const where = buildPbcpaCriteriaWhere({ soldWithinYears: 2 });
    expect(where).toContain("MONTHS_SINCE_SALE <= 24");
  });

  it("builds a heldAtLeastYears clause as MONTHS_SINCE_SALE >= N*12", () => {
    const where = buildPbcpaCriteriaWhere({ heldAtLeastYears: 10 });
    expect(where).toContain("MONTHS_SINCE_SALE >= 120");
  });
});

// ─── searchByCriteria (Palm Beach) ────────────────────────────────────────────

describe("searchByCriteria (Palm Beach)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns too_many with the real count when it exceeds maxResults, without fetching records", async () => {
    let fetchCalls = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      fetchCalls += 1;
      expect(new URL(url).searchParams.get("returnCountOnly")).toBe("true");
      return { ok: true, json: async () => ({ count: 180260 }) } as unknown as Response;
    });
    const result = await searchByCriteria({ landSqftMin: 21780, landSqftMax: 87120 }, 200);
    expect(result).toEqual({ kind: "too_many", count: 180260 });
    expect(fetchCalls).toBe(1);
  });

  it("returns ok with zero matches when count is zero", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ count: 0 }) }) as unknown as Response);
    const result = await searchByCriteria({ landSqftMin: 999_999_999 }, 200);
    expect(result).toEqual({ kind: "ok", matches: [], totalCount: 0 });
  });

  it("always requests orderByFields=OBJECTID (required by this service for paginated queries)", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      const params = new URL(url).searchParams;
      if (params.get("returnCountOnly") === "true") {
        return { ok: true, json: async () => ({ count: 1 }) } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({ features: [{ attributes: { PARCEL_NUMBER: "00434230000003014" } }] }),
      } as unknown as Response;
    });
    await searchByCriteria({}, 200);
    const pageUrl = urls.find((u) => new URL(u).searchParams.get("returnCountOnly") !== "true");
    expect(pageUrl && new URL(pageUrl).searchParams.get("orderByFields")).toBe("OBJECTID");
  });

  it("paginates across a full first page into a second page", async () => {
    const PAGE_SIZE = 200;
    const totalCount = PAGE_SIZE + 1;
    vi.stubGlobal("fetch", async (url: string) => {
      const params = new URL(url).searchParams;
      if (params.get("returnCountOnly") === "true") {
        return { ok: true, json: async () => ({ count: totalCount }) } as unknown as Response;
      }
      const offset = Number(params.get("resultOffset"));
      if (offset === 0) {
        const features = Array.from({ length: PAGE_SIZE }, (_, i) => ({
          attributes: { PARCEL_NUMBER: String(i + 1).padStart(17, "0"), ACRES: 1.5 },
        }));
        return { ok: true, json: async () => ({ features }) } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({ features: [{ attributes: { PARCEL_NUMBER: "99999999999999999", ACRES: 2 } }] }),
      } as unknown as Response;
    });
    const result = await searchByCriteria({}, 500);
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.totalCount).toBe(totalCount);
    expect(result.matches).toHaveLength(totalCount);
    expect(result.matches[PAGE_SIZE].folio).toBe("99999999999999999");
    // ACRES converted to landSqft: 1.5 * 43560 = 65340
    expect(result.matches[0].landSqft).toBe(65340);
    expect(result.matches[0].buildingSqft).toBeNull();
    expect(result.matches[0].yearBuilt).toBeNull();
  });
});
