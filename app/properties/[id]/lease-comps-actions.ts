"use server";

import { createClient } from "@/lib/supabase/server";
import {
  leaseCompsEmptyCopy,
  selectLeaseComps,
  type LeaseComp,
  type LeaseCompCandidate,
} from "@/lib/lease-comps";

export type LeaseCompsActionResult =
  | { comps: LeaseComp[]; note: string }
  | { error: string; empty?: true };

export async function getLeaseCompsForProperty(propertyId: string): Promise<LeaseCompsActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: subject, error: subErr } = await supabase
    .from("properties")
    .select("id, submarket, property_type, size_sqft")
    .eq("owner_id", user.id)
    .eq("id", propertyId)
    .maybeSingle();

  if (subErr || !subject) return { error: "Property not found." };

  // Load abstracts with linked property banding attrs (book-wide, capped)
  const { data: leases, error: leaseErr } = await supabase
    .from("lease_abstracts")
    .select("id, linked_property, base_rate, term, expiration_date, properties(id, address, submarket, property_type, size_sqft)")
    .eq("owner_id", user.id)
    .not("linked_property", "is", null)
    .not("base_rate", "is", null)
    .limit(500);

  if (leaseErr) return { error: leaseErr.message };

  const candidates: LeaseCompCandidate[] = [];
  for (const row of leases ?? []) {
    const raw = row.properties as
      | {
          id: string;
          address: string | null;
          submarket: string | null;
          property_type: string | null;
          size_sqft: number | null;
        }
      | {
          id: string;
          address: string | null;
          submarket: string | null;
          property_type: string | null;
          size_sqft: number | null;
        }[]
      | null;
    const prop = Array.isArray(raw) ? raw[0] ?? null : raw;
    if (!prop || !row.linked_property) continue;
    const rate = row.base_rate != null ? Number(row.base_rate) : null;
    candidates.push({
      leaseId: row.id,
      propertyId: prop.id,
      address: prop.address,
      submarket: prop.submarket,
      propertyType: prop.property_type,
      sizeSqft: prop.size_sqft != null ? Number(prop.size_sqft) : null,
      baseRate: rate != null && !Number.isNaN(rate) ? rate : null,
      term: row.term,
      expirationDate: row.expiration_date,
      isSubjectProperty: prop.id === propertyId,
    });
  }

  const comps = selectLeaseComps(candidates, {
    subjectSubmarket: subject.submarket,
    subjectType: subject.property_type,
    subjectSqft: subject.size_sqft != null ? Number(subject.size_sqft) : null,
    sfTolerance: 0.35,
  });

  if (comps.length === 0) {
    return {
      error: leaseCompsEmptyCopy(candidates.length > 0),
      empty: true,
    };
  }

  return {
    comps,
    note: "From your linked lease abstracts in similar submarket / type / SF — not CoStar.",
  };
}
