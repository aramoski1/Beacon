import { describe, it, expect } from "vitest";
import { fieldSlug, buildCustomFieldsSchema } from "../../lib/custom-fields";
import type { FieldDefinition } from "../../lib/custom-fields";

// ─── fieldSlug ────────────────────────────────────────────────────────────────

describe("fieldSlug", () => {
  it("lowercases the input", () => {
    expect(fieldSlug("ALLCAPS")).toBe("allcaps");
  });

  it("replaces spaces with underscores", () => {
    expect(fieldSlug("Cap Rate")).toBe("cap_rate");
  });

  it("replaces multiple consecutive non-alphanumeric chars with a single underscore", () => {
    expect(fieldSlug("My  Custom  Field")).toBe("my_custom_field");
  });

  it("strips leading and trailing underscores", () => {
    expect(fieldSlug("  Leading Trailing  ")).toBe("leading_trailing");
  });

  it("preserves digits", () => {
    expect(fieldSlug("CO2 Level")).toBe("co2_level");
  });

  it("replaces special characters with underscores", () => {
    // "Field #1" — ' ' and '#' are both non-alnum, collapsed to a single '_'
    expect(fieldSlug("Field #1")).toBe("field_1");
  });

  it("handles an already-snake-case name", () => {
    expect(fieldSlug("my_custom_field")).toBe("my_custom_field");
  });

  it("returns an empty string for an all-symbol input", () => {
    expect(fieldSlug("!!!")).toBe("");
  });

  it("returns an empty string for an empty string", () => {
    expect(fieldSlug("")).toBe("");
  });

  it("produces the same slug for colliding display names", () => {
    // These are two different display names that map to the same slug —
    // the collision case buildCustomFieldsSchema must handle.
    expect(fieldSlug("My Field")).toBe(fieldSlug("MY FIELD"));
    expect(fieldSlug("cap rate")).toBe(fieldSlug("Cap Rate"));
  });

  it("converts mixed separators (dash, dot, slash) to underscores", () => {
    expect(fieldSlug("Year-Built")).toBe("year_built");
    expect(fieldSlug("Price/SF")).toBe("price_sf");
    expect(fieldSlug("lot.size")).toBe("lot_size");
  });
});

// ─── buildCustomFieldsSchema ──────────────────────────────────────────────────

// Minimal FieldDefinition factory — only the fields buildCustomFieldsSchema reads.
function makeDef(
  field_name: string,
  field_type: FieldDefinition["field_type"],
  extra: Partial<FieldDefinition> = {}
): FieldDefinition {
  return {
    id: "id-" + field_name,
    owner_id: "owner-1",
    entity_type: "property",
    field_name,
    field_type,
    select_options: null,
    fill_mode: null,
    created_at: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

describe("buildCustomFieldsSchema", () => {
  it("returns an empty object for an empty field list", () => {
    expect(buildCustomFieldsSchema([])).toEqual({});
  });

  // ── Type mapping ───────────────────────────────────────────────────────────

  it("maps a text field to {type: ['string','null'], description: field_name}", () => {
    const schema = buildCustomFieldsSchema([makeDef("Notes", "text")]);
    expect(schema).toEqual({
      notes: { type: ["string", "null"], description: "Notes" },
    });
  });

  it("maps a number field to {type: ['number','null']}", () => {
    const schema = buildCustomFieldsSchema([makeDef("Cap Rate", "number")]);
    expect(schema).toEqual({
      cap_rate: { type: ["number", "null"], description: "Cap Rate" },
    });
  });

  it("maps a date field with '(ISO 8601 date)' appended to description", () => {
    const schema = buildCustomFieldsSchema([makeDef("Closing Date", "date")]);
    expect(schema).toEqual({
      closing_date: {
        type: ["string", "null"],
        description: "Closing Date (ISO 8601 date)",
      },
    });
  });

  it("maps a select field with options to an enum that includes null", () => {
    const schema = buildCustomFieldsSchema([
      makeDef("Status", "select", { select_options: ["Active", "Inactive"] }),
    ]);
    expect(schema).toEqual({
      status: {
        type: ["string", "null"],
        enum: ["Active", "Inactive", null],
        description: "Status",
      },
    });
  });

  it("treats a select field with null select_options as text (falls through)", () => {
    const schema = buildCustomFieldsSchema([
      makeDef("Zone", "select", { select_options: null }),
    ]);
    expect(schema).toEqual({
      zone: { type: ["string", "null"], description: "Zone" },
    });
  });

  it("treats a select field with an empty options array as text (falls through)", () => {
    const schema = buildCustomFieldsSchema([
      makeDef("Zone", "select", { select_options: [] }),
    ]);
    expect(schema).toEqual({
      zone: { type: ["string", "null"], description: "Zone" },
    });
  });

  // ── Slug as key ────────────────────────────────────────────────────────────

  it("uses the slugged field_name as the object key", () => {
    const schema = buildCustomFieldsSchema([makeDef("Year Built", "number")]);
    expect(Object.keys(schema)).toEqual(["year_built"]);
  });

  it("uses the original field_name (not the slug) as the description", () => {
    const schema = buildCustomFieldsSchema([
      makeDef("My Custom Field", "text"),
    ]) as Record<string, { description: string }>;
    expect(schema["my_custom_field"].description).toBe("My Custom Field");
  });

  // ── Multiple fields ────────────────────────────────────────────────────────

  it("handles multiple fields of different types", () => {
    const schema = buildCustomFieldsSchema([
      makeDef("Notes", "text"),
      makeDef("Cap Rate", "number"),
      makeDef("Closing Date", "date"),
      makeDef("Zone", "select", { select_options: ["A", "B"] }),
    ]);
    expect(Object.keys(schema)).toEqual([
      "notes",
      "cap_rate",
      "closing_date",
      "zone",
    ]);
    expect((schema["zone"] as { enum: unknown[] }).enum).toContain(null);
  });

  // ── Slug collision ─────────────────────────────────────────────────────────

  it("last definition wins when two field names collide to the same slug", () => {
    // "Cap Rate" and "CAP RATE" both slug to "cap_rate".
    // The second definition overwrites the first.
    const schema = buildCustomFieldsSchema([
      makeDef("Cap Rate", "text"),      // first: text
      makeDef("CAP RATE", "number"),    // second: number — wins
    ]);
    expect(Object.keys(schema)).toHaveLength(1);
    expect(schema["cap_rate"]).toMatchObject({ type: ["number", "null"] });
  });

  it("does not add extra properties to a select entry beyond type, enum, description", () => {
    const schema = buildCustomFieldsSchema([
      makeDef("Priority", "select", { select_options: ["High", "Low"] }),
    ]) as Record<string, object>;
    expect(Object.keys(schema["priority"])).toEqual(["type", "enum", "description"]);
  });
});
