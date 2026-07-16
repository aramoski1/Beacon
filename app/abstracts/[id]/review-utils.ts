// Pure helpers for lease field review — no React, safe to import in tests.

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
