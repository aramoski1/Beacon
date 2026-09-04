/**
 * Pure merge/rank helpers for the broker Today desk.
 * Unions cadence outreach, follow-ups, deal next actions, ownership flips, and urgent leases.
 */

export type TodayDeskKind =
  | "lease_urgent"
  | "option_notice"
  | "exchange_1031"
  | "ownership"
  | "follow_up"
  | "deal_due"
  | "outreach";

export type TodayDeskItem = {
  /** Stable unique key across kinds */
  id: string;
  kind: TodayDeskKind;
  /** Higher = more urgent */
  score: number;
  title: string;
  why: string;
  href: string;
  dueDate?: string | null;
};

export function daysPastDue(dueDate: string, today: string): number {
  if (dueDate >= today) return 0;
  return Math.floor(
    (new Date(today + "T12:00:00").getTime() - new Date(dueDate + "T12:00:00").getTime()) /
      86_400_000,
  );
}

/** Lease ≤90d for the Today rail. */
export function scoreLeaseUrgent(daysUntilExpiry: number): number {
  if (daysUntilExpiry < 0) return 0;
  if (daysUntilExpiry <= 30) return 100;
  if (daysUntilExpiry <= 90) return 90;
  return 0;
}

/** Option-notice and 1031 — same 30/90 window, plus overdue bump. */
export function scoreDatedDeadline(daysUntil: number): number {
  if (daysUntil < 0) return Math.min(110, 102 + Math.min(Math.abs(daysUntil), 8));
  return scoreLeaseUrgent(daysUntil);
}

export function scoreOwnershipChange(): number {
  return 85;
}

export function scoreFollowUp(dueDate: string, today: string): number {
  if (dueDate > today) return 0; // upcoming stay off the Today rail
  if (dueDate === today) return 65;
  const days = daysPastDue(dueDate, today);
  return Math.min(80, 70 + Math.min(days, 10));
}

export function scoreDealDue(nextActionDue: string | null, today: string): number {
  if (!nextActionDue) return 0;
  if (nextActionDue > today) return 0;
  if (nextActionDue === today) return 55;
  const days = daysPastDue(nextActionDue, today);
  return Math.min(70, 58 + Math.min(days, 10));
}

/** Cadence / outreach items — reuse enriched priority when provided. */
export function scoreOutreach(priorityScore: number, daysOverdue: number): number {
  if (daysOverdue < 0) return 0; // not yet due
  // Cap below lease/ownership so structural CRE signals win
  return Math.min(50, Math.max(priorityScore, daysOverdue === 0 ? 20 : 25));
}

export type BuildTodayDeskInput = {
  today: string; // YYYY-MM-DD
  outreach: Array<{
    id: string;
    name: string | null;
    whyNow: string;
    daysOverdue: number;
    priorityScore: number;
  }>;
  followUps: Array<{
    id: string;
    description: string;
    due_date: string;
    contact_name: string | null;
    property_address: string | null;
  }>;
  deals: Array<{
    id: string;
    name: string;
    next_action: string | null;
    next_action_due: string | null;
    contact_name?: string | null;
    property_address?: string | null;
  }>;
  ownership: Array<{
    id: string;
    address: string | null;
    previous_owner: string | null;
    new_owner: string | null;
  }>;
  leases: Array<{
    id: string;
    property_address: string | null;
    daysUntilExpiry: number;
    property_id: string | null;
  }>;
  optionNotices?: Array<{
    id: string;
    property_address: string | null;
    daysUntil: number;
    label: string;
    href: string;
    dueDate: string;
  }>;
  exchange1031?: Array<{
    id: string;
    name: string | null;
    daysUntil: number;
    deadline: string;
  }>;
  /** Max items after sort (default 12) */
  limit?: number;
};

