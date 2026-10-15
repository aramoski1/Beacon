/** Pure KPI aggregators for the broker command dashboard (client-safe). */

export type LeaseExposureInput = {
  daysUntilExpiry: number;
  sizeSqft: number | null;
};

export type LeaseExposureKpi = {
  count90: number;
  sqft90: number;
  count180: number;
  sqft180: number;
};

/** Aggregate lease exposure buckets from radar-style rows. */
export function aggregateLeaseExposure(rows: LeaseExposureInput[]): LeaseExposureKpi {
  let count90 = 0;
  let sqft90 = 0;
  let count180 = 0;
  let sqft180 = 0;
  for (const r of rows) {
    if (r.daysUntilExpiry < 0) continue;
    const sf = r.sizeSqft != null && r.sizeSqft > 0 ? r.sizeSqft : 0;
    if (r.daysUntilExpiry <= 90) {
      count90 += 1;
      sqft90 += sf;
    }
    if (r.daysUntilExpiry <= 180) {
      count180 += 1;
      sqft180 += sf;
    }
  }
  return { count90, sqft90, count180, sqft180 };
}

/** Sum estimated commission across active pursuits (nulls ignored). */
export function sumEstimatedCommission(
  commissions: Array<number | null | undefined>,
): number {
  return commissions.reduce<number>((sum, n) => {
    if (n == null || !Number.isFinite(n) || n < 0) return sum;
    return sum + n;
  }, 0);
}

export function fmtKpiMoney(n: number): string {
  if (n <= 0) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

export function fmtKpiSqft(n: number): string {
  if (n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M SF`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toLocaleString()}k SF`;
  return `${n.toLocaleString()} SF`;
}

export type BriefingMetricsInput = {
  overdueOutreach: number;
  dueTodayOutreach: number;
  followUpsOverdue: number;
  followUpsToday: number;
  expiringLeases: number;
  activitiesThisWeek: number;
  dataIssues: number;
  unworkedOpportunities: number;
  coldTier1: number;
  ownershipChanges: number;
};

export type BriefingMetrics = BriefingMetricsInput & { actionItems: number };

/** Assemble dashboard briefing counts without extra database round-trips. */
export function buildBriefingMetrics(input: BriefingMetricsInput): BriefingMetrics {
  const actionItems =
    input.overdueOutreach +
    input.followUpsOverdue +
    input.expiringLeases +
    input.dataIssues +
    input.unworkedOpportunities +
    input.coldTier1 +
    input.ownershipChanges;
  return { ...input, actionItems };
}
