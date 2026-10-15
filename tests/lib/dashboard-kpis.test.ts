import { describe, expect, it } from "vitest";
import {
  aggregateLeaseExposure,
  sumEstimatedCommission,
  fmtKpiMoney,
  fmtKpiSqft,
  buildBriefingMetrics,
} from "../../lib/dashboard-kpis";

describe("aggregateLeaseExposure", () => {
  it("buckets count and SF for 90d and 180d", () => {
    const kpi = aggregateLeaseExposure([
      { daysUntilExpiry: 30, sizeSqft: 10_000 },
      { daysUntilExpiry: 90, sizeSqft: 5_000 },
      { daysUntilExpiry: 120, sizeSqft: 20_000 },
      { daysUntilExpiry: 200, sizeSqft: 99_000 },
      { daysUntilExpiry: -1, sizeSqft: 1_000 },
    ]);
    expect(kpi.count90).toBe(2);
    expect(kpi.sqft90).toBe(15_000);
    expect(kpi.count180).toBe(3);
    expect(kpi.sqft180).toBe(35_000);
  });

  it("treats missing SF as zero", () => {
    const kpi = aggregateLeaseExposure([{ daysUntilExpiry: 10, sizeSqft: null }]);
    expect(kpi.count90).toBe(1);
    expect(kpi.sqft90).toBe(0);
  });
});

describe("sumEstimatedCommission", () => {
  it("sums positive commissions and ignores null/invalid", () => {
    expect(sumEstimatedCommission([25_000, null, 10_000, -5, undefined])).toBe(35_000);
  });

  it("returns 0 for empty", () => {
    expect(sumEstimatedCommission([])).toBe(0);
  });
});

describe("fmt helpers", () => {
  it("formats money and sf", () => {
    expect(fmtKpiMoney(0)).toBe("—");
    expect(fmtKpiMoney(25_000)).toBe("$25K");
    expect(fmtKpiSqft(0)).toBe("—");
    expect(fmtKpiSqft(42_000)).toBe("42k SF");
  });
});

describe("buildBriefingMetrics", () => {
  it("sums action items from the provided counts", () => {
    const m = buildBriefingMetrics({
      overdueOutreach: 1,
      dueTodayOutreach: 2,
      followUpsOverdue: 3,
      followUpsToday: 0,
      expiringLeases: 4,
      activitiesThisWeek: 9,
      dataIssues: 5,
      unworkedOpportunities: 6,
      coldTier1: 7,
      ownershipChanges: 8,
    });
    expect(m.actionItems).toBe(1 + 3 + 4 + 5 + 6 + 7 + 8);
    expect(m.activitiesThisWeek).toBe(9);
  });
});
