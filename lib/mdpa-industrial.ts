import type { ExtractedProperty } from "@/lib/property-pipeline";
import type { IndustrialFields } from "@/lib/industrial-fields";
import { EMPTY_INDUSTRIAL, INDUSTRIAL_FIELD_KEYS } from "@/lib/industrial-extract";

type RollRow = { RollYear?: number | null };

export type MdpaBuildingInfo = RollRow & {
  Actual?: number | string | null;
  ActualArea?: number | string | null;
  improvementModelDesc?: string | null;
  BuildingNo?: number | null;
};

export type MdpaExtraFeature = RollRow & {
  Description?: string | null;
  Units?: number | string | null;
  UseCode?: string | null;
};

export type MdpaFolioRecord = {
  RollYear1?: number | null;
  PropertyInfo?: Record<string, unknown> | null;
  Building?: { BuildingInfos?: MdpaBuildingInfo[] | null } | null;
  ExtraFeature?: { ExtraFeatureInfos?: MdpaExtraFeature[] | null } | null;
};

const DOCK_COUNT_MAX = 200;
const HEIGHT_MIN = 10;
const HEIGHT_MAX = 80;

function asRecord(raw: unknown): MdpaFolioRecord {
  return (raw ?? {}) as MdpaFolioRecord;
}

function asNumber(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function currentMdpaRollYear(raw: unknown): number | null {
  const d = asRecord(raw);
  const fromRoot = asNumber(d.RollYear1);
  if (fromRoot != null && fromRoot > 1900) return fromRoot;
  const years = [
    ...(d.Building?.BuildingInfos ?? []),
    ...(d.ExtraFeature?.ExtraFeatureInfos ?? []),
  ]
    .map((row) => asNumber(row.RollYear))
    .filter((y): y is number => y != null && y > 1900);
  return years.length > 0 ? Math.max(...years) : null;
}

export function rowsForCurrentYear<T extends RollRow>(rows: T[] | null | undefined, year: number | null): T[] {
  const list = rows ?? [];
  if (list.length === 0) return [];
  const y = year ?? Math.max(...list.map((r) => asNumber(r.RollYear) ?? 0));
  const matched = list.filter((r) => asNumber(r.RollYear) === y);
  return matched.length > 0 ? matched : list;
}

/** Earliest Actual year on the current roll — used when PropertyInfo.YearBuilt is "Multiple". */
export function yearBuiltFromBuildingInfos(raw: unknown): number | null {
  const year = currentMdpaRollYear(raw);
  const rows = rowsForCurrentYear(asRecord(raw).Building?.BuildingInfos, year);
  const years = rows
    .map((r) => asNumber(r.Actual))
    .filter((n): n is number => n != null && n >= 1800 && n <= 2100);
  if (years.length === 0) return null;
  return Math.min(...years);
}

export function mdpaExtrasNote(raw: unknown): string | null {
  const year = currentMdpaRollYear(raw);
  const extras = rowsForCurrentYear(asRecord(raw).ExtraFeature?.ExtraFeatureInfos, year);
  const parts: string[] = [];
  for (const row of extras) {
    const desc = row.Description?.trim();
    if (!desc) continue;
    const units = asNumber(row.Units);
    parts.push(units != null ? `${desc} (${units})` : desc);
  }
  const buildings = rowsForCurrentYear(asRecord(raw).Building?.BuildingInfos, year);
  for (const row of buildings) {
    const model = row.improvementModelDesc?.trim();
    if (model) parts.push(model);
  }
  if (parts.length === 0) return null;
  return [...new Set(parts)].join("; ").slice(0, 800);
}

function isHeightFactorText(text: string): boolean {
  return /height\s*factor|wall\s*area\s*above/i.test(text);
}

function isBoatOrYardDock(text: string): boolean {
  return /boat\s*dock|wood\s*dock|dock\s*space|floating\s*dock/i.test(text);
}

export function isDockFeatureDescription(text: string): boolean {
  if (isBoatOrYardDock(text)) return false;
  return /loading\s*dock|dock[\s-]*high|dock[\s-]*doors?|overhead\s*doors?/i.test(text);
}

export function isDriveInFeatureDescription(text: string): boolean {
  return /drive[\s-]*in|grade[\s-]*doors?|grade[\s-]*level/i.test(text);
}

function plausibleCount(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > DOCK_COUNT_MAX) return null;
  return rounded;
}

