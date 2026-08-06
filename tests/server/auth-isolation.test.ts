/**
 * Tests that server actions scope data access to the authenticated user.
 * These tests mount the real action code with a mocked Supabase client
 * and assert that every query carries an owner_id filter, and that
 * cross-user mutation attempts are rejected before any DB write occurs.
 */
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

vi.mock("@/app/settings/actions", () => ({
  getUserSettings: vi.fn().mockResolvedValue({
    cadence_tier1_days: 30,
    cadence_tier2_days: 60,
    cadence_tier3_days: 90,
    broker_name: "Test Broker",
    broker_email: "broker@test.com",
  }),
}));

vi.mock("@/lib/activity-logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "tool_use", input: { emails: [] } }],
      }),
    };
  },
}));

// Mock next/cache used indirectly by some actions
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import {
  getDueContacts,
  generateDrafts,
  logOutreach,
} from "@/app/outreach/actions";
import { createActivity } from "@/app/activities/actions";
import { createDeal } from "@/app/deals/actions";
import { setLeaseTenant } from "@/app/abstracts/[id]/actions";
import { fetchFieldDefs } from "@/lib/custom-fields";
import { fetchMatchingPropertyIdsFromClient } from "@/lib/crm-search-filters";

// ─── Mock Supabase builder ────────────────────────────────────────────────────

type EqCall = { field: string; value: unknown };
type ChainRecord = {
  table: string;
  op: "select" | "insert" | "update" | "delete" | "upsert";
  eqs: EqCall[];
  data?: unknown;
};

/**
 * Builds a minimal Supabase-shaped spy that:
 *  - Returns configured per-table responses
 *  - Records every eq(), insert(), update() call for assertions
 */
function buildSupabaseSpy(
  userId: string | null,
  tableResponses: Record<string, unknown> = {}
) {
  const chains: ChainRecord[] = [];

  function resolveFor(record: ChainRecord): Promise<unknown> {
    const key =
      record.op === "update" || record.op === "insert" || record.op === "upsert"
        ? `${record.table}:${record.op}`
        : record.table;
    const fallback =
      record.op === "insert" || record.op === "upsert"
        ? { data: { id: "mock-id" }, error: null }
        : { data: null, error: null };
    return Promise.resolve(tableResponses[key] ?? fallback);
  }

  function makeChain(table: string) {
    const record: ChainRecord = { table, op: "select", eqs: [] };
    chains.push(record);

    const fluent = () => proxy;

    const proxy = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "eq") {
            return (f: string, v: unknown) => {
              record.eqs.push({ field: f, value: v });
              return proxy;
            };
          }
          if (prop === "insert") {
            return (d: unknown) => {
              record.op = "insert";
              record.data = d;
              return proxy;
            };
          }
          if (prop === "upsert") {
            return (d: unknown) => {
              record.op = "upsert";
              record.data = d;
              return proxy;
            };
          }
          if (prop === "update") {
            return (d: unknown) => {
              record.op = "update";
              record.data = d;
              return proxy;
            };
          }
          if (prop === "delete") {
            return () => { record.op = "delete"; return proxy; };
          }
          if (prop === "single" || prop === "maybeSingle") {
            return () => resolveFor(record);
          }
          if (prop === "then") {
            return (
              onfulfilled: (v: unknown) => unknown,
              onrejected?: (e: unknown) => unknown
            ) => resolveFor(record).then(onfulfilled, onrejected);
          }
          // All other query methods are fluent no-ops
          return fluent;
        },
      }
    );

    return proxy;
  }

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: userId ? { id: userId, email: "test@test.com" } : null,
        },
        error: null,
      }),
    },
    from: vi.fn((table: string) => makeChain(table)),
  };

  const spy = {
    /** True if any query on `table` included .eq("owner_id", ownerId). */
    tableHadOwnerFilter: (table: string, ownerId: string) =>
      chains
        .filter((c) => c.table === table)
        .some((c) =>
          c.eqs.some((e) => e.field === "owner_id" && e.value === ownerId)
        ),

    /** True if any UPDATE on `table` included .eq("owner_id", ownerId). */
    updateHadOwnerFilter: (table: string, ownerId: string) =>
      chains
        .filter((c) => c.table === table && c.op === "update")
        .some((c) =>
          c.eqs.some((e) => e.field === "owner_id" && e.value === ownerId)
        ),

    /** True if any INSERT was attempted on `table`. */
    insertedInto: (table: string) =>
      chains.some((c) => c.table === table && c.op === "insert"),

    /** True if any UPSERT was attempted on `table`. */
    upsertedInto: (table: string) =>
      chains.some((c) => c.table === table && c.op === "upsert"),

    /** True if any UPDATE was attempted on `table`. */
    updatedIn: (table: string) =>
      chains.some((c) => c.table === table && c.op === "update"),

    chains,
  };

  return { supabase, spy };
}

