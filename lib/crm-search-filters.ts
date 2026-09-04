import type {
  ContactSearchFilters,
  LeaseSearchFilters,
  PropertySearchFilters,
  SearchResult,
} from "@/app/crm/actions";
import { DEFAULT_CADENCE_TIER_DAYS } from "@/lib/cadence";
import { LEASE_RADAR_DAY_THRESHOLDS } from "@/lib/lease-radar";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryBuilder = any;

// ─── Property ownership_type buckets for the individual/entity filter ─────────
// Reuses the ownership_type column, itself derived from owner_name at
// extraction time (lib/property-pipeline.ts): LLC/INC/CORP/... → institutional,
// individual-sounding names → private. owner-occupant/unknown are genuinely
// ambiguous and match neither bucket.
const ENTITY_OWNERSHIP_TYPES = ["institutional", "REIT"];
const INDIVIDUAL_OWNERSHIP_TYPES = ["private"];

// ─── Date-bucket helpers (pure — directly unit-testable) ──────────────────────

export type SaleRecencyBucket = "lt1y" | "1to3y" | "3to5y" | "5plus";

const MS_DAY = 86_400_000;
const MS_YEAR = 365 * MS_DAY;

/** Date-range bounds (ISO strings) for a last_sale_date recency bucket. */
export function saleRecencyDateRange(
  bucket: SaleRecencyBucket,
  nowMs: number = Date.now(),
): { gt?: string; lte?: string } {
  const yearsAgo = (y: number) => new Date(nowMs - y * MS_YEAR).toISOString();
  if (bucket === "lt1y") return { gt: yearsAgo(1) };
  if (bucket === "1to3y") return { gt: yearsAgo(3), lte: yearsAgo(1) };
  if (bucket === "3to5y") return { gt: yearsAgo(5), lte: yearsAgo(3) };
  return { lte: yearsAgo(5) };
}

export type LeaseExpirationWindow = "90d" | "180d" | "12mo" | "beyond12mo";

/** Date-range bounds (ISO strings) for an expiration_date window, reusing the
 * same day thresholds as the lease radar (lib/lease-radar.ts). */
export function leaseExpirationWindowDateRange(
  window: LeaseExpirationWindow,
  nowMs: number = Date.now(),
): { gt?: string; gte?: string; lte?: string } {
  const inDays = (d: number) => new Date(nowMs + d * MS_DAY).toISOString();
  const { threeMonth, sixMonth, twelveMonth } = LEASE_RADAR_DAY_THRESHOLDS;
  if (window === "90d") return { gte: inDays(0), lte: inDays(threeMonth) };
  if (window === "180d") return { gt: inDays(threeMonth), lte: inDays(sixMonth) };
  if (window === "12mo") return { gt: inDays(sixMonth), lte: inDays(twelveMonth) };
  return { gt: inDays(twelveMonth) };
}

export type CadenceStatusValue = "overdue" | "due_soon" | "ok" | "never";

/**
 * PostgREST OR-filter string bucketing contacts by cadence status, resolving
 * each tier's own threshold from the cadence map (lib/cadence.ts) since
 * "overdue" means something different for a Tier 1 vs Tier 3 contact.
 * Returns null for "never" (handled separately — it doesn't need a per-tier OR).
 */
export function buildCadenceStatusOrFilter(
  status: Exclude<CadenceStatusValue, "never">,
  cadenceMap: Record<number, number> = DEFAULT_CADENCE_TIER_DAYS,
  nowMs: number = Date.now(),
): string | null {
  const tiers = Object.keys(cadenceMap)
    .map(Number)
    .filter((t) => typeof cadenceMap[t] === "number" && cadenceMap[t] > 0);

  const clauses = tiers.map((tier) => {
    const days = cadenceMap[tier];
    const overdueCutoff = new Date(nowMs - days * MS_DAY).toISOString();
    const dueSoonLower = new Date(nowMs - Math.max(days - 3, 0) * MS_DAY).toISOString();
    if (status === "overdue") {
      return `and(contact_tier.eq.${tier},last_contacted_at.lt.${overdueCutoff})`;
    }
    if (status === "due_soon") {
      return `and(contact_tier.eq.${tier},last_contacted_at.gte.${overdueCutoff},last_contacted_at.lte.${dueSoonLower})`;
    }
    // ok
    return `and(contact_tier.eq.${tier},last_contacted_at.gt.${dueSoonLower})`;
  });

  return clauses.length > 0 ? clauses.join(",") : null;
}

