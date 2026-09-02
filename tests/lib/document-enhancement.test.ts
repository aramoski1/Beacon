import { describe, expect, it } from "vitest";
import { computeDocumentDiff, AUTHORITATIVE_PROPERTY_FIELDS, type ExistingPropertyForDiff } from "@/lib/document-enhancement";
import type { ExtractedProperty } from "@/lib/property-pipeline";
import type { FieldDefinition } from "@/lib/custom-fields";

function baseExisting(overrides: Partial<ExistingPropertyForDiff> = {}): ExistingPropertyForDiff {
  return {
    owner_name: null,
    size_sqft: null,
    land_sqft: null,
    asset_description: null,
    last_sale_date: null,
    last_sale_price: null,
    custom_fields: {},
    ...overrides,
  };
}

function baseExtracted(overrides: Partial<ExtractedProperty> = {}): ExtractedProperty {
  return {
    address: "123 Main St",
    city: "Miami",
    submarket: null,
    owner_name: null,
    ownership_type: "unknown",
    size_sqft: null,
    property_type: "industrial",
    last_sale_date: null,
    last_sale_price: null,
    building_composition: {},
    confidence_flags: [],
    custom_fields: {},
    ...overrides,
  };
}

function customField(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: "fd-1",
    owner_id: "owner-1",
    entity_type: "property",
    field_name: "Clear Height",
    field_type: "text",
    select_options: null,
    fill_mode: "extract",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeDocumentDiff — core fields", () => {
  it("fills an empty field, not a conflict", () => {
    const existing = baseExisting({ owner_name: null });
    const extracted = baseExtracted({ owner_name: "Acme LLC" });

    const diff = computeDocumentDiff(existing, extracted, []);

    expect(diff.changes.some((c) => c.field === "owner_name")).toBe(true);
    expect(diff.conflicts.some((c) => c.field === "owner_name")).toBe(false);
  });

  it.each([...AUTHORITATIVE_PROPERTY_FIELDS])(
    "flags a conflict, never auto-applies, when %s already has a differing value",
    (field) => {
      const existing = baseExisting({
        owner_name: "Existing Owner LLC",
        size_sqft: 10_000,
        land_sqft: 20_000,
        last_sale_date: "2020-01-01",
        last_sale_price: 1_000_000,
      });
      const extracted = baseExtracted({
        owner_name: "New Owner LLC",
        size_sqft: 12_000,
        last_sale_date: "2023-06-15",
        last_sale_price: 1_500_000,
        building_composition: { lot_size_sqft: 25_000 },
      });

      const diff = computeDocumentDiff(existing, extracted, []);

      expect(diff.conflicts.some((c) => c.field === field)).toBe(true);
      expect(diff.changes.some((c) => c.field === field)).toBe(false);
    }
  );

  it("treats a differing non-authoritative field (asset_description) as a plain change", () => {
    const existing = baseExisting({ asset_description: "Old description" });
    const extracted = baseExtracted({ building_composition: { dor_description: "New description" } });

    const diff = computeDocumentDiff(existing, extracted, []);

    expect(diff.changes.some((c) => c.field === "asset_description")).toBe(true);
    expect(diff.conflicts.some((c) => c.field === "asset_description")).toBe(false);
  });

  it("never suggests clearing an existing value when the source is silent (extracted null)", () => {
    const existing = baseExisting({
      owner_name: "Existing Owner LLC",
      size_sqft: 10_000,
      asset_description: "Existing description",
    });
    const extracted = baseExtracted({ owner_name: null, size_sqft: null });

    const diff = computeDocumentDiff(existing, extracted, []);

    const allFields = [...diff.changes, ...diff.conflicts, ...diff.unchanged].map((e) => e.field);
    expect(allFields).not.toContain("owner_name");
    expect(allFields).not.toContain("size_sqft");
  });

  it("marks an equal value as unchanged", () => {
    const existing = baseExisting({ owner_name: "Same Owner LLC" });
    const extracted = baseExtracted({ owner_name: "Same Owner LLC" });

    const diff = computeDocumentDiff(existing, extracted, []);

    expect(diff.unchanged.some((c) => c.field === "owner_name")).toBe(true);
    expect(diff.changes.some((c) => c.field === "owner_name")).toBe(false);
    expect(diff.conflicts.some((c) => c.field === "owner_name")).toBe(false);
  });
});

