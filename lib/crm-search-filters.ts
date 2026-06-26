import type {
  ContactSearchFilters,
  LeaseSearchFilters,
  PropertySearchFilters,
  SearchResult,
} from "@/app/crm/actions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryBuilder = any;

export function applyPropertyFilters(q: QueryBuilder, f: PropertySearchFilters): QueryBuilder {
  if (f.property_type) q = q.eq("property_type", f.property_type);
  if (f.ownership_type) q = q.eq("ownership_type", f.ownership_type);
  if (f.size_sqft_min != null) q = q.gte("size_sqft", f.size_sqft_min);
  if (f.size_sqft_max != null) q = q.lte("size_sqft", f.size_sqft_max);
  if (f.last_sale_price_min != null) q = q.gte("last_sale_price", f.last_sale_price_min);
  if (f.last_sale_price_max != null) q = q.lte("last_sale_price", f.last_sale_price_max);
  if (f.geographic_keyword) {
    const kw = f.geographic_keyword.replace(/[%_,]/g, "");
    q = q.or(`address.ilike.%${kw}%,city.ilike.%${kw}%,geographic_category.ilike.%${kw}%`);
  }
  if (f.owner_name_contains) q = q.ilike("owner_name", `%${f.owner_name_contains}%`);
  if (f.size_category_keyword) q = q.ilike("size_category", `%${f.size_category_keyword}%`);
  return q;
}

