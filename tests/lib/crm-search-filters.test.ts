import { describe, expect, it } from "vitest";
import {
  applyContactFilters,
  buildManualFilterSearchResult,
  mapClientStatusToRelationshipStage,
  type ManualConFilters,
  type ManualLeaseFilters,
  type ManualPropFilters,
} from "../../lib/crm-search-filters";
import type { ContactSearchFilters } from "../../app/crm/actions";

// Minimal chainable stand-in for a Supabase query builder that records every
// method call so we can assert exactly which columns/values a filter set touches.
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
}

const EMPTY_PROP: ManualPropFilters = { propType: "", ownership: "", sizeCat: "", geoCat: "" };
const EMPTY_CON: ManualConFilters = { tier: "", status: "", contactType: "", sizeCat: "", geoCat: "", ownership: "", tag: "" };
const EMPTY_LEASE: ManualLeaseFilters = { status: "" };

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

  it("wires the Role dropdown to ownership_role, not the contact_type enum", () => {
    const result = buildManualFilterSearchResult(
      "contacts",
      EMPTY_PROP,
      { ...EMPTY_CON, contactType: "managing_member" },
      EMPTY_LEASE,
    );
    expect(result?.contacts?.ownership_role).toBe("managing_member");
    expect(result?.contacts?.contact_type).toBeUndefined();
  });

  it("wires the Portfolio dropdown to portfolio_size_keyword, not the dead size_category_keyword", () => {
    const result = buildManualFilterSearchResult(
      "contacts",
      EMPTY_PROP,
      { ...EMPTY_CON, sizeCat: "5 buildings" },
      EMPTY_LEASE,
    );
    expect(result?.contacts?.portfolio_size_keyword).toBe("5 buildings");
    expect(result?.contacts?.size_category_keyword).toBeUndefined();
  });

  it("wires the Submarket dropdown to submarket_keyword, not legacy geographic_keyword", () => {
    const result = buildManualFilterSearchResult(
      "contacts",
      EMPTY_PROP,
      { ...EMPTY_CON, geoCat: "Doral" },
      EMPTY_LEASE,
    );
    expect(result?.contacts?.submarket_keyword).toBe("Doral");
    expect(result?.contacts?.geographic_keyword).toBeUndefined();
  });

  it("wires the Lead source dropdown to lead_source, not ownership_type_keyword", () => {
    const result = buildManualFilterSearchResult(
      "contacts",
      EMPTY_PROP,
      { ...EMPTY_CON, ownership: "referral" },
      EMPTY_LEASE,
    );
    expect(result?.contacts?.lead_source).toBe("referral");
    expect(result?.contacts?.ownership_type_keyword).toBeUndefined();
  });

  it("returns null when no manual contact filters are set", () => {
    expect(buildManualFilterSearchResult("contacts", EMPTY_PROP, EMPTY_CON, EMPTY_LEASE)).toBeNull();
  });
});

describe("buildManualFilterSearchResult — properties (unchanged)", () => {
  it("still uses property_type/ownership_type/size_category/geographic_category", () => {
    const result = buildManualFilterSearchResult(
      "properties",
      { propType: "industrial", ownership: "private", sizeCat: "Large", geoCat: "Brickell" },
      EMPTY_CON,
      EMPTY_LEASE,
    );
    expect(result?.properties?.property_type).toBe("industrial");
    expect(result?.properties?.ownership_type).toBe("private");
    expect(result?.properties?.size_category_keyword).toBe("Large");
    expect(result?.properties?.geographic_keyword).toBe("Brickell");
  });
});
