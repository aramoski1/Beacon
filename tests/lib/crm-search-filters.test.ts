import { describe, expect, it } from "vitest";
import {
  applyContactFilters,
  applyLeaseFilters,
  applyPropertyFilters,
  buildCadenceStatusOrFilter,
  buildManualFilterSearchResult,
  leaseExpirationWindowDateRange,
  mapClientStatusToRelationshipStage,
  saleRecencyDateRange,
  type ManualConFilters,
  type ManualLeaseFilters,
  type ManualPropFilters,
} from "../../lib/crm-search-filters";
import type { ContactSearchFilters } from "../../app/crm/actions";

// Minimal chainable stand-in for a Supabase query builder that records every
// method call so we can assert exactly which columns/values a filter set touches.
// Deliberately NOT thenable — applyLeaseFilters is async and returns this
// instance directly, and a thenable return value would get auto-unwrapped by
// the JS runtime instead of being handed back as-is.
class FakeQuery {
  calls: { method: string; args: unknown[] }[] = [];

  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
    return this;
  }

  eq(...args: unknown[]) { return this.record("eq", args); }
  ilike(...args: unknown[]) { return this.record("ilike", args); }
  gte(...args: unknown[]) { return this.record("gte", args); }
  lte(...args: unknown[]) { return this.record("lte", args); }
  gt(...args: unknown[]) { return this.record("gt", args); }
  lt(...args: unknown[]) { return this.record("lt", args); }
  not(...args: unknown[]) { return this.record("not", args); }
  or(...args: unknown[]) { return this.record("or", args); }
  contains(...args: unknown[]) { return this.record("contains", args); }
  in(...args: unknown[]) { return this.record("in", args); }
  is(...args: unknown[]) { return this.record("is", args); }
  select(...args: unknown[]) { return this.record("select", args); }
  limit(...args: unknown[]) { return this.record("limit", args); }
}

// Separate thenable stand-in used only for the properties lookup that
// applyLeaseFilters' linked_property_type join awaits internally.
class FakeAwaitableQuery {
  constructor(private resolvedData: unknown[] = []) {}
  select() { return this; }
  limit() { return this; }
  eq() { return this; }
  in() { return this; }
  ilike() { return this; }
  gte() { return this; }
  lte() { return this; }
  or() { return this; }

  then(resolve: (v: { data: unknown[] }) => void) {
    resolve({ data: this.resolvedData });
  }
}

const EMPTY_PROP: ManualPropFilters = { propType: "", ownership: "", ownershipChange: "", saleRecency: "" };
const EMPTY_CON: ManualConFilters = { tier: "", status: "", assetFocus: "", cadenceStatus: "" };
const EMPTY_LEASE: ManualLeaseFilters = { expirationWindow: "", linkedPropertyType: "", hasTenantContact: "" };

describe("mapClientStatusToRelationshipStage", () => {
  it("maps known legacy client_status values to their live relationship_stage", () => {
    expect(mapClientStatusToRelationshipStage("prospect")).toBe("prospect");
    expect(mapClientStatusToRelationshipStage("active client")).toBe("active");
    expect(mapClientStatusToRelationshipStage("past client")).toBe("past_client");
  });

  it("falls back to dormant for unrecognized legacy values", () => {
    expect(mapClientStatusToRelationshipStage("who knows")).toBe("dormant");
    expect(mapClientStatusToRelationshipStage("")).toBe("dormant");
  });
});

