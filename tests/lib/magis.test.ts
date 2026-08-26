import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  searchByAddressGIS,
  getPropertyDetail,
  extractOwnerMailing,
  primaryOwnerName,
  propertyTypeFromUseDesc,
  maSaleDate,
  buildMagisCriteriaWhere,
  searchByCriteria,
  type MAParcel,
  type MARecord,
  type GISSearchResult,
} from "../../lib/magis";
import { parseAddressForGIS } from "../../lib/mdpa";
import { detectCounty, resolveMassachusettsCity } from "../../lib/county-router";
import { normalizeOwnerName } from "../../lib/owner-contacts";

function okParcels(result: GISSearchResult): MAParcel[] {
  if (result.kind !== "ok") throw new Error(`Expected kind "ok", got "${result.kind}"`);
  return result.parcels;
}

// ─── parseAddressForGIS reuse ─────────────────────────────────────────────────
// Not redefined — imported straight from lib/mdpa, same as lib/bcpa.ts /
// lib/pbcpa.ts. Sanity check that real Boston-area address shapes parse the
// same way as Florida's.

describe("parseAddressForGIS applied to Massachusetts addresses", () => {
  it("parses a non-directional address: 1105 Saratoga St", () => {
    expect(parseAddressForGIS("1105 Saratoga St")).toEqual({
      houseNum: 1105,
      streetKeyword: "SARATOGA",
      directional: null,
      streetType: "ST",
    });
  });

  it("parses a directional address: 316 N Beacon St", () => {
    expect(parseAddressForGIS("316 N Beacon St")).toEqual({
      houseNum: 316,
      streetKeyword: "BEACON",
      directional: "N",
      streetType: "ST",
    });
  });

  it("parses a spelled-out house number: One Westinghouse Plaza (real Hyde Park/Boston address)", () => {
    // Confirmed live: MassGIS stores this parcel numerically ("1
    // WESTINGHOUSE PZ..."), even though the building's real-world address
    // spells out "One" — not a Massachusetts-specific convention (Miami has
    // the same pattern, e.g. "One Biscayne Tower"), so this is handled in
    // the shared parser, not per-state.
    expect(parseAddressForGIS("One Westinghouse Plaza")).toEqual({
      houseNum: 1,
      streetKeyword: "WESTINGHOUSE",
      directional: null,
      streetType: null,
    });
  });

  it("parses an address with no recognized street-type suffix: 1 City Hall Sq", () => {
    // "SQ" isn't in the shared TYPES set, so streetType stays null and the
    // first remaining word ("CITY") becomes the keyword — this is why the
    // live fixture below uses "24 Beacon St" instead: a multi-word street
    // name with no recognized type suffix produces a too-generic keyword
    // ("CITY" alone collides with Boston's unrelated "1 City Point Ct"),
    // a pre-existing limitation of the shared single-keyword
    // parseAddressForGIS extraction, not something specific to Massachusetts.
    expect(parseAddressForGIS("1 City Hall Sq")).toEqual({
      houseNum: 1,
      streetKeyword: "CITY",
      directional: null,
      streetType: null,
    });
  });
});

// ─── searchByAddressGIS — WHERE clause construction ──────────────────────────

