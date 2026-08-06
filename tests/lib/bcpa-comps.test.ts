import { describe, expect, it } from "vitest";
import { fetchBcpaTaxRollComps, folioFromBcpaSourceUrl } from "../../lib/bcpa-comps";

describe("folioFromBcpaSourceUrl", () => {
  it("parses dashed and undashed bcpa refs", () => {
    expect(folioFromBcpaSourceUrl("bcpa:51-4209-05-1449")).toBe("514209051449");
    expect(folioFromBcpaSourceUrl("bcpa:514209051449")).toBe("514209051449");
    expect(folioFromBcpaSourceUrl("mdpa:01-3125-078-0010")).toBeNull();
    expect(folioFromBcpaSourceUrl("https://example.com")).toBeNull();
  });
});

// ─── Live Broward tax-roll comps ──────────────────────────────────────────────

describe("live Broward tax-roll comps", () => {
  it("2116 Sherman St, Hollywood (514209051449) returns real, priced comps in the same city", async () => {
    const result = await fetchBcpaTaxRollComps("514209051449");
    expect(result.subjectFolio).toBe("514209051449");
    expect(result.subjectDor).not.toBeNull();

    for (const comp of result.comps) {
      expect(comp.city).toBe("HOLLYWOOD");
      expect(comp.salePrice).not.toBeNull();
      expect(comp.salePrice!).toBeGreaterThanOrEqual(5_000);
      expect(comp.folio).not.toBe("514209051449");
    }
  }, 30_000);
});