export function applyContactFilters(q: QueryBuilder, f: ContactSearchFilters): QueryBuilder {
  if (f.contact_tier != null) q = q.eq("contact_tier", f.contact_tier);
  if (f.client_status) q = q.eq("client_status", f.client_status);
  if (f.contact_type) q = q.eq("contact_type", f.contact_type);
  if (f.action_tags_includes) q = q.contains("action_tags", [f.action_tags_includes]);
  if (f.not_contacted_in_days != null) {
    const cutoff = new Date(Date.now() - f.not_contacted_in_days * 86_400_000).toISOString();
    q = q.or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoff}`);
  }
  if (f.last_contacted_within_days != null) {
    const cutoff = new Date(Date.now() - f.last_contacted_within_days * 86_400_000).toISOString();
    q = q.not("last_contacted_at", "is", null).gte("last_contacted_at", cutoff);
  }
  if (f.geographic_keyword) q = q.ilike("geographic_category", `%${f.geographic_keyword}%`);
  if (f.size_category_keyword) q = q.ilike("size_category", `%${f.size_category_keyword}%`);
  if (f.ownership_type_keyword) q = q.ilike("ownership_type", `%${f.ownership_type_keyword}%`);
  if (f.name_contains) q = q.ilike("name", `%${f.name_contains}%`);
  if (f.company_contains) q = q.ilike("company", `%${f.company_contains}%`);
  return q;
}

export function applyLeaseFilters(q: QueryBuilder, f: LeaseSearchFilters): QueryBuilder {
  const now = new Date().toISOString();
  const in90 = new Date(Date.now() + 90 * 86_400_000).toISOString();

  const applyLeaseStatus = (status: string) => {
    if (status === "active") return q.not("expiration_date", "is", null).gte("expiration_date", in90);
    if (status === "expiring") return q.not("expiration_date", "is", null).gt("expiration_date", now).lt("expiration_date", in90);
    if (status === "expired") return q.not("expiration_date", "is", null).lt("expiration_date", now);
    return q;
  };

  if (f.status) q = applyLeaseStatus(f.status);
  if (f.expiring_within_days != null) {
    const cutoff = new Date(Date.now() + f.expiring_within_days * 86_400_000).toISOString();
    q = q.not("expiration_date", "is", null).gt("expiration_date", now).lt("expiration_date", cutoff);
  }
  if (f.base_rate_min != null) q = q.gte("base_rate", f.base_rate_min);
  if (f.base_rate_max != null) q = q.lte("base_rate", f.base_rate_max);
  return q;
}

/** Property IDs matching filters (pass browser Supabase client — RLS scopes to user). */
export async function fetchMatchingPropertyIdsFromClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  filters: PropertySearchFilters,
): Promise<string[]> {
  let q = supabase.from("properties").select("id");
  q = applyPropertyFilters(q, filters);
  const { data } = await q;
  return (data ?? []).map((r: { id: string }) => r.id);
}

export function primaryTabForSearch(search: SearchResult): "properties" | "contacts" | "leases" {
  if (search.target === "contacts" || search.target === "both") return "contacts";
  if (search.target === "leases") return "leases";
  return "properties";
}

export type SmartListCounts = {
  properties: number;
  contacts: number;
  leases: number;
  outreachContacts: number;
};

export type ManualPropFilters = {
  propType: string;
  ownership: string;
  sizeCat: string;
  geoCat: string;
};

export type ManualConFilters = {
  tier: string;
  status: string;
  contactType: string;
  sizeCat: string;
  geoCat: string;
  ownership: string;
  tag: string;
};

export type ManualLeaseFilters = {
  status: string;
};

const LEASE_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  expiring: "Expiring soon",
  expired: "Expired",
};

function humanizeToken(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function buildManualFilterSearchResult(
  tab: "properties" | "contacts" | "leases",
  propFilters: ManualPropFilters,
  conFilters: ManualConFilters,
  leaseFilters: ManualLeaseFilters,
): SearchResult | null {
  if (tab === "properties") {
    const parts: string[] = [];
    const properties: PropertySearchFilters = {};
    if (propFilters.propType) {
      properties.property_type = propFilters.propType;
      parts.push(humanizeToken(propFilters.propType));
    }
    if (propFilters.ownership) {
      properties.ownership_type = propFilters.ownership;
      parts.push(`${humanizeToken(propFilters.ownership)} ownership`);
    }
    if (propFilters.sizeCat) {
      properties.size_category_keyword = propFilters.sizeCat;
      parts.push(`Size: ${propFilters.sizeCat}`);
    }
    if (propFilters.geoCat) {
      properties.geographic_keyword = propFilters.geoCat;
      parts.push(`Geo: ${propFilters.geoCat}`);
    }
    if (parts.length === 0) return null;
    return { target: "properties", properties, explanation: parts.join(" · ") };
  }

  if (tab === "contacts") {
    const parts: string[] = [];
    const contacts: ContactSearchFilters = {};
    if (conFilters.tier) {
      contacts.contact_tier = Number(conFilters.tier);
      parts.push(`Tier ${conFilters.tier}`);
    }
    if (conFilters.status) {
      contacts.client_status = conFilters.status;
      parts.push(humanizeToken(conFilters.status));
    }
    if (conFilters.contactType) {
      contacts.contact_type = conFilters.contactType;
      parts.push(`${humanizeToken(conFilters.contactType)}s`);
    }
    if (conFilters.tag) {
      contacts.action_tags_includes = conFilters.tag;
      parts.push(`Tag: ${conFilters.tag}`);
    }
    if (conFilters.sizeCat) {
      contacts.size_category_keyword = conFilters.sizeCat;
      parts.push(`Size: ${conFilters.sizeCat}`);
    }
    if (conFilters.geoCat) {
      contacts.geographic_keyword = conFilters.geoCat;
      parts.push(`Geo: ${conFilters.geoCat}`);
    }
    if (conFilters.ownership) {
      contacts.ownership_type_keyword = conFilters.ownership;
      parts.push(`Ownership: ${conFilters.ownership}`);
    }
    if (parts.length === 0) return null;
    return { target: "contacts", contacts, explanation: parts.join(" · ") };
  }

  if (leaseFilters.status) {
    const status = leaseFilters.status as "active" | "expiring" | "expired";
    return {
      target: "leases",
      leases: { status },
      explanation: LEASE_STATUS_LABELS[status] ?? humanizeToken(status),
    };
  }

  return null;
}

/** Filters that can be saved as a smart list (AI search or manual filters), excluding open saved lists. */
export function resolveSavableSearchResult(
  tab: "properties" | "contacts" | "leases",
  activeSearch: SearchResult | null,
  activeListId: string | null,
  propFilters: ManualPropFilters,
  conFilters: ManualConFilters,
  leaseFilters: ManualLeaseFilters,
): SearchResult | null {
  if (activeListId) return null;
  if (activeSearch) return activeSearch;
  return buildManualFilterSearchResult(tab, propFilters, conFilters, leaseFilters);
}
