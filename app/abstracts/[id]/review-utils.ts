// Pure helpers for lease field review — no React, safe to import in tests.

import { isValidDate } from "@/lib/validation";

export type ReviewStatus = "pending" | "accepted" | "rejected" | "corrected";

export type FieldReview = {
  status: ReviewStatus;
  correctedValue?: string | number | null;
  reviewedAt?: string;
};

export type FieldCitation = {
  field: string;
  page: string;
  text: string;
};

export type FieldReviews = Record<string, FieldReview>;

// ─── Confidence scoring ───────────────────────────────────────────────────────

export function deriveConfidence(
  displayValue: string,
  citation: FieldCitation | undefined,
): number {
  if (!citation || !citation.text) return 0.2;
  if (!displayValue || displayValue === "—") return 0.4;

  // Normalise: strip currency / punctuation for comparison
  const norm = (s: string) => s.toLowerCase().replace(/[$,./\s\-–—]/g, "");
  const val = norm(displayValue);
  const txt = norm(citation.text);

  if (val.length >= 2 && txt.includes(val)) return 0.95;

  // Word-level partial match
  const words = displayValue
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ""))
    .filter(w => w.length > 2);

  if (words.length === 0) return 0.55;

  const citLower = citation.text.toLowerCase();
  const matchCount = words.filter(w => citLower.includes(w)).length;
  return 0.4 + (matchCount / words.length) * 0.5;
}

export type ConfidenceLevel = "high" | "medium" | "low";

export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

// ─── Field labels ─────────────────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  execution_date: "Execution date",
  expiration_date: "Expiration date",
  term: "Term",
  base_rate: "Base rate",
  leased_sf: "Tenant SF",
  landlord_name: "Landlord",
  escalations: "Escalations",
  options: "Options",
  key_provisions: "Key provisions",
};

export function fieldLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];

  // "escalations[0]" → "Escalation 1"
  const arrMatch = key.match(/^([a-z_]+)\[(\d+)\]$/);
  if (arrMatch) {
    const base = arrMatch[1].replace(/_/g, " ").replace(/s$/, "");
    const idx = parseInt(arrMatch[2], 10) + 1;
    return `${base.charAt(0).toUpperCase()}${base.slice(1)} ${idx}`;
  }

  // snake_case → Title Case
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Column sync for corrections ───────────────────────────────────────────────

export type ColumnPatch = Record<string, string | number | null>;

const SCALAR_COLUMN_KEYS = ["execution_date", "expiration_date", "term", "base_rate", "leased_sf", "landlord_name"] as const;

/**
 * Maps a broker's corrected value for a scalar field back to the real
 * lease_abstracts column it lives in. Lease radar and lease comps read
 * expiration_date/base_rate/term/execution_date directly off the row —
 * a correction that only lands in field_reviews JSONB never reaches them.
 *
 * Returns:
 *   - null            — this field has no direct column (escalations[i] /
 *                        options[i] / key_provisions[i] live only in
 *                        field_reviews; nothing to sync)
 *   - { patch }        — the column(s) to merge into the same UPDATE
 *   - { error }        — the corrected value can't be safely written to the
 *                        column's real type (caller should reject the save,
 *                        not silently write garbage into a DATE/NUMERIC column)
 */
export function columnPatchForCorrection(
  fieldKey: string,
  correctedValue: string | number | null | undefined,
): { patch: ColumnPatch } | { error: string } | null {
  if (correctedValue === undefined) return null;
  if (!(SCALAR_COLUMN_KEYS as readonly string[]).includes(fieldKey)) return null;

  const raw = correctedValue == null ? "" : String(correctedValue).trim();

  if (fieldKey === "execution_date" || fieldKey === "expiration_date") {
    if (!raw) return { patch: { [fieldKey]: null } };
    if (!isValidDate(raw)) {
      return { error: `${fieldLabel(fieldKey)} must be a valid date (YYYY-MM-DD).` };
    }
    return { patch: { [fieldKey]: raw } };
  }

  if (fieldKey === "base_rate") {
    if (!raw) return { patch: { base_rate: null } };
    const stripped = raw.replace(/[^0-9.-]/g, "");
    // Number("") is 0, not NaN — a value with no digits at all (e.g. "market
    // rate", "TBD") would otherwise silently become 0 instead of being rejected.
    if (!stripped || !/\d/.test(stripped)) {
      return { error: "Base rate must be a number." };
    }
    const num = Number(stripped);
    if (!Number.isFinite(num)) {
      return { error: "Base rate must be a number." };
    }
    return { patch: { base_rate: num } };
  }

  if (fieldKey === "leased_sf") {
    if (!raw) return { patch: { leased_sf: null } };
    const stripped = raw.replace(/[^0-9.-]/g, "");
    if (!stripped || !/\d/.test(stripped)) {
      return { error: "Tenant SF must be a number." };
    }
    const num = Number(stripped);
    if (!Number.isFinite(num)) {
      return { error: "Tenant SF must be a number." };
    }
    return { patch: { leased_sf: num } };
  }

  if (fieldKey === "landlord_name") {
    return { patch: { landlord_name: raw || null } };
  }

  // term — plain text passthrough
  return { patch: { term: raw || null } };
}
