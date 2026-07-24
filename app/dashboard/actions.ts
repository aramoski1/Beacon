"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserSettings } from "@/app/settings/actions";
import { cadenceMapFromSettings } from "@/lib/cadence";

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
  property_id: string | null;
  property_address: string | null;
};


export type UnworkedOpportunity = {
  id: string;
  address: string | null;
  owner_name: string | null;
  owner_contact_name: string | null;
  ingested_at: string | null;
};

export type ColdTier1Contact = {
  id: string;
  name: string | null;
  company: string | null;
  daysOverdue: number;
  property_id: string | null;
  property_address: string | null;
};

export type WeekMomentum = {
  propertiesAdded: number;
  contactsAdded: number;
  touchpoints: number;
  followUpsCompleted: number;
  outreachSent: number;
};

export type DashboardDelta = {
  propertiesAdded: number;
  contactsAdded: number;
  followUpsCompleted: number;
  activities: RecentActivity[];
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

export type StaleTier1Owner = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  daysSince: number;
  property_id: string | null;
  property_address: string | null;
};

export type OwnershipChangedProperty = {
  id: string;
  address: string | null;
  previous_owner: string | null;
  new_owner: string | null;
  detected_at: string;
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
  unworkedOpportunities: number;
  coldTier1: number;
  ownershipChanges: number;
};

export type CadenceHealth = {
  compliancePct: number;
  onTrack: number;
  overdue: number;
  neverContacted: number;
  tierBreakdown: { tier: number; label: string; overdue: number; total: number }[];
};

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

function isContactOverdue(
  c: { contact_tier: number | null; last_contacted_at: string | null },
  cadence: Record<number, number>
): boolean {
  if (!c.contact_tier) return false;
  const threshold = cadence[c.contact_tier] ?? 90;
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
    .select("id, activity_type, activity_date, notes, contact_id, property_id, contacts(name), properties(address)")
    .eq("owner_id", user.id)
    .order("activity_date", { ascending: false })
    .limit(15);

  return (data ?? []).map((row) => ({
    id:               row.id,
    activity_type:    row.activity_type,
    activity_date:    row.activity_date,
    notes:            row.notes,
    contact_id:       row.contact_id,
    contact_name:     (row.contacts as unknown as { name: string | null } | null)?.name ?? null,
    property_id:      row.property_id,
    property_address: (row.properties as unknown as { address: string | null } | null)?.address ?? null,
  }));
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

  const [{ data }, settings] = await Promise.all([
    supabase
      .from("contacts")
      .select("contact_tier, last_contacted_at")
      .eq("owner_id", user.id)
      .not("contact_tier", "is", null),
    getUserSettings(),
  ]);

  const cadence = cadenceMapFromSettings(settings);

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
    } else if (isContactOverdue(c, cadence)) {
      cur.overdue++;
      overdue++;
    } else {
      onTrack++;
    }
    tierStats.set(tier, cur);
  }

  const tierLabels: Record<number, string> = {
    1: `Tier 1 · ${cadence[1]}d`,
    2: `Tier 2 · ${cadence[2]}d`,
    3: `Tier 3 · ${cadence[3]}d`,
  };
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

function firstOwnerContactName(ownerContacts: unknown): string | null {
  if (!Array.isArray(ownerContacts) || ownerContacts.length === 0) return null;
  const first = ownerContacts[0] as { name?: string };
  return first?.name?.trim() || null;
}

export async function getUnworkedOpportunities(limit = 8): Promise<UnworkedOpportunity[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const [{ data: props }, { data: contacts }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, address, owner_name, owner_contacts, ingested_at")
      .eq("owner_id", user.id)
      .not("owner_name", "is", null)
      .order("ingested_at", { ascending: false })
      .limit(200),
    supabase.from("contacts").select("linked_properties").eq("owner_id", user.id),
  ]);

  const linked = new Set<string>();
  for (const c of contacts ?? []) {
    for (const pid of c.linked_properties ?? []) linked.add(pid);
  }

  return (props ?? [])
    .filter((p) => p.owner_name?.trim() && !linked.has(p.id))
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      address: p.address,
      owner_name: p.owner_name,
      owner_contact_name: firstOwnerContactName(p.owner_contacts),
      ingested_at: p.ingested_at,
    }));
}

