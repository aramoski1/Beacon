/**
 * Regression coverage for the owner-portfolio false-grouping bug:
 * getOwnerPortfolioForProperty (app/owner-portfolio/actions.ts) used to OR a
 * loose fuzzy name match (entityMatchesProperty) into the property set
 * unconditionally — even for rows that already had their OWN, different
 * entity_id. A property durably linked to entity A must never be pulled into
 * entity B's portfolio just because the two owner_name strings loosely
 * resemble each other (see lib/mdpa-owner-search.ts entityOwnerNamesMatch
 * for the matching-algorithm-level fix).
 */
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getOwnerPortfolioForProperty } from "@/app/owner-portfolio/actions";

const USER_A = "00000000-0000-0000-0000-000000000001";

type Row = Record<string, unknown>;

/** Minimal fluent Supabase spy: every query on a table resolves with that table's canned rows. */
function buildSupabaseSpy(tableRows: Record<string, Row[]>) {
  function makeChain(table: string) {
    const rows = tableRows[table] ?? [];
    const proxy = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "single" || prop === "maybeSingle") {
            return () => Promise.resolve({ data: rows[0] ?? null, error: null });
          }
          if (prop === "then") {
            return (onf: (v: unknown) => unknown) =>
              Promise.resolve({ data: rows, error: null }).then(onf);
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  }

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_A } }, error: null }),
    },
    from: vi.fn((table: string) => makeChain(table)),
  };

  return supabase;
}

function property(overrides: Partial<Row> = {}): Row {
  return {
    id: "prop-anchor",
    address: "1 Main St",
    city: "Miami",
    submarket: null,
    property_type: "industrial",
    size_sqft: 10_000,
    owner_name: "PARADISE 2 LLC",
    owner_mailing_address: null,
    owner_contacts: null,
    owner_contact_name: null,
    owner_contact_address: null,
    entity_id: null,
    last_sale_date: null,
    last_sale_price: null,
    ownership_change_detected_at: null,
    ownership_change_data: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOwnerPortfolioForProperty — entity_id guards the fuzzy fallback", () => {
  it("does not pull in a property that already has a DIFFERENT entity_id, even if names loosely match", async () => {
    const anchor = property({
      id: "prop-anchor",
      owner_name: "PARADISE 2 LLC",
      entity_id: "entity-paradise-2",
    });
    // Loosely resembles the anchor's owner_name under the old bag-of-words
    // matcher ("paradise") but is a different, already-linked entity.
    const unrelated = property({
      id: "prop-unrelated",
      address: "2 Ocean Ridge Dr",
      owner_name: "OCEAN RIDGE PARADISE 120 LLC",
      entity_id: "entity-ocean-ridge",
    });

    const supabase = buildSupabaseSpy({
      properties: [anchor, unrelated],
      entity_properties: [{ property_id: "prop-anchor" }],
      contacts: [],
      lease_abstracts: [],
      contact_properties: [],
      activities: [],
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await getOwnerPortfolioForProperty("prop-anchor");

    expect(result).not.toBeNull();
    const ids = result!.properties.map((p) => p.id);
    expect(ids).toContain("prop-anchor");
    expect(ids).not.toContain("prop-unrelated");
  });

  it("still groups a property with no entity_id yet via the (now stricter) fuzzy match", async () => {
    const anchor = property({
      id: "prop-anchor",
      owner_name: "ACME HOLDINGS LLC",
      entity_id: null,
    });
    // Same entity, tax-roll adds a state suffix — no entity_id assigned yet.
    const variant = property({
      id: "prop-variant",
      address: "2 Second St",
      owner_name: "ACME HOLDINGS LLC A FL",
      entity_id: null,
    });

    const supabase = buildSupabaseSpy({
      properties: [anchor, variant],
      // anchor has no entity_id yet, so getOwnerPortfolioForProperty lazily
      // resolves/creates one via syncPropertyEntity before matching.
      entities: [{ id: "entity-acme" }],
      entity_properties: [],
      contacts: [],
      lease_abstracts: [],
      contact_properties: [],
      activities: [],
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await getOwnerPortfolioForProperty("prop-anchor");

    expect(result).not.toBeNull();
    const ids = result!.properties.map((p) => p.id);
    expect(ids).toContain("prop-anchor");
    expect(ids).toContain("prop-variant");
  });
});
