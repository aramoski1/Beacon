import { describe, it, expect } from "vitest";
import { aggregateRelatedEntities, aggregateRelatedPersons } from "@/lib/portfolio-graph";

// ─── aggregateRelatedEntities ─────────────────────────────────────────────────

describe("aggregateRelatedEntities", () => {
  it("returns empty array when no properties", () => {
    expect(aggregateRelatedEntities([])).toEqual([]);
  });

  it("skips null and empty owner_name values", () => {
    const result = aggregateRelatedEntities([
      { owner_name: null },
      { owner_name: "" },
      { owner_name: "  " },
    ]);
    expect(result).toHaveLength(0);
  });

  it("aggregates unique entity names and counts properties", () => {
    const result = aggregateRelatedEntities([
      { owner_name: "Acme LLC" },
      { owner_name: "Acme LLC" },
      { owner_name: "Beta Holdings" },
    ]);
    expect(result).toHaveLength(2);
    const acme = result.find((e) => e.name === "Acme LLC");
    expect(acme?.propertyCount).toBe(2);
    const beta = result.find((e) => e.name === "Beta Holdings");
    expect(beta?.propertyCount).toBe(1);
  });

  it("sorts by propertyCount descending", () => {
    const result = aggregateRelatedEntities([
      { owner_name: "Solo Corp" },
      { owner_name: "Big Group LLC" },
      { owner_name: "Big Group LLC" },
      { owner_name: "Big Group LLC" },
    ]);
    expect(result[0].name).toBe("Big Group LLC");
    expect(result[0].propertyCount).toBe(3);
    expect(result[1].name).toBe("Solo Corp");
  });

  it("deduplicates case-insensitively", () => {
    const result = aggregateRelatedEntities([
      { owner_name: "ACME LLC" },
      { owner_name: "acme llc" },
      { owner_name: "Acme LLC" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].propertyCount).toBe(3);
  });
});

// ─── aggregateRelatedPersons ──────────────────────────────────────────────────

describe("aggregateRelatedPersons", () => {
  it("returns empty array when no properties", () => {
    expect(aggregateRelatedPersons([])).toEqual([]);
  });

  it("skips null or empty owner_contacts", () => {
    const result = aggregateRelatedPersons([
      { owner_contacts: null, owner_name: null, owner_mailing_address: null },
      { owner_contacts: [], owner_name: null, owner_mailing_address: null },
    ]);
    expect(result).toHaveLength(0);
  });

  it("aggregates persons from owner_contacts array", () => {
    // Supabase returns JSONB columns as parsed arrays, not strings
    const contacts = [
      { name: "John Doe", title: "Managing Member", address: null },
      { name: "Jane Smith", title: "Officer", address: null },
    ];
    const result = aggregateRelatedPersons([
      { owner_contacts: contacts, owner_name: "Acme LLC", owner_mailing_address: null },
      { owner_contacts: contacts, owner_name: "Acme LLC", owner_mailing_address: null },
    ]);
    const john = result.find((p) => p.name === "John Doe");
    expect(john).toBeDefined();
    expect(john?.propertyCount).toBe(2);
    expect(john?.title).toBe("Managing Member");
  });

  it("sorts by propertyCount descending", () => {
    const singleContact = [{ name: "Alice Brown", title: "CEO", address: null }];
    const multiContact = [{ name: "Bob Green", title: "President", address: null }];
    const result = aggregateRelatedPersons([
      { owner_contacts: singleContact, owner_name: null, owner_mailing_address: null },
      { owner_contacts: multiContact, owner_name: null, owner_mailing_address: null },
      { owner_contacts: multiContact, owner_name: null, owner_mailing_address: null },
    ]);
    expect(result[0].name).toBe("Bob Green");
    expect(result[0].propertyCount).toBe(2);
  });

  it("deduplicates persons case-insensitively across properties", () => {
    const contacts1 = [{ name: "Carlos Mendez", title: "Owner", address: null }];
    const contacts2 = [{ name: "CARLOS MENDEZ", title: "Owner", address: null }];
    const result = aggregateRelatedPersons([
      { owner_contacts: contacts1, owner_name: null, owner_mailing_address: null },
      { owner_contacts: contacts2, owner_name: null, owner_mailing_address: null },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].propertyCount).toBe(2);
  });

  it("limits output to 20 persons", () => {
    const properties = Array.from({ length: 25 }, (_, i) => ({
      owner_contacts: [{ name: `Person ${i}`, title: null, address: null }],
      owner_name: null,
      owner_mailing_address: null,
    }));
    const result = aggregateRelatedPersons(properties);
    expect(result.length).toBeLessThanOrEqual(20);
  });
});
