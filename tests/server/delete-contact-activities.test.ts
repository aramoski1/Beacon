/**
 * Regression coverage for deleteContact (app/crm/actions.ts).
 *
 * activities.contact_id has ON DELETE CASCADE, so deleting a contact used to
 * silently destroy every activity tied to it — including activities that also
 * reference a still-existing property, wiping out that property's timeline
 * with no warning. deleteContact must now mirror deleteProperty's pattern:
 *   1. delete contact-only activities (property_id IS NULL) for the contact
 *   2. clear contact_id on the remaining (property-linked) activities
 *   3. delete the contact
 * — in that order, before the FK's ON DELETE CASCADE would ever fire.
 */
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { deleteContact } from "@/app/crm/actions";

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
const CONTACT_ID = "contact-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleteContact — activity preservation", () => {
  it("purges contact-only activities, unlinks property-linked ones, then deletes the contact", async () => {
    // contact select returns null (no name / no linked_properties), so the
    // owner-name-preservation branch is skipped and we isolate the activity logic.
    const { supabase, chains } = buildSupabaseSpy(USER_A, {
      contacts: { data: null, error: null },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await deleteContact(CONTACT_ID);

    expect(result.error).toBeUndefined();

    const activityChains = chains.filter((c) => c.table === "activities");
    const contactChains = chains.filter((c) => c.table === "contacts");

    // Contact-only purge: DELETE activities WHERE contact_id = id AND property_id IS NULL
    const purge = activityChains.find((c) => c.op === "delete");
    expect(purge).toBeDefined();
    expect(purge!.eqs).toContainEqual({ field: "contact_id", value: CONTACT_ID });
    expect(purge!.eqs).toContainEqual({ field: "owner_id", value: USER_A });
    expect(purge!.isNulls).toContain("property_id");

    // Unlink: UPDATE activities SET contact_id = null WHERE contact_id = id
    const unlink = activityChains.find((c) => c.op === "update");
    expect(unlink).toBeDefined();
    expect(unlink!.data).toEqual({ contact_id: null });
    expect(unlink!.eqs).toContainEqual({ field: "contact_id", value: CONTACT_ID });
    expect(unlink!.eqs).toContainEqual({ field: "owner_id", value: USER_A });

    // Contact delete happens last.
    const contactDelete = contactChains.find((c) => c.op === "delete");
    expect(contactDelete).toBeDefined();
    expect(contactDelete!.eqs).toContainEqual({ field: "id", value: CONTACT_ID });
    expect(contactDelete!.eqs).toContainEqual({ field: "owner_id", value: USER_A });

    // Order: purge activities -> unlink activities -> delete contact.
    const purgeIdx = chains.indexOf(purge!);
    const unlinkIdx = chains.indexOf(unlink!);
    const contactDeleteIdx = chains.indexOf(contactDelete!);
    expect(purgeIdx).toBeLessThan(unlinkIdx);
    expect(unlinkIdx).toBeLessThan(contactDeleteIdx);
  });

  it("returns the error and stops if the activities purge fails", async () => {
    const { supabase, chains } = buildSupabaseSpy(USER_A, {
      contacts: { data: null, error: null },
      activities: { data: null, error: { message: "purge failed" } },
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await deleteContact(CONTACT_ID);

    expect(result.error).toBe("purge failed");
    expect(chains.some((c) => c.table === "contacts" && c.op === "delete")).toBe(false);
  });

  it("returns an error when not authenticated", async () => {
    const supabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      from: vi.fn(),
    };
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await deleteContact(CONTACT_ID);

    expect(result.error).toBe("Not authenticated.");
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
