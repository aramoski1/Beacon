"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { fieldSlug, scrubCustomFieldValues, renameCustomFieldValues, type FieldDefinition, type EntityType, type FieldType, type FillMode } from "@/lib/custom-fields";

export async function getFieldDefinitions(): Promise<FieldDefinition[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("owner_id", user.id)
    .order("entity_type")
    .order("created_at", { ascending: true });
  return (data ?? []) as FieldDefinition[];
}

export async function createFieldDefinition(
  formData: FormData
): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const entity_type = formData.get("entity_type") as EntityType;
  const field_name  = (formData.get("field_name") as string | null)?.trim() ?? "";
  const field_type  = formData.get("field_type")  as FieldType;
  const fill_mode   = (formData.get("fill_mode")  as FillMode | null) || null;
  const optionsRaw  = (formData.get("select_options") as string | null)?.trim() ?? "";

  if (!field_name) return { error: "Field name is required." };
  if (!["property", "contact", "lease", "deal"].includes(entity_type))
    return { error: "Invalid entity type." };
  if (!["text", "number", "date", "select"].includes(field_type))
    return { error: "Invalid field type." };
  if (entity_type === "property" && !fill_mode)
    return { error: "Property fields require a fill mode (extract or manual)." };
  if (fieldSlug(field_name).length < 1)
    return { error: "Field name must contain at least one letter or digit." };

  let select_options: string[] | null = null;
  if (field_type === "select") {
    select_options = optionsRaw.split(",").map(s => s.trim()).filter(Boolean);
    if (select_options.length === 0)
      return { error: "Select fields need at least one option (comma-separated)." };
  }

  const { data, error } = await supabase
    .from("field_definitions")
    .insert({
      owner_id: user.id,
      entity_type,
      field_name,
      field_type,
      fill_mode: entity_type === "property" ? fill_mode : null,
      select_options,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505")
      return { error: "A field with that name already exists for this entity." };
    return { error: error.message };
  }
  return { id: data.id };
}

export async function renameFieldDefinition(
  id: string,
  newName: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const trimmed = newName.trim();
  if (!trimmed) return { error: "Field name is required." };
  if (fieldSlug(trimmed).length < 1)
    return { error: "Field name must contain at least one letter or digit." };

  const { data: existing, error: fetchErr } = await supabase
    .from("field_definitions")
    .select("id, entity_type, field_name")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();
  if (fetchErr || !existing) return { error: "Field not found." };

  if (existing.field_name === trimmed) return {};

  const { error: updateErr } = await supabase
    .from("field_definitions")
    .update({ field_name: trimmed })
    .eq("id", id)
    .eq("owner_id", user.id);

  if (updateErr) {
    if (updateErr.code === "23505")
      return { error: "A field with that name already exists for this entity." };
    return { error: updateErr.message };
  }

  const oldSlug = fieldSlug(existing.field_name);
  const newSlug = fieldSlug(trimmed);
  if (oldSlug !== newSlug) {
    await renameCustomFieldValues(supabase, user.id, existing.entity_type as EntityType, oldSlug, newSlug);
  }

  return {};
}

export async function deleteFieldDefinition(
  id: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: def } = await supabase
    .from("field_definitions")
    .select("entity_type, field_name")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  const { error } = await supabase
    .from("field_definitions")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };

  if (def) {
    await scrubCustomFieldValues(supabase, user.id, def.entity_type as EntityType, def.field_name);
  }
  return {};
}
