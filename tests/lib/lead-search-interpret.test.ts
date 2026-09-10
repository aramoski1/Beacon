import { describe, expect, it } from "vitest";
import {
  refineLeadCriteria,
  resolveCity,
  sanitizeLeadCriteria,
} from "@/lib/lead-search-interpret";
import { SUPPORTED_MARKETS, type LeadSearchCriteria } from "@/lib/lead-finder";

function base(overrides: Partial<LeadSearchCriteria> = {}): LeadSearchCriteria {
  return {
    markets: [...SUPPORTED_MARKETS],
    ...overrides,
  };
}

describe("resolveCity", () => {
  it("maps Hialeah to Miami-Dade", () => {
    expect(resolveCity("hialeah")).toEqual({ canonical: "Hialeah", market: "miami-dade" });
  });

  it("maps Ft Lauderdale to Fort Lauderdale / Broward", () => {
    expect(resolveCity("Ft Lauderdale")).toEqual({ canonical: "Fort Lauderdale", market: "broward" });
  });

  it("maps WPB to West Palm Beach", () => {
    expect(resolveCity("wpb")).toEqual({ canonical: "West Palm Beach", market: "palm-beach" });
  });
});

describe("refineLeadCriteria", () => {
  it("scopes Hialeah industrial + size to Miami-Dade only", () => {
    const out = refineLeadCriteria(
      base({
        propertyType: "industrial",
        cities: ["Hialeah"],
        buildingSqftMin: 20000,
        buildingSqftMax: 50000,
      }),
      "20-50k industrial in Hialeah",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.criteria.markets).toEqual(["miami-dade"]);
    expect(out.criteria.cities).toEqual(["Hialeah"]);
    expect(out.criteria.buildingSqftMin).toBe(20000);
  });

  it("canonicalizes Ft Lauderdale and sets Broward", () => {
    const out = refineLeadCriteria(
      base({ cities: ["Ft Lauderdale"], propertyType: "industrial", buildingSqftMin: 10000 }),
      "industrial in Ft Lauderdale over 10k",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.criteria.cities).toEqual(["Fort Lauderdale"]);
    expect(out.criteria.markets).toEqual(["broward"]);
  });

  it("drops Palm Beach when year-built is set and PB was not named", () => {
    const out = refineLeadCriteria(
      base({ yearBuiltMin: 2000, propertyType: "industrial" }),
      "industrial built after 2000",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.criteria.markets).not.toContain("palm-beach");
    expect(out.ignored.some((i) => i.term === "Palm Beach")).toBe(true);
  });

  it("keeps Palm Beach when the query names it even with year built", () => {
    const out = refineLeadCriteria(
      base({ markets: ["palm-beach"], yearBuiltMin: 2000, cities: ["Boca Raton"] }),
      "industrial in Boca Raton Palm Beach built after 2000",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.criteria.markets).toEqual(["palm-beach"]);
  });

  it("refuses a type-only search across multiple markets", () => {
    const out = refineLeadCriteria(
      base({ propertyType: "industrial" }),
      "industrial warehouses",
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/too broad/i);
  });

  it("ignores docks instead of inventing a GIS filter", () => {
    const out = refineLeadCriteria(
      base({ cities: ["Doral"], propertyType: "industrial" }),
      "docks in Doral",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.ignored.some((i) => i.term === "docks")).toBe(true);
    expect(out.criteria.markets).toEqual(["miami-dade"]);
  });

  it("drops Massachusetts on type-only with no city", () => {
    const out = refineLeadCriteria(
      { markets: ["massachusetts"], propertyType: "industrial" },
      "industrial in Massachusetts",
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/No market left/i);
  });

  it("keeps Massachusetts when Boston is the city", () => {
    const out = refineLeadCriteria(
      base({ cities: ["Boston"], propertyType: "industrial" }),
      "industrial in Boston",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.criteria.markets).toEqual(["massachusetts"]);
    expect(out.criteria.cities).toEqual(["Boston"]);
  });

  it("swaps inverted min/max", () => {
    const out = refineLeadCriteria(
      base({ cities: ["Hialeah"], buildingSqftMin: 50000, buildingSqftMax: 20000 }),
      "industrial in Hialeah 20-50k",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.criteria.buildingSqftMin).toBe(20000);
    expect(out.criteria.buildingSqftMax).toBe(50000);
  });

  it("keeps held-at-least when the sentence says held", () => {
    const out = refineLeadCriteria(
      base({
        cities: ["Hialeah"],
        soldWithinYears: 2,
        heldAtLeastYears: 10,
      }),
      "industrial in Hialeah held 10+ years",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.criteria.heldAtLeastYears).toBe(10);
    expect(out.criteria.soldWithinYears).toBeUndefined();
  });
});

describe("sanitizeLeadCriteria", () => {
  it("drops unknown markets and invalid property types", () => {
    const out = sanitizeLeadCriteria({
      markets: ["miami-dade", "mars"],
      propertyType: "warehouse",
      cities: ["Hialeah"],
    });
    expect(out?.markets).toEqual(["miami-dade"]);
    expect(out?.propertyType).toBeUndefined();
  });
});
