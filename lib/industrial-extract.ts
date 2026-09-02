import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";
import {
  AVAILABILITY_STATUS,
  INDUSTRIAL_COLUMN_BY_SLUG,
  LEASE_STRUCTURES,
  POWER_PHASES,
  SPRINKLER_TYPES,
  isIndustrialGroup,
  type IndustrialFields,
} from "@/lib/industrial-fields";

export const EMPTY_INDUSTRIAL: IndustrialFields = {
  clear_height_ft: null,
  dock_doors: null,
  drive_in_doors: null,
  power_amps: null,
  power_phase: null,
  yard_acres: null,
  column_spacing: null,
  sprinkler_type: null,
  availability_status: null,
  asking_rent_psf: null,
  nnn_cam_psf: null,
  lease_structure: null,
};

const SQFT_PER_ACRE = 43_560;

const CUSTOM_FIELD_ALIASES: Record<keyof IndustrialFields, string[]> = {
  clear_height_ft: ["clear_height_ft", "clear_height", "clearheight", "ceiling_height"],
  dock_doors: ["dock_doors", "docks", "dock_high_doors", "loading_docks"],
  drive_in_doors: ["drive_in_doors", "drive_in", "grade_doors", "drive_in_door"],
  power_amps: ["power_amps", "amps", "power"],
  power_phase: ["power_phase", "phase"],
  yard_acres: ["yard_acres", "yard", "outside_storage_acres"],
  column_spacing: ["column_spacing", "bay_spacing"],
  sprinkler_type: ["sprinkler_type", "sprinkler", "sprinklers"],
  availability_status: ["availability_status", "availability"],
  asking_rent_psf: ["asking_rent_psf", "asking_rent", "asking_rate"],
  nnn_cam_psf: ["nnn_cam_psf", "nnn_cam", "cam", "opex"],
  lease_structure: ["lease_structure", "lease_type"],
};

const INDUSTRIAL_LABELS: Record<keyof IndustrialFields, string> = {
  clear_height_ft: "Clear height",
  dock_doors: "Dock doors",
  drive_in_doors: "Drive-in doors",
  power_amps: "Power",
  power_phase: "Phase",
  yard_acres: "Yard",
  column_spacing: "Column spacing",
  sprinkler_type: "Sprinkler",
  availability_status: "Availability",
  asking_rent_psf: "Asking rent",
  nnn_cam_psf: "NNN / CAM",
  lease_structure: "Lease structure",
};

export const INDUSTRIAL_FIELD_KEYS = Object.keys(EMPTY_INDUSTRIAL) as (keyof IndustrialFields)[];

export function industrialFieldLabel(key: keyof IndustrialFields): string {
  return INDUSTRIAL_LABELS[key];
}

export function parseNumericSpec(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const m = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function pickEnum(value: unknown, allowed: readonly string[]): string | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (allowed.includes(raw)) return raw;
  if (raw === "1_phase" || raw === "single" || raw === "single_phase") return allowed.includes("1") ? "1" : null;
  if (raw === "3_phase" || raw === "three" || raw === "three_phase") return allowed.includes("3") ? "3" : null;
  if (raw === "offmarket") return allowed.includes("off_market") ? "off_market" : null;
  if (raw === "nnn" || raw === "triple_net") return allowed.includes("nnn") ? "nnn" : null;
  return null;
}

function customValue(
  custom: Record<string, string | number | null> | null | undefined,
  key: keyof IndustrialFields,
): unknown {
  if (!custom) return null;
  for (const alias of CUSTOM_FIELD_ALIASES[key]) {
    if (custom[alias] != null && custom[alias] !== "") return custom[alias];
  }
  return null;
}

function coerceField(key: keyof IndustrialFields, value: unknown): IndustrialFields[typeof key] {
  if (key === "column_spacing") {
    if (value == null || value === "") return null;
    const s = String(value).trim();
    return s || null;
  }
  if (key === "power_phase") {
    return pickEnum(value, POWER_PHASES.map((p) => p.value));
  }
  if (key === "sprinkler_type") {
    return pickEnum(value, SPRINKLER_TYPES.map((p) => p.value));
  }
  if (key === "availability_status") {
    return pickEnum(value, AVAILABILITY_STATUS.map((p) => p.value));
  }
  if (key === "lease_structure") {
    return pickEnum(value, LEASE_STRUCTURES.map((p) => p.value));
  }
  return parseNumericSpec(value);
}

