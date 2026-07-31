import { describe, it, expect, vi, afterEach } from "vitest";
import {
  folioToStrap,
  searchByAddressGIS,
  getPropertyDetail,
  extractOwnerMailing,
  primaryOwnerName,
  propertyUseToType,
  pbSaleDate,
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

describe("live Palm Beach parcel service", () => {
  it("627 SW 4th Ave, Boynton Beach resolves to PCN 08434529010190251", async () => {
    const result = await searchByAddressGIS("627 SW 4th Ave");
    const parcels = okParcels(result);
    expect(parcels.length).toBeGreaterThanOrEqual(1);
    expect(parcels[0].folio).toBe("08434529010190251");

    const detail = await getPropertyDetail(parcels[0].folio);
    expect(detail).not.toBeNull();
    expect(detail!.PARCEL_NUMBER).toBe("08434529010190251");
  }, 30_000);
});
