"use server";

import { createClient } from "@/lib/supabase/server";
import { loadContactsByPropertyMap } from "@/lib/contact-properties";
import { nearestNoticeDeadline } from "@/lib/lease-export";
import {
  daysUntilExpiry,
  leaseRadarBucket,
  leaseRadarUrgency,
  preferOwnerContactCandidate,
  type LeaseRadarBucket,
  type LeaseRadarData,
  type LeaseRadarEntry,
  type RadarContactRef,
} from "@/lib/lease-radar";
import { addCalendarDays, todayLocal } from "@/lib/dates";

function toContactRef(c: {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
}): RadarContactRef {
  return { id: c.id, name: c.name, email: c.email, company: c.company };
}

export async function getLeaseRadarData(): Promise<LeaseRadarData> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      within3: [], within6: [], within12: [],
      counts: { within3: 0, within6: 0, within12: 0, total: 0 },
      urgentCount: 0,
    };
  }

  const now = new Date();
  const today = todayLocal();
  const cutoff12 = addCalendarDays(today, 365);

  const [{ data: leases }, { data: contacts }] = await Promise.all([
    supabase
      .from("lease_abstracts")
      .select(
        "id, expiration_date, source_document, base_rate, term, leased_sf, options, linked_property, tenant_contact_id, properties(id, address, owner_name, submarket)",
      )
      .eq("owner_id", user.id)
      .not("expiration_date", "is", null)
      .gte("expiration_date", today)
      .lte("expiration_date", cutoff12)
      .order("expiration_date", { ascending: true }),
    supabase
      .from("contacts")
      .select("id, name, email, company, contact_tier, contact_type, linked_properties")
      .eq("owner_id", user.id),
  ]);

  type Ranked = RadarContactRef & { tier: number; isOwnerType: boolean };
  const ownerByProperty = new Map<string, Ranked>();
  const contactById = new Map<string, RadarContactRef>();

  for (const c of contacts ?? []) {
    contactById.set(c.id, toContactRef(c));
  }

  const propToContactIds = await loadContactsByPropertyMap(
    supabase,
    user.id,
    contacts ?? [],
  );

  for (const [pid, cids] of propToContactIds) {
    for (const cid of cids) {
      const c = (contacts ?? []).find((row) => row.id === cid);
      if (!c) continue;
      const tier = c.contact_tier ?? 99;
      const isOwnerType = c.contact_type === "owner";
      const candidate = { ...toContactRef(c), tier, isOwnerType };
      const existing = ownerByProperty.get(pid);
      if (preferOwnerContactCandidate(existing, candidate)) {
        ownerByProperty.set(pid, candidate);
      }
    }
  }

  const within3: LeaseRadarEntry[] = [];
  const within6: LeaseRadarEntry[] = [];
  const within12: LeaseRadarEntry[] = [];

  for (const row of leases ?? []) {
    const days = daysUntilExpiry(row.expiration_date!, now);
    const bucket = leaseRadarBucket(days);
    if (!bucket) continue;

    const prop = row.properties as unknown as {
      id: string;
      address: string | null;
      owner_name: string | null;
      submarket: string | null;
    } | null;
    const propertyId = (row.linked_property as string | null) ?? prop?.id ?? null;
    const linked = propertyId ? ownerByProperty.get(propertyId) : undefined;
    const tenantId = row.tenant_contact_id as string | null;
    const notice = nearestNoticeDeadline(row.expiration_date, row.options, today);

    const entry: LeaseRadarEntry = {
      id: row.id,
      expiration_date: row.expiration_date!,
      source_document: row.source_document,
      base_rate: row.base_rate,
      term: row.term,
      daysUntilExpiry: days,
      bucket,
      urgency: leaseRadarUrgency(notice?.daysUntil != null && notice.daysUntil < days ? notice.daysUntil : days),
      leased_sf: row.leased_sf != null ? Number(row.leased_sf) : null,
      property_submarket: prop?.submarket ?? null,
      property_id: propertyId,
      property_address: prop?.address ?? null,
      property_owner_name: prop?.owner_name ?? null,
      owner_contact: linked
        ? { id: linked.id, name: linked.name, email: linked.email, company: linked.company }
        : null,
      tenant_contact: tenantId ? (contactById.get(tenantId) ?? null) : null,
      notice_deadline: notice?.date ?? null,
      daysUntilNotice: notice?.daysUntil ?? null,
      notice_label: notice?.label ?? null,
    };

    if (bucket === "3mo") within3.push(entry);
    else if (bucket === "6mo") within6.push(entry);
    else within12.push(entry);
  }

  return {
    within3,
    within6,
    within12,
    counts: {
      within3: within3.length,
      within6: within6.length,
      within12: within12.length,
      total: within3.length + within6.length + within12.length,
    },
    urgentCount: within3.length,
  };
}

/** Count for nav badge — leases expiring within 90 days. */
export async function getLeaseRadarUrgentCount(): Promise<number> {
  const data = await getLeaseRadarData();
  return data.urgentCount;
}

