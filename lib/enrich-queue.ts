/**
 * Post-import enrich queue helpers — plan MDPA + Sunbiz work without blocking import.
 */

import { isEntityOwnerName } from "@/lib/owner-contacts";

export const ENRICH_QUEUE_DELAY_MS = 400;
export const ENRICH_QUEUE_MAX = 50;

export type EnrichQueueProperty = {
  id: string;
  address: string | null;
  source: string | null;
  source_url: string | null;
  owner_name: string | null;
};

export type EnrichJobPlan = {
  propertyId: string;
  address: string | null;
  needsCounty: boolean;
  needsSunbiz: boolean;
  skipReason?: string;
};

/** Skip county enhance when already county/state-sourced (any of MDPA/BCPA/
 * PBCPA/MassGIS's source_url prefixes — not just MDPA's). `source ===
 * "tax_roll"` already covers a property ingested directly from the tax
 * roll, but a property enhanced later via the Enrich panel's "Run" flow
 * (applyCountyEnhancement) keeps its original `source` and only gets a new
 * `source_url` — this second check is what catches that case, so it has to
 * cover every county/state prefix, not just Miami-Dade's. */
export function shouldSkipCountyEnhance(p: {
  source: string | null;
  source_url: string | null;
}): boolean {
  if (p.source === "tax_roll") return true;
  if (
    p.source_url?.startsWith("mdpa:") ||
    p.source_url?.startsWith("bcpa:") ||
    p.source_url?.startsWith("pbcpa:") ||
    p.source_url?.startsWith("magis:")
  ) {
    return true;
  }
  return false;
}

/** Build ordered enrich jobs; caps list and marks skip reasons. */
export function planEnrichJobs(
  properties: EnrichQueueProperty[],
  opts?: { max?: number },
): EnrichJobPlan[] {
  const max = opts?.max ?? ENRICH_QUEUE_MAX;
  const plans: EnrichJobPlan[] = [];

  for (const p of properties.slice(0, max)) {
    const needsCounty = !shouldSkipCountyEnhance(p);
    const needsSunbiz = isEntityOwnerName(p.owner_name);
    if (!needsCounty && !needsSunbiz) {
      plans.push({
        propertyId: p.id,
        address: p.address,
        needsCounty: false,
        needsSunbiz: false,
        skipReason: "Already county-linked and no entity owner for Sunbiz",
      });
      continue;
    }
    plans.push({
      propertyId: p.id,
      address: p.address,
      needsCounty,
      needsSunbiz,
    });
  }

  return plans;
}

export function summarizeEnrichPlan(plans: EnrichJobPlan[]): {
  total: number;
  county: number;
  sunbiz: number;
  skipped: number;
} {
  return {
    total: plans.length,
    county: plans.filter((p) => p.needsCounty).length,
    sunbiz: plans.filter((p) => p.needsSunbiz).length,
    skipped: plans.filter((p) => p.skipReason).length,
  };
}