export async function getColdTier1Contacts(limit = 6): Promise<ColdTier1Contact[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const [{ data: contacts }, settings] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, name, company, contact_tier, last_contacted_at, linked_properties")
      .eq("owner_id", user.id)
      .eq("contact_tier", 1),
    getUserSettings(),
  ]);

  const cold = (contacts ?? [])
    .map((c) => {
      const threshold = settings.cadence_tier1_days;
      let daysOverdue = threshold;
      if (c.last_contacted_at) {
        const daysSince = Math.floor(
          (Date.now() - new Date(c.last_contacted_at).getTime()) / 86_400_000,
        );
        daysOverdue = daysSince - threshold;
      }
      return { ...c, daysOverdue, linked_properties: c.linked_properties ?? [] };
    })
    .filter((c) => c.daysOverdue >= 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, limit);

  const propIds = [...new Set(cold.flatMap((c) => c.linked_properties).slice(0, limit * 2))];
  const propMap = new Map<string, string | null>();
  if (propIds.length > 0) {
    const { data: props } = await supabase
      .from("properties")
      .select("id, address")
      .in("id", propIds);
    for (const p of props ?? []) propMap.set(p.id, p.address);
  }

  return cold.map((c) => {
    const pid = c.linked_properties[0] ?? null;
    return {
      id: c.id,
      name: c.name,
      company: c.company,
      daysOverdue: c.daysOverdue,
      property_id: pid,
      property_address: pid ? propMap.get(pid) ?? null : null,
    };
  });
}

export async function getWeekMomentum(): Promise<WeekMomentum> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { propertiesAdded: 0, contactsAdded: 0, touchpoints: 0, followUpsCompleted: 0, outreachSent: 0 };
  }

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [
    { count: propertiesAdded },
    { count: contactsAdded },
    { count: touchpoints },
    { count: followUpsCompleted },
    { count: outreachSent },
  ] = await Promise.all([
    supabase.from("properties").select("*", { count: "exact", head: true }).eq("owner_id", user.id).gte("created_at", weekAgo),
    supabase.from("contacts").select("*", { count: "exact", head: true }).eq("owner_id", user.id).gte("created_at", weekAgo),
    supabase.from("activities").select("*", { count: "exact", head: true }).eq("owner_id", user.id).gte("activity_date", weekAgo),
    supabase.from("follow_ups").select("*", { count: "exact", head: true }).eq("owner_id", user.id).eq("done", true).gte("done_at", weekAgo),
    supabase.from("activities").select("*", { count: "exact", head: true }).eq("owner_id", user.id).eq("activity_type", "email").gte("activity_date", weekAgo),
  ]);

  return {
    propertiesAdded: propertiesAdded ?? 0,
    contactsAdded: contactsAdded ?? 0,
    touchpoints: touchpoints ?? 0,
    followUpsCompleted: followUpsCompleted ?? 0,
    outreachSent: outreachSent ?? 0,
  };
}

export async function getDashboardDelta(sinceIso: string): Promise<DashboardDelta> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { propertiesAdded: 0, contactsAdded: 0, followUpsCompleted: 0, activities: [] };
  }

  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) {
    return { propertiesAdded: 0, contactsAdded: 0, followUpsCompleted: 0, activities: [] };
  }
  const sinceStr = since.toISOString();

  const [
    { count: propertiesAdded },
    { count: contactsAdded },
    { count: followUpsCompleted },
    { data: activityRows },
  ] = await Promise.all([
    supabase.from("properties").select("*", { count: "exact", head: true }).eq("owner_id", user.id).gte("created_at", sinceStr),
    supabase.from("contacts").select("*", { count: "exact", head: true }).eq("owner_id", user.id).gte("created_at", sinceStr),
    supabase.from("follow_ups").select("*", { count: "exact", head: true }).eq("owner_id", user.id).eq("done", true).gte("done_at", sinceStr),
    supabase
      .from("activities")
      .select("id, activity_type, activity_date, notes, contact_id, property_id, contacts(name), properties(address)")
      .eq("owner_id", user.id)
      .gte("activity_date", sinceStr)
      .order("activity_date", { ascending: false })
      .limit(6),
  ]);

  const activities = (activityRows ?? []).map((row) => ({
    id: row.id,
    activity_type: row.activity_type,
    activity_date: row.activity_date,
    notes: row.notes,
    contact_id: row.contact_id,
    contact_name: (row.contacts as unknown as { name: string | null } | null)?.name ?? null,
    property_id: row.property_id,
    property_address: (row.properties as unknown as { address: string | null } | null)?.address ?? null,
  }));

  return {
    propertiesAdded: propertiesAdded ?? 0,
    contactsAdded: contactsAdded ?? 0,
    followUpsCompleted: followUpsCompleted ?? 0,
    activities,
  };
}

