import { describe, it, expect } from "vitest";
import { buildSunbizSearchUrl, manualSunbizSearchUrl } from "../../lib/sunbiz-url";

describe("buildSunbizSearchUrl", () => {
  it("builds a path-based results URL with the entity name encoded", () => {
    const url = buildSunbizSearchUrl("TERRENO 90TH STREET LLC");
    expect(url).toBe(
      "https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults/EntityName/TERRENO%2090TH%20STREET%20LLC/Page1?searchNameOrder=TERRENO90THSTREET",
    );
  });

  it("strips the entity-type suffix and punctuation from searchNameOrder", () => {
    const url = buildSunbizSearchUrl("Gato Properties, L.L.C.");
    expect(url).toContain("searchNameOrder=GATOPROPERTIES");
  });

  it("keeps the raw (unstripped) name in the encoded path segment", () => {
    const url = buildSunbizSearchUrl("Five B LLC");
    expect(url).toContain("/EntityName/Five%20B%20LLC/Page1");
  });
});

describe("manualSunbizSearchUrl", () => {
  it("is the same URL a broker would land on manually — a real browser navigation, not a scrape", () => {
    expect(manualSunbizSearchUrl("Five B LLC")).toBe(buildSunbizSearchUrl("Five B LLC"));
  });
});
