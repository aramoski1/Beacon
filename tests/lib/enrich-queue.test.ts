import { describe, expect, it } from "vitest";
import {
  planEnrichJobs,
  shouldSkipCountyEnhance,
  summarizeEnrichPlan,
} from "../../lib/enrich-queue";

describe("shouldSkipCountyEnhance", () => {
  it("skips tax_roll and mdpa: source_url", () => {
    expect(shouldSkipCountyEnhance({ source: "tax_roll", source_url: null })).toBe(true);
    expect(shouldSkipCountyEnhance({ source: "csv_import", source_url: "mdpa:01-1" })).toBe(true);
    expect(shouldSkipCountyEnhance({ source: "csv_import", source_url: null })).toBe(false);
  });
});

describe("planEnrichJobs", () => {
  it("plans county + sunbiz for entity owners without mdpa", () => {
    const plans = planEnrichJobs([
      {
        id: "1",
        address: "100 Main",
        source: "csv_import",
        source_url: null,
        owner_name: "Acme Holdings LLC",
      },
      {
        id: "2",
        address: "200 Main",
        source: "tax_roll",
        source_url: "mdpa:01",
        owner_name: "Jane Doe",
      },
    ]);
    expect(plans[0]).toMatchObject({ needsCounty: true, needsSunbiz: true });
    expect(plans[1].skipReason).toBeTruthy();
  });

  it("caps at max", () => {
    const props = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      address: null,
      source: "csv_import",
      source_url: null,
      owner_name: "X LLC",
    }));
    expect(planEnrichJobs(props, { max: 2 })).toHaveLength(2);
  });
});

describe("summarizeEnrichPlan", () => {
  it("counts buckets", () => {
    const summary = summarizeEnrichPlan([
      { propertyId: "1", address: null, needsCounty: true, needsSunbiz: true },
      { propertyId: "2", address: null, needsCounty: false, needsSunbiz: false, skipReason: "x" },
    ]);
    expect(summary).toEqual({ total: 2, county: 1, sunbiz: 1, skipped: 1 });
  });
});
