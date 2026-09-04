import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@/lib/custom-fields";
import type { ExtractedProperty } from "@/lib/property-pipeline";
import {
  addressMatchesPage,
  buildListingCandidates,
  excerptForValue,
  isJunkListingUrl,
  listingSearchQuery,
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
  it("quotes address and city with industrial terms", () => {
    expect(listingSearchQuery("7900 NW 27th Ave", "Miami")).toContain('"7900 NW 27th Ave"');
    expect(listingSearchQuery("7900 NW 27th Ave", "Miami")).toContain('"Miami"');
    expect(listingSearchQuery("7900 NW 27th Ave", "Miami")).toContain("clear height");
  });
});

describe("isJunkListingUrl / uniqueHttpUrls", () => {
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

describe("addressMatchesPage", () => {
  const page = "Industrial warehouse at 7900 NW 27th Avenue, Miami. 32' clear height, 8 dock doors.";

  it("matches street number plus a street-name token", () => {
    expect(addressMatchesPage("7900 NW 27th Ave", "Miami", page)).toBe(true);
  });

  it("fails closed when the street number is missing", () => {
    expect(addressMatchesPage("7900 NW 27th Ave", "Miami", "Warehouse on 27th Avenue with docks")).toBe(false);
  });

  it("fails closed when the street token is missing", () => {
    expect(addressMatchesPage("7900 NW 27th Ave", "Miami", "7900 Biscayne Boulevard industrial")).toBe(false);
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