describe("searchByAddressGIS (Massachusetts)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type FakeFeature = { LOC_ID: string; MAP_PAR_ID: string; SITE_ADDR: string; CITY: string };

  function stubFetch(features: FakeFeature[] = [], exceededTransferLimit?: boolean) {
    const capturedUrls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrls.push(url);
      return {
        ok: true,
        json: async () => ({ features: features.map((f) => ({ attributes: f })), exceededTransferLimit }),
      } as unknown as Response;
    });
    return capturedUrls;
  }

  function stubFetchSequence(pages: FakeFeature[][], exceededTransferLimits: (boolean | undefined)[] = []) {
    const capturedUrls: string[] = [];
    let call = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrls.push(url);
      const features = pages[call] ?? [];
      const exceededTransferLimit = exceededTransferLimits[call];
      call++;
      return {
        ok: true,
        json: async () => ({ features: features.map((f) => ({ attributes: f })), exceededTransferLimit }),
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

  it("points at the statewide Massachusetts_Property_Tax_Parcels layer, not the FL services", async () => {
    const urls = stubFetch([
      { LOC_ID: "F_790618_2965662", MAP_PAR_ID: "0101268000", SITE_ADDR: "1105 Saratoga ST", CITY: "BOSTON" },
    ]);
    await searchByAddressGIS("1105 Saratoga St", "Boston");
    expect(serviceFrom(urls[0])).toContain("Massachusetts_Property_Tax_Parcels/FeatureServer/0");
  });

  it("1105 Saratoga St, Boston — WHERE embeds CITY filter (load-bearing, unlike FL) and case-insensitive address prefix", async () => {
    const urls = stubFetch([
      { LOC_ID: "F_790618_2965662", MAP_PAR_ID: "0101268000", SITE_ADDR: "1105 Saratoga ST", CITY: "BOSTON" },
    ]);
    await searchByAddressGIS("1105 Saratoga St", "Boston");
    expect(whereFrom(urls[0])).toBe("UPPER(CITY)=UPPER('BOSTON') AND UPPER(SITE_ADDR) LIKE UPPER('1105 SARATOGA%')");
  });

  it("316 N Beacon St, Boston — WHERE embeds house number, directional, and keyword", async () => {
    const urls = stubFetch([
      { LOC_ID: "F_749448_2955370", MAP_PAR_ID: "0", SITE_ADDR: "316 N BEACON ST", CITY: "BOSTON" },
    ]);
    await searchByAddressGIS("316 N Beacon St", "Boston");
    expect(whereFrom(urls[0])).toBe("UPPER(CITY)=UPPER('BOSTON') AND UPPER(SITE_ADDR) LIKE UPPER('316 N BEACON%')");
  });

  it("runs a whole-state (no CITY clause) search when city is omitted", async () => {
    const urls = stubFetch([]);
    await searchByAddressGIS("1105 Saratoga St");
    expect(whereFrom(urls[0])).toBe("UPPER(SITE_ADDR) LIKE UPPER('1105 SARATOGA%')");
  });

  it("maps returned features to MAParcel with folio, strap (both LOC_ID), address, city", async () => {
    stubFetch([
      { LOC_ID: "F_790618_2965662", MAP_PAR_ID: "0101268000", SITE_ADDR: "1105 Saratoga ST", CITY: "BOSTON" },
    ]);
    const parcels = okParcels(await searchByAddressGIS("1105 Saratoga St", "Boston"));
    expect(parcels).toHaveLength(1);
    expect(parcels[0].folio).toBe("F_790618_2965662");
    expect(parcels[0].strap).toBe("F_790618_2965662");
    expect(parcels[0].address).toBe("1105 SARATOGA ST");
    expect(parcels[0].city).toBe("BOSTON");
  });

  it("returns { kind: 'ok', parcels: [] } when no features (genuine miss)", async () => {
    stubFetch([]);
    const result = await searchByAddressGIS("1105 Saratoga St", "Boston");
    expect(result.kind).toBe("ok");
    expect(okParcels(result)).toHaveLength(0);
  });

  it("returns { kind: 'error' } on GIS HTTP error (does not throw)", async () => {
    stubFetchError(null, false, 503);
    const result = await searchByAddressGIS("1105 Saratoga St", "Boston");
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toContain("503");
  });

  it("throws when address has no house number", async () => {
    stubFetch();
    await expect(searchByAddressGIS("Saratoga St", "Boston")).rejects.toThrow();
  });

  it("returns { kind: 'too_many_candidates' } when every page has no keyword match and paging is exhausted", async () => {
    const junk = Array.from({ length: 100 }, (_, i) => ({
      LOC_ID: `F_${i}`,
      MAP_PAR_ID: `${i}`,
      SITE_ADDR: `1105 OAK ST UNIT ${i}`,
      CITY: "BOSTON",
    }));
    // 3 full pages, each still exceeding the transfer limit — MAX_ADDRESS_PAGES caps it.
    stubFetchSequence([junk, junk, junk], [true, true, true]);
    const result = await searchByAddressGIS("1105 Saratoga St", "Boston");
    expect(result.kind).toBe("too_many_candidates");
  });

  it("pages forward via resultOffset when a full page has no match but exceededTransferLimit is true", async () => {
    const junkPage = Array.from({ length: 100 }, (_, i) => ({
      LOC_ID: `F_${i}`,
      MAP_PAR_ID: `${i}`,
      SITE_ADDR: `1105 OAK ST UNIT ${i}`,
      CITY: "BOSTON",
    }));
    const matchPage = [
      { LOC_ID: "F_790618_2965662", MAP_PAR_ID: "0101268000", SITE_ADDR: "1105 Saratoga ST", CITY: "BOSTON" },
    ];
    const urls = stubFetchSequence([junkPage, matchPage], [true, false]);
    const result = await searchByAddressGIS("1105 Saratoga St", "Boston");
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]).searchParams.get("resultOffset")).toBe("0");
    expect(new URL(urls[1]).searchParams.get("resultOffset")).toBe("100");
    expect(okParcels(result)[0].address).toBe("1105 SARATOGA ST");
  });

  it("numbered street with ordinal suffix — retries with the bare number when dropped in the tax roll", async () => {
    const urls = stubFetchSequence([
      [],
      [{ LOC_ID: "F_1", MAP_PAR_ID: "1", SITE_ADDR: "627 4 AVE", CITY: "BOSTON" }],
    ]);
    const result = await searchByAddressGIS("627 4th Ave", "Boston");
    expect(urls).toHaveLength(2);
    expect(whereFrom(urls[0])).toBe("UPPER(CITY)=UPPER('BOSTON') AND UPPER(SITE_ADDR) LIKE UPPER('627 4TH%')");
    expect(whereFrom(urls[1])).toBe("UPPER(CITY)=UPPER('BOSTON') AND UPPER(SITE_ADDR) LIKE UPPER('627 4%')");
    expect(okParcels(result)[0].address).toBe("627 4 AVE");
  });

  it("hyphenated house-number range — retries with the second number when the first finds nothing", async () => {
    const urls = stubFetchSequence([
      [],
      [{ LOC_ID: "F_2", MAP_PAR_ID: "2", SITE_ADDR: "305 Clematis ST", CITY: "BOSTON" }],
    ]);
    const result = await searchByAddressGIS("301-305 Clematis St", "Boston");
    expect(urls).toHaveLength(2);
    expect(whereFrom(urls[0])).toContain("301 CLEMATIS%");
    expect(whereFrom(urls[1])).toContain("305 CLEMATIS%");
    expect(okParcels(result)[0].address).toBe("305 CLEMATIS ST");
  });

  it("does not retry when the first attempt already matches", async () => {
    const urls = stubFetchSequence([
      [{ LOC_ID: "F_790618_2965662", MAP_PAR_ID: "0101268000", SITE_ADDR: "1105 Saratoga ST", CITY: "BOSTON" }],
    ]);
    const result = await searchByAddressGIS("1105 Saratoga St", "Boston");
    expect(urls).toHaveLength(1);
    expect(okParcels(result)[0].address).toBe("1105 SARATOGA ST");
  });
});

