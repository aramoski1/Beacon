import { describe, expect, it } from "vitest";
import { fetchPbcpaTaxRollComps, folioFromPbcpaSourceUrl } from "../../lib/pbcpa-comps";

describe("folioFromPbcpaSourceUrl", () => {
  it("parses dashed and undashed pbcpa refs", () => {
    expect(folioFromPbcpaSourceUrl("pbcpa:08-43-45-29-01-019-0251")).toBe("08434529010190251");
    expect(folioFromPbcpaSourceUrl("pbcpa:08434529010190251")).toBe("08434529010190251");
    expect(folioFromPbcpaSourceUrl("bcpa:51-4209-05-1449")).toBeNull();
    expect(folioFromPbcpaSourceUrl("https://example.com")).toBeNull();
  });
});

// ─── Live Palm Beach tax-roll comps ───────────────────────────────────────────

describe.skipIf(!!process.env.CI)("live Palm Beach tax-roll comps", () => {
  it("627 SW 4th Ave, Boynton Beach (08434529010190251) returns real, priced same-class comps", async () => {
    const result = await fetchPbcpaTaxRollComps("08434529010190251");
    expect(result.subjectFolio).toBe("08434529010190251");
    expect(result.subjectDor).toBe("SINGLE FAMILY");

    for (const comp of result.comps) {
      expect(comp.city).toBe("BOYNTON BEACH");
      expect(comp.salePrice).not.toBeNull();
      expect(comp.salePrice!).toBeGreaterThanOrEqual(5_000);
      expect(comp.folio).not.toBe("08434529010190251");
    }
    // Same-use-class comps are preferred, not guaranteed — Boynton Beach has a
    // deep enough single-family sample that at least one should show up.
    expect(result.comps.some((c) => c.sameDorClass)).toBe(true);
  }, 30_000);
});
