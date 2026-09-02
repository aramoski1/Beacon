import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fieldSlug,
  type FieldDefinition,
  type FieldType,
  type FillMode,
} from "@/lib/custom-fields";

export const AVAILABILITY_STATUS = [
  { value: "available", label: "Available" },
  { value: "leased", label: "Leased" },
  { value: "off_market", label: "Off market" },
  { value: "under_contract", label: "Under contract" },
] as const;

export const LEASE_STRUCTURES = [
  { value: "nnn", label: "NNN" },
  { value: "modified_gross", label: "Modified gross" },
  { value: "gross", label: "Gross" },
  { value: "industrial_gross", label: "Industrial gross" },
] as const;

export const POWER_PHASES = [
  { value: "1", label: "1-phase" },
  { value: "3", label: "3-phase" },
] as const;

export const SPRINKLER_TYPES = [
  { value: "esfr", label: "ESFR" },
  { value: "k25", label: "K25" },
  { value: "wet", label: "Wet" },
  { value: "dry", label: "Dry" },
  { value: "none", label: "None" },
] as const;

export type IndustrialFields = {
  clear_height_ft: number | null;
  dock_doors: number | null;
  drive_in_doors: number | null;
  power_amps: number | null;
  power_phase: string | null;
  yard_acres: number | null;
  column_spacing: string | null;
  sprinkler_type: string | null;
  availability_status: string | null;
  asking_rent_psf: number | null;
  nnn_cam_psf: number | null;
  lease_structure: string | null;
};

export const INDUSTRIAL_SELECT =
  "clear_height_ft, dock_doors, drive_in_doors, power_amps, power_phase, yard_acres, column_spacing, sprinkler_type, availability_status, asking_rent_psf, nnn_cam_psf, lease_structure";

export type IndustrialDefaultSpec = {
  field_name: string;
  field_type: FieldType;
  fill_mode: FillMode;
  select_options: string[] | null;
  suffix: string | null;
  column: keyof IndustrialFields | null;
};

/** Default industrial/flex specs. Seeded once per broker; deletable and extensible like custom fields. */
export const DEFAULT_INDUSTRIAL_SPECS: IndustrialDefaultSpec[] = [
  { field_name: "Clear height", field_type: "number", fill_mode: "extract", select_options: null, suffix: "ft", column: "clear_height_ft" },
  { field_name: "Dock doors", field_type: "number", fill_mode: "extract", select_options: null, suffix: null, column: "dock_doors" },
  { field_name: "Drive-in doors", field_type: "number", fill_mode: "extract", select_options: null, suffix: null, column: "drive_in_doors" },
  { field_name: "Power", field_type: "number", fill_mode: "extract", select_options: null, suffix: "amps", column: "power_amps" },
  { field_name: "Phase", field_type: "select", fill_mode: "extract", select_options: POWER_PHASES.map((p) => p.value), suffix: null, column: "power_phase" },
  { field_name: "Yard", field_type: "number", fill_mode: "extract", select_options: null, suffix: "ac", column: "yard_acres" },
  { field_name: "Column spacing", field_type: "text", fill_mode: "extract", select_options: null, suffix: null, column: "column_spacing" },
  { field_name: "Sprinkler", field_type: "select", fill_mode: "extract", select_options: SPRINKLER_TYPES.map((p) => p.value), suffix: null, column: "sprinkler_type" },
  { field_name: "Availability", field_type: "select", fill_mode: "extract", select_options: AVAILABILITY_STATUS.map((p) => p.value), suffix: null, column: "availability_status" },
  { field_name: "Asking rent", field_type: "number", fill_mode: "extract", select_options: null, suffix: "$/SF", column: "asking_rent_psf" },
  { field_name: "NNN / CAM", field_type: "number", fill_mode: "extract", select_options: null, suffix: "$/SF", column: "nnn_cam_psf" },
  { field_name: "Lease structure", field_type: "select", fill_mode: "extract", select_options: LEASE_STRUCTURES.map((p) => p.value), suffix: null, column: "lease_structure" },
];