const USER_A = "00000000-0000-0000-0000-000000000001";

// ─── getDueContacts ───────────────────────────────────────────────────────────

describe("getDueContacts", () => {
  it("returns empty array when not authenticated", async () => {
    const { supabase } = buildSupabaseSpy(null);
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await getDueContacts();
    expect(result).toEqual([]);
  });

  it("scopes contacts query to the authenticated user", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: { data: [], error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    await getDueContacts();

    expect(spy.tableHadOwnerFilter("contacts", USER_A)).toBe(true);
  });

  it("scopes properties query to the authenticated user when linked properties exist", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: {
        data: [
          {
            id: "c1",
            name: "Alice",
            email: null,
            company: null,
            role: null,
            contact_tier: 1,
            client_status: null,
            last_contacted_at: null,
            size_category: null,
            geographic_category: null,
            ownership_type: null,
            linked_properties: ["p1"],
          },
        ],
        error: null,
      },
      properties: { data: [], error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    await getDueContacts();

    expect(spy.tableHadOwnerFilter("contacts", USER_A)).toBe(true);
    expect(spy.tableHadOwnerFilter("properties", USER_A)).toBe(true);
  });
});

// ─── logOutreach ──────────────────────────────────────────────────────────────

describe("logOutreach", () => {
  it("returns error for empty subject without touching the database", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A);
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await logOutreach("c1", "", "body text");

    expect(result.error).toBeTruthy();
    expect(spy.updatedIn("contacts")).toBe(false);
  });

  it("returns error for empty body without touching the database", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A);
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await logOutreach("c1", "subject", "");

    expect(result.error).toBeTruthy();
    expect(spy.updatedIn("contacts")).toBe(false);
  });

  it("returns error for subject exceeding 500 chars without touching the database", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A);
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await logOutreach("c1", "x".repeat(501), "body text");

    expect(result.error).toBeTruthy();
    expect(spy.updatedIn("contacts")).toBe(false);
  });

  it("scopes contact fetch to the authenticated user", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: {
        data: { contact_tier: 1, outreach_history: [] },
        error: null,
      },
      "contacts:update": { data: null, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    await logOutreach("c1", "Subject", "Body text");

    expect(spy.tableHadOwnerFilter("contacts", USER_A)).toBe(true);
  });

  it("scopes contact UPDATE to the authenticated user", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: {
        data: { contact_tier: 1, outreach_history: [] },
        error: null,
      },
      "contacts:update": { data: null, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    await logOutreach("c1", "Subject", "Body text");

    expect(spy.updateHadOwnerFilter("contacts", USER_A)).toBe(true);
  });

  it("rejects when contact does not belong to the current user", async () => {
    // Contact query returns null — simulates contact belonging to another user.
    // The owner_id filter causes the SELECT to return no rows.
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: { data: null, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await logOutreach("foreign-contact-id", "Subject", "Body text");

    expect(result.error).toBeTruthy();
    // Must NOT attempt to update a contact that wasn't found
    expect(spy.updatedIn("contacts")).toBe(false);
  });

  it("does not log activity when contact not found", async () => {
    const { supabase } = buildSupabaseSpy(USER_A, {
      contacts: { data: null, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const { logActivity } = await import("@/lib/activity-logger");
    (logActivity as Mock).mockClear();

    await logOutreach("foreign-contact-id", "Subject", "Body");

    expect(logActivity).not.toHaveBeenCalled();
  });
});

// ─── generateDrafts ───────────────────────────────────────────────────────────

describe("generateDrafts", () => {
  it("returns error when not authenticated", async () => {
    const { supabase } = buildSupabaseSpy(null);
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await generateDrafts(["c1"], "broker context");
    expect(result.error).toBeTruthy();
  });

  it("scopes contacts query to the authenticated user", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: {
        data: [
          {
            id: "c1",
            name: "Bob",
            email: "bob@example.com",
            company: null,
            role: null,
            contact_tier: 2,
            client_status: null,
            last_contacted_at: null,
            size_category: null,
            geographic_category: null,
            ownership_type: null,
            linked_properties: [],
          },
        ],
        error: null,
      },
      activities: { data: [], error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    await generateDrafts(["c1"], "broker context");

    expect(spy.tableHadOwnerFilter("contacts", USER_A)).toBe(true);
  });

  it("scopes properties query to the authenticated user when linked properties exist", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: {
        data: [
          {
            id: "c1",
            name: "Bob",
            email: "bob@example.com",
            company: null,
            role: null,
            contact_tier: 1,
            client_status: null,
            last_contacted_at: null,
            size_category: null,
            geographic_category: null,
            ownership_type: null,
            linked_properties: ["p1"],
          },
        ],
        error: null,
      },
      properties: { data: [], error: null },
      activities: { data: [], error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    await generateDrafts(["c1"], "broker context");

    expect(spy.tableHadOwnerFilter("properties", USER_A)).toBe(true);
  });

  it("rejects when no contacts are found (all belong to another user)", async () => {
    const { supabase } = buildSupabaseSpy(USER_A, {
      contacts: { data: [], error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await generateDrafts(["foreign-id"], "broker context");
    expect(result.error).toBeTruthy();
  });
});

// ─── createActivity ───────────────────────────────────────────────────────────

describe("createActivity", () => {
  it("rejects invalid activity_type without querying the database", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A);
    (createClient as Mock).mockResolvedValue(supabase);

    // Cast to bypass TypeScript — we're testing runtime defense
    const result = await createActivity({
      contact_id: "c1",
      activity_type: "invalid" as "call",
    });

    expect(result.error).toMatch(/Invalid activity type/i);
    expect(spy.insertedInto("activities")).toBe(false);
  });

  it("rejects when contact does not belong to the current user", async () => {
    // Contact query returns null — simulates another user's contact
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: { data: null, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await createActivity({
      contact_id: "foreign-contact-id",
      activity_type: "call",
    });

    expect(result.error).toMatch(/Contact not found/i);
    expect(spy.insertedInto("activities")).toBe(false);
  });

  it("rejects when property does not belong to the current user", async () => {
    // Contact found, but property query returns null
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: { data: { id: "c1" }, error: null },
      properties: { data: null, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await createActivity({
      contact_id: "c1",
      property_id: "foreign-property-id",
      activity_type: "email",
    });

    expect(result.error).toMatch(/Property not found/i);
    expect(spy.insertedInto("activities")).toBe(false);
  });

  it("scopes contact ownership check to the authenticated user", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: { data: { id: "c1" }, error: null },
      "activities:insert": { data: { id: "new-act" }, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    await createActivity({ contact_id: "c1", activity_type: "note" });

    expect(spy.tableHadOwnerFilter("contacts", USER_A)).toBe(true);
  });

  it("inserts activity when contact ownership is confirmed", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: { data: { id: "c1" }, error: null },
      "activities:insert": { data: { id: "new-act" }, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await createActivity({
      contact_id: "c1",
      activity_type: "meeting",
    });

    expect(result.error).toBeUndefined();
    expect(spy.insertedInto("activities")).toBe(true);
  });

  it("returns error when not authenticated", async () => {
    const { supabase } = buildSupabaseSpy(null);
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await createActivity({
      contact_id: "c1",
      activity_type: "call",
    });

    expect(result.error).toBeTruthy();
  });
});

// ─── contact_properties join helpers ──────────────────────────────────────────

import {
  contactIdsForProperty,
  propertyIdsForContact,
  linkContactProperty,
} from "@/lib/contact-properties";
import { linkPropertyToEntity, linkContactToEntity } from "@/lib/entities";

describe("contact_properties auth isolation", () => {
  it("scopes property→contact lookup by owner_id", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contact_properties: {
        data: [{ contact_id: "c1" }],
        error: null,
      },
    });

    await contactIdsForProperty(supabase, USER_A, "p1");

    expect(spy.tableHadOwnerFilter("contact_properties", USER_A)).toBe(true);
  });

  it("scopes contact→property lookup by owner_id", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contact_properties: {
        data: [{ property_id: "p1" }],
        error: null,
      },
    });

    await propertyIdsForContact(supabase, USER_A, "c1");

    expect(spy.tableHadOwnerFilter("contact_properties", USER_A)).toBe(true);
  });
});