// ─── getPropertyDetail ────────────────────────────────────────────────────────

describe("getPropertyDetail (Massachusetts)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queries by LOC_ID exact match", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        json: async () => ({
          features: [{ attributes: { LOC_ID: "F_790618_2965662", OWNER1: "VROOMAN PAUL JOHN JR" } }],
        }),
      } as unknown as Response;
    });
    const rec = await getPropertyDetail("F_790618_2965662");
    expect(new URL(urls[0]).searchParams.get("where")).toBe("LOC_ID='F_790618_2965662'");
    expect(rec?.LOC_ID).toBe("F_790618_2965662");
    expect(rec?.OWNER1).toBe("VROOMAN PAUL JOHN JR");
  });
});

// ─── extractOwnerMailing ──────────────────────────────────────────────────────

describe("extractOwnerMailing (Massachusetts)", () => {
  function record(overrides: Partial<MARecord> = {}): MARecord {
    return {
      LOC_ID: "F_790618_2965662",
      MAP_PAR_ID: "0101268000",
      SITE_ADDR: "1105 Saratoga ST",
      CITY: "BOSTON",
      ZIP: "02128",
      OWNER1: "VROOMAN PAUL JOHN JR",
      OWN_ADDR: "1105 SARATOGA ST",
      OWN_CITY: "EAST BOSTON",
      OWN_STATE: "MA",
      OWN_ZIP: "02128",
      OWN_CO: null,
      LOT_SIZE: 0,
      LOT_UNITS: "Acres",
      LS_DATE: "20210120",
      LS_PRICE: 995000,
      LS_BOOK: "64603",
      LS_PAGE: "100",
      USE_CODE: "105",
      USE_DESC: "Three-Family Residential",
      TOTAL_VAL: 902000,
      LAND_VAL: 269500,
      BLDG_VAL: 632500,
      OTHER_VAL: 0,
      YEAR_BUILT: 1910,
      BLD_AREA: 0,
      RES_AREA: 3210,
      UNITS: null,
      STORIES: "2.0",
      NUM_ROOMS: 14,
      STYLE: "Conventional",
      ...overrides,
    };
  }

  it("builds from discrete OWN_ADDR/OWN_CITY/OWN_STATE/OWN_ZIP fields", () => {
    expect(extractOwnerMailing(record())).toBe("1105 SARATOGA ST, EAST BOSTON, MA 02128");
  });

  it("includes OWN_CO (care-of) when present", () => {
    expect(extractOwnerMailing(record({ OWN_CO: "C/O SMITH TRUST" }))).toBe(
      "1105 SARATOGA ST, C/O SMITH TRUST, EAST BOSTON, MA 02128"
    );
  });

  it("omits the ZIP when absent", () => {
    expect(extractOwnerMailing(record({ OWN_ZIP: null }))).toBe("1105 SARATOGA ST, EAST BOSTON, MA");
  });

  it("returns null when all address fields are null", () => {
    expect(
      extractOwnerMailing(record({ OWN_ADDR: null, OWN_CO: null, OWN_CITY: null, OWN_STATE: null, OWN_ZIP: null }))
    ).toBeNull();
  });

  it("returns null for null input", () => {
    expect(extractOwnerMailing(null)).toBeNull();
  });
});