describe("computeDocumentDiff — custom (broker-defined, extract-mode) fields", () => {
  it("fills an empty custom field", () => {
    const def = customField({ field_name: "Clear Height" });
    const existing = baseExisting({ custom_fields: {} });
    const extracted = baseExtracted({ custom_fields: { clear_height: "24 ft" } });

    const diff = computeDocumentDiff(existing, extracted, [def]);

    const entry = diff.changes.find((c) => c.field === "custom_fields.clear_height");
    expect(entry).toBeTruthy();
    expect(entry?.rawAfter).toBe("24 ft");
  });

  it("is never conflict-gated even when it overwrites an existing value — custom fields aren't authoritative", () => {
    const def = customField({ field_name: "Dock Doors" });
    const existing = baseExisting({ custom_fields: { dock_doors: "2" } });
    const extracted = baseExtracted({ custom_fields: { dock_doors: "6" } });

    const diff = computeDocumentDiff(existing, extracted, [def]);

    expect(diff.changes.some((c) => c.field === "custom_fields.dock_doors")).toBe(true);
    expect(diff.conflicts.some((c) => c.field === "custom_fields.dock_doors")).toBe(false);
  });

  it("omits a custom field the source doesn't mention (extracted null) — never fabricates", () => {
    const def = customField({ field_name: "Clear Height" });
    const existing = baseExisting({ custom_fields: {} });
    const extracted = baseExtracted({
      custom_fields: { clear_height: null },
      confidence_flags: [{ field: "custom_fields.clear_height", reason: "not mentioned in this flyer" }],
    });

    const diff = computeDocumentDiff(existing, extracted, [def]);

    const allFields = [...diff.changes, ...diff.conflicts, ...diff.unchanged].map((e) => e.field);
    expect(allFields).not.toContain("custom_fields.clear_height");
  });

  it("preserves the confidence_flag reason verbatim rather than a generic default", () => {
    // computeDocumentDiff itself doesn't surface the reason (that's the caller's
    // job via extracted.confidence_flags), but it must leave the flag data intact
    // and must not write anything for a null custom field, so the reason stays
    // meaningful when the caller looks it up.
    const def = customField({ field_name: "Clear Height" });
    const existing = baseExisting({ custom_fields: {} });
    const reason = "flyer mentions ceiling height only for the mezzanine, not the warehouse";
    const extracted = baseExtracted({
      custom_fields: { clear_height: null },
      confidence_flags: [{ field: "custom_fields.clear_height", reason }],
    });

    computeDocumentDiff(existing, extracted, [def]);

    expect(extracted.confidence_flags.find((f) => f.field === "custom_fields.clear_height")?.reason).toBe(reason);
  });
});

describe("computeDocumentDiff — first-class industrial specs", () => {
  it("fills empty dock doors from extract via the Dock doors spec", () => {
    const existing = baseExisting({ dock_doors: null });
    const extracted = baseExtracted({ dock_doors: 8 });
    const diff = computeDocumentDiff(existing, extracted, [customField({ field_name: "Dock doors" })]);
    const entry = diff.changes.find((c) => c.field === "custom_fields.dock_doors");
    expect(entry?.rawAfter).toBe(8);
    expect(diff.conflicts.some((c) => c.field === "custom_fields.dock_doors")).toBe(false);
  });

  it("lifts custom_fields.clear_height into the Clear height spec", () => {
    const existing = baseExisting();
    const extracted = baseExtracted({ custom_fields: { clear_height: "24 ft" } });
    const diff = computeDocumentDiff(existing, extracted, [customField({ field_name: "Clear height" })]);
    expect(diff.changes.find((c) => c.field === "custom_fields.clear_height")?.rawAfter).toBe("24 ft");
  });

  it("does not clear existing docks when extract omits them", () => {
    const existing = baseExisting({ dock_doors: 4 });
    const extracted = baseExtracted({});
    const diff = computeDocumentDiff(existing, extracted, [customField({ field_name: "Dock doors" })]);
    const all = [...diff.changes, ...diff.conflicts, ...diff.unchanged].map((e) => e.field);
    expect(all).not.toContain("custom_fields.dock_doors");
    expect(all).not.toContain("dock_doors");
  });
});
