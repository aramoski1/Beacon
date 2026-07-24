// Pure merge/conflict logic for enhancing an *existing* property from a
// document, pasted text, or URL (as opposed to county appraiser data).
// Kept out of app/properties/[id]/actions.ts because a "use server" file may
// only export async functions — this needs to be a plain, unit-testable module.

import { fieldSlug, type FieldDefinition } from "./custom-fields";
import type { ExtractedProperty } from "./property-pipeline";

// Authoritative fields: never silently overwritten by a document/URL/pasted
// source when an existing value is already on record. Surfaced as individual
// accept/reject conflicts instead.
export const AUTHORITATIVE_PROPERTY_FIELDS = new Set([
  "owner_name",
  "size_sqft",
  "land_sqft",
  "last_sale_date",
  "last_sale_price",
]);

export type ExistingPropertyForDiff = {
  owner_name: string | null;
  size_sqft: number | null;
  land_sqft: number | null;
  asset_description: string | null;
  last_sale_date: string | null;
  last_sale_price: number | null;
  custom_fields: Record<string, string | number | null> | null;
};

export type DocumentDiffEntry = {
  field: string; // "owner_name" | "size_sqft" | "land_sqft" | "last_sale_date" | "last_sale_price" | "asset_description" | "custom_fields.<slug>"
  label: string;
  before: string | null; // display string
  after: string | null; // display string
  rawAfter: string | number | null; // value to persist on apply
};

export type DocumentDiffResult = {
  changes: DocumentDiffEntry[];
  conflicts: DocumentDiffEntry[];
  unchanged: DocumentDiffEntry[];
};

function fmtN(n: number | null | undefined, opts?: Intl.NumberFormatOptions): string | null {
  if (n == null) return null;
  return n.toLocaleString("en-US", opts);
}
function fmtD(d: string | null | undefined): string | null {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

const CURRENCY: Intl.NumberFormatOptions = { style: "currency", currency: "USD", maximumFractionDigits: 0 };

export function computeDocumentDiff(
  existing: ExistingPropertyForDiff,
  extracted: ExtractedProperty,
  customFieldDefs: FieldDefinition[]
): DocumentDiffResult {
  const bc = extracted.building_composition;
  const extractedLandSqft = bc?.lot_size_sqft != null ? Math.round(bc.lot_size_sqft) : null;
  const extractedAssetDescription = bc?.dor_description ?? null;

  const changes: DocumentDiffEntry[] = [];
  const conflicts: DocumentDiffEntry[] = [];
  const unchanged: DocumentDiffEntry[] = [];

  function pushCore(
    field: string,
    label: string,
    beforeRaw: string | number | null,
    afterRaw: string | number | null,
    fmt: (v: string | number | null) => string | null
  ) {
    if (afterRaw == null) return; // never suggest clearing an existing value
    const before = fmt(beforeRaw);
    const after = fmt(afterRaw);
    const entry: DocumentDiffEntry = { field, label, before, after, rawAfter: afterRaw };
    if (beforeRaw == null) {
      changes.push(entry);
    } else if (before !== after) {
      if (AUTHORITATIVE_PROPERTY_FIELDS.has(field)) {
        conflicts.push(entry);
      } else {
        changes.push(entry);
      }
    } else {
      unchanged.push(entry);
    }
  }

  pushCore("owner_name", "Owner name", existing.owner_name, extracted.owner_name, (v) => (v == null ? null : String(v)));
  pushCore("size_sqft", "Building SF", existing.size_sqft, extracted.size_sqft, (v) => fmtN(v as number | null));
  pushCore("land_sqft", "Land SF", existing.land_sqft, extractedLandSqft, (v) => fmtN(v as number | null));
  pushCore("last_sale_date", "Last sale date", existing.last_sale_date, extracted.last_sale_date, (v) => fmtD(v as string | null));
  pushCore("last_sale_price", "Last sale price", existing.last_sale_price, extracted.last_sale_price, (v) => fmtN(v as number | null, CURRENCY));
  pushCore("asset_description", "Asset description", existing.asset_description, extractedAssetDescription, (v) => (v == null ? null : String(v)));

  // Custom (broker-defined, extract-mode) fields — never authoritative, always
  // land in `changes` (fill or overwrite), never gated as a conflict.
  for (const def of customFieldDefs) {
    const slug = fieldSlug(def.field_name);
    const field = `custom_fields.${slug}`;
    const beforeRaw = existing.custom_fields?.[slug] ?? null;
    const afterRaw = extracted.custom_fields?.[slug] ?? null;
    if (afterRaw == null) continue; // nothing to write; reason surfaced separately by the caller
    const before = beforeRaw == null ? null : String(beforeRaw);
    const after = String(afterRaw);
    const entry: DocumentDiffEntry = { field, label: def.field_name, before, after, rawAfter: afterRaw };
    if (before === after) {
      unchanged.push(entry);
    } else {
      changes.push(entry);
    }
  }

  return { changes, conflicts, unchanged };
}
