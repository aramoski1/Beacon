import type { SupabaseClient } from "@supabase/supabase-js";

export type FieldType = "text" | "number" | "date" | "select";
export type EntityType = "property" | "contact" | "lease" | "deal";
export type FillMode = "extract" | "manual";

export type FieldDefinition = {
  id: string;
  owner_id: string;
  entity_type: EntityType;
  field_name: string;
  field_type: FieldType;
  select_options: string[] | null;
  fill_mode: FillMode | null;
  created_at: string;
};

// "My Custom Field" → "my_custom_field"
export function fieldSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const ENTITY_TABLES: Record<EntityType, string> = {
  property: "properties",
  contact: "contacts",
  lease: "lease_abstracts",
  deal: "deals",
};

// Removes a deleted field's stored values from every entity's custom_fields JSONB
// for this owner. Without this, recreating a field with the same name later would
// silently resurrect stale values that nobody re-entered (custom_fields has no FK
// back to field_definitions — the link is the slug alone).
export async function scrubCustomFieldValues(
  supabase: SupabaseClient,
  ownerId: string,
  entityType: EntityType,
  fieldName: string
): Promise<void> {
  const slug = fieldSlug(fieldName);
  if (!slug) return;
  const table = ENTITY_TABLES[entityType];
  const { data: rows } = await supabase
    .from(table)
    .select("id, custom_fields")
    .eq("owner_id", ownerId)
    .not("custom_fields", "is", null);
  if (!rows?.length) return;
  for (const row of rows as { id: string; custom_fields: Record<string, unknown> | null }[]) {
    const cf = row.custom_fields;
    if (!cf || !(slug in cf)) continue;
    const rest = { ...cf };
    delete rest[slug];
    await supabase.from(table).update({ custom_fields: rest }).eq("id", row.id).eq("owner_id", ownerId);
  }
}

// Moves a field's stored values from the old slug to the new one across every
// entity row for this owner, when a rename changes the derived slug (e.g.
// "Cap Rate" -> "Cap Rate %"). Without this, a rename would silently orphan
// every value already saved under the old slug — custom_fields has no FK
// back to field_definitions, so the slug is the only link between the two.
export async function renameCustomFieldValues(
  supabase: SupabaseClient,
  ownerId: string,
  entityType: EntityType,
  oldSlug: string,
  newSlug: string
): Promise<void> {
  if (!oldSlug || !newSlug || oldSlug === newSlug) return;
  const table = ENTITY_TABLES[entityType];
  const { data: rows } = await supabase
    .from(table)
    .select("id, custom_fields")
    .eq("owner_id", ownerId)
    .not("custom_fields", "is", null);
  if (!rows?.length) return;
  for (const row of rows as { id: string; custom_fields: Record<string, unknown> | null }[]) {
    const cf = row.custom_fields;
    if (!cf || !(oldSlug in cf)) continue;
    const rest = { ...cf };
    rest[newSlug] = rest[oldSlug];
    delete rest[oldSlug];
    await supabase.from(table).update({ custom_fields: rest }).eq("id", row.id).eq("owner_id", ownerId);
  }
}

export async function fetchFieldDefs(
  supabase: SupabaseClient,
  ownerId: string,
  entityType: EntityType
): Promise<FieldDefinition[]> {
  const { data } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("entity_type", entityType)
    .order("created_at", { ascending: true });
  return (data ?? []) as FieldDefinition[];
}

// Build the `properties` map for the Anthropic tool schema's custom_fields object
export function buildCustomFieldsSchema(fields: FieldDefinition[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const f of fields) {
    const slug = fieldSlug(f.field_name);
    if (f.field_type === "number") {
      props[slug] = { type: ["number", "null"], description: f.field_name };
    } else if (f.field_type === "date") {
      props[slug] = { type: ["string", "null"], description: `${f.field_name} (ISO 8601 date)` };
    } else if (f.field_type === "select" && f.select_options?.length) {
      props[slug] = {
        type: ["string", "null"],
        enum: [...f.select_options, null],
        description: f.field_name,
      };
    } else {
      props[slug] = { type: ["string", "null"], description: f.field_name };
    }
  }
  return props;
}