// ─── Write-side FK ownership checks ────────────────────────────────────────────
//
// The audit that motivated these tests found that several write paths accepted
// a foreign-key id (contact_id / property_id / entity_id) from the caller and
// wrote it into a row without verifying that the referenced record belongs to
// the same owner. RLS already blocks *reading* another user's row through the
// planted pointer, but nothing stopped the pointer from being planted in the
// first place. These tests prove the write itself is now rejected.

describe("linkContactProperty — rejects planting a pointer to another owner's record", () => {
  it("rejects when the contact does not belong to the caller", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: { data: null, error: null },
      properties: { data: { id: "p1" }, error: null },
    });

    await expect(
      linkContactProperty(supabase, USER_A, "foreign-contact", "p1")
    ).rejects.toThrow(/contact does not belong to this owner/i);
    expect(spy.upsertedInto("contact_properties")).toBe(false);
  });

  it("rejects when the property does not belong to the caller", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: { data: { id: "c1" }, error: null },
      properties: { data: null, error: null },
    });

    await expect(
      linkContactProperty(supabase, USER_A, "c1", "foreign-property")
    ).rejects.toThrow(/property does not belong to this owner/i);
    expect(spy.upsertedInto("contact_properties")).toBe(false);
  });

  it("links when both contact and property belong to the caller", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: { data: { id: "c1" }, error: null },
      properties: { data: { id: "p1" }, error: null },
      "contact_properties:upsert": { data: null, error: null },
    });

    await expect(linkContactProperty(supabase, USER_A, "c1", "p1")).resolves.toBeUndefined();
    expect(spy.upsertedInto("contact_properties")).toBe(true);
  });
});