describe("applyContactFilters — live fields", () => {
  it("filters on relationship_stage directly when provided", () => {
    const q = applyContactFilters(new FakeQuery(), { relationship_stage: "active" }) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "eq", args: ["relationship_stage", "active"] });
  });

  it("filters on asset_focus tags via array contains", () => {
    const q = applyContactFilters(new FakeQuery(), { asset_focus_includes: "industrial" }) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "contains", args: ["asset_focus", ["industrial"]] });
  });

  it("filters on submarket via ilike substring", () => {
    const q = applyContactFilters(new FakeQuery(), { submarket_keyword: "Doral" }) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "ilike", args: ["submarket", "%Doral%"] });
  });

  it("filters on portfolio_size via ilike substring", () => {
    const q = applyContactFilters(new FakeQuery(), { portfolio_size_keyword: "5 buildings" }) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "ilike", args: ["portfolio_size", "%5 buildings%"] });
  });

  it("filters on ownership_role and lead_source exactly", () => {
    const q = applyContactFilters(new FakeQuery(), {
      ownership_role: "managing_member",
      lead_source: "referral",
    }) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "eq", args: ["ownership_role", "managing_member"] });
    expect(q.calls).toContainEqual({ method: "eq", args: ["lead_source", "referral"] });
  });

  it("never touches the legacy client_status/geographic_category/size_category columns for live filters", () => {
    const f: ContactSearchFilters = {
      relationship_stage: "prospect",
      submarket_keyword: "Brickell",
      portfolio_size_keyword: "large",
    };
    const q = applyContactFilters(new FakeQuery(), f) as FakeQuery;
    const touchedColumns = q.calls.map((c) => c.args[0]);
    expect(touchedColumns).not.toContain("client_status");
    expect(touchedColumns).not.toContain("geographic_category");
    expect(touchedColumns).not.toContain("size_category");
  });
});

describe("applyContactFilters — legacy compat shim", () => {
  it("maps legacy client_status onto relationship_stage", () => {
    const q = applyContactFilters(new FakeQuery(), { client_status: "active client" }) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "eq", args: ["relationship_stage", "active"] });
  });

  it("prefers relationship_stage over client_status when both are present", () => {
    const q = applyContactFilters(new FakeQuery(), {
      relationship_stage: "dormant",
      client_status: "prospect",
    }) as FakeQuery;
    const stageCalls = q.calls.filter((c) => c.method === "eq" && c.args[0] === "relationship_stage");
    expect(stageCalls).toEqual([{ method: "eq", args: ["relationship_stage", "dormant"] }]);
  });

  it("maps legacy geographic_keyword onto the live submarket column", () => {
    const q = applyContactFilters(new FakeQuery(), { geographic_keyword: "Hialeah" }) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "ilike", args: ["submarket", "%Hialeah%"] });
  });

  it("maps legacy size_category_keyword onto the live portfolio_size column", () => {
    const q = applyContactFilters(new FakeQuery(), { size_category_keyword: ">100k sf" }) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "ilike", args: ["portfolio_size", "%>100k sf%"] });
  });

  it("prefers the live keyword over the legacy one when both are present", () => {
    const q = applyContactFilters(new FakeQuery(), {
      submarket_keyword: "Doral",
      geographic_keyword: "Airport West",
    }) as FakeQuery;
    const submarketCalls = q.calls.filter((c) => c.method === "ilike" && c.args[0] === "submarket");
    expect(submarketCalls).toEqual([{ method: "ilike", args: ["submarket", "%Doral%"] }]);
  });
});

describe("applyContactFilters — dead filter removed", () => {
  it("does not touch size_category for contacts even when no filters are set", () => {
    const q = applyContactFilters(new FakeQuery(), {}) as FakeQuery;
    expect(q.calls).toEqual([]);
  });
});