// ─── primaryOwnerName ─────────────────────────────────────────────────────────

describe("primaryOwnerName (Massachusetts)", () => {
  it("returns OWNER1 trimmed, unchanged", () => {
    expect(primaryOwnerName({ OWNER1: "VROOMAN PAUL JOHN JR" })).toBe("VROOMAN PAUL JOHN JR");
    expect(primaryOwnerName({ OWNER1: "  CITY OF BOSTON  " })).toBe("CITY OF BOSTON");
  });

  it("returns null for a blank or missing OWNER1", () => {
    expect(primaryOwnerName({ OWNER1: null })).toBeNull();
    expect(primaryOwnerName({ OWNER1: "  " })).toBeNull();
    expect(primaryOwnerName(null)).toBeNull();
  });
});

// ─── Critical: owner-portfolio normalization stays consistent across states ──
// A Massachusetts owner name must normalize through the exact same pipeline
// Florida owner names already use — no state-specific transform, or entity
// resolution (lib/entities.ts) and portfolio matching
// (lib/mdpa-owner-search.ts entityOwnerNamesMatch) would silently diverge
// between states and miss real cross-state portfolio matches.

describe("normalizeOwnerName applied to a real MassGIS owner name", () => {
  it("normalizes a MA individual owner the same way an FL owner normalizes (lowercase, periods stripped, whitespace collapsed)", () => {
    const maOwner = primaryOwnerName({ OWNER1: "VROOMAN PAUL JOHN JR" })!;
    expect(normalizeOwnerName(maOwner)).toBe("vrooman paul john jr");
  });

  it("normalizes a MA government/entity owner consistently", () => {
    const maOwner = primaryOwnerName({ OWNER1: "CITY OF BOSTON" })!;
    expect(normalizeOwnerName(maOwner)).toBe("city of boston");
  });

  it("is idempotent and whitespace/period-insensitive, same as it is for an FL owner string", () => {
    // Mirrors the exact behavior normalizeOwnerName already provides for
    // Florida owner strings (e.g. "SMITH, JOHN A." / "SMITH  JOHN  A")
    // — proven here against a MassGIS-shaped name instead.
    expect(normalizeOwnerName("Vrooman  Paul  John  Jr.")).toBe("vrooman paul john jr");
    expect(normalizeOwnerName(normalizeOwnerName("VROOMAN PAUL JOHN JR"))).toBe(normalizeOwnerName("VROOMAN PAUL JOHN JR"));
  });
});

