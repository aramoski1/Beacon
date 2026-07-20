import { createClient } from "@/lib/supabase/server";
import type { PropertySearchFilters, SearchResult } from "@/app/crm/actions";
import {
  applyPropertyFilters,
  applyContactFilters,
  applyLeaseFilters,
  type SmartListCounts,
} from "@/lib/crm-search-filters";
import { contactIdsForProperties } from "@/lib/contact-properties";

async function fetchMatchingPropertyIds(
  filters: PropertySearchFilters,
  ownerId: string,
): Promise<string[]> {
  const supabase = await createClient();
  let q = supabase.from("properties").select("id").eq("owner_id", ownerId);
  q = applyPropertyFilters(q, filters);
  const { data } = await q;
  return (data ?? []).map((r: { id: string }) => r.id);
}

export async function countSmartListMatches(
  search: SearchResult,
  ownerId: string,
): Promise<SmartListCounts> {
  const supabase = await createClient();
  const propertyIds =
    search.properties && (search.target === "both" || search.target === "properties")
      ? await fetchMatchingPropertyIds(search.properties, ownerId)
      : null;

  let propCount = 0;
  if (search.properties && (search.target === "properties" || search.target === "both")) {
    let pq = supabase.from("properties").select("*", { count: "exact", head: true }).eq("owner_id", ownerId);
    pq = applyPropertyFilters(pq, search.properties);
    const { count } = await pq;
    propCount = count ?? 0;
  }

  let contactCount = 0;
  if (search.contacts || search.target === "contacts" || search.target === "both") {
    if (propertyIds != null) {
      if (propertyIds.length === 0) {
        contactCount = 0;
      } else {
        const linkedContactIds = await contactIdsForProperties(supabase, ownerId, propertyIds);
        if (linkedContactIds.length === 0) {
          contactCount = 0;
        } else {
          let cq = supabase
            .from("contacts")
            .select("*", { count: "exact", head: true })
            .eq("owner_id", ownerId)
            .in("id", linkedContactIds);
          if (search.contacts) cq = applyContactFilters(cq, search.contacts);
          const { count } = await cq;
          contactCount = count ?? 0;
        }
      }
    } else {
      let cq = supabase.from("contacts").select("*", { count: "exact", head: true }).eq("owner_id", ownerId);
      if (search.contacts) cq = applyContactFilters(cq, search.contacts);
      const { count } = await cq;
      contactCount = count ?? 0;
    }
  }

  let leaseCount = 0;
  if (search.leases && (search.target === "leases" || search.target === "both")) {
    let lq = supabase.from("lease_abstracts").select("*", { count: "exact", head: true }).eq("owner_id", ownerId);
    lq = applyLeaseFilters(lq, search.leases);
    const { count } = await lq;
    leaseCount = count ?? 0;
  }

  const outreachContacts =
    search.target === "contacts" || search.target === "both"
      ? contactCount
      : 0;

  return {
    properties: propCount,
    contacts: contactCount,
    leases: leaseCount,
    outreachContacts,
  };
}

export async function fetchSmartListContactIds(
  search: SearchResult,
  ownerId: string,
): Promise<string[]> {
  const supabase = await createClient();

  const propertyIds =
    search.properties && (search.target === "both" || search.target === "contacts" || search.target === "properties")
      ? await fetchMatchingPropertyIds(search.properties, ownerId)
      : null;

  if (propertyIds != null && propertyIds.length === 0) return [];

  if (propertyIds != null) {
    const linkedContactIds = await contactIdsForProperties(supabase, ownerId, propertyIds);
    if (linkedContactIds.length === 0) return [];
    let q = supabase.from("contacts").select("id").eq("owner_id", ownerId).in("id", linkedContactIds);
    if (search.contacts) q = applyContactFilters(q, search.contacts);
    const { data } = await q;
    return (data ?? []).map((r: { id: string }) => r.id);
  }

  if (search.target === "properties") return [];

  let q = supabase.from("contacts").select("id").eq("owner_id", ownerId);
  if (search.contacts) q = applyContactFilters(q, search.contacts);

  const { data } = await q;
  return (data ?? []).map((r: { id: string }) => r.id);
}