describe("buildCadenceStatusOrFilter", () => {
  const cadenceMap = { 1: 14, 2: 30, 3: 90 };
  const nowMs = new Date("2026-01-15T00:00:00.000Z").getTime();

  it("builds an overdue OR-of-AND-per-tier clause using each tier's own threshold", () => {
    const filter = buildCadenceStatusOrFilter("overdue", cadenceMap, nowMs);
    expect(filter).toContain("and(contact_tier.eq.1,last_contacted_at.lt.");
    expect(filter).toContain("and(contact_tier.eq.2,last_contacted_at.lt.");
    expect(filter).toContain("and(contact_tier.eq.3,last_contacted_at.lt.");
    // Tier 1's cutoff (14 days back) must differ from Tier 3's (90 days back).
    const tier1Cutoff = new Date(nowMs - 14 * 86_400_000).toISOString();
    const tier3Cutoff = new Date(nowMs - 90 * 86_400_000).toISOString();
    expect(filter).toContain(tier1Cutoff);
    expect(filter).toContain(tier3Cutoff);
  });

  it("builds a due_soon clause bounded by [threshold-3, threshold] days back", () => {
    const filter = buildCadenceStatusOrFilter("due_soon", { 1: 14 }, nowMs);
    const upper = new Date(nowMs - 14 * 86_400_000).toISOString(); // gte
    const lower = new Date(nowMs - 11 * 86_400_000).toISOString(); // lte
    expect(filter).toBe(`and(contact_tier.eq.1,last_contacted_at.gte.${upper},last_contacted_at.lte.${lower})`);
  });

  it("builds an ok clause for contacts more recent than threshold-3 days", () => {
    const filter = buildCadenceStatusOrFilter("ok", { 1: 14 }, nowMs);
    const lower = new Date(nowMs - 11 * 86_400_000).toISOString();
    expect(filter).toBe(`and(contact_tier.eq.1,last_contacted_at.gt.${lower})`);
  });

  it("returns null when the cadence map has no valid tiers", () => {
    expect(buildCadenceStatusOrFilter("overdue", {})).toBeNull();
  });
});

describe("applyContactFilters — cadence_status", () => {
  it("filters 'never' as tiered + null last_contacted_at, without the per-tier OR", () => {
    const q = applyContactFilters(new FakeQuery(), { cadence_status: "never" }) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "not", args: ["contact_tier", "is", null] });
    expect(q.calls).toContainEqual({ method: "is", args: ["last_contacted_at", null] });
    expect(q.calls.some((c) => c.method === "or")).toBe(false);
  });

  it("uses the provided cadence map (not the default) for overdue", () => {
    const q = applyContactFilters(new FakeQuery(), { cadence_status: "overdue" }, { 1: 7 }) as FakeQuery;
    const orCall = q.calls.find((c) => c.method === "or");
    expect(orCall?.args[0]).toContain("contact_tier.eq.1");
    expect(orCall?.args[0]).not.toContain("contact_tier.eq.2");
  });
});

describe("saleRecencyDateRange", () => {
  const nowMs = new Date("2026-01-15T00:00:00.000Z").getTime();

  it("lt1y is bounded below by one year ago, open above", () => {
    const range = saleRecencyDateRange("lt1y", nowMs);
    expect(range.gt).toBe(new Date(nowMs - 365 * 86_400_000).toISOString());
    expect(range.lte).toBeUndefined();
  });

  it("5plus is bounded above by five years ago, open below", () => {
    const range = saleRecencyDateRange("5plus", nowMs);
    expect(range.lte).toBe(new Date(nowMs - 5 * 365 * 86_400_000).toISOString());
    expect(range.gt).toBeUndefined();
  });

  it("1to3y is bounded on both sides", () => {
    const range = saleRecencyDateRange("1to3y", nowMs);
    expect(range.gt).toBe(new Date(nowMs - 3 * 365 * 86_400_000).toISOString());
    expect(range.lte).toBe(new Date(nowMs - 365 * 86_400_000).toISOString());
  });
});