/** Literal clear height in feet. Ignores MDPA "Height Factor - Wall Area Above N ft". */
export function clearHeightFtFromText(text: string): number | null {
  if (!text.trim() || isHeightFactorText(text)) return null;
  const patterns = [
    /clear(?:\s*height|\s*ance)?\s*(?:of|:)?\s*(\d{2,3})\s*(?:'|ft|feet)?/i,
    /(?:ceiling(?:\s*height)?)\s*(?:of|:)?\s*(\d{2,3})\s*(?:'|ft|feet)?/i,
    /(\d{2,3})\s*(?:'|ft|feet)\s*clear/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (n >= HEIGHT_MIN && n <= HEIGHT_MAX) return n;
  }
  return null;
}

function powerAmpsFromText(text: string): number | null {
  const m = text.match(/(\d{2,4})\s*(?:amp|amps|a)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 20 && n <= 8000 ? n : null;
}

function powerPhaseFromText(text: string): "1" | "3" | null {
  if (/\b3[\s-]*phase\b/i.test(text)) return "3";
  if (/\b(?:1|single)[\s-]*phase\b/i.test(text)) return "1";
  return null;
}

function sprinklerFromText(text: string): IndustrialFields["sprinkler_type"] {
  const t = text.toLowerCase();
  if (/\besfr\b/.test(t)) return "esfr";
  if (/\bk\s*25\b/.test(t)) return "k25";
  if (/\bdry\s+(?:pipe|system|sprinkler)/.test(t)) return "dry";
  if (/\bwet\s+(?:pipe|system|sprinkler)/.test(t)) return "wet";
  return null;
}

function askingRentFromText(text: string): number | null {
  const m = text.match(/asking\s*(?:rent|rate)\s*(?:of|:)?\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:\/|\s*)?(?:sf|psf)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n < 200 ? n : null;
}

function emptyIndustrial(): IndustrialFields {
  return { ...EMPTY_INDUSTRIAL };
}

function mergeSpec(into: IndustrialFields, patch: Partial<IndustrialFields>): void {
  for (const key of INDUSTRIAL_FIELD_KEYS) {
    if (into[key] == null && patch[key] != null && patch[key] !== "") {
      Object.assign(into, { [key]: patch[key] });
    }
  }
}

/** Map extra-feature / building / sketch text onto industrial fields. Never invents from DOR or lot. */
export function industrialSpecsFromText(text: string): IndustrialFields {
  const out = emptyIndustrial();
  if (!text.trim()) return out;
  out.clear_height_ft = clearHeightFtFromText(text);
  out.power_amps = powerAmpsFromText(text);
  out.power_phase = powerPhaseFromText(text);
  out.sprinkler_type = sprinklerFromText(text);
  out.asking_rent_psf = askingRentFromText(text);
  return out;
}

export function industrialSpecsFromMdpa(raw: unknown, sketchText?: string | null): IndustrialFields {
  const out = emptyIndustrial();
  const year = currentMdpaRollYear(raw);
  const extras = rowsForCurrentYear(asRecord(raw).ExtraFeature?.ExtraFeatureInfos, year);
  const buildings = rowsForCurrentYear(asRecord(raw).Building?.BuildingInfos, year);

  for (const row of extras) {
    const desc = row.Description?.trim() ?? "";
    if (!desc) continue;
    const units = asNumber(row.Units);
    if (isDockFeatureDescription(desc)) {
      const count = plausibleCount(units);
      if (count != null && out.dock_doors == null) out.dock_doors = count;
    } else if (isDriveInFeatureDescription(desc)) {
      const count = plausibleCount(units);
      if (count != null && out.drive_in_doors == null) out.drive_in_doors = count;
    }
    mergeSpec(out, industrialSpecsFromText(desc));
  }

  for (const row of buildings) {
    mergeSpec(out, industrialSpecsFromText(row.improvementModelDesc ?? ""));
  }

  if (sketchText) mergeSpec(out, industrialSpecsFromSketchHtml(sketchText));
  return out;
}

/** Sketch legend codes are presence-only. LPF / XHT without a count or stated height do not fill specs. */
export function industrialSpecsFromSketchHtml(html: string): IndustrialFields {
  const text = decodeSketchHtml(html);
  if (/no sketch on file/i.test(text)) return emptyIndustrial();
  const out = industrialSpecsFromText(text);

  const dockCount = text.match(/(\d{1,3})\s*(?:dock[\s-]*high|dock[\s-]*doors?|loading\s*docks?|overhead\s*doors?)/i);
  if (dockCount && out.dock_doors == null) {
    out.dock_doors = plausibleCount(Number(dockCount[1]));
  }
  const driveCount = text.match(/(\d{1,3})\s*(?:drive[\s-]*in|grade[\s-]*doors?)/i);
  if (driveCount && out.drive_in_doors == null) {
    out.drive_in_doors = plausibleCount(Number(driveCount[1]));
  }
  return out;
}

export function decodeSketchHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMdpaSketchHtml(html: string): { text: string; specs: IndustrialFields } {
  const text = decodeSketchHtml(html);
  return { text, specs: industrialSpecsFromSketchHtml(html) };
}

const INDUSTRIAL_SLUGS: Record<keyof IndustrialFields, string> = {
  clear_height_ft: "clear_height",
  dock_doors: "dock_doors",
  drive_in_doors: "drive_in_doors",
  power_amps: "power",
  power_phase: "phase",
  yard_acres: "yard",
  column_spacing: "column_spacing",
  sprinkler_type: "sprinkler",
  availability_status: "availability",
  asking_rent_psf: "asking_rent",
  nnn_cam_psf: "nnn_cam",
  lease_structure: "lease_structure",
};

/** Copy stated MDPA specs onto empty extract fields only. */
export function mergeMdpaIndustrialOntoExtracted(
  fields: ExtractedProperty,
  specs: IndustrialFields,
): ExtractedProperty {
  const next: ExtractedProperty = { ...fields };
  const custom = { ...(fields.custom_fields ?? {}) };
  for (const key of INDUSTRIAL_FIELD_KEYS) {
    const value = specs[key];
    if (value == null || value === "") continue;
    if (next[key] == null || next[key] === "") {
      Object.assign(next, { [key]: value });
    }
    const slug = INDUSTRIAL_SLUGS[key];
    if (custom[slug] == null || custom[slug] === "") custom[slug] = value as string | number;
  }
  next.custom_fields = custom;
  return next;
}
