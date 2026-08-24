import { describe, it, expect, vi, afterEach } from "vitest";
import {
  searchParcelsByOwnerName,
  searchParcelsByOwnerQueries,
  folioStrapKey,
} from "../../lib/magis-owner-search";

describe("magis-owner-search — searchParcelsByOwnerName (mocked)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type FakeOwnerFeature = {
    LOC_ID: string;
    SITE_ADDR?: string;
    CITY?: string;
    OWNER1: string;
    BLD_AREA?: number | null;
    RES_AREA?: number | null;
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

  it("builds an entity WHERE clause against OWNER1 using the top 2 significant tokens", async () => {
    const urls = stubOwnerFetch([[]]);
    await searchParcelsByOwnerName("Acme Holdings LLC", "entity");
    expect(whereFrom(urls[0])).toBe("(UPPER(OWNER1) LIKE '%HOLDINGS%' AND UPPER(OWNER1) LIKE '%ACME%')");
  });

  it("builds a person WHERE clause against OWNER1 ANDing every name part", async () => {
    const urls = stubOwnerFetch([[]]);
    await searchParcelsByOwnerName("John Smith", "person");
    expect(whereFrom(urls[0])).toBe("(UPPER(OWNER1) LIKE UPPER('%John%') AND UPPER(OWNER1) LIKE UPPER('%Smith%'))");
  });

  it("maps matching features to MagisOwnerParcelHit with folio === strap (LOC_ID)", async () => {
    stubOwnerFetch([
      [{ LOC_ID: "F_1", SITE_ADDR: "1 Main St", CITY: "BOSTON", OWNER1: "MODENA CAPITAL INVESTMENTS LLC", BLD_AREA: 5000 }],
    ]);
    const hits = await searchParcelsByOwnerName("Modena Capital Investments LLC", "entity");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({
      folio: "F_1",
      strap: "F_1",
      ownerName: "MODENA CAPITAL INVESTMENTS LLC",
      address: "1 Main St",
      city: "BOSTON",
      buildingSqft: 5000,
    });
  });

  it("dedupes by LOC_ID when the same parcel appears under many unit rows (condo/parking-space wrinkle)", async () => {
    stubOwnerFetch([
      [
        { LOC_ID: "F_1", SITE_ADDR: "1 Westinghouse Plaza PS-1", CITY: "BOSTON", OWNER1: "ACME HOLDINGS LLC" },
        { LOC_ID: "F_1", SITE_ADDR: "1 Westinghouse Plaza PS-2", CITY: "BOSTON", OWNER1: "ACME HOLDINGS LLC" },
        { LOC_ID: "F_1", SITE_ADDR: "1 Westinghouse Plaza PS-3", CITY: "BOSTON", OWNER1: "ACME HOLDINGS LLC" },
      ],
    ]);
    const hits = await searchParcelsByOwnerName("Acme Holdings LLC", "entity");
    expect(hits).toHaveLength(1);
  });

  it("filters out rows whose OWNER1 does not actually match the entity query (LIKE false positives)", async () => {
    stubOwnerFetch([
      [
        { LOC_ID: "F_1", OWNER1: "ACME HOLDINGS LLC" },
        { LOC_ID: "F_2", OWNER1: "BETA ACME PARTNERS LLC" },
      ],
    ]);
    const hits = await searchParcelsByOwnerName("Acme Holdings LLC", "entity");
    expect(hits.map((h) => h.ownerName)).toEqual(["ACME HOLDINGS LLC"]);
  });

  it("filters person search to owners containing every name part", async () => {
    stubOwnerFetch([
      [
        { LOC_ID: "F_1", OWNER1: "SMITH JOHN" },
        { LOC_ID: "F_2", OWNER1: "SMITH JANE" },
      ],
    ]);
    const hits = await searchParcelsByOwnerName("John Smith", "person");
    expect(hits.map((h) => h.ownerName)).toEqual(["SMITH JOHN"]);
  });

  it("throws when the owner name is too short to search", async () => {
    stubOwnerFetch([[]]);
    await expect(searchParcelsByOwnerName("A", "entity")).rejects.toThrow();
  });

  it("skips rows with a blank OWNER1", async () => {
    stubOwnerFetch([[{ LOC_ID: "F_1", OWNER1: "" }]]);
    const hits = await searchParcelsByOwnerName("Acme Holdings LLC", "entity");
    expect(hits).toHaveLength(0);
  });
});

describe("magis-owner-search — searchParcelsByOwnerQueries (mocked)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("merges hits from multiple queries by folio and dedupes repeated queries", async () => {
    let call = 0;
    vi.stubGlobal("fetch", async () => {
      call++;
      const features =
        call === 1
          ? [{ LOC_ID: "F_1", OWNER1: "ACME HOLDINGS LLC", SITE_ADDR: "A ST" }]
          : [{ LOC_ID: "F_2", OWNER1: "JOHN SMITH", SITE_ADDR: "B ST" }];
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

    expect(hits.map((h) => h.folio).sort()).toEqual(["F_1", "F_2"]);
    // Only 2 fetch calls: the duplicate normalized query was skipped before any fetch.
    expect(call).toBe(2);
  });
});

describe("folioStrapKey", () => {
  it("is the identity function — LOC_ID has no raw/display split", () => {
    expect(folioStrapKey("F_790618_2965662")).toBe("F_790618_2965662");
    expect(folioStrapKey("  F_790618_2965662  ")).toBe("F_790618_2965662");
  });
});

// ─── Live Massachusetts owner search ──────────────────────────────────────────

describe("live Massachusetts tax roll owner search", () => {
  it("CITY OF BOSTON resolves to multiple real Boston-owned parcels", async () => {
    const hits = await searchParcelsByOwnerName("City of Boston", "entity");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    // Real live variants confirmed: "CITY OF BOSTON" and "CITY OF BOSTON BY
    // FCL" (foreclosure) both legitimately match via entityOwnerNamesMatch's
    // substring-core rule; "BOSTON CITY OF" (word order reversed) does NOT
    // match and is correctly excluded — this loose "every hit mentions
    // Boston, and the exact form is present" check tolerates that real
    // variance without re-asserting entityOwnerNamesMatch's own rules here.
    expect(hits.every((h) => h.ownerName.includes("BOSTON"))).toBe(true);
    expect(hits.some((h) => h.ownerName === "CITY OF BOSTON")).toBe(true);
    // City of Boston owns thousands of parcels statewide-scanned (no CITY
    // filter on an owner-name search) — allow enough time for the paginated
    // scan (up to MAX_PARCELS=3000 across multiple 1000-record pages).
  }, 90_000);
});