describe("linkPropertyToEntity — rejects planting a pointer to another owner's record", () => {
  it("rejects when the property does not belong to the caller", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      properties: { data: null, error: null },
      entities: { data: { id: "e1" }, error: null },
    });

    await expect(
      linkPropertyToEntity(supabase, USER_A, "foreign-property", "e1")
    ).rejects.toThrow(/property does not belong to this owner/i);
    expect(spy.upsertedInto("entity_properties")).toBe(false);
  });

  it("rejects when the entity does not belong to the caller", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      properties: { data: { id: "p1" }, error: null },
      entities: { data: null, error: null },
    });

    await expect(
      linkPropertyToEntity(supabase, USER_A, "p1", "foreign-entity")
    ).rejects.toThrow(/entity does not belong to this owner/i);
    expect(spy.upsertedInto("entity_properties")).toBe(false);
  });

  it("links and updates properties.entity_id when both belong to the caller", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      properties: { data: { id: "p1" }, error: null },
      entities: { data: { id: "e1" }, error: null },
      "entity_properties:upsert": { data: null, error: null },
      "properties:update": { data: null, error: null },
    });

    await expect(linkPropertyToEntity(supabase, USER_A, "p1", "e1")).resolves.toBeUndefined();
    expect(spy.upsertedInto("entity_properties")).toBe(true);
    expect(spy.updateHadOwnerFilter("properties", USER_A)).toBe(true);
  });
});

