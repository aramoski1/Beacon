// Jev fills leftover CSV headers after deterministic autoSuggestMapping.
// Never overwrites a header the alias table already claimed.

import { CONTACT_FIELDS, PROPERTY_FIELDS, type Mapping } from "@/lib/import-mapper";
import { jevChoice, jevDecide, jevEnabled, type JevQuestion } from "@/lib/jev";

const SKIP = "skip";

export type JevHeaderChoice = {
  header: string;
  field: string;
  confidence: number;
};

export function applyJevHeaderChoices(
  current: Mapping,
  choices: JevHeaderChoice[],
  minConfidence = 0.65,
): Mapping {
  const next: Mapping = { ...current };
  const usedHeaders = new Set(Object.values(next).filter(Boolean));
  const usedFields = new Set(Object.keys(next).filter((k) => next[k]));

  for (const pick of choices) {
    if (pick.field === SKIP || pick.confidence < minConfidence) continue;
    if (usedHeaders.has(pick.header) || usedFields.has(pick.field)) continue;
    next[pick.field] = pick.header;
    usedHeaders.add(pick.header);
    usedFields.add(pick.field);
  }
  return next;
}

export async function fillUnmappedHeadersWithJev(
  headers: string[],
  entityType: "property" | "contact",
  current: Mapping,
): Promise<Mapping> {
  if (!jevEnabled()) return current;
  const fields = entityType === "property" ? PROPERTY_FIELDS : CONTACT_FIELDS;
  const usedHeaders = new Set(Object.values(current).filter(Boolean));
  const leftovers = headers.filter((h) => h.trim() && !usedHeaders.has(h));
  if (leftovers.length === 0) return current;

  const fieldKeys = [...Object.keys(fields), SKIP];
  const questions: Record<string, JevQuestion> = {};
  leftovers.forEach((header, i) => {
    questions[`h${i}`] = {
      type: "choice",
      instructions: `Map this spreadsheet column header to a Beacon ${entityType} field, or skip if it is not one of those fields.`,
      criteria: Object.fromEntries(
        fieldKeys.map((k) => [
          k,
          k === SKIP ? "Not a Beacon field (notes, extra, ignore)" : (fields as Record<string, { label: string }>)[k]?.label ?? k,
        ]),
      ),
    };
  });

  const decided = await jevDecide({ entityType, headers: leftovers }, questions);
  if (!decided) return current;

  const choices: JevHeaderChoice[] = leftovers.map((header, i) => {
    const pick = jevChoice(decided, `h${i}`);
    return {
      header,
      field: pick?.choice ?? SKIP,
      confidence: pick?.confidence ?? 0,
    };
  });
  return applyJevHeaderChoices(current, choices);
}
