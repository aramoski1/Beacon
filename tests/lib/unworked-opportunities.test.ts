import { describe, expect, it } from "vitest";
import {
  collectOwnerLinkedPropertyIds,
  pickUnworkedOpportunities,
} from "../../lib/unworked-opportunities";

const prop = (
  id: string,
  extras: Partial<{
    address: string | null;
    owner_name: string | null;
    owner_contact_name: string | null;
    owner_contacts: unknown;
    ingested_at: string | null;
  }> = {},
) => ({
  id,
  address: extras.address ?? `${id} Main`,
  owner_name: extras.owner_name === undefined ? "Acme LLC" : extras.owner_name,
  owner_contact_name: extras.owner_contact_name ?? null,
  owner_contacts: extras.owner_contacts ?? [],
  ingested_at: extras.ingested_at ?? "2026-09-01",
});

describe("collectOwnerLinkedPropertyIds", () => {
  it("prefers join-table ids and ignores extra legacy ids on the same contact", () => {
    const linked = collectOwnerLinkedPropertyIds(
      [{ id: "c1", linked_properties: ["p-join", "p-legacy-only"] }],
      new Map([["c1", ["p-join"]]]),
    );
    expect(linked.has("p-join")).toBe(true);
    expect(linked.has("p-legacy-only")).toBe(false);
  });

  it("falls back to legacy when the join table has no rows for that contact", () => {
    const linked = collectOwnerLinkedPropertyIds(
      [{ id: "c1", linked_properties: ["p-legacy"] }],
      new Map(),
    );
    expect([...linked]).toEqual(["p-legacy"]);
  });

  it("does not treat tenant-only links as owner-linked (caller passes owner contacts only)", () => {
    const linked = collectOwnerLinkedPropertyIds(
      [{ id: "owner-1", linked_properties: ["p1"] }],
      new Map([["tenant-9", ["p2"]]]),
    );
    expect([...linked]).toEqual(["p1"]);
  });
});

describe("pickUnworkedOpportunities", () => {
  it("returns properties with owner names that are not owner-linked", () => {
    const items = pickUnworkedOpportunities(
      [prop("p1"), prop("p2"), prop("p3")],
      new Set(["p2"]),
      8,
    );
    expect(items.map((i) => i.id)).toEqual(["p1", "p3"]);
  });

  it("skips blank owner names", () => {
    const items = pickUnworkedOpportunities(
      [prop("p1", { owner_name: "  " }), prop("p2", { owner_name: null })],
      new Set(),
      8,
    );
    expect(items).toEqual([]);
  });

  it("prefers stored owner-contact name, then owner_contact_name column", () => {
    const items = pickUnworkedOpportunities(
      [
        prop("p1", {
          owner_contacts: [{ name: "Ada Principal", title: "AMBR", address: null }],
          owner_contact_name: "Fallback",
        }),
        prop("p2", { owner_contacts: [], owner_contact_name: "Column Name" }),
      ],
      new Set(),
      8,
    );
    expect(items[0].owner_contact_name).toBe("Ada Principal");
    expect(items[1].owner_contact_name).toBe("Column Name");
  });

  it("respects the limit", () => {
    const items = pickUnworkedOpportunities(
      [prop("p1"), prop("p2"), prop("p3")],
      new Set(),
      2,
    );
    expect(items).toHaveLength(2);
  });
});
