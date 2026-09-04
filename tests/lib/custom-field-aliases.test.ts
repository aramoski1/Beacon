import { describe, expect, it } from "vitest";
import {
  builtinValueForCustomSlug,
  customFieldsNeedBuiltinFill,
  fillCustomFieldsFromBuiltins,
  resolveCustomFieldValue,
} from "@/lib/custom-field-aliases";
import type { FieldDefinition } from "@/lib/custom-fields";

function def(name: string, group: "custom" | "industrial" = "custom"): FieldDefinition {
  return {
    id: name,
    owner_id: "u",
    entity_type: "property",
    field_name: name,
    field_type: "number",
    select_options: null,
    fill_mode: "extract",
    field_group: group,
    created_at: "2026-01-01",
  };
}

const source = {
  size_sqft: 42000,
  land_sqft: 80000,
  building_composition: {
    year_built: 2019,
    lot_size_sqft: 80000,
    stories: 1,
    units: 2,
    assessed_value: 4_100_000,
  },
};

describe("builtinValueForCustomSlug", () => {
  it("maps Year Built to building_composition.year_built", () => {
    expect(builtinValueForCustomSlug("year_built", source)).toBe(2019);
  });

  it("returns null for unknown slugs", () => {
    expect(builtinValueForCustomSlug("clear_height", source)).toBeNull();
  });
});

describe("fillCustomFieldsFromBuiltins", () => {
  it("copies year built into an empty custom field", () => {
    const out = fillCustomFieldsFromBuiltins([def("Year Built")], {}, source);
    expect(out.year_built).toBe(2019);
  });

  it("does not overwrite an existing custom value", () => {
    const out = fillCustomFieldsFromBuiltins(
      [def("Year Built")],
      { year_built: 1990 },
      source,
    );
    expect(out.year_built).toBe(1990);
  });

  it("skips industrial specs", () => {
    const out = fillCustomFieldsFromBuiltins([def("Year Built", "industrial")], {}, source);
    expect(out.year_built).toBeUndefined();
  });
});

describe("resolveCustomFieldValue", () => {
  it("prefers the stored custom value", () => {
    expect(resolveCustomFieldValue("year_built", { year_built: 2001 }, source)).toBe(2001);
  });

  it("falls back to the county year when the custom field is empty", () => {
    expect(resolveCustomFieldValue("year_built", {}, source)).toBe(2019);
  });
});

describe("customFieldsNeedBuiltinFill", () => {
  it("detects a newly filled slug", () => {
    expect(customFieldsNeedBuiltinFill({}, { year_built: 2019 })).toBe(true);
    expect(customFieldsNeedBuiltinFill({ year_built: 2019 }, { year_built: 2019 })).toBe(false);
  });
});