// ─── propertyTypeFromUseDesc ────────────────────────────────────────────────────────────
// Domain confirmed live via a groupByFieldsForStatistics(USE_CODE, USE_DESC)
// query against the whole Massachusetts_Property_Tax_Parcels table;
// representative real values from each bucket below.

describe("propertyTypeFromUseDesc (Massachusetts)", () => {
  it("classifies residential uses", () => {
    expect(propertyTypeFromUseDesc("Single Family Residential")).toBe("residential");
    expect(propertyTypeFromUseDesc("Two-Family Residential")).toBe("residential");
    expect(propertyTypeFromUseDesc("Three-Family Residential")).toBe("residential");
    expect(propertyTypeFromUseDesc("Bungalow")).toBe("residential");
  });

  it("classifies multifamily uses", () => {
    expect(propertyTypeFromUseDesc("Apartments with Four to Eight Units")).toBe("multifamily");
    expect(propertyTypeFromUseDesc("Apartments with More than Eight Units")).toBe("multifamily");
    expect(propertyTypeFromUseDesc("Condo")).toBe("multifamily");
    expect(propertyTypeFromUseDesc("Residential Condominium")).toBe("multifamily");
    expect(propertyTypeFromUseDesc("Affordable Housing Units (Greater than 50% of the units qualify)")).toBe("multifamily");
  });

  it("classifies office uses, including commercial condos, before the generic condo rule", () => {
    expect(propertyTypeFromUseDesc("General Office Buildings")).toBe("office");
    expect(propertyTypeFromUseDesc("Bank Buildings")).toBe("office");
    expect(propertyTypeFromUseDesc("Condo-Office")).toBe("office");
    expect(propertyTypeFromUseDesc("Condo Office")).toBe("office");
  });

  it("classifies retail uses", () => {
    expect(propertyTypeFromUseDesc("Discount Stores, Junior Department Stores, Department Stores")).toBe("retail");
    expect(propertyTypeFromUseDesc("Eating and Drinking Establishments - restaurants, diners, fast food establishments, bars, nightclubs")).toBe("retail");
    expect(propertyTypeFromUseDesc("Automotive Vehicles Sales and Service")).toBe("retail");
    expect(propertyTypeFromUseDesc("Gasoline Service Stations - providing engine repair or maintenance services, and fuel products")).toBe("retail");
    expect(propertyTypeFromUseDesc("Car Wash Facilities")).toBe("retail");
  });

  it("classifies industrial uses, including developable industrial land before the generic land rule", () => {
    expect(propertyTypeFromUseDesc("Buildings for manufacturing operations")).toBe("industrial");
    expect(propertyTypeFromUseDesc("Developable Industrial Land")).toBe("industrial");
  });

  it("classifies land uses", () => {
    expect(propertyTypeFromUseDesc("Developable Residential Land")).toBe("land");
    expect(propertyTypeFromUseDesc("Developable Commercial Land")).toBe("land");
    expect(propertyTypeFromUseDesc("Agricultural/Horticultural Land not included in Chapter 61A")).toBe("land");
    expect(propertyTypeFromUseDesc("All land designated under Chapter 61 (not classified as Open Space)")).toBe("land");
  });

  it("falls back to 'other' for government/charitable/religious/educational uses, rather than guessing", () => {
    expect(propertyTypeFromUseDesc("Church, Mosque, Synagogue, Temple, etc...")).toBe("other");
    expect(propertyTypeFromUseDesc("College or University (Educational Private)")).toBe("other");
    expect(propertyTypeFromUseDesc("Cemeteries (Charitable Org.)")).toBe("other");
    expect(propertyTypeFromUseDesc("Dept. of Conservation and Recreation (DCR), Division of State Parks and Recreation")).toBe("other");
    expect(propertyTypeFromUseDesc(null)).toBe("other");
    expect(propertyTypeFromUseDesc("")).toBe("other");
  });
});

// ─── maSaleDate ───────────────────────────────────────────────────────────────

