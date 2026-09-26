import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";
import { INDUSTRIAL_COLUMN_BY_SLUG, isCustomGroup, type IndustrialFields } from "@/lib/industrial-fields";

export type BuiltinFieldSource = {
  size_sqft?: number | null;
  land_sqft?: number | null;
  last_sale_date?: string | null;
  last_sale_price?: number | null;
  owner_name?: string | null;
  building_composition?: {
    year_built?: number | null;
    lot_size_sqft?: number | null;
    stories?: number | null;
    units?: number | null;
    assessed_value?: number | null;
  } | null;
} & Partial<IndustrialFields>;

const YEAR_BUILT_SLUGS = new Set(["year_built", "yearbuilt", "yr_built", "yr_blt", "year_of_construction"]);
const STORIES_SLUGS = new Set(["stories", "number_of_stories"]);
const UNITS_SLUGS = new Set(["units"]);
const LOT_SLUGS = new Set(["lot_size", "lot_size_sqft", "lot_sf", "land_sf", "land_sqft"]);
const ASSESSED_SLUGS = new Set(["assessed_value", "assessed"]);
const BUILDING_SF_SLUGS = new Set(["building_sf", "building_sqft", "building_size", "size_sqft"]);

function hasValue(value: unknown): boolean {
  return value != null && value !== "";
}

/** County / first-class value that matches a broker custom-field slug. */
export function builtinValueForCustomSlug(
  slug: string,
  source: BuiltinFieldSource,
): string | number | null {
  const bc = source.building_composition;
  if (YEAR_BUILT_SLUGS.has(slug)) return bc?.year_built ?? null;
  if (STORIES_SLUGS.has(slug)) return bc?.stories ?? null;
  if (UNITS_SLUGS.has(slug)) return bc?.units ?? null;
  if (LOT_SLUGS.has(slug)) return bc?.lot_size_sqft ?? source.land_sqft ?? null;
  if (ASSESSED_SLUGS.has(slug)) return bc?.assessed_value ?? null;
  if (BUILDING_SF_SLUGS.has(slug)) return source.size_sqft ?? null;
  const industrialCol = INDUSTRIAL_COLUMN_BY_SLUG[slug];
  if (industrialCol) {
    const value = source[industrialCol];
    return value != null && value !== "" ? value : null;
  }
  return null;
}

export function resolveCustomFieldValue(
  slug: string,
  custom: Record<string, string | number | null> | null | undefined,
  source: BuiltinFieldSource,
): string | number | null {
  const stored = custom?.[slug];
  if (hasValue(stored)) return stored as string | number;
  const builtin = builtinValueForCustomSlug(slug, source);
  return hasValue(builtin) ? builtin : null;
}

export function fillCustomFieldsFromBuiltins(
  defs: FieldDefinition[],
  custom: Record<string, string | number | null> | null | undefined,
  source: BuiltinFieldSource,
): Record<string, string | number | null> {
  const next = { ...(custom ?? {}) };
  for (const def of defs) {
    if (!isCustomGroup(def)) continue;
    const slug = fieldSlug(def.field_name);
    if (hasValue(next[slug])) continue;
    const builtin = builtinValueForCustomSlug(slug, source);
    if (hasValue(builtin) && builtin != null) next[slug] = builtin;
  }
  return next;
}

export function customFieldsNeedBuiltinFill(
  before: Record<string, string | number | null> | null | undefined,
  after: Record<string, string | number | null>,
): boolean {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  for (const key of keys) {
    if ((before?.[key] ?? null) !== (after[key] ?? null)) return true;
  }
  return false;
}
