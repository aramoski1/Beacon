/**
 * Pure signal-building logic for enriched dashboard action items.
 * No server or DB dependencies — fully testable.
 */
import { rolloverHint } from "./lease-radar";

// ─── Signal types ──────────────────────────────────────────────────────────────

export type LeaseExpiringSignal = {
  kind: "lease_expiring";
  leaseId: string;
  daysUntilExpiry: number;
  address: string | null;
  sqft: number | null;
};

export type OwnershipChangedSignal = {
  kind: "ownership_changed";
  address: string | null;
  newOwner: string | null;
};

export type CadenceOverdueSignal = {
  kind: "cadence_overdue";
  daysOverdue: number;
  tier: number | null;
};

export type NeverContactedSignal = {
  kind: "never_contacted";
  tier: number | null;
};

// Flags a property built well below what its zoning currently allows — a
// highest-and-best-use / redevelopment conversation starter. Only computed
// when a broker has actually run the Zoning lookup (lib/zoning.ts) on the
// property and it persisted a numeric FAR — today that's Massachusetts only
// (the MAPC Zoning Atlas is the only region with real numeric FAR data; the
// Florida GIS layers only expose a zoning code/description, no buildable-area
// math), so this signal simply never fires for FL properties rather than
// guessing a FAR that isn't in any real record.
export type ZoningOpportunitySignal = {
  kind: "zoning_opportunity";
  address: string | null;
  zoningCode: string | null;
  farEffective: number;
  builtSqft: number;
  allowedSqft: number;
  utilizationPct: number; // 0–100, rounded
};

export type ActionSignal =
  | LeaseExpiringSignal
  | OwnershipChangedSignal
  | CadenceOverdueSignal
  | NeverContactedSignal
  | ZoningOpportunitySignal;

// ─── Enriched item type ────────────────────────────────────────────────────────

export type EnrichedProperty = {
  id: string;
  address: string | null;
  size_sqft: number | null;
  /** Land area in sqft — needed alongside zoning_far to compute allowed buildable area. */
  land_sqft?: number | null;
  /** Persisted from a prior broker-run zoning lookup (lib/zoning.ts) — null until run, and null everywhere outside Massachusetts today. */
  zoning_far?: number | null;
  zoning_code?: string | null;
};

// A utilization ratio below this (built ÷ zoning-allowed) is flagged as a
// meaningful gap — well short of "basically built out." The farEffective
// floor below avoids flagging ordinary single-family lots, where zoned FAR is
// often already close to 1 and low utilization is just a normal-sized house,
// not a real redevelopment opportunity.
const ZONING_OPPORTUNITY_MAX_UTILIZATION = 0.5;
const ZONING_OPPORTUNITY_MIN_FAR = 1;

export type EnrichedActionItem = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  contact_tier: number | null;
  last_contacted_at: string | null;
  daysSinceContact: number;
  daysOverdue: number;
  /** Cadence interval for this contact's tier (from user_settings). */
  cadenceDays: number;
  signals: ActionSignal[];
  /** Full reason sentence including name, e.g. "John Smith — 42,000 SF Doral lease expires in 14 months, …" */
  whyNow: string;
  /** Signal-specific context injected into the AI draft call alongside the broker bio. */
  composeContext: string;
  resolvedProperties: EnrichedProperty[];
};

// ─── Signal building ───────────────────────────────────────────────────────────