describe("linkContactToEntity — rejects planting a pointer to another owner's record", () => {
  it("rejects when the entity does not belong to the caller", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      entities: { data: null, error: null },
      contacts: { data: { id: "c1" }, error: null },
    });

    await expect(
      linkContactToEntity(supabase, USER_A, "foreign-entity", "c1")
    ).rejects.toThrow(/entity does not belong to this owner/i);
    expect(spy.upsertedInto("entity_contacts")).toBe(false);
  });

  it("rejects when the contact does not belong to the caller", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      entities: { data: { id: "e1" }, error: null },
      contacts: { data: null, error: null },
    });

    await expect(
      linkContactToEntity(supabase, USER_A, "e1", "foreign-contact")
    ).rejects.toThrow(/contact does not belong to this owner/i);
    expect(spy.upsertedInto("entity_contacts")).toBe(false);
  });

  it("links when both entity and contact belong to the caller", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      entities: { data: { id: "e1" }, error: null },
      contacts: { data: { id: "c1" }, error: null },
      "entity_contacts:upsert": { data: null, error: null },
    });

    await expect(linkContactToEntity(supabase, USER_A, "e1", "c1")).resolves.toBeUndefined();
    expect(spy.upsertedInto("entity_contacts")).toBe(true);
  });
});

describe("createDeal — cannot reference another owner's contact/property", () => {
  it("rejects a deal referencing a contact the caller does not own", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: { data: null, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await createDeal({ name: "Test Deal", contact_id: "foreign-contact" });

    expect(result.error).toMatch(/contact isn't in your book/i);
    expect(spy.insertedInto("deals")).toBe(false);
  });

  it("rejects a deal referencing a property the caller does not own", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      properties: { data: null, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await createDeal({ name: "Test Deal", property_id: "foreign-property" });

    expect(result.error).toMatch(/property isn't in your book/i);
    expect(spy.insertedInto("deals")).toBe(false);
  });

  it("creates the deal when the referenced contact and property are owned", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: { data: { id: "c1" }, error: null },
      properties: { data: { id: "p1" }, error: null },
      "deals:insert": {
        data: {
          id: "deal-1",
          name: "Test Deal",
          contact_id: "c1",
          property_id: "p1",
          next_action: null,
          next_action_due: null,
        },
        error: null,
      },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await createDeal({ name: "Test Deal", contact_id: "c1", property_id: "p1" });

    expect(result.error).toBeUndefined();
    expect(spy.insertedInto("deals")).toBe(true);
  });
});

describe("setLeaseTenant — cannot point a lease at another owner's contact", () => {
  it("rejects a tenant contact the caller does not own", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: { data: null, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await setLeaseTenant("lease-1", "foreign-contact");

    expect(result.error).toMatch(/contact isn't in your book/i);
    expect(spy.updatedIn("lease_abstracts")).toBe(false);
  });

  it("updates the lease when the tenant contact is owned", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      contacts: { data: { id: "c1" }, error: null },
      "lease_abstracts:update": { data: null, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await setLeaseTenant("lease-1", "c1");

    expect(result.error).toBeUndefined();
    expect(spy.updatedIn("lease_abstracts")).toBe(true);
  });

  it("allows clearing the tenant contact (null) without an ownership lookup", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      "lease_abstracts:update": { data: null, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await setLeaseTenant("lease-1", null);

    expect(result.error).toBeUndefined();
    expect(spy.updatedIn("lease_abstracts")).toBe(true);
  });
});

// ─── Read-side defense-in-depth: explicit owner_id filters backstopping RLS ────

describe("fetchFieldDefs — explicit owner_id filter (defense in depth alongside RLS)", () => {
  it("scopes the field_definitions query by owner_id", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      field_definitions: { data: [], error: null },
    });

    await fetchFieldDefs(supabase as unknown as Parameters<typeof fetchFieldDefs>[0], USER_A, "property");

    expect(spy.tableHadOwnerFilter("field_definitions", USER_A)).toBe(true);
  });
});

describe("fetchMatchingPropertyIdsFromClient — explicit owner_id filter (defense in depth alongside RLS)", () => {
  it("scopes the properties query by owner_id", async () => {
    const { supabase, spy } = buildSupabaseSpy(USER_A, {
      properties: { data: [], error: null },
    });

    await fetchMatchingPropertyIdsFromClient(supabase, USER_A, {});

    expect(spy.tableHadOwnerFilter("properties", USER_A)).toBe(true);
  });
});
