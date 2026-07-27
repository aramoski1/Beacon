/**
 * Regression coverage for deleteProperty (app/crm/actions.ts).
 *
 * activities has a CHECK constraint requiring contact_id OR property_id to be
 * non-null. Deleting a property used to rely on ON DELETE SET NULL for
 * activities.property_id, which violated that constraint for property-only
 * activities (no contact). deleteProperty must now:
 *   1. delete property-only activities (contact_id IS NULL) for the property
 *   2. clear property_id on the remaining (contact-linked) activities
 *   3. delete the property
 * — in that order, before the FK's ON DELETE CASCADE would ever fire.
 */
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { deleteProperty } from "@/app/crm/actions";

// ─── Mock Supabase builder ────────────────────────────────────────────────────

type EqCall = { field: string; value: unknown };
type ChainRecord = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  eqs: EqCall[];
  isNulls: string[];
  data?: unknown;
};

function buildSupabaseSpy(userId: string, tableResponses: Record<string, unknown> = {}) {
  const chains: ChainRecord[] = [];

  function resolveFor(record: ChainRecord): Promise<unknown> {
    const fallback = { data: null, error: null };
    return Promise.resolve(tableResponses[record.table] ?? fallback);
  }

  function makeChain(table: string) {
    const record: ChainRecord = { table, op: "select", eqs: [], isNulls: [] };
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
          if (prop === "is") {
            return (f: string, v: unknown) => {
              if (v === null) record.isNulls.push(f);
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
            return () => {
              record.op = "delete";
              return proxy;
            };
          }
          if (prop === "then") {
            return (
              onfulfilled: (v: unknown) => unknown,
              onrejected?: (e: unknown) => unknown
            ) => resolveFor(record).then(onfulfilled, onrejected);
          }
          return fluent;
        },
      }
    );

    return proxy;
  }

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId, email: "test@test.com" } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => makeChain(table)),
  };

  return { supabase, chains };
}

const USER_A = "00000000-0000-0000-0000-000000000001";
const PROPERTY_ID = "prop-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleteProperty — activities_contact_or_property safety", () => {
  it("deletes property-only activities before deleting the property", async () => {
    const { supabase, chains } = buildSupabaseSpy(USER_A);
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await deleteProperty(PROPERTY_ID);

    expect(result.error).toBeUndefined();

    const activityChains = chains.filter((c) => c.table === "activities");
    const propertyChains = chains.filter((c) => c.table === "properties");

    // Property-only purge: DELETE activities WHERE property_id = id AND contact_id IS NULL
    const purge = activityChains.find((c) => c.op === "delete");
    expect(purge).toBeDefined();
    expect(purge!.eqs).toContainEqual({ field: "property_id", value: PROPERTY_ID });
    expect(purge!.eqs).toContainEqual({ field: "owner_id", value: USER_A });
    expect(purge!.isNulls).toContain("contact_id");

    // Unlink: UPDATE activities SET property_id = null WHERE property_id = id
    const unlink = activityChains.find((c) => c.op === "update");
    expect(unlink).toBeDefined();
    expect(unlink!.data).toEqual({ property_id: null });
    expect(unlink!.eqs).toContainEqual({ field: "property_id", value: PROPERTY_ID });
    expect(unlink!.eqs).toContainEqual({ field: "owner_id", value: USER_A });

    // Property delete happens last.
    const propDelete = propertyChains.find((c) => c.op === "delete");
    expect(propDelete).toBeDefined();
    expect(propDelete!.eqs).toContainEqual({ field: "id", value: PROPERTY_ID });
    expect(propDelete!.eqs).toContainEqual({ field: "owner_id", value: USER_A });

    // Order: purge activities -> unlink activities -> delete property.
    const purgeIdx = chains.indexOf(purge!);
    const unlinkIdx = chains.indexOf(unlink!);
    const propDeleteIdx = chains.indexOf(propDelete!);
    expect(purgeIdx).toBeLessThan(unlinkIdx);
    expect(unlinkIdx).toBeLessThan(propDeleteIdx);
  });

  it("succeeds deleting a property that only has a property-only activity", async () => {
    const { supabase } = buildSupabaseSpy(USER_A, {
      activities: { data: null, error: null },
      properties: { data: null, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await deleteProperty(PROPERTY_ID);

    expect(result.error).toBeUndefined();
  });

  it("returns the error and stops if the activities purge fails", async () => {
    const { supabase, chains } = buildSupabaseSpy(USER_A, {
      activities: { data: null, error: { message: "purge failed" } },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await deleteProperty(PROPERTY_ID);

    expect(result.error).toBe("purge failed");
    expect(chains.some((c) => c.table === "properties" && c.op === "delete")).toBe(false);
  });

  it("returns an error when not authenticated", async () => {
    const supabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      from: vi.fn(),
    };
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await deleteProperty(PROPERTY_ID);

    expect(result.error).toBe("Not authenticated.");
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
