import { differenceInCalendarDays, formatLocalDate } from "@/lib/dates";
import { formatPsf } from "@/lib/format-money";

/** Lease expiration radar — bucket, urgency, and outreach-contact helpers (client-safe). */

export type LeaseRadarBucket = "3mo" | "6mo" | "12mo";

export type LeaseRadarUrgency = "critical" | "high" | "medium" | "low";

export type RadarContactRef = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
};

export type LeaseRadarEntry = {
  id: string;
  expiration_date: string;
  source_document: string | null;
  base_rate: number | null;
  term: string | null;
  daysUntilExpiry: number;
  bucket: LeaseRadarBucket;
  urgency: LeaseRadarUrgency;
  property_id: string | null;
  property_address: string | null;
  property_owner_name: string | null;
  leased_sf: number | null;
  property_submarket: string | null;
  /** Best CRM contact on the property for owner-facing actions (prefer contact_type=owner). */
  owner_contact: RadarContactRef | null;
  /** Tenant CRM contact linked on the lease abstract. */
  tenant_contact: RadarContactRef | null;
  /** Soonest option-notice deadline derived from abstract options. */
  notice_deadline?: string | null;
  daysUntilNotice?: number | null;
  notice_label?: string | null;
};

export type LeaseRadarData = {
  within3: LeaseRadarEntry[];
  within6: LeaseRadarEntry[];
  within12: LeaseRadarEntry[];
  counts: { within3: number; within6: number; within12: number; total: number };
  /** Leases expiring in ≤90 days — for nav badges and dashboard flags. */
  urgentCount: number;
};

/** CRE action that determines who should be contacted. */
export type RadarActionType =
  | "tenant_rollover"
  | "owner_renewal"
  | "owner_sale";

export type OutreachResolution =
  | {
      kind: "ready";
      role: "tenant" | "owner";
      contact: RadarContactRef;
      why: string;
      action: RadarActionType;
    }
  | {
      kind: "needs_choice";
      /** Shown when tenant rollover is intended but only an owner contact exists. */
      why: string;
      ownerOption: {
        contact: RadarContactRef;
        why: string;
        action: RadarActionType;
      } | null;
    }
  | {
      kind: "missing";
      want: "tenant" | "owner" | "either";
      why: string;
      linkHint: "abstract" | "property";
    };

/** Day-count thresholds for the radar buckets — shared with the CRM "Expiration window" filter. */
export const LEASE_RADAR_DAY_THRESHOLDS = {
  threeMonth: 90,
  sixMonth: 180,
  twelveMonth: 365,
} as const;

export function daysUntilExpiry(expirationDate: string, now = new Date()): number {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return differenceInCalendarDays(expirationDate.slice(0, 10), today);
}

export function leaseRadarBucket(days: number): LeaseRadarBucket | null {
  if (days < 0) return null;
  if (days <= LEASE_RADAR_DAY_THRESHOLDS.threeMonth) return "3mo";
  if (days <= LEASE_RADAR_DAY_THRESHOLDS.sixMonth) return "6mo";
  if (days <= LEASE_RADAR_DAY_THRESHOLDS.twelveMonth) return "12mo";
  return null;
}

export function leaseRadarUrgency(days: number): LeaseRadarUrgency {
  if (days <= 30) return "critical";
  if (days <= 90) return "high";
  if (days <= 180) return "medium";
  return "low";
}

export function leaseLabel(path: string | null): string {
  if (!path) return "Lease abstract";
  const name = path.split("/").pop() ?? path;
  if (name === "seed:demo" || name.startsWith("seed:")) return "Lease abstract";
  return name.length > 40 ? name.slice(0, 38) + "…" : name;
}

/** Broker-facing title: tenant, then property, never a seed filename. */
export function leaseDisplayTitle(entry: {
  tenant_contact?: { name?: string | null } | null;
  property_address?: string | null;
  source_document?: string | null;
}): string {
  const tenant = entry.tenant_contact?.name?.trim();
  if (tenant) return tenant;
  const addr = entry.property_address?.trim();
  if (addr) return addr;
  return leaseLabel(entry.source_document ?? null);
}

export function fmtExpiry(iso: string): string {
  return formatLocalDate(iso) ?? iso.slice(0, 10);
}

export function formatLeaseRate(rate: number | null | undefined): string | null {
  return formatPsf(rate);
}

export function rolloverHint(days: number): string {
  if (days <= 30) return "Tenant likely evaluating options — reach out now";
  if (days <= 90) return "Start space planning conversation before listings hit market";
  if (days <= 180) return "Good window to discuss renewal or relocation";
  return "Early signal — add to rollover pipeline";
}