describe("maSaleDate (Massachusetts)", () => {
  it("converts a real LS_DATE YYYYMMDD string to an ISO date", () => {
    expect(maSaleDate("20210120")).toBe("2021-01-20");
    expect(maSaleDate("20130729")).toBe("2013-07-29");
  });

  it("treats an all-zero placeholder as no recorded sale", () => {
    expect(maSaleDate("00000000")).toBeNull();
  });

  it("returns null for null/undefined/malformed input", () => {
    expect(maSaleDate(null)).toBeNull();
    expect(maSaleDate(undefined)).toBeNull();
    expect(maSaleDate("")).toBeNull();
    expect(maSaleDate("not-a-date")).toBeNull();
  });
});

// ─── detectCounty — Massachusetts routing ────────────────────────────────────

describe("detectCounty — Massachusetts cities/towns", () => {
  it("identifies Boston metro cities/towns across all four covered counties", () => {
    for (const city of [
      "Boston",       // Suffolk
      "Cambridge",    // Middlesex
      "Quincy",       // Norfolk
      "Salem",        // Essex
    ]) {
      expect(detectCounty(city), city).toBe("massachusetts");
    }
  });

  it("is case-insensitive for Massachusetts cities", () => {
    expect(detectCounty("boston")).toBe("massachusetts");
    expect(detectCounty("CAMBRIDGE")).toBe("massachusetts");
  });

  it("still returns null for a genuinely unsupported city", () => {
    expect(detectCounty("Orlando")).toBeNull();
    expect(detectCounty("Springfield")).toBeNull(); // real MA city, but outside the Boston-metro 4-county v1 scope
  });

  it("does not misclassify Florida cities as Massachusetts, or vice versa", () => {
    expect(detectCounty("Miami")).toBe("miami-dade");
    expect(detectCounty("Fort Lauderdale")).toBe("broward");
    expect(detectCounty("West Palm Beach")).toBe("palm-beach");
    expect(detectCounty("Boston")).toBe("massachusetts");
  });
});

// ─── Boston neighborhoods — routed like a city, resolved back to "Boston" ────
// Real-world reported bug: "One Westinghouse Plaza, Hyde Park, MA 02136"
// failed because "Hyde Park" (a Boston neighborhood, not a municipality)
// wasn't recognized at all, AND — even once recognized — MassGIS's own CITY
// field only ever says "BOSTON", never the neighborhood name.

describe("detectCounty / resolveMassachusettsCity — Boston neighborhoods", () => {
  it("routes real Boston neighborhoods to massachusetts, same as the municipality itself", () => {
    for (const neighborhood of ["Hyde Park", "Dorchester", "Roxbury", "East Boston", "Jamaica Plain"]) {
      expect(detectCounty(neighborhood), neighborhood).toBe("massachusetts");
    }
  });

  it("resolves a Boston neighborhood to 'Boston' for the actual MassGIS query filter", () => {
    expect(resolveMassachusettsCity("Hyde Park")).toBe("Boston");
    expect(resolveMassachusettsCity("East Boston")).toBe("Boston");
    expect(resolveMassachusettsCity("DORCHESTER")).toBe("Boston");
  });

  it("leaves a real municipality (not a Boston neighborhood) unchanged", () => {
    expect(resolveMassachusettsCity("Cambridge")).toBe("Cambridge");
    expect(resolveMassachusettsCity("Boston")).toBe("Boston");
  });

  it("passes through undefined unchanged", () => {
    expect(resolveMassachusettsCity(undefined)).toBeUndefined();
  });
});

// ─── Live Massachusetts parcel service ────────────────────────────────────────
// The Massachusetts State House — a government-owned parcel, chosen
// deliberately as a stable long-term fixture (unlike an individually-owned
// residence, its ownership isn't expected to change), with a clean
// single-word street name ("Beacon") so the shared keyword-based address
// matcher resolves it unambiguously (see the parseAddressForGIS note above
// on why "1 City Hall Sq" was NOT used here).

