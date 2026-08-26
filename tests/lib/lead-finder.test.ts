import { describe, it, expect, vi, beforeEach } from "vitest";

const mdpaSearch = vi.fn();
const bcpaSearch = vi.fn();
const pbcpaSearch = vi.fn();
const magisSearch = vi.fn();
const mdpaOwnerSearch = vi.fn();
const bcpaOwnerSearch = vi.fn();
const pbcpaOwnerSearch = vi.fn();
const magisOwnerSearch = vi.fn();

vi.mock("../../lib/mdpa", () => ({ searchByCriteria: (...args: unknown[]) => mdpaSearch(...args) }));
vi.mock("../../lib/bcpa", () => ({
  searchByCriteria: (...args: unknown[]) => bcpaSearch(...args),
  searchParcelsByOwnerName: (...args: unknown[]) => bcpaOwnerSearch(...args),
}));
vi.mock("../../lib/pbcpa", () => ({
  searchByCriteria: (...args: unknown[]) => pbcpaSearch(...args),
  searchParcelsByOwnerName: (...args: unknown[]) => pbcpaOwnerSearch(...args),
}));
vi.mock("../../lib/magis", () => ({ searchByCriteria: (...args: unknown[]) => magisSearch(...args) }));
vi.mock("../../lib/mdpa-owner-search", () => ({
  searchParcelsByOwnerName: (...args: unknown[]) => mdpaOwnerSearch(...args),
  mdpaSearchModeForName: (name: string) => (/\b(LLC|INC|CORP|LP)\b/i.test(name) ? "entity" : "person"),
}));
vi.mock("../../lib/magis-owner-search", () => ({
  searchParcelsByOwnerName: (...args: unknown[]) => magisOwnerSearch(...args),
}));

import { searchLeads, SUPPORTED_MARKETS, type LeadSearchCriteria } from "../../lib/lead-finder";

function okMatch(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    folio: "F1",
    strap: "F1",
    address: "1 TEST ST",
    city: "TESTVILLE",
    ownerName: "TEST OWNER",
    buildingSqft: 10000,
    landSqft: 20000,
    useCode: "048",
    useDescription: "WAREHOUSE",
    assessedValue: 500000,
    yearBuilt: 1990,
    ...overrides,
  };
}