export function yardAcresFromLandSqft(landSqft: number | null | undefined): number | null {
  if (landSqft == null || landSqft <= 0) return null;
  return Math.round((landSqft / SQFT_PER_ACRE) * 100) / 100;
}

export type IndustrialExtractSource = {
  clear_height_ft?: number | string | null;
  dock_doors?: number | string | null;
  drive_in_doors?: number | string | null;
  power_amps?: number | string | null;
  power_phase?: string | null;
  yard_acres?: number | string | null;
  column_spacing?: string | null;
  sprinkler_type?: string | null;
  availability_status?: string | null;
  asking_rent_psf?: number | string | null;
  nnn_cam_psf?: number | string | null;
  lease_structure?: string | null;
  custom_fields?: Record<string, string | number | null> | null;
  building_composition?: { lot_size_sqft?: number | null } | null;
};

export function industrialFromExtracted(fields: IndustrialExtractSource): IndustrialFields {
  const out: IndustrialFields = { ...EMPTY_INDUSTRIAL };
  for (const key of INDUSTRIAL_FIELD_KEYS) {
    const direct = coerceField(key, fields[key]);
    if (direct != null) {
      Object.assign(out, { [key]: direct });
      continue;
    }
    const fromCustom = coerceField(key, customValue(fields.custom_fields, key));
    if (fromCustom != null) {
      Object.assign(out, { [key]: fromCustom });
    }
  }
  return out;
}

export function industrialFromCustomFields(
  custom: Record<string, string | number | null> | null | undefined,
  landSqft?: number | null,
): IndustrialFields {
  return industrialFromExtracted({ custom_fields: custom, building_composition: { lot_size_sqft: landSqft ?? null } });
}

/** Prefer stored columns; fill gaps from custom_fields. Does not invent specs from lot SF. */
export function mergeIndustrialDisplay(
  columns: Partial<IndustrialFields> | null | undefined,
  custom: Record<string, string | number | null> | null | undefined,
  landSqft?: number | null,
): IndustrialFields {
  const lifted = industrialFromCustomFields(custom, landSqft);
  const overlay: Partial<IndustrialFields> = {};
  for (const key of INDUSTRIAL_FIELD_KEYS) {
    const col = columns?.[key];
    if (col != null && col !== "") overlay[key] = col as never;
  }
  return { ...EMPTY_INDUSTRIAL, ...lifted, ...overlay };
}

/** Omit nulls so an upsert update does not wipe values the source did not mention. */
export function compactIndustrial(fields: IndustrialFields): Partial<IndustrialFields> {
  const out: Partial<IndustrialFields> = {};
  for (const key of INDUSTRIAL_FIELD_KEYS) {
    if (fields[key] != null && fields[key] !== "") {
      Object.assign(out, { [key]: fields[key] });
    }
  }
  return out;
}

export function industrialSpecValue(
  def: FieldDefinition,
  custom: Record<string, string | number | null> | null | undefined,
  columns?: Partial<IndustrialFields> | null,
): string | number | null {
  const slug = fieldSlug(def.field_name);
  const fromCustom = custom?.[slug];
  if (fromCustom != null && fromCustom !== "") return fromCustom;
  const col = INDUSTRIAL_COLUMN_BY_SLUG[slug];
  if (col) {
    const fromCol = columns?.[col];
    if (fromCol != null && fromCol !== "") return fromCol;
  }
  return null;
}

/**
 * Map extract output onto the broker's current industrial field list.
 * Deleted defaults are not written. User-added specs come from custom_fields.
 */
export function persistIndustrialFromExtract(
  defs: FieldDefinition[],
  source: IndustrialExtractSource,
): {
  custom: Record<string, string | number | null>;
  columns: Partial<IndustrialFields>;
} {
  const extracted = industrialFromExtracted(source);
  const custom: Record<string, string | number | null> = { ...(source.custom_fields ?? {}) };
  const industrialDefs = defs.filter(isIndustrialGroup);

  if (industrialDefs.length === 0) {
    return { custom, columns: {} };
  }

  const columns: Partial<IndustrialFields> = {};
  for (const def of industrialDefs) {
    const slug = fieldSlug(def.field_name);
    const col = INDUSTRIAL_COLUMN_BY_SLUG[slug];
    const fromCustom = custom[slug];
    const fromCol = col ? extracted[col] : null;
    const value = fromCustom != null && fromCustom !== "" ? fromCustom : fromCol;
    if (value == null || value === "") continue;
    custom[slug] = value as string | number;
    if (col) Object.assign(columns, { [col]: extracted[col] ?? coerceField(col, value) });
  }
  return { custom, columns };
}