describe("live Massachusetts parcel service", () => {
  it("24 Beacon St, Boston resolves to LOC_ID F_774077_2955940, owned by the Commonwealth of Massachusetts", async () => {
    const result = await searchByAddressGIS("24 Beacon St", "Boston");
    const parcels = okParcels(result);
    expect(parcels.length).toBeGreaterThanOrEqual(1);
    expect(parcels[0].folio).toBe("F_774077_2955940");

    const detail = await getPropertyDetail(parcels[0].folio);
    expect(detail).not.toBeNull();
    expect(detail!.LOC_ID).toBe("F_774077_2955940");
    expect(primaryOwnerName(detail)).toBe("COMMWLTH OF MASS");
  }, 30_000);

  it("1105 Saratoga St, Boston resolves to LOC_ID F_790618_2965662", async () => {
    const result = await searchByAddressGIS("1105 Saratoga St", "Boston");
    const parcels = okParcels(result);
    expect(parcels.length).toBeGreaterThanOrEqual(1);
    expect(parcels[0].folio).toBe("F_790618_2965662");
  }, 30_000);

  // Reproduces the exact reported bug end to end: a spelled-out house number
  // ("One") at a real Hyde Park/Boston address (city passed here as
  // "Boston" — what lib/county-router.ts's resolveMassachusettsCity resolves
  // "Hyde Park" to before calling this function).
  it("One Westinghouse Plaza, Boston (Hyde Park) resolves to LOC_ID F_755909_2914790", async () => {
    const result = await searchByAddressGIS("One Westinghouse Plaza", "Boston");
    const parcels = okParcels(result);
    expect(parcels.length).toBeGreaterThanOrEqual(1);
    // The whole complex's ~199 unit/parking-space rows all share one LOC_ID
    // (confirmed live) — every returned candidate should resolve to it.
    expect(parcels.every((p) => p.folio === "F_755909_2914790")).toBe(true);
  }, 30_000);
});

// ─── buildMagisCriteriaWhere ──────────────────────────────────────────────────

describe("buildMagisCriteriaWhere", () => {
  it("returns 1=1 when no criteria given", () => {
    expect(buildMagisCriteriaWhere({})).toBe("1=1");
  });

  it("builds a building-SF BETWEEN clause on BLD_AREA", () => {
    const where = buildMagisCriteriaWhere({ buildingSqftMin: 5000, buildingSqftMax: 20000 });
    expect(where).toContain("BLD_AREA BETWEEN 5000 AND 20000");
  });

  it("builds a dual-unit land-SF clause covering both Sq. Ft. and Acres rows", () => {
    const where = buildMagisCriteriaWhere({ landSqftMin: 10000, landSqftMax: 87120 });
    expect(where).toContain("LOT_UNITS = 'Sq. Ft.' AND LOT_SIZE BETWEEN 10000 AND 87120");
    expect(where).toContain("LOT_UNITS = 'Acres' AND LOT_SIZE BETWEEN");
    // 10000 sqft / 43560 and 87120 sqft / 43560 = 2 acres exactly
    expect(where).toContain("LOT_SIZE BETWEEN 0.2295684113865932 AND 2");
  });

  it("builds an assessed-value BETWEEN clause on TOTAL_VAL", () => {
    const where = buildMagisCriteriaWhere({ assessedValueMin: 100000, assessedValueMax: 900000 });
    expect(where).toContain("TOTAL_VAL BETWEEN 100000 AND 900000");
  });

  it("builds a year-built BETWEEN clause on YEAR_BUILT", () => {
    const where = buildMagisCriteriaWhere({ yearBuiltMin: 1990, yearBuiltMax: 2010 });
    expect(where).toContain("YEAR_BUILT BETWEEN 1990 AND 2010");
  });

  it("maps industrial property type to a LIKE-OR clause over the same keywords as propertyTypeFromUseDesc", () => {
    const where = buildMagisCriteriaWhere({ propertyType: "industrial" });
    expect(where).toContain("USE_DESC LIKE '%MANUFACTURING%'");
    expect(where).toContain("USE_DESC LIKE '%DEVELOPABLE INDUSTRIAL%'");
  });

  it("uppercases and quotes city/town filters against CITY", () => {
    const where = buildMagisCriteriaWhere({ cities: ["boston"] });
    expect(where).toContain("UPPER(CITY) IN ('BOSTON')");
  });

  describe("sale-date signals", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-15T00:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("builds a soldWithinYears clause as LS_DATE >= N years before today", () => {
      const where = buildMagisCriteriaWhere({ soldWithinYears: 2 });
      expect(where).toContain("LS_DATE >= '20240615'");
    });

    it("builds a heldAtLeastYears clause as LS_DATE <= N years before today", () => {
      const where = buildMagisCriteriaWhere({ heldAtLeastYears: 10 });
      expect(where).toContain("LS_DATE <= '20160615'");
    });
  });
});

