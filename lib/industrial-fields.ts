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