describe("applyPropertyFilters — ownership, ownership change, sale recency", () => {
  it("filters individual ownership to the private ownership_type", () => {
    const q = applyPropertyFilters(new FakeQuery(), { ownership_individual_or_entity: "individual" }) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "in", args: ["ownership_type", ["private"]] });
  });

  it("filters entity ownership to institutional/REIT ownership_type", () => {
    const q = applyPropertyFilters(new FakeQuery(), { ownership_individual_or_entity: "entity" }) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "in", args: ["ownership_type", ["institutional", "REIT"]] });
  });

  it("filters on an open ownership-change signal", () => {
    const q = applyPropertyFilters(new FakeQuery(), { has_ownership_change: true }) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "not", args: ["ownership_change_detected_at", "is", null] });
  });

  it("filters on no ownership-change signal", () => {
    const q = applyPropertyFilters(new FakeQuery(), { has_ownership_change: false }) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "is", args: ["ownership_change_detected_at", null] });
  });

  it("filters last_sale_recency as a non-null date range", () => {
    const q = applyPropertyFilters(new FakeQuery(), { last_sale_recency: "3to5y" }) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "not", args: ["last_sale_date", "is", null] });
    expect(q.calls.some((c) => c.method === "gt" && c.args[0] === "last_sale_date")).toBe(true);
    expect(q.calls.some((c) => c.method === "lte" && c.args[0] === "last_sale_date")).toBe(true);
  });
});

describe("leaseExpirationWindowDateRange", () => {
  const nowMs = new Date("2026-01-15T00:00:00.000Z").getTime();

  it("90d spans today through 90 days out", () => {
    const range = leaseExpirationWindowDateRange("90d", nowMs);
    expect(range.gte).toBe(new Date(nowMs).toISOString());
    expect(range.lte).toBe(new Date(nowMs + 90 * 86_400_000).toISOString());
  });

  it("180d starts just past the 90-day mark", () => {
    const range = leaseExpirationWindowDateRange("180d", nowMs);
    expect(range.gt).toBe(new Date(nowMs + 90 * 86_400_000).toISOString());
    expect(range.lte).toBe(new Date(nowMs + 180 * 86_400_000).toISOString());
  });

  it("beyond12mo is open-ended past 365 days", () => {
    const range = leaseExpirationWindowDateRange("beyond12mo", nowMs);
    expect(range.gt).toBe(new Date(nowMs + 365 * 86_400_000).toISOString());
    expect(range.lte).toBeUndefined();
  });
});

describe("applyLeaseFilters — expiration window, linked property type, tenant contact", () => {
  it("filters expiration_window as a non-null date range", async () => {
    const q = (await applyLeaseFilters(new FakeQuery(), { expiration_window: "90d" })) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "not", args: ["expiration_date", "is", null] });
    expect(q.calls.some((c) => c.method === "gte" && c.args[0] === "expiration_date")).toBe(true);
    expect(q.calls.some((c) => c.method === "lte" && c.args[0] === "expiration_date")).toBe(true);
  });

  it("resolves linked_property_type via a property lookup, then filters linked_property by id", async () => {
    const fakeSupabase = { from: () => new FakeAwaitableQuery([{ id: "p1" }, { id: "p2" }]) };
    const q = (await applyLeaseFilters(new FakeQuery(), { linked_property_type: "industrial" }, fakeSupabase)) as FakeQuery;
    expect(q.calls).toContainEqual({ method: "in", args: ["linked_property", ["p1", "p2"]] });
  });

  it("filters has_tenant_contact true/false onto tenant_contact_id", async () => {
    const qYes = (await applyLeaseFilters(new FakeQuery(), { has_tenant_contact: true })) as FakeQuery;
    expect(qYes.calls).toContainEqual({ method: "not", args: ["tenant_contact_id", "is", null] });

    const qNo = (await applyLeaseFilters(new FakeQuery(), { has_tenant_contact: false })) as FakeQuery;
    expect(qNo.calls).toContainEqual({ method: "is", args: ["tenant_contact_id", null] });
  });

  it("still supports the legacy status field used by AI search", async () => {
    const q = (await applyLeaseFilters(new FakeQuery(), { status: "expired" })) as FakeQuery;
    expect(q.calls.some((c) => c.method === "lt" && c.args[0] === "expiration_date")).toBe(true);
  });
});

