import type { SupabaseClient } from "@supabase/supabase-js";

export type FieldType = "text" | "number" | "date" | "select";
export type EntityType = "property" | "contact" | "lease";
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

export async function fetchFieldDefs(
  supabase: SupabaseClient,
  entityType: EntityType
): Promise<FieldDefinition[]> {
  const { data } = await supabase
    .from("field_definitions")
    .select("*")
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