describe("searchLeads", () => {
  beforeEach(() => {
    mdpaSearch.mockReset();
    bcpaSearch.mockReset();
    pbcpaSearch.mockReset();
    magisSearch.mockReset();
    mdpaOwnerSearch.mockReset();
    bcpaOwnerSearch.mockReset();
    pbcpaOwnerSearch.mockReset();
    magisOwnerSearch.mockReset();
  });

  it("defaults to all four markets when none are specified", async () => {
    mdpaSearch.mockResolvedValue({ kind: "ok", matches: [], totalCount: 0 });
    bcpaSearch.mockResolvedValue({ kind: "ok", matches: [], totalCount: 0 });
    pbcpaSearch.mockResolvedValue({ kind: "ok", matches: [], totalCount: 0 });
    magisSearch.mockResolvedValue({ kind: "ok", matches: [], totalCount: 0 });

    const result = await searchLeads({ markets: [] });
    expect(result.outcomes.map((o) => o.market).sort()).toEqual([...SUPPORTED_MARKETS].sort());
    expect(mdpaSearch).toHaveBeenCalledTimes(1);
    expect(bcpaSearch).toHaveBeenCalledTimes(1);
    expect(pbcpaSearch).toHaveBeenCalledTimes(1);
    expect(magisSearch).toHaveBeenCalledTimes(1);
  });

  it("only queries the explicitly selected markets", async () => {
    mdpaSearch.mockResolvedValue({ kind: "ok", matches: [], totalCount: 0 });
    bcpaSearch.mockResolvedValue({ kind: "ok", matches: [], totalCount: 0 });

    const result = await searchLeads({ markets: ["miami-dade", "broward"] });
    expect(result.outcomes.map((o) => o.market).sort()).toEqual(["broward", "miami-dade"]);
    expect(pbcpaSearch).not.toHaveBeenCalled();
    expect(magisSearch).not.toHaveBeenCalled();
  });

  it("flattens ok matches from multiple markets and tags each with its market and source", async () => {
    mdpaSearch.mockResolvedValue({ kind: "ok", matches: [okMatch({ folio: "MD1" })], totalCount: 1 });
    bcpaSearch.mockResolvedValue({ kind: "ok", matches: [okMatch({ folio: "BC1" })], totalCount: 1 });

    const result = await searchLeads({ markets: ["miami-dade", "broward"] });
    expect(result.matches).toHaveLength(2);
    const md = result.matches.find((m) => m.folio === "MD1");
    const bc = result.matches.find((m) => m.folio === "BC1");
    expect(md?.market).toBe("miami-dade");
    expect(md?.source).toContain("Miami-Dade");
    expect(bc?.market).toBe("broward");
    expect(bc?.source).toContain("Broward");
  });

  it("propagates a per-market too_many outcome without discarding other markets' ok results", async () => {
    mdpaSearch.mockResolvedValue({ kind: "too_many", count: 5000 });
    bcpaSearch.mockResolvedValue({ kind: "ok", matches: [okMatch({ folio: "BC1" })], totalCount: 1 });

    const result = await searchLeads({ markets: ["miami-dade", "broward"] });
    const mdOutcome = result.outcomes.find((o) => o.market === "miami-dade");
    expect(mdOutcome).toEqual({ market: "miami-dade", kind: "too_many", count: 5000 });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].folio).toBe("BC1");
  });

  it("propagates a per-market error outcome as an error, not a thrown exception", async () => {
    mdpaSearch.mockRejectedValue(new Error("network down"));
    bcpaSearch.mockResolvedValue({ kind: "ok", matches: [], totalCount: 0 });

    const result = await searchLeads({ markets: ["miami-dade", "broward"] });
    const mdOutcome = result.outcomes.find((o) => o.market === "miami-dade");
    expect(mdOutcome?.kind).toBe("error");
    if (mdOutcome?.kind === "error") expect(mdOutcome.message).toContain("network down");
  });

  it("adds the Palm Beach missing-fields caveat only when building-SF or year-built filters are requested with Palm Beach selected", async () => {
    pbcpaSearch.mockResolvedValue({ kind: "ok", matches: [], totalCount: 0 });

    const withFilter: LeadSearchCriteria = { markets: ["palm-beach"], buildingSqftMin: 5000 };
    const resultWith = await searchLeads(withFilter);
    expect(resultWith.caveats.some((c) => c.includes("Palm Beach"))).toBe(true);

    const withoutFilter: LeadSearchCriteria = { markets: ["palm-beach"] };
    const resultWithout = await searchLeads(withoutFilter);
    expect(resultWithout.caveats.some((c) => c.includes("Palm Beach"))).toBe(false);
  });

  it("always adds the Massachusetts reliability caveat whenever Massachusetts is selected", async () => {
    magisSearch.mockResolvedValue({ kind: "ok", matches: [], totalCount: 0 });

    const result = await searchLeads({ markets: ["massachusetts"] });
    expect(result.caveats.some((c) => c.includes("Massachusetts"))).toBe(true);
  });

  it("adds no caveats for a Florida-only search with no Palm Beach gap filters", async () => {
    mdpaSearch.mockResolvedValue({ kind: "ok", matches: [], totalCount: 0 });
    bcpaSearch.mockResolvedValue({ kind: "ok", matches: [], totalCount: 0 });

    const result = await searchLeads({ markets: ["miami-dade", "broward"], buildingSqftMin: 5000 });
    expect(result.caveats).toEqual([]);
  });

  describe("ownerPortfolioMin (Phase 3 signal filter)", () => {
    it("keeps a match whose owner meets the portfolio threshold and annotates the real count", async () => {
      mdpaSearch.mockResolvedValue({
        kind: "ok",
        matches: [okMatch({ folio: "MD1", ownerName: "BIG LANDLORD LLC" })],
        totalCount: 1,
      });
      mdpaOwnerSearch.mockResolvedValue(new Array(7).fill({ folio: "x" }));

      const result = await searchLeads({ markets: ["miami-dade"], ownerPortfolioMin: 5 });
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].ownerPortfolioCount).toBe(7);
      expect(mdpaOwnerSearch).toHaveBeenCalledWith("BIG LANDLORD LLC", "entity");
    });

    it("drops a match whose owner falls below the portfolio threshold", async () => {
      mdpaSearch.mockResolvedValue({
        kind: "ok",
        matches: [okMatch({ folio: "MD1", ownerName: "SMALL OWNER LLC" })],
        totalCount: 1,
      });
      mdpaOwnerSearch.mockResolvedValue(new Array(2).fill({ folio: "x" }));

      const result = await searchLeads({ markets: ["miami-dade"], ownerPortfolioMin: 5 });
      expect(result.matches).toHaveLength(0);
    });

    it("drops a match with no owner name on record rather than assuming it passes", async () => {
      mdpaSearch.mockResolvedValue({
        kind: "ok",
        matches: [okMatch({ folio: "MD1", ownerName: null })],
        totalCount: 1,
      });

      const result = await searchLeads({ markets: ["miami-dade"], ownerPortfolioMin: 1 });
      expect(result.matches).toHaveLength(0);
      expect(mdpaOwnerSearch).not.toHaveBeenCalled();
    });

    it("queries each distinct owner only once even when multiple matches share the same owner", async () => {
      mdpaSearch.mockResolvedValue({
        kind: "ok",
        matches: [
          okMatch({ folio: "MD1", ownerName: "REPEAT OWNER LLC" }),
          okMatch({ folio: "MD2", ownerName: "REPEAT OWNER LLC" }),
        ],
        totalCount: 2,
      });
      mdpaOwnerSearch.mockResolvedValue(new Array(3).fill({ folio: "x" }));

      const result = await searchLeads({ markets: ["miami-dade"], ownerPortfolioMin: 2 });
      expect(mdpaOwnerSearch).toHaveBeenCalledTimes(1);
      expect(result.matches).toHaveLength(2);
    });

    it("does not run the owner-portfolio check at all when ownerPortfolioMin is not set", async () => {
      mdpaSearch.mockResolvedValue({
        kind: "ok",
        matches: [okMatch({ folio: "MD1", ownerName: "ANY OWNER LLC" })],
        totalCount: 1,
      });

      const result = await searchLeads({ markets: ["miami-dade"] });
      expect(mdpaOwnerSearch).not.toHaveBeenCalled();
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].ownerPortfolioCount).toBeNull();
    });
  });
});
