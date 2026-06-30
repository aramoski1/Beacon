"use server";

import { createClient } from "@/lib/supabase/server";
import {
  daysUntilExpiry,
  leaseRadarBucket,
  leaseRadarUrgency,
  type LeaseRadarBucket,
  type LeaseRadarData,
  type LeaseRadarEntry,
} from "@/lib/lease-radar";

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
  const today = now.toISOString().slice(0, 10);
  const cutoff12 = new Date(now.getTime() + 365 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: leases }, { data: contacts }] = await Promise.all([
    supabase
      .from("lease_abstracts")
      .select("id, expiration_date, source_document, base_rate, term, linked_property, properties(id, address, owner_name)")
      .eq("owner_id", user.id)
      .not("expiration_date", "is", null)
      .gte("expiration_date", today)
      .lte("expiration_date", cutoff12)
      .order("expiration_date", { ascending: true }),
    supabase
      .from("contacts")
      .select("id, name, email, company, contact_tier, linked_properties")
      .eq("owner_id", user.id),
  ]);

  /** First linked contact per property — prefer Tier 1, then earliest in list. */
  const contactByProperty = new Map<string, LeaseRadarEntry["owner_contact"] & { tier: number }>();
  for (const c of contacts ?? []) {
    const tier = c.contact_tier ?? 99;
    for (const pid of c.linked_properties ?? []) {
      const existing = contactByProperty.get(pid);
      if (!existing || tier < existing.tier) {
        contactByProperty.set(pid, {
          id: c.id,
          name: c.name,
          email: c.email,
          company: c.company,
          tier,
        });
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
    } | null;
    const propertyId = (row.linked_property as string | null) ?? prop?.id ?? null;
    const linked = propertyId ? contactByProperty.get(propertyId) : undefined;

    const entry: LeaseRadarEntry = {
      id: row.id,
      expiration_date: row.expiration_date!,
      source_document: row.source_document,
      base_rate: row.base_rate,
      term: row.term,
      daysUntilExpiry: days,
      bucket,
      urgency: leaseRadarUrgency(days),
      property_id: propertyId,
      property_address: prop?.address ?? null,
      property_owner_name: prop?.owner_name ?? null,
      owner_contact: linked
        ? { id: linked.id, name: linked.name, email: linked.email, company: linked.company }
        : null,
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
  const d = new Date();
  d.setDate(d.getDate() + BUCKET_DUE_OFFSET[bucket]);
  return d.toISOString().slice(0, 10);
}

function followUpDescription(bucket: LeaseRadarBucket, address: string | null, role: "owner" | "tenant"): string {
  const loc = address ? ` at ${address}` : "";
  const bucketLabel = bucket === "3mo" ? "within 3 months" : bucket === "6mo" ? "within 6 months" : "within 12 months";
  if (role === "owner") return `Lease rollover (${bucketLabel})${loc} — contact owner`;
  return `Lease rollover (${bucketLabel})${loc} — reach out to tenant`;
}

/**
 * Creates follow-ups for owner and tenant contacts on leases approaching expiration.
 * Called on every lease-radar page load; idempotent via unique index on
 * (owner_id, lease_id, lease_bucket, contact_id).
 */
export async function syncLeaseFollowUps(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const cutoff12 = new Date(now.getTime() + 365 * 86_400_000).toISOString().slice(0, 10);

  // Fetch leases expiring within 12 months, with tenant contact
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

  // Build propertyId → best owner contact map (prefer owner type, then lowest tier)
  const ownerByProperty = new Map<string, { id: string; tier: number }>();
  for (const c of contactRows ?? []) {
    const tier = (c.contact_tier as number | null) ?? 99;
    const isOwnerType = c.contact_type === "owner";
    for (const pid of (c.linked_properties as string[] | null) ?? []) {
      const existing = ownerByProperty.get(pid);
      if (!existing || (isOwnerType && c.contact_type !== "owner") || tier < existing.tier) {
        ownerByProperty.set(pid, { id: c.id, tier });
      }
    }
  }

  // Collect all (lease, bucket, contact) pairs that need a follow-up
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

    // Owner contact
    const ownerContact = propertyId ? ownerByProperty.get(propertyId) : undefined;
    if (ownerContact) {
      candidates.push({ lease_id: row.id, bucket, contact_id: ownerContact.id, property_id: propertyId, address, role: "owner" });
    }

    // Tenant contact
    const tenantContactId = row.tenant_contact_id as string | null;
    if (tenantContactId) {
      candidates.push({ lease_id: row.id, bucket, contact_id: tenantContactId, property_id: propertyId, address, role: "tenant" });
    }
  }

  if (candidates.length === 0) return;

  // Fetch existing lease-triggered follow-ups to skip duplicates
  const { data: existing } = await supabase
    .from("follow_ups")
    .select("lease_id, lease_bucket, contact_id")
    .eq("owner_id", user.id)
    .eq("source_type", "lease_expiry")
    .not("lease_id", "is", null);

  const existingSet = new Set(
    (existing ?? []).map((r) => `${r.lease_id}|${r.lease_bucket}|${r.contact_id}`)
  );

  const toCreate = candidates.filter(
    (c) => !existingSet.has(`${c.lease_id}|${c.bucket}|${c.contact_id}`)
  );

  if (toCreate.length === 0) return;

  await supabase.from("follow_ups").insert(
    toCreate.map((c) => ({
      owner_id:     user.id,
      contact_id:   c.contact_id,
      property_id:  c.property_id,
      due_date:     followUpDueDate(c.bucket),
      description:  followUpDescription(c.bucket, c.address, c.role),
      source_type:  "lease_expiry",
      lease_id:     c.lease_id,
      lease_bucket: c.bucket,
    }))
  );
}
