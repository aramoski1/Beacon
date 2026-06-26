"use server";

import { createClient } from "@/lib/supabase/server";
import {
  daysUntilExpiry,
  leaseRadarBucket,
  leaseRadarUrgency,
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
