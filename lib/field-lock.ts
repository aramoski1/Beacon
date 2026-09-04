// Provenance lock + fill-only merge for property writes.
// County / Sunbiz / broker-entered values must never be clobbered by a
// scrape, listing search, document extract, or Apollo-style people enrich.

import { AUTHORITATIVE_PROPERTY_FIELDS } from "@/lib/document-enhancement";
import { industrialColumnForSlug } from "@/lib/industrial-fields";

export const LOCKED_SOURCE_TAGS = new Set(["county", "manual", "sunbiz"]);

export type FieldSources = Record<string, string>;

export function hasFieldValue(value: unknown): boolean {
  return value != null && value !== "";
}

export function fieldSourceOf(
  sources: FieldSources | null | undefined,
  key: string,
): string | undefined {
  const tag = sources?.[key];
  return typeof tag === "string" && tag.length > 0 ? tag : undefined;
}

export function isLocked(
  sources: FieldSources | null | undefined,
  key: string,
): boolean {
  const tag = fieldSourceOf(sources, key);
  return tag != null && LOCKED_SOURCE_TAGS.has(tag);
}

/** Also treat the paired industrial column / custom_fields.<slug> as locked. */
export function isFieldLocked(
  sources: FieldSources | null | undefined,
  key: string,
): boolean {
  if (isLocked(sources, key)) return true;
  if (key.startsWith("custom_fields.")) {
    const slug = key.slice("custom_fields.".length);
    const col = industrialColumnForSlug(slug);
    return col != null && isLocked(sources, col);
  }
  return isLocked(sources, `custom_fields.${key}`);
}

/**
 * County ingest scalars that already have a value are locked against
 * web/search/document auto-writes even when field_sources predates tagging.
 */
export function isAuthoritativeFilled(key: string, existingValue: unknown): boolean {
  return AUTHORITATIVE_PROPERTY_FIELDS.has(key) && hasFieldValue(existingValue);
}

export function isProtectedFromAutoWrite(
  sources: FieldSources | null | undefined,
  key: string,
  existingValue?: unknown,
): boolean {
  if (isFieldLocked(sources, key)) return true;
  if (existingValue !== undefined && isAuthoritativeFilled(key, existingValue)) return true;
  return false;
}

/**
 * Write incoming values only when the existing slot is empty and unlocked.
 * Never clears a value. Tags written keys with `writer` when provided.
 */
export function mergeFillOnly(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  sources: FieldSources | null | undefined,
  writer?: string,
): {
  next: Record<string, unknown>;
  written: string[];
  nextSources: FieldSources;
} {
  const next = { ...existing };
  const nextSources: FieldSources = { ...(sources ?? {}) };
  const written: string[] = [];

  for (const [key, value] of Object.entries(incoming)) {
    if (!hasFieldValue(value)) continue;
    if (isProtectedFromAutoWrite(sources, key, existing[key])) continue;
    if (hasFieldValue(existing[key])) continue;
    next[key] = value;
    written.push(key);
    if (writer) nextSources[key] = writer;
  }

  return { next, written, nextSources };
}

export function tagManualIndustrial(
  sources: FieldSources | null | undefined,
  slug: string,
): FieldSources {
  const next: FieldSources = { ...(sources ?? {}) };
  next[`custom_fields.${slug}`] = "manual";
  const col = industrialColumnForSlug(slug);
  if (col) next[col] = "manual";
  return next;
}