export function buildSignals({
  contact,
  resolvedProperties,
  expiringLeases,
  changedProperties,
  daysOverdue,
  daysSinceContact,
}: {
  contact: { contact_tier: number | null; last_contacted_at: string | null };
  resolvedProperties: EnrichedProperty[];
  expiringLeases: Array<{
    leaseId: string;
    daysUntilExpiry: number;
    address: string | null;
    sqft: number | null;
  }>;
  /** Map of property ID → { newOwner } for properties with detected ownership changes. */
  changedProperties: Map<string, { newOwner: string | null }>;
  daysOverdue: number;
  daysSinceContact: number;
}): ActionSignal[] {
  const signals: ActionSignal[] = [];

  // Lease expiry — most urgent first
  const sortedLeases = [...expiringLeases].sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  for (const l of sortedLeases) {
    signals.push({
      kind: "lease_expiring",
      leaseId: l.leaseId,
      daysUntilExpiry: l.daysUntilExpiry,
      address: l.address,
      sqft: l.sqft,
    });
  }

  // Ownership changes on linked properties
  for (const p of resolvedProperties) {
    const info = changedProperties.get(p.id);
    if (info !== undefined) {
      signals.push({ kind: "ownership_changed", address: p.address, newOwner: info.newOwner });
    }
  }

  // Zoning opportunity — built well below what's currently zoned (see
  // ZoningOpportunitySignal doc comment for why this only ever fires when a
  // real farEffective is on file).
  for (const p of resolvedProperties) {
    if (!p.zoning_far || !p.land_sqft || !p.size_sqft) continue;
    if (p.zoning_far < ZONING_OPPORTUNITY_MIN_FAR) continue;
    const allowedSqft = p.zoning_far * p.land_sqft;
    if (allowedSqft <= 0) continue;
    const utilization = p.size_sqft / allowedSqft;
    if (utilization >= ZONING_OPPORTUNITY_MAX_UTILIZATION) continue;
    signals.push({
      kind: "zoning_opportunity",
      address: p.address,
      zoningCode: p.zoning_code ?? null,
      farEffective: p.zoning_far,
      builtSqft: p.size_sqft,
      allowedSqft: Math.round(allowedSqft),
      utilizationPct: Math.round(utilization * 100),
    });
  }

  // Cadence / recency
  if (!contact.last_contacted_at) {
    signals.push({ kind: "never_contacted", tier: contact.contact_tier });
  } else if (daysOverdue > 0) {
    signals.push({ kind: "cadence_overdue", daysOverdue, tier: contact.contact_tier });
  }

  return signals;
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

export function formatTimeLeft(days: number): string {
  if (days <= 45) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 350) {
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"}`;
}

function formatDaysSince(days: number): string {
  if (days <= 60) return `${days} days ago`;
  if (days < 350) {
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

// ─── whyNow sentence ──────────────────────────────────────────────────────────

export function formatWhyNow(
  signals: ActionSignal[],
  name: string | null,
  daysSinceContact: number,
): string {
  const displayName = name ?? "Contact";
  const parts: string[] = [];

  // Priority 1: most urgent expiring lease
  const leases = signals.filter((s): s is LeaseExpiringSignal => s.kind === "lease_expiring");
  if (leases.length > 0) {
    const l = leases[0]; // already sorted most-urgent first
    const sqftStr = l.sqft ? `${l.sqft.toLocaleString()} SF ` : "";
    const addrStr = l.address ? `${l.address} ` : "";
    parts.push(`${sqftStr}${addrStr}lease expires in ${formatTimeLeft(l.daysUntilExpiry)}`);
  }

  // Priority 2: ownership changes
  if (signals.some((s) => s.kind === "ownership_changed")) {
    parts.push("ownership changed recently");
  }

  // Priority 3: zoning opportunity (only ever present alongside, never instead
  // of, the above — see ZoningOpportunitySignal)
  const zoningOpp = signals.find((s): s is ZoningOpportunitySignal => s.kind === "zoning_opportunity");
  if (zoningOpp) {
    parts.push(`built at ${zoningOpp.utilizationPct}% of what its zoning (FAR ${zoningOpp.farEffective}) allows`);
  }

  // Priority 4: contact recency — "last contacted" only shown when there's a
  // primary signal (lease/ownership/zoning) to give it context; alone it's
  // redundant because daysOverdue already covers that.
  const hasPrimarySignal = leases.length > 0 || signals.some((s) => s.kind === "ownership_changed") || !!zoningOpp;
  if (signals.some((s) => s.kind === "never_contacted")) {
    parts.push("never contacted");
  } else if (hasPrimarySignal && daysSinceContact > 0) {
    parts.push(`last contacted ${formatDaysSince(daysSinceContact)}`);
  }

  if (parts.length === 0) {
    const overdue = signals.find((s): s is CadenceOverdueSignal => s.kind === "cadence_overdue");
    if (overdue) return `${displayName} — ${overdue.daysOverdue}d overdue on cadence`;
    return displayName;
  }

  return `${displayName} — ${parts.join(", ")}`;
}

// ─── composeContext (pre-fill for AI) ─────────────────────────────────────────

export function formatComposeContext(
  signals: ActionSignal[],
  daysSinceContact: number,
): string {
  const lines: string[] = [];

  const leases = signals.filter((s): s is LeaseExpiringSignal => s.kind === "lease_expiring");
  for (const l of leases.slice(0, 2)) {
    const sqftStr = l.sqft ? `${l.sqft.toLocaleString()} SF` : "";
    const addrStr = l.address ?? "";
    const desc = [sqftStr, addrStr].filter(Boolean).join(" at ");
    const urgencyTag =
      l.daysUntilExpiry <= 30
        ? "CRITICAL: "
        : l.daysUntilExpiry <= 90
        ? "URGENT: "
        : "";
    lines.push(
      `${urgencyTag}Lease expiring in ${formatTimeLeft(l.daysUntilExpiry)}${desc ? ` (${desc})` : ""} — ${rolloverHint(l.daysUntilExpiry)}`
    );
  }

  const changed = signals.filter((s): s is OwnershipChangedSignal => s.kind === "ownership_changed");
  for (const c of changed) {
    const prop = c.address ?? "linked property";
    lines.push(
      `Ownership recently changed at ${prop}${c.newOwner ? ` — new owner: ${c.newOwner}` : ""}`
    );
  }

  const zoningOpp = signals.find((s): s is ZoningOpportunitySignal => s.kind === "zoning_opportunity");
  if (zoningOpp) {
    const prop = zoningOpp.address ?? "the linked property";
    const zoneStr = zoningOpp.zoningCode ? ` (zoned ${zoningOpp.zoningCode}, FAR ${zoningOpp.farEffective})` : ` (FAR ${zoningOpp.farEffective})`;
    lines.push(
      `${prop}${zoneStr} is built at ${zoningOpp.builtSqft.toLocaleString()} SF against ~${zoningOpp.allowedSqft.toLocaleString()} SF allowed by zoning (${zoningOpp.utilizationPct}% utilized) — a potential redevelopment/expansion angle worth raising, not a certainty.`
    );
  }

  if (signals.some((s) => s.kind === "never_contacted")) {
    lines.push("This is a first contact — introduce yourself and your specialty.");
  } else if (daysSinceContact > 0) {
    lines.push(
      `Last contact was ${daysSinceContact} days ago — acknowledge the gap naturally.`
    );
  }

  return lines.join("\n");
}

// ─── Priority score (higher = more urgent) ────────────────────────────────────

export function signalPriorityScore(signals: ActionSignal[]): number {
  const mostUrgentLease = signals
    .filter((s): s is LeaseExpiringSignal => s.kind === "lease_expiring")
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)[0];

  if (mostUrgentLease) {
    if (mostUrgentLease.daysUntilExpiry <= 30) return 100;
    if (mostUrgentLease.daysUntilExpiry <= 90) return 80;
    if (mostUrgentLease.daysUntilExpiry <= 180) return 60;
    return 40;
  }

  if (signals.some((s) => s.kind === "ownership_changed")) return 30;

  // Below ownership change (a discrete, timely event) but above plain cadence
  // overdue — a real opportunity, but not time-sensitive the way the above are.
  if (signals.some((s) => s.kind === "zoning_opportunity")) return 20;

  const overdue = signals.find((s): s is CadenceOverdueSignal => s.kind === "cadence_overdue");
  if (overdue) return Math.min(25, overdue.daysOverdue / 2);

  if (signals.some((s) => s.kind === "never_contacted")) return 10;

  return 0;
}