// ─── Filter appliers ───────────────────────────────────────────────────────────

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

  if (f.ownership_individual_or_entity === "individual") {
    q = q.in("ownership_type", INDIVIDUAL_OWNERSHIP_TYPES);
  } else if (f.ownership_individual_or_entity === "entity") {
    q = q.in("ownership_type", ENTITY_OWNERSHIP_TYPES);
  }
  if (f.has_ownership_change === true) q = q.not("ownership_change_detected_at", "is", null);
  if (f.has_ownership_change === false) q = q.is("ownership_change_detected_at", null);
  if (f.last_sale_recency) {
    const range = saleRecencyDateRange(f.last_sale_recency);
    q = q.not("last_sale_date", "is", null);
    if (range.gt) q = q.gt("last_sale_date", range.gt);
    if (range.lte) q = q.lte("last_sale_date", range.lte);
  }

  return q;
}

/**
 * Legacy client_status values (from smart lists / stored queries saved before
 * the CRE contact fields migration) map onto the relationship_stage values
 * brokers actually set in the UI today. Mirrors the one-time DB backfill in
 * scripts/migrate-cre-contact-fields.ts so old and new queries agree.
 */
const LEGACY_CLIENT_STATUS_TO_RELATIONSHIP_STAGE: Record<string, string> = {
  "prospect": "prospect",
  "active client": "active",
  "past client": "past_client",
};

export function mapClientStatusToRelationshipStage(clientStatus: string): string {
  return LEGACY_CLIENT_STATUS_TO_RELATIONSHIP_STAGE[clientStatus] ?? "dormant";
}