export async function getStaleTier1Owners(limit = 6): Promise<StaleTier1Owner[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, name, email, company, contact_tier, contact_type, last_contacted_at, linked_properties")
    .eq("owner_id", user.id)
    .eq("contact_tier", 1)
    .eq("contact_type", "owner")
    .or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoff}`);

  const sorted = (contacts ?? [])
    .map((c) => {
      const daysSince = c.last_contacted_at
        ? Math.floor((Date.now() - new Date(c.last_contacted_at as string).getTime()) / 86_400_000)
        : 999;
      return { ...c, daysSince };
    })
    .sort((a, b) => b.daysSince - a.daysSince)
    .slice(0, limit);

  const propIds = [...new Set(sorted.flatMap((c) => (c.linked_properties as string[] | null) ?? []).slice(0, limit * 2))];
  const propMap = new Map<string, string | null>();
  if (propIds.length > 0) {
    const { data: props } = await supabase.from("properties").select("id, address").in("id", propIds);
    for (const p of props ?? []) propMap.set(p.id, p.address);
  }

  return sorted.map((c) => {
    const pid = ((c.linked_properties as string[] | null) ?? [])[0] ?? null;
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      company: c.company,
      daysSince: c.daysSince,
      property_id: pid,
      property_address: pid ? propMap.get(pid) ?? null : null,
    };
  });
}

export async function getOwnershipWatchStats(): Promise<{
  enrolledCount: number;
  everChecked: boolean;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { enrolledCount: 0, everChecked: false };

  const { count: enrolledCount } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id)
    .not("ownership_watch_enrolled_at", "is", null);

  const { count: checkedCount } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id)
    .not("ownership_last_checked_at", "is", null);

  return {
    enrolledCount: enrolledCount ?? 0,
    everChecked: (checkedCount ?? 0) > 0,
  };
}

export async function getOwnershipChangedProperties(): Promise<OwnershipChangedProperty[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("properties")
    .select("id, address, ownership_change_detected_at, ownership_change_data")
    .eq("owner_id", user.id)
    .not("ownership_change_detected_at", "is", null)
    .order("ownership_change_detected_at", { ascending: false })
    .limit(10);

  return (data ?? []).map((row) => {
    const d = row.ownership_change_data as { previous_owner?: string | null; new_owner?: string | null } | null;
    return {
      id:             row.id,
      address:        row.address,
      previous_owner: d?.previous_owner ?? null,
      new_owner:      d?.new_owner ?? null,
      detected_at:    row.ownership_change_detected_at as string,
    };
  });
}

export async function getBriefingMetrics(
  overdueOutreach: number,
  dueTodayOutreach: number,
  followUpsOverdue: number,
  followUpsToday: number,
  expiringLeasesCount: number,
  ownershipChangesCount: number,
): Promise<BriefingMetrics> {
  const [activitiesThisWeek, dataHealth, unworked, coldTier1] = await Promise.all([
    getActivitiesThisWeek(),
    getDataHealth(),
    getUnworkedOpportunities(20),
    getColdTier1Contacts(20),
  ]);

  const actionItems =
    overdueOutreach + followUpsOverdue + expiringLeasesCount + dataHealth.ingestionErrors + dataHealth.flaggedProperties
    + unworked.length + coldTier1.length + ownershipChangesCount;

  return {
    overdueOutreach,
    dueTodayOutreach,
    followUpsOverdue,
    followUpsToday,
    expiringLeases:        expiringLeasesCount,
    activitiesThisWeek,
    dataIssues:            dataHealth.ingestionErrors + dataHealth.flaggedProperties,
    actionItems,
    unworkedOpportunities: unworked.length,
    coldTier1:             coldTier1.length,
    ownershipChanges:      ownershipChangesCount,
  };
}
