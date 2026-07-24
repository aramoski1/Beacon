/**
 * Pure helpers for Workspace property-grid activity edits → real activities rows.
 */

export const PROPERTY_ACTIVITY_FIELDS = [
  "last_activity_date",
  "last_activity_type",
  "last_activity_notes",
] as const;

export type PropertyActivityField = (typeof PROPERTY_ACTIVITY_FIELDS)[number];

export type PropertyActivitySnapshot = {
  last_activity_date: string | null;
  last_activity_type: string | null;
  last_activity_notes: string | null;
};

export function isPropertyActivityField(field: string): field is PropertyActivityField {
  return (PROPERTY_ACTIVITY_FIELDS as readonly string[]).includes(field);
}

export function mergePropertyActivityPatch(
  current: PropertyActivitySnapshot,
  field: PropertyActivityField,
  value: unknown,
): PropertyActivitySnapshot {
  const next = typeof value === "string" ? value : value == null ? null : String(value);
  return { ...current, [field]: next };
}

/** Normalize grid date (YYYY-MM-DD or ISO) to an ISO activity_date. */
export function normalizeActivityDate(
  date: string | null | undefined,
  nowIso: string = new Date().toISOString(),
): string {
  if (!date?.trim()) return nowIso;
  const trimmed = date.trim();
  if (trimmed.includes("T")) return trimmed;
  // Date-only from the grid → midday UTC to avoid timezone day-shift noise
  return `${trimmed}T12:00:00.000Z`;
}

export type GridActivityPayload = {
  activity_type: "letter" | "email" | "call" | "note" | "meeting";
  activity_date: string;
  notes: string | null;
};

const VALID_TYPES = new Set(["letter", "email", "call", "note", "meeting"]);

/** Build activity insert/update payload from denormalized property columns. */
export function resolveGridActivityPayload(
  snap: PropertyActivitySnapshot,
  nowIso: string = new Date().toISOString(),
): GridActivityPayload {
  const rawType = snap.last_activity_type?.trim() || "note";
  const activity_type = (
    VALID_TYPES.has(rawType) ? rawType : "note"
  ) as GridActivityPayload["activity_type"];
  return {
    activity_type,
    activity_date: normalizeActivityDate(snap.last_activity_date, nowIso),
    notes: snap.last_activity_notes,
  };
}

/** Broker-facing tip when grid activity is empty / clarifying shadow CRM. */
export const GRID_ACTIVITY_TIP =
  "Saves as a real activity (and bumps cadence when a CRM contact is linked). Notes alone don’t count as outreach.";