// ─── searchByCriteria (Massachusetts) ─────────────────────────────────────────

describe("searchByCriteria (Massachusetts)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses a property-type-only search without ever calling fetch (confirmed live: this service 400s on a lone USE_DESC LIKE predicate)", async () => {
    let fetchCalls = 0;
    vi.stubGlobal("fetch", async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => ({ count: 0 }) } as unknown as Response;
    });
    const result = await searchByCriteria({ propertyType: "industrial" }, 200);
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toContain("requires at least one more filter");
    expect(fetchCalls).toBe(0);
  });

  it("proceeds to a real query when property type is paired with any other filter", async () => {
    let fetchCalls = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      fetchCalls += 1;
      const params = new URL(url).searchParams;
      if (params.get("returnCountOnly") === "true") {
        return { ok: true, json: async () => ({ count: 42 }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ features: [] }) } as unknown as Response;
    });
    const result = await searchByCriteria({ propertyType: "industrial", buildingSqftMin: 5000 }, 200);
    expect(result).toEqual({ kind: "ok", matches: [], totalCount: 42 });
    expect(fetchCalls).toBe(2);
  });

  it("surfaces ArcGIS's details array when the error message itself is empty", async () => {
    vi.stubGlobal("fetch", async () =>
      ({ ok: true, json: async () => ({ error: { message: "", details: ["Unable to perform query. Please check your parameters."] } }) }) as unknown as Response,
    );
    const result = await searchByCriteria({ propertyType: "industrial", cities: ["Boston"] }, 200);
    expect(result).toEqual({ kind: "error", message: "Unable to perform query. Please check your parameters." });
  });

  it("returns too_many with the real count when it exceeds maxResults, without fetching records", async () => {
    let fetchCalls = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      fetchCalls += 1;
      expect(new URL(url).searchParams.get("returnCountOnly")).toBe("true");
      return { ok: true, json: async () => ({ count: 270720 }) } as unknown as Response;
    });
    const result = await searchByCriteria({ buildingSqftMin: 5000, buildingSqftMax: 20000 }, 200);
    expect(result).toEqual({ kind: "too_many", count: 270720 });
    expect(fetchCalls).toBe(1);
  });

  it("returns ok with zero matches when count is zero", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ count: 0 }) }) as unknown as Response);
    const result = await searchByCriteria({ buildingSqftMin: 999_999_999 }, 200);
    expect(result).toEqual({ kind: "ok", matches: [], totalCount: 0 });
  });

  it("paginates across a full first page (page size 1000) into a second page", async () => {
    const PAGE_SIZE = 1000;
    const totalCount = PAGE_SIZE + 1;
    vi.stubGlobal("fetch", async (url: string) => {
      const params = new URL(url).searchParams;
      if (params.get("returnCountOnly") === "true") {
        return { ok: true, json: async () => ({ count: totalCount }) } as unknown as Response;
      }
      const offset = Number(params.get("resultOffset"));
      if (offset === 0) {
        const features = Array.from({ length: PAGE_SIZE }, (_, i) => ({
          attributes: { LOC_ID: `F_${i}`, SITE_ADDR: `${i} TEST ST` },
        }));
        return { ok: true, json: async () => ({ features }) } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({ features: [{ attributes: { LOC_ID: "F_LAST", SITE_ADDR: "LAST ST" } }] }),
      } as unknown as Response;
    });
    const result = await searchByCriteria({}, 1500);
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.totalCount).toBe(totalCount);
    expect(result.matches).toHaveLength(totalCount);
    expect(result.matches[PAGE_SIZE].folio).toBe("F_LAST");
    expect(result.matches[0].strap).toBe("F_0"); // LOC_ID doubles as strap for MA
  });

  it("skips a feature with a blank/missing LOC_ID", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const params = new URL(url).searchParams;
      if (params.get("returnCountOnly") === "true") {
        return { ok: true, json: async () => ({ count: 1 }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ features: [{ attributes: { LOC_ID: "" } }] }) } as unknown as Response;
    });
    const result = await searchByCriteria({}, 200);
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.matches).toEqual([]);
  });
});
