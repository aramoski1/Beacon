"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withAction } from "@/lib/logger";
import { getUserSettings } from "@/app/settings/actions";
import { cadenceMapFromSettings } from "@/lib/cadence";
import {
  resolveVisible,
  sanitizeVisiblePatch,
  type DashboardLayoutPrefs,
} from "@/lib/dashboard-layout";
import { todayLocal } from "@/lib/dates";
import { propertyIdsByContactIds } from "@/lib/contact-properties";
import {
  collectOwnerLinkedPropertyIds,
  pickUnworkedOpportunities,
} from "@/lib/unworked-opportunities";

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

export type OwnershipChangedProperty = {
  id: string;
  address: string | null;
  previous_owner: string | null;
  new_owner: string | null;
  detected_at: string;
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

  const { data: cached } = await supabase
    .from("dashboard_kpi_cache")
    .select("payload, computed_at")
    .eq("owner_id", user.id)
    .maybeSingle();
  const ageMs = cached?.computed_at ? Date.now() - new Date(cached.computed_at).getTime() : Infinity;
  if (cached?.payload && ageMs < 5 * 60 * 1000) {
    return cached.payload as DashboardStats;
  }

  const today = todayLocal();

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

  const stats: DashboardStats = {
    properties:   propCount ?? 0,
    contacts:     contactCount ?? 0,
    leases:       leaseCount ?? 0,
    errors:       errorCount ?? 0,
    followUpsDue: followUpsDueCount ?? 0,
  };

  await supabase.from("dashboard_kpi_cache").upsert({
    owner_id: user.id,
    payload: stats,
    computed_at: new Date().toISOString(),
  });

  return stats;
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

export async function getUnworkedOpportunities(limit = 8): Promise<UnworkedOpportunity[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const [{ data: props }, { data: ownerContacts }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, address, owner_name, owner_contact_name, owner_contacts, ingested_at")
      .eq("owner_id", user.id)
      .not("owner_name", "is", null)
      .order("ingested_at", { ascending: false })
      .limit(200),
    supabase
      .from("contacts")
      .select("id, linked_properties")
      .eq("owner_id", user.id)
      .or("contact_type.eq.owner,contact_type.is.null"),
  ]);

  const owners = ownerContacts ?? [];
  let joinByContact = new Map<string, string[]>();
  try {
    joinByContact = await propertyIdsByContactIds(
      supabase,
      user.id,
      owners.map((c) => c.id),
    );
  } catch {
    joinByContact = new Map();
  }

  return pickUnworkedOpportunities(
    props ?? [],
    collectOwnerLinkedPropertyIds(owners, joinByContact),
    limit,
  );
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

// ─── Dashboard layout (show/hide customization) ───────────────────────────────

/** Raw prefs for this user, or null if never set — pass through resolveVisible
 * (lib/dashboard-layout.ts) to get a complete visibility map; do not read
 * .visible directly, since missing keys must resolve to true. */
export async function getDashboardLayout(): Promise<DashboardLayoutPrefs | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("user_settings")
    .select("dashboard_layout")
    .eq("owner_id", user.id)
    .maybeSingle();

  return (data?.dashboard_layout as DashboardLayoutPrefs | null) ?? null;
}

/** Merges a {moduleId: boolean} patch into the stored prefs and persists it.
 * Validated against the module catalog — an unknown id or non-boolean value
 * is rejected outright rather than silently dropped. */
export async function saveDashboardLayout(
  patch: Record<string, unknown>,
): Promise<{ ok: true } | { error: string }> {
  return withAction("saveDashboardLayout", async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated." };

    const sanitized = sanitizeVisiblePatch(patch);
    if (!sanitized.ok) return { error: sanitized.error };

    // Persist the full resolved map (missing keys stay visible) so Save matches
    // the checkboxes the broker just set — not a stale merge with an old row.
    const merged: DashboardLayoutPrefs = {
      version: 1,
      visible: resolveVisible({ version: 1, visible: sanitized.visible }),
    };

    const { data: existing } = await supabase
      .from("user_settings")
      .select("id")
      .eq("owner_id", user.id)
      .maybeSingle();

    const { error } = existing
      ? await supabase
          .from("user_settings")
          .update({ dashboard_layout: merged, updated_at: new Date().toISOString() })
          .eq("owner_id", user.id)
      : await supabase
          .from("user_settings")
          .insert({ owner_id: user.id, dashboard_layout: merged });

    if (error) return { error: error.message };
    revalidatePath("/dashboard");
    return { ok: true };
  });
}

/** Clears the column entirely — null resolves to all-visible via
 * resolveVisible, same as an account that never touched Customize. */
export async function resetDashboardLayout(): Promise<{ ok: true } | { error: string }> {
  return withAction("resetDashboardLayout", async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated." };

    const { error } = await supabase
      .from("user_settings")
      .update({ dashboard_layout: null, updated_at: new Date().toISOString() })
      .eq("owner_id", user.id);

    if (error) return { error: error.message };
    revalidatePath("/dashboard");
    return { ok: true };
  });
}
