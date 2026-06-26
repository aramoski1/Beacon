/** Lease expiration radar — bucket and urgency helpers (client-safe). */

export type LeaseRadarBucket = "3mo" | "6mo" | "12mo";

export type LeaseRadarUrgency = "critical" | "high" | "medium" | "low";

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
  owner_contact: {
    id: string;
    name: string | null;
    email: string | null;
    company: string | null;
  } | null;
};

export type LeaseRadarData = {
  within3: LeaseRadarEntry[];
  within6: LeaseRadarEntry[];
  within12: LeaseRadarEntry[];
  counts: { within3: number; within6: number; within12: number; total: number };
  /** Leases expiring in ≤90 days — for nav badges and dashboard flags. */
  urgentCount: number;
};

const MS_DAY = 86_400_000;

export function daysUntilExpiry(expirationDate: string, now = new Date()): number {
  const exp = new Date(expirationDate + "T12:00:00").getTime();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.ceil((exp - today.getTime()) / MS_DAY);
}

export function leaseRadarBucket(days: number): LeaseRadarBucket | null {
  if (days < 0) return null;
  if (days <= 90) return "3mo";
  if (days <= 180) return "6mo";
  if (days <= 365) return "12mo";
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
  return name.length > 40 ? name.slice(0, 38) + "…" : name;
}

export function fmtExpiry(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function rolloverHint(days: number): string {
  if (days <= 30) return "Tenant likely evaluating options — reach out now";
  if (days <= 90) return "Start space planning conversation before listings hit market";
  if (days <= 180) return "Good window to discuss renewal or relocation";
  return "Early signal — add to rollover pipeline";
}

export function leaseOutreachContext(entry: LeaseRadarEntry): string {
  const parts = [
    "LEASE ROLLOVER OUTREACH:",
    entry.property_address ? `Property: ${entry.property_address}.` : "",
    entry.property_owner_name ? `Ownership entity: ${entry.property_owner_name}.` : "",
    `Lease expires ${fmtExpiry(entry.expiration_date)} (${entry.daysUntilExpiry} days).`,
    entry.base_rate != null ? `Current base rate: $${entry.base_rate}/sf.` : "",
    rolloverHint(entry.daysUntilExpiry),
    "The tenant may need space soon — proactive outreach beats waiting for a listing.",
  ];
  return parts.filter(Boolean).join(" ");
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