/** Slug (and aliases) → first-class properties column, for CRM/workspace compatibility. */
export const INDUSTRIAL_COLUMN_BY_SLUG: Record<string, keyof IndustrialFields> = {
  clear_height: "clear_height_ft",
  clear_height_ft: "clear_height_ft",
  dock_doors: "dock_doors",
  drive_in_doors: "drive_in_doors",
  power: "power_amps",
  power_amps: "power_amps",
  phase: "power_phase",
  power_phase: "power_phase",
  yard: "yard_acres",
  yard_acres: "yard_acres",
  column_spacing: "column_spacing",
  sprinkler: "sprinkler_type",
  sprinkler_type: "sprinkler_type",
  availability: "availability_status",
  availability_status: "availability_status",
  asking_rent: "asking_rent_psf",
  asking_rent_psf: "asking_rent_psf",
  nnn_cam: "nnn_cam_psf",
  nnn_cam_psf: "nnn_cam_psf",
  lease_structure: "lease_structure",
};

const DEFAULT_NAME_SET = new Set(DEFAULT_INDUSTRIAL_SPECS.map((s) => s.field_name));

export function isDefaultIndustrialName(fieldName: string): boolean {
  return DEFAULT_NAME_SET.has(fieldName);
}

export function industrialSuffix(slug: string): string | null {
  const spec = DEFAULT_INDUSTRIAL_SPECS.find((s) => fieldSlug(s.field_name) === slug);
  return spec?.suffix ?? null;
}

export function industrialColumnForSlug(slug: string): keyof IndustrialFields | null {
  return INDUSTRIAL_COLUMN_BY_SLUG[slug] ?? null;
}

export function isIndustrialGroup(def: FieldDefinition): boolean {
  return def.field_group === "industrial";
}

export function isCustomGroup(def: FieldDefinition): boolean {
  return def.field_group !== "industrial";
}

export async function fetchIndustrialFieldDefs(
  supabase: SupabaseClient,
): Promise<FieldDefinition[]> {
  const { data } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("entity_type", "property")
    .eq("field_group", "industrial")
    .order("created_at", { ascending: true });
  return (data ?? []) as FieldDefinition[];
}

/**
 * Seed the default industrial spec list once. If the broker (or a teammate)
 * already has industrial field_definitions, do not insert again — even if
 * they deleted every default. That way "delete" sticks.
 */
export async function ensureIndustrialFieldDefs(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<FieldDefinition[]> {
  const existing = await fetchIndustrialFieldDefs(supabase);
  const { data: settings } = await supabase
    .from("user_settings")
    .select("industrial_specs_initialized")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (existing.length > 0) {
    if (!settings?.industrial_specs_initialized) {
      await supabase.from("user_settings").upsert(
        {
          owner_id: ownerId,
          industrial_specs_initialized: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id" },
      );
    }
    return existing;
  }

  if (settings?.industrial_specs_initialized) return [];

  const rows = DEFAULT_INDUSTRIAL_SPECS.map((spec) => ({
    owner_id: ownerId,
    entity_type: "property" as const,
    field_group: "industrial" as const,
    field_name: spec.field_name,
    field_type: spec.field_type,
    fill_mode: spec.fill_mode,
    select_options: spec.select_options,
  }));

  const { error } = await supabase.from("field_definitions").insert(rows);
  if (error && error.code !== "23505") {
    console.error("ensureIndustrialFieldDefs insert failed:", error.message);
  }

  await supabase.from("user_settings").upsert(
    {
      owner_id: ownerId,
      industrial_specs_initialized: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" },
  );

  return fetchIndustrialFieldDefs(supabase);
}

export async function propertyExtractFieldDefs(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<FieldDefinition[]> {
  await ensureIndustrialFieldDefs(supabase, ownerId);
  const { data } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("entity_type", "property")
    .eq("fill_mode", "extract")
    .order("created_at", { ascending: true });
  return (data ?? []) as FieldDefinition[];
}

export async function scrubIndustrialColumn(
  supabase: SupabaseClient,
  ownerId: string,
  slug: string,
): Promise<void> {
  const column = industrialColumnForSlug(slug);
  if (!column) return;
  await supabase
    .from("properties")
    .update({ [column]: null, updated_at: new Date().toISOString() })
    .eq("owner_id", ownerId);
}