/**
 * Pick who to email for a CRE action.
 * Tenant rollover → tenant when linked; otherwise an explicit choice (link tenant vs email owner).
 * Owner-facing actions → owner contact only.
 */
export function resolveOutreachContact(
  action: RadarActionType,
  entry: Pick<LeaseRadarEntry, "tenant_contact" | "owner_contact">,
): OutreachResolution {
  if (action === "tenant_rollover") {
    if (entry.tenant_contact) {
      return {
        kind: "ready",
        role: "tenant",
        contact: entry.tenant_contact,
        why: "Tenant rollover — email the tenant about renewal or relocation.",
        action,
      };
    }
    if (entry.owner_contact) {
      return {
        kind: "needs_choice",
        why: "No tenant linked — link the tenant on the abstract, or email the owner about vacancy / renewal strategy?",
        ownerOption: {
          contact: entry.owner_contact,
          why: "Owner-facing — vacancy / renewal strategy with the ownership contact.",
          action: "owner_renewal",
        },
      };
    }
    return {
      kind: "missing",
      want: "tenant",
      why: "No tenant linked — radar can't email the right party for rollover.",
      linkHint: "abstract",
    };
  }

  // owner_renewal | owner_sale
  if (entry.owner_contact) {
    return {
      kind: "ready",
      role: "owner",
      contact: entry.owner_contact,
      why:
        action === "owner_sale"
          ? "Owner-facing — discuss sale / ownership timing around this expiry."
          : "Owner-facing — renewal strategy and vacancy risk with the ownership contact.",
      action,
    };
  }
  return {
    kind: "missing",
    want: "owner",
    why: "No owner CRM contact on this property — link an owner contact to continue.",
    linkHint: "property",
  };
}

/** AI draft context aligned to who is being contacted. */
export function leaseOutreachContext(
  entry: LeaseRadarEntry,
  action: RadarActionType = "tenant_rollover",
): string {
  const base = [
    entry.property_address ? `Property: ${entry.property_address}.` : "",
    entry.property_owner_name ? `Ownership entity: ${entry.property_owner_name}.` : "",
    `Lease expires ${fmtExpiry(entry.expiration_date)} (${entry.daysUntilExpiry} days).`,
    entry.notice_deadline && entry.daysUntilNotice != null
      ? `${entry.notice_label ?? "Option notice"} is ${entry.daysUntilNotice < 0 ? `${Math.abs(entry.daysUntilNotice)} days past` : `in ${entry.daysUntilNotice} days`} (${fmtExpiry(entry.notice_deadline)}).`
      : "",
    entry.base_rate != null ? `Current base rate: ${formatPsf(entry.base_rate)}.` : "",
  ];

  if (action === "tenant_rollover") {
    return [
      "LEASE ROLLOVER OUTREACH (to tenant):",
      ...base,
      rolloverHint(entry.daysUntilExpiry),
      "The tenant may need space soon — proactive outreach beats waiting for a listing.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (action === "owner_sale") {
    return [
      "LEASE EXPIRY — OWNER SALE / TIMING:",
      ...base,
      "Discuss whether an approaching vacancy changes sale timing or marketing strategy.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    "LEASE EXPIRY — OWNER RENEWAL / VACANCY:",
    ...base,
    "Discuss renewal strategy, rollover risk, and backfill timing with ownership.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Prefer contact_type=owner, then lower tier (1 best).
 * Used when building property → owner_contact maps.
 */
export function preferOwnerContactCandidate(
  existing: { id: string; tier: number; isOwnerType: boolean } | undefined,
  candidate: { id: string; tier: number; isOwnerType: boolean },
): boolean {
  if (!existing) return true;
  if (candidate.isOwnerType && !existing.isOwnerType) return true;
  if (!candidate.isOwnerType && existing.isOwnerType) return false;
  return candidate.tier < existing.tier;
}

export const BUCKET_META: Record<
  LeaseRadarBucket,
  { label: string; sub: string; href: string }
> = {
  "3mo": {
    label: "Next 3 months",
    sub: "Highest priority — tenants actively planning",
    href: "#bucket-3mo",
  },
  "6mo": {
    label: "3–6 months",
    sub: "Start renewal and relocation conversations",
    href: "#bucket-6mo",
  },
  "12mo": {
    label: "6–12 months",
    sub: "Pipeline signals — get on their radar early",
    href: "#bucket-12mo",
  },
};
