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

// ─── Mock Supabase builder ────────────────────────────────────────────────────

type EqCall = { field: string; value: unknown };
type ChainRecord = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
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
      record.op === "update" || record.op === "insert"
        ? `${record.table}:${record.op}`
        : record.table;
    const fallback =
      record.op === "insert"
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
} from "@/lib/contact-properties";

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