export function applyContactFilters(
  q: QueryBuilder,
  f: ContactSearchFilters,
  cadenceMap: Record<number, number> = DEFAULT_CADENCE_TIER_DAYS,
): QueryBuilder {
  if (f.contact_tier != null) q = q.eq("contact_tier", f.contact_tier);

  // Prefer the live relationship_stage field; fall back to the legacy
  // client_status compat shim for smart lists saved before the migration.
  const stage = f.relationship_stage || (f.client_status ? mapClientStatusToRelationshipStage(f.client_status) : undefined);
  if (stage) q = q.eq("relationship_stage", stage);

  if (f.contact_type) q = q.eq("contact_type", f.contact_type);
  if (f.ownership_role) q = q.eq("ownership_role", f.ownership_role);
  if (f.lead_source) q = q.eq("lead_source", f.lead_source);
  if (f.action_tags_includes) q = q.contains("action_tags", [f.action_tags_includes]);
  if (f.asset_focus_includes) q = q.contains("asset_focus", [f.asset_focus_includes]);
  if (f.not_contacted_in_days != null) {
    const cutoff = new Date(Date.now() - f.not_contacted_in_days * 86_400_000).toISOString();
    q = q.or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoff}`);
  }
  if (f.last_contacted_within_days != null) {
    const cutoff = new Date(Date.now() - f.last_contacted_within_days * 86_400_000).toISOString();
    q = q.not("last_contacted_at", "is", null).gte("last_contacted_at", cutoff);
  }

  // Prefer the live submarket/portfolio_size fields; fall back to the legacy
  // geographic_category/size_category keywords for old saved queries.
  const submarketKw = f.submarket_keyword || f.geographic_keyword;
  if (submarketKw) q = q.ilike("submarket", `%${submarketKw}%`);
  const portfolioKw = f.portfolio_size_keyword || f.size_category_keyword;
  if (portfolioKw) q = q.ilike("portfolio_size", `%${portfolioKw}%`);
  if (f.ownership_type_keyword) q = q.ilike("ownership_type", `%${f.ownership_type_keyword}%`);

  if (f.name_contains) q = q.ilike("name", `%${f.name_contains}%`);
  if (f.company_contains) q = q.ilike("company", `%${f.company_contains}%`);

  if (f.cadence_status === "never") {
    q = q.not("contact_tier", "is", null).is("last_contacted_at", null);
  } else if (f.cadence_status) {
    const orFilter = buildCadenceStatusOrFilter(f.cadence_status, cadenceMap);
    if (orFilter) q = q.or(orFilter);
  }

  return q;
}

export async function applyLeaseFilters(
  q: QueryBuilder,
  f: LeaseSearchFilters,
  ctx?: { ownerId: string; supabase: QueryBuilder },
): Promise<QueryBuilder> {
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

  if (f.expiration_window) {
    const range = leaseExpirationWindowDateRange(f.expiration_window);
    q = q.not("expiration_date", "is", null);
    if (range.gte) q = q.gte("expiration_date", range.gte);
    if (range.gt) q = q.gt("expiration_date", range.gt);
    if (range.lte) q = q.lte("expiration_date", range.lte);
  }

  if (f.linked_property_type && ctx) {
    const propertyIds = await fetchMatchingPropertyIdsFromClient(ctx.supabase, ctx.ownerId, { property_type: f.linked_property_type });
    q = q.in("linked_property", propertyIds.length > 0 ? propertyIds : ["00000000-0000-0000-0000-000000000000"]);
  }

  if (f.has_tenant_contact === true) q = q.not("tenant_contact_id", "is", null);
  if (f.has_tenant_contact === false) q = q.is("tenant_contact_id", null);

  return q;
}

/**
 * Property IDs matching filters. Scoped explicitly to `ownerId` as a backstop
 * to RLS — this is called from both server and browser Supabase clients, so
 * it shouldn't depend solely on the session-scoped RLS policy staying intact.
 */
export async function fetchMatchingPropertyIdsFromClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ownerId: string,
  filters: PropertySearchFilters,
): Promise<string[]> {
  let q = supabase.from("properties").select("id").eq("owner_id", ownerId).limit(1000);
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
  ownership: string;        // "individual" | "entity" | ""
  ownershipChange: string;  // "yes" | "no" | ""
  saleRecency: string;      // SaleRecencyBucket | ""
};

export type ManualConFilters = {
  tier: string;
  status: string;           // relationship_stage
  assetFocus: string;       // asset_focus_includes
  cadenceStatus: string;    // CadenceStatusValue | ""
  contactType?: string;     // owner | tenant | other
};

export type ManualLeaseFilters = {
  expirationWindow: string;   // LeaseExpirationWindow | ""
  linkedPropertyType: string; // property_type enum
  hasTenantContact: string;   // "yes" | "no" | ""
};

const SALE_RECENCY_LABELS: Record<string, string> = {
  lt1y: "sold within 1 year",
  "1to3y": "sold 1–3 years ago",
  "3to5y": "sold 3–5 years ago",
  "5plus": "sold 5+ years ago",
};

const CADENCE_STATUS_LABELS: Record<string, string> = {
  overdue: "Cadence overdue",
  due_soon: "Cadence due soon",
  ok: "Cadence on track",
  never: "Never contacted",
};

const EXPIRATION_WINDOW_LABELS: Record<string, string> = {
  "90d": "Expiring ≤90 days",
  "180d": "Expiring ≤180 days",
  "12mo": "Expiring ≤12 months",
  "beyond12mo": "Expiring 12+ months out",
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
    if (propFilters.ownership === "individual" || propFilters.ownership === "entity") {
      properties.ownership_individual_or_entity = propFilters.ownership;
      parts.push(`${humanizeToken(propFilters.ownership)} ownership`);
    }
    if (propFilters.ownershipChange === "yes" || propFilters.ownershipChange === "no") {
      properties.has_ownership_change = propFilters.ownershipChange === "yes";
      parts.push(propFilters.ownershipChange === "yes" ? "Ownership change" : "No ownership change");
    }
    if (propFilters.saleRecency) {
      properties.last_sale_recency = propFilters.saleRecency as PropertySearchFilters["last_sale_recency"];
      parts.push(SALE_RECENCY_LABELS[propFilters.saleRecency] ?? humanizeToken(propFilters.saleRecency));
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
      contacts.relationship_stage = conFilters.status;
      parts.push(humanizeToken(conFilters.status));
    }
    if (conFilters.assetFocus) {
      contacts.asset_focus_includes = conFilters.assetFocus;
      parts.push(`Focus: ${humanizeToken(conFilters.assetFocus)}`);
    }
    if (conFilters.cadenceStatus) {
      contacts.cadence_status = conFilters.cadenceStatus as ContactSearchFilters["cadence_status"];
      parts.push(CADENCE_STATUS_LABELS[conFilters.cadenceStatus] ?? humanizeToken(conFilters.cadenceStatus));
    }
    if (conFilters.contactType) {
      contacts.contact_type = conFilters.contactType;
      parts.push(conFilters.contactType === "owner" ? "Owners" : conFilters.contactType === "tenant" ? "Tenants" : "Other");
    }
    if (parts.length === 0) return null;
    return { target: "contacts", contacts, explanation: parts.join(" · ") };
  }

  const parts: string[] = [];
  const leases: LeaseSearchFilters = {};
  if (leaseFilters.expirationWindow) {
    leases.expiration_window = leaseFilters.expirationWindow as LeaseSearchFilters["expiration_window"];
    parts.push(EXPIRATION_WINDOW_LABELS[leaseFilters.expirationWindow] ?? humanizeToken(leaseFilters.expirationWindow));
  }
  if (leaseFilters.linkedPropertyType) {
    leases.linked_property_type = leaseFilters.linkedPropertyType;
    parts.push(`Property: ${humanizeToken(leaseFilters.linkedPropertyType)}`);
  }
  if (leaseFilters.hasTenantContact === "yes" || leaseFilters.hasTenantContact === "no") {
    leases.has_tenant_contact = leaseFilters.hasTenantContact === "yes";
    parts.push(leaseFilters.hasTenantContact === "yes" ? "Has tenant contact" : "No tenant contact");
  }
  if (parts.length === 0) return null;
  return { target: "leases", leases, explanation: parts.join(" · ") };
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