describe("buildManualFilterSearchResult — contacts (live field wiring)", () => {
  it("wires the Stage dropdown to relationship_stage, not legacy client_status", () => {
    const result = buildManualFilterSearchResult(
      "contacts",
      EMPTY_PROP,
      { ...EMPTY_CON, status: "active" },
      EMPTY_LEASE,
    );
    expect(result?.contacts?.relationship_stage).toBe("active");
    expect(result?.contacts?.client_status).toBeUndefined();
  });

  it("wires the Asset focus dropdown to asset_focus_includes", () => {
    const result = buildManualFilterSearchResult(
      "contacts",
      EMPTY_PROP,
      { ...EMPTY_CON, assetFocus: "industrial" },
      EMPTY_LEASE,
    );
    expect(result?.contacts?.asset_focus_includes).toBe("industrial");
  });

  it("wires the Cadence dropdown to cadence_status", () => {
    const result = buildManualFilterSearchResult(
      "contacts",
      EMPTY_PROP,
      { ...EMPTY_CON, cadenceStatus: "overdue" },
      EMPTY_LEASE,
    );
    expect(result?.contacts?.cadence_status).toBe("overdue");
  });

  it("returns null when no manual contact filters are set", () => {
    expect(buildManualFilterSearchResult("contacts", EMPTY_PROP, EMPTY_CON, EMPTY_LEASE)).toBeNull();
  });
});

describe("buildManualFilterSearchResult — properties (live field wiring)", () => {
  it("wires Type to property_type", () => {
    const result = buildManualFilterSearchResult(
      "properties",
      { ...EMPTY_PROP, propType: "industrial" },
      EMPTY_CON,
      EMPTY_LEASE,
    );
    expect(result?.properties?.property_type).toBe("industrial");
  });

  it("wires Ownership to the individual/entity derived filter, not the raw ownership_type enum", () => {
    const result = buildManualFilterSearchResult(
      "properties",
      { ...EMPTY_PROP, ownership: "entity" },
      EMPTY_CON,
      EMPTY_LEASE,
    );
    expect(result?.properties?.ownership_individual_or_entity).toBe("entity");
    expect(result?.properties?.ownership_type).toBeUndefined();
  });

  it("wires Ownership change to has_ownership_change", () => {
    const result = buildManualFilterSearchResult(
      "properties",
      { ...EMPTY_PROP, ownershipChange: "yes" },
      EMPTY_CON,
      EMPTY_LEASE,
    );
    expect(result?.properties?.has_ownership_change).toBe(true);
  });

  it("wires Last sale to last_sale_recency, not the dead size/geo keywords", () => {
    const result = buildManualFilterSearchResult(
      "properties",
      { ...EMPTY_PROP, saleRecency: "lt1y" },
      EMPTY_CON,
      EMPTY_LEASE,
    );
    expect(result?.properties?.last_sale_recency).toBe("lt1y");
    expect(result?.properties?.size_category_keyword).toBeUndefined();
    expect(result?.properties?.geographic_keyword).toBeUndefined();
  });
});

describe("buildManualFilterSearchResult — leases (live field wiring)", () => {
  it("wires Expiration to expiration_window, not the old status bucket", () => {
    const result = buildManualFilterSearchResult(
      "leases",
      EMPTY_PROP,
      EMPTY_CON,
      { ...EMPTY_LEASE, expirationWindow: "180d" },
    );
    expect(result?.leases?.expiration_window).toBe("180d");
  });

  it("wires Property type to linked_property_type", () => {
    const result = buildManualFilterSearchResult(
      "leases",
      EMPTY_PROP,
      EMPTY_CON,
      { ...EMPTY_LEASE, linkedPropertyType: "office" },
    );
    expect(result?.leases?.linked_property_type).toBe("office");
  });

  it("wires Tenant contact to has_tenant_contact", () => {
    const result = buildManualFilterSearchResult(
      "leases",
      EMPTY_PROP,
      EMPTY_CON,
      { ...EMPTY_LEASE, hasTenantContact: "no" },
    );
    expect(result?.leases?.has_tenant_contact).toBe(false);
  });

  it("returns null when no manual lease filters are set", () => {
    expect(buildManualFilterSearchResult("leases", EMPTY_PROP, EMPTY_CON, EMPTY_LEASE)).toBeNull();
  });
});