// Days until a follow-up is due, by bucket urgency.
const BUCKET_DUE_OFFSET: Record<LeaseRadarBucket, number> = {
  "3mo":  0,   // due today — act now
  "6mo":  7,   // due in a week
  "12mo": 30,  // due in a month
};

function followUpDueDate(bucket: LeaseRadarBucket): string {
  return addCalendarDays(todayLocal(), BUCKET_DUE_OFFSET[bucket]);
}

function followUpDescription(
  bucket: LeaseRadarBucket,
  address: string | null,
  role: "owner" | "tenant",
): string {
  const loc = address ? ` at ${address}` : "";
  const bucketLabel =
    bucket === "3mo" ? "within 3 months" : bucket === "6mo" ? "within 6 months" : "within 12 months";
  if (role === "owner") {
    return `Lease expiry (${bucketLabel})${loc} — owner renewal / vacancy strategy`;
  }
  return `Lease rollover (${bucketLabel})${loc} — reach out to tenant`;
}

/**
 * Creates follow-ups aligned to action type:
 * - tenant_contact → tenant rollover task
 * - owner CRM contact on property → owner renewal/vacancy task
 * Idempotent via unique index on (owner_id, lease_id, lease_bucket, contact_id).
 */
export async function syncLeaseFollowUps(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const now = new Date();
  const today = todayLocal();
  const cutoff12 = addCalendarDays(today, 365);

  const [{ data: leases }, { data: contactRows }] = await Promise.all([
    supabase
      .from("lease_abstracts")
      .select("id, expiration_date, linked_property, tenant_contact_id, properties(id, address)")
      .eq("owner_id", user.id)
      .not("expiration_date", "is", null)
      .gte("expiration_date", today)
      .lte("expiration_date", cutoff12),
    supabase
      .from("contacts")
      .select("id, linked_properties, contact_type, contact_tier")
      .eq("owner_id", user.id),
  ]);

  if (!leases || leases.length === 0) return;

  const ownerByProperty = new Map<string, { id: string; tier: number; isOwnerType: boolean }>();
  const propToContactIds = await loadContactsByPropertyMap(
    supabase,
    user.id,
    contactRows ?? [],
  );
  for (const [pid, cids] of propToContactIds) {
    for (const cid of cids) {
      const c = (contactRows ?? []).find((row) => row.id === cid);
      if (!c) continue;
      const tier = (c.contact_tier as number | null) ?? 99;
      const isOwnerType = c.contact_type === "owner";
      const candidate = { id: c.id, tier, isOwnerType };
      const existing = ownerByProperty.get(pid);
      if (preferOwnerContactCandidate(existing, candidate)) {
        ownerByProperty.set(pid, candidate);
      }
    }
  }

  type FollowUpCandidate = {
    lease_id: string;
    bucket: LeaseRadarBucket;
    contact_id: string;
    property_id: string | null;
    address: string | null;
    role: "owner" | "tenant";
  };

  const candidates: FollowUpCandidate[] = [];

  for (const row of leases) {
    const days = daysUntilExpiry(row.expiration_date!, now);
    const bucket = leaseRadarBucket(days);
    if (!bucket) continue;

    const prop = row.properties as unknown as { id: string; address: string | null } | null;
    const propertyId = (row.linked_property as string | null) ?? prop?.id ?? null;
    const address = prop?.address ?? null;

    const tenantContactId = row.tenant_contact_id as string | null;
    const ownerContact = propertyId ? ownerByProperty.get(propertyId) : undefined;
    if (ownerContact && ownerContact.id !== tenantContactId) {
      candidates.push({
        lease_id: row.id,
        bucket,
        contact_id: ownerContact.id,
        property_id: propertyId,
        address,
        role: "owner",
      });
    }
    if (tenantContactId) {
      candidates.push({
        lease_id: row.id,
        bucket,
        contact_id: tenantContactId,
        property_id: propertyId,
        address,
        role: "tenant",
      });
    }
  }

  if (candidates.length === 0) return;

  const { data: existing } = await supabase
    .from("follow_ups")
    .select("lease_id, lease_bucket, contact_id")
    .eq("owner_id", user.id)
    .eq("source_type", "lease_expiry")
    .not("lease_id", "is", null);

  const existingKeys = new Set(
    (existing ?? []).map((r) => `${r.lease_id}|${r.contact_id}`),
  );

  const toCreate = candidates.filter(
    (c) => !existingKeys.has(`${c.lease_id}|${c.contact_id}`),
  );

  if (toCreate.length === 0) return;

  await supabase.from("follow_ups").insert(
    toCreate.map((c) => ({
      owner_id: user.id,
      contact_id: c.contact_id,
      property_id: c.property_id,
      due_date: followUpDueDate(c.bucket),
      description: followUpDescription(c.bucket, c.address, c.role),
      source_type: "lease_expiry",
      lease_id: c.lease_id,
      lease_bucket: c.bucket,
    })),
  );
}