export function buildTodayDeskItems(input: BuildTodayDeskInput): TodayDeskItem[] {
  const items: TodayDeskItem[] = [];
  const today = input.today;

  for (const l of input.leases) {
    const score = scoreLeaseUrgent(l.daysUntilExpiry);
    if (score <= 0) continue;
    const addr = l.property_address ?? "Linked property";
    items.push({
      id: `lease:${l.id}`,
      kind: "lease_urgent",
      score,
      title: addr,
      why:
        l.daysUntilExpiry <= 30
          ? `Lease expires in ${l.daysUntilExpiry}d — radar can't wait`
          : `Lease expires in ${l.daysUntilExpiry}d (≤90d exposure)`,
      href: l.property_id ? `/properties/${l.property_id}` : "/lease-radar",
      dueDate: null,
    });
  }

  for (const n of input.optionNotices ?? []) {
    const score = scoreDatedDeadline(n.daysUntil);
    if (score <= 0) continue;
    const addr = n.property_address ?? "Linked property";
    items.push({
      id: `notice:${n.id}`,
      kind: "option_notice",
      score,
      title: addr,
      why:
        n.daysUntil < 0
          ? `${n.label} was ${Math.abs(n.daysUntil)}d ago`
          : `${n.label} in ${n.daysUntil}d`,
      href: n.href,
      dueDate: n.dueDate,
    });
  }

  for (const x of input.exchange1031 ?? []) {
    const score = scoreDatedDeadline(x.daysUntil);
    if (score <= 0) continue;
    items.push({
      id: `1031:${x.id}`,
      kind: "exchange_1031",
      score,
      title: x.name ?? "Contact",
      why:
        x.daysUntil < 0
          ? `1031 deadline passed ${Math.abs(x.daysUntil)}d ago`
          : `1031 exchange deadline in ${x.daysUntil}d`,
      href: `/contacts/${x.id}`,
      dueDate: x.deadline,
    });
  }

  for (const o of input.ownership) {
    items.push({
      id: `own:${o.id}`,
      kind: "ownership",
      score: scoreOwnershipChange(),
      title: o.address ?? "Property",
      why: o.new_owner
        ? `Ownership changed${o.previous_owner ? ` from ${o.previous_owner}` : ""} → ${o.new_owner}`
        : "Ownership change detected — verify who to call",
      href: `/properties/${o.id}`,
      dueDate: null,
    });
  }

  for (const f of input.followUps) {
    const score = scoreFollowUp(f.due_date, today);
    if (score <= 0) continue;
    const who = [f.contact_name, f.property_address].filter(Boolean).join(" · ");
    items.push({
      id: `fu:${f.id}`,
      kind: "follow_up",
      score,
      title: f.description || "Follow-up",
      why:
        f.due_date < today
          ? `${daysPastDue(f.due_date, today)}d overdue${who ? ` — ${who}` : ""}`
          : `Due today${who ? ` — ${who}` : ""}`,
      href: f.contact_name ? `/follow-ups` : "/follow-ups",
      dueDate: f.due_date,
    });
  }

  for (const d of input.deals) {
    const score = scoreDealDue(d.next_action_due, today);
    if (score <= 0) continue;
    const detail = d.next_action?.trim() || "Next action due";
    const who = [d.contact_name, d.property_address].filter(Boolean).join(" · ");
    items.push({
      id: `deal:${d.id}`,
      kind: "deal_due",
      score,
      title: d.name,
      why: `${detail}${who ? ` — ${who}` : ""}`,
      href: "/deals",
      dueDate: d.next_action_due,
    });
  }

  for (const c of input.outreach) {
    const score = scoreOutreach(c.priorityScore, c.daysOverdue);
    if (score <= 0) continue;
    items.push({
      id: `out:${c.id}`,
      kind: "outreach",
      score,
      title: c.name ?? "Contact",
      why: c.whyNow,
      href: `/contacts/${c.id}`,
      dueDate: null,
    });
  }

  items.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const limit = input.limit ?? 12;
  return items.slice(0, limit);
}

export const TODAY_KIND_LABEL: Record<TodayDeskKind, string> = {
  lease_urgent: "Lease",
  option_notice: "Notice",
  exchange_1031: "1031",
  ownership: "Ownership",
  follow_up: "Follow-up",
  deal_due: "Pursuit",
  outreach: "Cadence",
};
