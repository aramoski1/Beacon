"use server";

import { createClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DashboardStats = {
  properties: number;
  contacts: number;
  leases: number;
  errors: number;
  followUpsDue: number;
};

export type RecentActivity = {
  id: string;
  activity_type: string;
  activity_date: string;
  notes: string | null;
  contact_id: string;
  contact_name: string | null;
  property_address: string | null;
};

export type ExpiringLease = {
  id: string;
  expiration_date: string;
  source_document: string | null;
  base_rate: number | null;
  daysUntilExpiry: number;
};

export type PortfolioSnapshot = {
  totalSqft: number;
  totalValue: number;
  byType: { type: string; count: number; sqft: number }[];
  bySubmarket: { name: string; count: number }[];
  addedThisWeek: number;
  recentProperties: { id: string; address: string | null; property_type: string | null; size_sqft: number | null; ingested_at: string | null }[];
};

export type DataHealth = {
  ingestionErrors: number;
  flaggedProperties: number;
  totalProperties: number;
};

export type BriefingMetrics = {
  overdueOutreach: number;
  dueTodayOutreach: number;
  followUpsOverdue: number;
  followUpsToday: number;
  expiringLeases: number;
  activitiesThisWeek: number;
  dataIssues: number;
  actionItems: number;
};

export type CadenceHealth = {
  compliancePct: number;
  onTrack: number;
  overdue: number;
  neverContacted: number;
  tierBreakdown: { tier: number; label: string; overdue: number; total: number }[];
};

const CADENCE_DAYS: Record<number, number> = { 1: 14, 2: 30, 3: 90 };

// ─── Audit classification ─────────────────────────────────────────────────────

const GOVT_PATTERNS = [
  "MIAMI-DADE", "MIAMI DADE", "COUNTY OF MIAMI", "DADE COUNTY",
  "BOARD OF COUNTY", "SCHOOL BOARD", "HOUSING AUTHORITY",
  "PUBLIC HEALTH TRUST", "JACKSON HEALTH", "SOUTH FLORIDA WATER",
  "FDOT", "FLORIDA DEPT OF TRANSP", "MDTA",
];

const CORE_FIELDS = new Set(["address", "owner_name", "size_sqft"]);

function isFlaggedProperty(p: {
  address: string | null;
  owner_name: string | null;
  confidence_flags: { field: string; reason: string }[] | null;
}): boolean {
  if (p.address?.toUpperCase().startsWith("111 NW 1 ST")) return true;
  const ownerUp = (p.owner_name ?? "").toUpperCase();
  if (GOVT_PATTERNS.some((pat) => ownerUp.includes(pat))) return true;
  return (p.confidence_flags ?? []).some((f) => CORE_FIELDS.has(f.field));
}

function isContactOverdue(c: { contact_tier: number | null; last_contacted_at: string | null }): boolean {
  if (!c.contact_tier) return false;
  const threshold = CADENCE_DAYS[c.contact_tier] ?? 90;
  if (!c.last_contacted_at) return true;
  const daysSince = Math.floor((Date.now() - new Date(c.last_contacted_at).getTime()) / 86_400_000);
  return daysSince >= threshold;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { properties: 0, contacts: 0, leases: 0, errors: 0, followUpsDue: 0 };

  const today = new Date().toISOString().slice(0, 10);

  const [
    { count: propCount },
    { count: contactCount },
    { count: leaseCount },
    { count: errorCount },
    { count: followUpsDueCount },
  ] = await Promise.all([
    supabase.from("properties").select("*", { count: "exact", head: true }).eq("owner_id", user.id),
    supabase.from("contacts").select("*", { count: "exact", head: true }).eq("owner_id", user.id),
    supabase.from("lease_abstracts").select("*", { count: "exact", head: true }).eq("owner_id", user.id),
    supabase.from("ingestion_errors").select("*", { count: "exact", head: true }).eq("owner_id", user.id),
    supabase.from("follow_ups").select("*", { count: "exact", head: true }).eq("owner_id", user.id).eq("done", false).lte("due_date", today),
  ]);

  return {
    properties:   propCount ?? 0,
    contacts:     contactCount ?? 0,
    leases:       leaseCount ?? 0,
    errors:       errorCount ?? 0,
    followUpsDue: followUpsDueCount ?? 0,
  };
}

export async function getRecentActivities(): Promise<RecentActivity[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("activities")
    .select("id, activity_type, activity_date, notes, contact_id, contacts(name), properties(address)")
    .eq("owner_id", user.id)
    .order("activity_date", { ascending: false })
    .limit(20);

  return (data ?? []).map((row) => ({
    id:               row.id,
    activity_type:    row.activity_type,
    activity_date:    row.activity_date,
    notes:            row.notes,
    contact_id:       row.contact_id,
    contact_name:     (row.contacts as unknown as { name: string | null } | null)?.name ?? null,
    property_address: (row.properties as unknown as { address: string | null } | null)?.address ?? null,
  }));
}

export async function getExpiringLeases(): Promise<{ items: ExpiringLease[]; total: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { items: [], total: 0 };

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const cutoff = new Date(now.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);

  const { data, count } = await supabase
    .from("lease_abstracts")
    .select("id, expiration_date, source_document, base_rate", { count: "exact" })
    .eq("owner_id", user.id)
    .not("expiration_date", "is", null)
    .gte("expiration_date", today)
    .lte("expiration_date", cutoff)
    .order("expiration_date", { ascending: true })
    .limit(6);

  const items = (data ?? []).map((row) => {
    const exp = new Date(row.expiration_date!).getTime();
    return {
      id:               row.id,
      expiration_date:  row.expiration_date!,
      source_document:  row.source_document,
      base_rate:        row.base_rate,
      daysUntilExpiry:  Math.ceil((exp - now.getTime()) / 86_400_000),
    };
  });

  return { items, total: count ?? items.length };
}

export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { totalSqft: 0, totalValue: 0, byType: [], bySubmarket: [], addedThisWeek: 0, recentProperties: [] };

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const { data } = await supabase
    .from("properties")
    .select("id, address, property_type, submarket, size_sqft, last_sale_price, created_at, ingested_at")
    .eq("owner_id", user.id)
    .order("ingested_at", { ascending: false });

  const rows = data ?? [];
  const totalSqft = rows.reduce((sum, r) => sum + (r.size_sqft ?? 0), 0);
  const totalValue = rows.reduce((sum, r) => sum + (Number(r.last_sale_price) || 0), 0);
  const addedThisWeek = rows.filter((r) => r.created_at && r.created_at >= weekAgo).length;

  const typeMap = new Map<string, { count: number; sqft: number }>();
  for (const r of rows) {
    const t = r.property_type?.trim() || "Other";
    const cur = typeMap.get(t) ?? { count: 0, sqft: 0 };
    typeMap.set(t, { count: cur.count + 1, sqft: cur.sqft + (r.size_sqft ?? 0) });
  }
  const byType = [...typeMap.entries()]
    .map(([type, v]) => ({ type, count: v.count, sqft: v.sqft }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const subMap = new Map<string, number>();
  for (const r of rows) {
    const s = r.submarket?.trim() || r.address?.split(",").pop()?.trim();
    if (!s) continue;
    subMap.set(s, (subMap.get(s) ?? 0) + 1);
  }
  const bySubmarket = [...subMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const recentProperties = rows.slice(0, 5).map((r) => ({
    id:            r.id,
    address:       r.address,
    property_type: r.property_type,
    size_sqft:     r.size_sqft,
    ingested_at:   r.ingested_at,
  }));

  return { totalSqft, totalValue, byType, bySubmarket, addedThisWeek, recentProperties };
}

export async function getCadenceHealth(): Promise<CadenceHealth> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { compliancePct: 100, onTrack: 0, overdue: 0, neverContacted: 0, tierBreakdown: [] };

  const { data } = await supabase
    .from("contacts")
    .select("contact_tier, last_contacted_at")
    .eq("owner_id", user.id)
    .not("contact_tier", "is", null);

  const contacts = data ?? [];
  let overdue = 0;
  let neverContacted = 0;
  let onTrack = 0;

  const tierStats = new Map<number, { overdue: number; total: number }>();
  for (const c of contacts) {
    const tier = c.contact_tier as number;
    const cur = tierStats.get(tier) ?? { overdue: 0, total: 0 };
    cur.total++;
    if (!c.last_contacted_at) {
      neverContacted++;
      cur.overdue++;
      overdue++;
    } else if (isContactOverdue(c)) {
      cur.overdue++;
      overdue++;
    } else {
      onTrack++;
    }
    tierStats.set(tier, cur);
  }

  const tierLabels: Record<number, string> = { 1: "Tier 1 · 14d", 2: "Tier 2 · 30d", 3: "Tier 3 · 90d" };
  const tierBreakdown = [1, 2, 3]
    .map((tier) => {
      const s = tierStats.get(tier) ?? { overdue: 0, total: 0 };
      return { tier, label: tierLabels[tier], overdue: s.overdue, total: s.total };
    })
    .filter((t) => t.total > 0);

  const compliancePct = contacts.length > 0
    ? Math.round((onTrack / contacts.length) * 100)
    : 100;

  return { compliancePct, onTrack, overdue, neverContacted, tierBreakdown };
}

export async function getDataHealth(): Promise<DataHealth> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ingestionErrors: 0, flaggedProperties: 0, totalProperties: 0 };

  const [{ count: errorCount }, { data: props }] = await Promise.all([
    supabase.from("ingestion_errors").select("*", { count: "exact", head: true }).eq("owner_id", user.id),
    supabase.from("properties").select("address, owner_name, confidence_flags").eq("owner_id", user.id),
  ]);

  const properties = props ?? [];
  const flaggedProperties = properties.filter((p) =>
    isFlaggedProperty({
      address: p.address,
      owner_name: p.owner_name,
      confidence_flags: p.confidence_flags as { field: string; reason: string }[] | null,
    })
  ).length;

  return { ingestionErrors: errorCount ?? 0, flaggedProperties, totalProperties: properties.length };
}

export async function getActivitiesThisWeek(): Promise<number> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { count } = await supabase
    .from("activities")
    .select("*", { count: "exact", head: true })
    .eq("owner_id", user.id)
    .gte("activity_date", weekAgo);

  return count ?? 0;
}

export async function getBriefingMetrics(
  overdueOutreach: number,
  dueTodayOutreach: number,
  followUpsOverdue: number,
  followUpsToday: number,
): Promise<BriefingMetrics> {
  const [expiring, activitiesThisWeek, dataHealth] = await Promise.all([
    getExpiringLeases(),
    getActivitiesThisWeek(),
    getDataHealth(),
  ]);

  const actionItems =
    overdueOutreach + followUpsOverdue + expiring.total + dataHealth.ingestionErrors + dataHealth.flaggedProperties;

  return {
    overdueOutreach,
    dueTodayOutreach,
    followUpsOverdue,
    followUpsToday,
    expiringLeases:    expiring.total,
    activitiesThisWeek,
    dataIssues:        dataHealth.ingestionErrors + dataHealth.flaggedProperties,
    actionItems,
  };
}
