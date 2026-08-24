import { describe, expect, it } from "vitest";
import { fetchMagisTaxRollComps, folioFromMagisSourceUrl } from "../../lib/magis-comps";

describe("folioFromMagisSourceUrl", () => {
  it("parses a magis: source_url", () => {
    expect(folioFromMagisSourceUrl("magis:F_790618_2965662")).toBe("F_790618_2965662");
    expect(folioFromMagisSourceUrl("mdpa:01-3125-078-0010")).toBeNull();
    expect(folioFromMagisSourceUrl("bcpa:514209051449")).toBeNull();
    expect(folioFromMagisSourceUrl("pbcpa:08434529010190251")).toBeNull();
    expect(folioFromMagisSourceUrl(null)).toBeNull();
    expect(folioFromMagisSourceUrl(undefined)).toBeNull();
  });
});

// ─── Live Massachusetts tax-roll comps ────────────────────────────────────────

describe("live Massachusetts tax-roll comps", () => {
  it("1105 Saratoga St, Boston (F_790618_2965662) returns real, priced comps in the same city", async () => {
    const result = await fetchMagisTaxRollComps("F_790618_2965662");
    expect(result.subjectFolio).toBe("F_790618_2965662");
    expect(result.subjectDor).not.toBeNull();

    for (const comp of result.comps) {
      expect(comp.city).toBe("BOSTON");
      expect(comp.salePrice).not.toBeNull();
      expect(comp.salePrice!).toBeGreaterThanOrEqual(5_000);
      expect(comp.folio).not.toBe("F_790618_2965662");
    }
  }, 30_000);

  it("returns an honest empty result (not an error) for a nonexistent LOC_ID", async () => {
    const result = await fetchMagisTaxRollComps("F_000000_0000000_does_not_exist");
    expect(result.comps).toEqual([]);
    expect(result.note).toContain("not found");
  }, 30_000);
});
