import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@/lib/custom-fields";
import type { ExtractedProperty } from "@/lib/property-pipeline";
import {
  addressMatchesPage,
  buildListingCandidates,
  excerptForValue,
  isJunkListingUrl,
  listingDetailRank,
  listingHostBlocksReader,
  listingSearchHitText,
  listingSearchQuery,
  listingUrlLooksLikeAddress,
  expandAddressForSearch,
  parseBraveHits,
  parseBraveUrls,
  parseDdgHtmlUrls,
  parseSerperUrls,
  planListingApplyWrites,
  uniqueHttpUrls,
  type ListingDiscoverCandidate,
} from "@/lib/listing-discover";

function def(name: string, overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: name,
    owner_id: "o1",
    entity_type: "property",
    field_name: name,
    field_type: "number",
    select_options: null,
    fill_mode: "extract",
    field_group: "industrial",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function extracted(overrides: Partial<ExtractedProperty> = {}): ExtractedProperty {
  return {
    address: "7900 NW 27th Avenue",
    city: "Miami",
    submarket: null,
    owner_name: null,
    ownership_type: "unknown",
    size_sqft: null,
    property_type: "industrial",
    last_sale_date: null,
    last_sale_price: null,
    building_composition: {},
    confidence_flags: [],
    custom_fields: {},
    ...overrides,
  };
}

describe("listingSearchQuery", () => {
  it("expands numbered streets and does not exact-quote the tax-roll address", () => {
    expect(expandAddressForSearch("601 NW 11 ST")).toBe("601 NW 11th Street");
    expect(expandAddressForSearch("3880 W 104TH ST")).toBe("3880 W 104TH Street");
    const q = listingSearchQuery("601 NW 11 ST", "Miami");
    expect(q).toContain("601 NW 11th Street");
    expect(q).toContain("Miami");
    expect(q).not.toContain('"601 NW 11 ST"');
    expect(q).toContain("LoopNet");
  });
});

describe("isJunkListingUrl / uniqueHttpUrls", () => {
  it("skips Jina on LoopNet and Crexi", () => {
    expect(listingHostBlocksReader("https://www.loopnet.com/Listing/1")).toBe(true);
    expect(listingHostBlocksReader("https://www.crexi.com/properties/1")).toBe(true);
    expect(listingHostBlocksReader("https://warehousespaces.com/x")).toBe(false);
  });

  it("drops social, tax-roll, and residential portals", () => {
    expect(isJunkListingUrl("https://www.facebook.com/foo")).toBe(true);
    expect(isJunkListingUrl("https://www.miamidade.gov/pa/foo")).toBe(true);
    expect(isJunkListingUrl("https://www.zillow.com/homedetails/x")).toBe(true);
    expect(isJunkListingUrl("https://www.crexi.com/properties/123")).toBe(false);
  });

  it("dedupes and keeps http(s) listing URLs", () => {
    expect(
      uniqueHttpUrls([
        "https://www.crexi.com/a",
        "https://www.crexi.com/a",
        "ftp://x",
        "https://wikipedia.org/wiki/Warehouse",
      ]),
    ).toEqual(["https://www.crexi.com/a"]);
  });
});

describe("search snippet fallback", () => {
  const snippet = [
    "3880 W 104th Street, Suite 4, Hialeah, FL",
    "Featuring a 32’ clear height, and heavy power capacity at 480V/250 AMPS.",
    "The property includes two dock-high doors, one ramp, and an ESFR sprinkler system.",
  ].join("\n");

  it("address-matches a Brave snippet when Jina cannot fetch LoopNet", () => {
    expect(addressMatchesPage("3880 W 104TH ST", "Miami", snippet)).toBe(true);
  });

  it("can cite docks and clear height from the snippet text", () => {
    const excerptH = excerptForValue(snippet, 32);
    const excerptD = excerptForValue(snippet, 2);
    expect(excerptH?.toLowerCase()).toContain("clear");
    expect(excerptD).toBeTruthy();
  });
});

describe("addressMatchesPage", () => {
  const page = "Industrial warehouse at 7900 NW 27th Avenue, Miami. 32' clear height, 8 dock doors.";

  it("matches street number plus a street-name token", () => {
    expect(addressMatchesPage("7900 NW 27th Ave", "Miami", page)).toBe(true);
  });

  it("treats 104TH and 104th as the same street token", () => {
    expect(addressMatchesPage("3880 W 104TH ST", "Miami", "3880 W 104th Street, Hialeah")).toBe(true);
  });

  it("fails closed when the street number is missing", () => {
    expect(addressMatchesPage("7900 NW 27th Ave", "Miami", "Warehouse on 27th Avenue with docks")).toBe(false);
  });

  it("fails closed when the street token is missing", () => {
    expect(addressMatchesPage("7900 NW 27th Ave", "Miami", "7900 Biscayne Boulevard industrial")).toBe(false);
  });

  it("treats 11 ST and 11th Street as the same numbered street", () => {
    expect(addressMatchesPage("601 NW 11 ST", "Miami", "601 NW 11th Street, Miami warehouse")).toBe(true);
  });

  it("does not treat 1601 as a match for house number 601", () => {
    expect(addressMatchesPage("601 NW 11 ST", "Miami", "1601 NW 11th Street industrial")).toBe(false);
  });
});

describe("listingUrlLooksLikeAddress", () => {
  it("accepts a LoopNet detail slug that carries the address", () => {
    expect(
      listingUrlLooksLikeAddress(
        "https://www.loopnet.com/Listing/601-NW-11th-St-Miami-FL/12345/",
        "601 NW 11 ST",
      ),
    ).toBe(true);
  });

  it("rejects a different house number in the slug", () => {
    expect(
      listingUrlLooksLikeAddress(
        "https://www.loopnet.com/Listing/1601-NW-11th-St-Miami-FL/12345/",
        "601 NW 11 ST",
      ),
    ).toBe(false);
  });

  it("rejects search/index listing URLs", () => {
    expect(
      listingUrlLooksLikeAddress(
        "https://www.crexi.com/properties/FL/Miami/Warehouses",
        "601 NW 11 ST",
      ),
    ).toBe(false);
  });
});

describe("excerptForValue", () => {
  const page = "This building offers 32' clear height and 8 dock-high doors.";

  it("returns a window around the stated value", () => {
    const excerpt = excerptForValue(page, 32);
    expect(excerpt).toBeTruthy();
    expect(excerpt!.toLowerCase()).toContain("32");
    expect(excerpt!.toLowerCase()).toContain("clear");
  });

  it("rejects a value the page never states", () => {
    expect(excerptForValue(page, 4000)).toBeNull();
  });

  it("does not treat 2 as a match inside 32", () => {
    expect(excerptForValue("32' clear height and two dock-high doors.", 2)?.toLowerCase()).toContain("dock");
    expect(excerptForValue("32' clear height only.", 2)).toBeNull();
  });
});

describe("search result parsers", () => {
  it("reads Brave web.results urls", () => {
    expect(
      parseBraveUrls({
        web: { results: [{ url: "https://www.crexi.com/p/1" }, { url: "https://www.facebook.com/x" }] },
      }),
    ).toEqual(["https://www.crexi.com/p/1"]);
  });

  it("reads Serper organic links", () => {
    expect(
      parseSerperUrls({ organic: [{ link: "https://www.loopnet.com/Listing/1" }] }),
    ).toEqual(["https://www.loopnet.com/Listing/1"]);
  });

  it("reads DuckDuckGo uddg redirects", () => {
    const html = `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://www.crexi.com/p/2")}">x</a>`;
    expect(parseDdgHtmlUrls(html)).toEqual(["https://www.crexi.com/p/2"]);
  });

  it("keeps Brave extra snippets and prefers listing detail pages with specs", () => {
    const hits = parseBraveHits({
      web: {
        results: [
          {
            url: "https://www.crexi.com/properties/FL/Miami/Warehouses",
            title: "Warehouses",
            description: "Browse warehouses",
          },
          {
            url: "https://www.loopnet.com/Listing/3880-W-104th-St-Hialeah-FL/1",
            title: "3880 W 104th St",
            description: "Available for lease",
            extra_snippets: ["32' clear height and two dock-high doors."],
          },
        ],
      },
    });
    expect(hits[0]?.url).toContain("/Listing/");
    expect(listingSearchHitText(hits[0]!)).toContain("32'");
    expect(listingDetailRank(hits[0]!.url)).toBeLessThan(listingDetailRank(hits[1]!.url));
  });
});

describe("buildListingCandidates", () => {
  const defs = [def("Dock doors"), def("Clear height")];
  const page = "8 dock doors and 32 ft clear height at this warehouse.";

  it("emits fill-only cited specs and skips locked or filled fields", () => {
    const candidates = buildListingCandidates(
      extracted({ dock_doors: 8, clear_height_ft: 32 }),
      defs,
      { dock_doors: 6 },
      { clear_height_ft: null },
      { dock_doors: "manual" },
      page,
      "https://www.crexi.com/p/1",
    );
    expect(candidates.map((c) => c.field)).toEqual(["custom_fields.clear_height"]);
    expect(candidates[0]?.value).toBe(32);
    expect(candidates[0]?.citation.url).toBe("https://www.crexi.com/p/1");
    expect(candidates[0]?.citation.excerpt.toLowerCase()).toContain("32");
  });

  it("rejects a field with no excerpt even when extract returned a value", () => {
    const candidates = buildListingCandidates(
      extracted({ dock_doors: 99 }),
      [def("Dock doors")],
      {},
      {},
      {},
      page,
      "https://www.crexi.com/p/1",
    );
    expect(candidates).toEqual([]);
  });

  it("skips manual-only custom fields", () => {
    const candidates = buildListingCandidates(
      extracted({ custom_fields: { notes: "Great building" } }),
      [def("Notes", { fill_mode: "manual", field_type: "text", field_group: "custom" })],
      {},
      {},
      {},
      "Great building on this page",
      "https://www.crexi.com/p/1",
    );
    expect(candidates).toEqual([]);
  });
});

function cand(overrides: Partial<ListingDiscoverCandidate> = {}): ListingDiscoverCandidate {
  return {
    field: "custom_fields.dock_doors",
    column: "dock_doors",
    label: "Dock doors",
    value: 8,
    citation: { url: "https://www.crexi.com/p/1", excerpt: "8 dock doors", field: "custom_fields.dock_doors" },
    ...overrides,
  };
}

describe("planListingApplyWrites", () => {
  it("fills an empty unlocked spec and tags web", () => {
    const out = planListingApplyWrites([cand()], ["custom_fields.dock_doors"], {}, {}, {});
    expect(out.fieldsApplied).toBe(1);
    expect(out.custom.dock_doors).toBe(8);
    expect(out.columns.dock_doors).toBe(8);
    expect(out.nextSources.dock_doors).toBe("web");
    expect(out.nextSources["custom_fields.dock_doors"]).toBe("web");
  });

  it("never overwrites a locked or already-filled spec", () => {
    const locked = planListingApplyWrites(
      [cand()],
      ["custom_fields.dock_doors"],
      {},
      {},
      { dock_doors: "county" },
    );
    expect(locked.fieldsApplied).toBe(0);

    const filled = planListingApplyWrites(
      [cand()],
      ["custom_fields.dock_doors"],
      { dock_doors: 4 },
      {},
      {},
    );
    expect(filled.fieldsApplied).toBe(0);
    expect(filled.custom.dock_doors).toBe(4);
  });

  it("ignores a spoofed column that would overwrite owner_name", () => {
    const out = planListingApplyWrites(
      [cand({ column: "owner_name", value: "Hacked LLC" })],
      ["custom_fields.dock_doors"],
      {},
      { owner_name: "Tax Roll LLC" },
      { owner_name: "county" },
    );
    expect(out.columns.owner_name).toBeUndefined();
    expect(out.columns.dock_doors).toBe("Hacked LLC");
  });

  it("rejects a field that is not custom_fields.*", () => {
    const out = planListingApplyWrites(
      [cand({ field: "owner_name", column: "owner_name", value: "Hacked LLC" })],
      ["owner_name"],
      {},
      {},
      {},
    );
    expect(out.fieldsApplied).toBe(0);
    expect(out.columns.owner_name).toBeUndefined();
  });

  it("requires a citation excerpt and url", () => {
    const out = planListingApplyWrites(
      [cand({ citation: { url: "", excerpt: "", field: "custom_fields.dock_doors" } })],
      ["custom_fields.dock_doors"],
      {},
      {},
      {},
    );
    expect(out.fieldsApplied).toBe(0);
  });
});
