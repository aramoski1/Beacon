// Single shared extraction + save pipeline for all property ingestion paths.
// Every source (address lookup, URL, upload) calls extractPropertyFields() then
// savePipelineProperty(). Input-fetching logic (MDPA API, Jina, file parsing)
// stays in each source's own action file.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertProperty } from "./property-ingest";
import { buildCustomFieldsSchema, type FieldDefinition } from "./custom-fields";
import type { StoredOwnerContact } from "./owner-contacts";
import { persistIndustrialFromExtract } from "./industrial-extract";
import { ensureIndustrialFieldDefs } from "./industrial-fields";
import { enqueueJob } from "./jobs";
import { fillCustomFieldsFromBuiltins } from "./custom-field-aliases";

// ─── Unified tool ─────────────────────────────────────────────────────────────
// One definition used by every ingestion path. Source-specific extraction hints
// (e.g. MDPA field mappings) are passed as context in the user message, not here.

export const PROPERTY_EXTRACT_TOOL: Anthropic.Tool = {
  name: "extract_property_fields",
  description: `Extract structured commercial real estate property fields.
Rules:
- Use only data explicitly present in the source — do not guess or hallucinate.
- address: full street address (flag if not found).
- size_sqft: building/rentable area only — never lot/land size.
- ownership_type: infer from owner name (LLC/INC/CORP/TRUST/FUND/REIT = institutional; government entities = institutional; individual names = private).
- last_sale_date/last_sale_price: historical sale data only — never the listing asking price.
- Industrial/flex specs (clear_height_ft, dock_doors, drive_in_doors, power, yard_acres, sprinkler, availability, asking_rent_psf, nnn_cam_psf, lease_structure): copy only when the source states them. Do not invent docks or clear height from a tax roll, DOR code, or lot size. Lot/land size belongs in building_composition.lot_size_sqft, not yard_acres, unless the source names a yard or outside storage.
- confidence_flags: flag every field that is absent, ambiguous, inferred, or uncertain.`,
  input_schema: {
    type: "object" as const,
    required: [
      "address",
      "city",
      "submarket",
      "owner_name",
      "ownership_type",
      "size_sqft",
      "property_type",
      "last_sale_date",
      "last_sale_price",
      "building_composition",
      "confidence_flags",
    ],
    properties: {
      address:        { type: ["string", "null"] },
      city:           { type: ["string", "null"] },
      submarket:      { type: ["string", "null"] },
      owner_name:     { type: ["string", "null"] },
      ownership_type: {
        type: "string",
        enum: ["institutional", "private", "REIT", "owner-occupant", "unknown"],
      },
      size_sqft:       { type: ["number", "null"] },
      property_type:   {
        type: "string",
        enum: ["industrial", "office", "retail", "multifamily", "land", "residential", "mixed-use", "other"],
      },
      last_sale_date:  { type: ["string", "null"] },
      last_sale_price: { type: ["number", "null"] },
      clear_height_ft: { type: ["number", "null"], description: "Warehouse/flex clear height in feet." },
      dock_doors: { type: ["integer", "null"], description: "Count of dock-high loading doors." },
      drive_in_doors: { type: ["integer", "null"] },
      power_amps: { type: ["number", "null"] },
      power_phase: { type: ["string", "null"], description: "Electrical phase: \"1\" or \"3\"." },
      yard_acres: { type: ["number", "null"], description: "Outside storage / yard acres if stated; otherwise omit (lot size is lot_size_sqft)." },
      column_spacing: { type: ["string", "null"] },
      sprinkler_type: { type: ["string", "null"], description: "esfr | k25 | wet | dry | none" },
      availability_status: { type: ["string", "null"], description: "available | leased | off_market | under_contract" },
      asking_rent_psf: { type: ["number", "null"], description: "Asking rent $/SF if listed — not a historical sale price." },
      nnn_cam_psf: { type: ["number", "null"] },
      lease_structure: { type: ["string", "null"], description: "nnn | modified_gross | gross | industrial_gross" },
      building_composition: {
        type: "object",
        properties: {
          year_built:        { type: ["number", "null"] },
          lot_size_sqft:     { type: ["number", "null"] },
          stories:           { type: ["number", "null"] },
          units:             { type: ["number", "null"] },
          parking_spaces:    { type: ["number", "null"] },
          dor_code:          { type: ["string", "null"] },
          dor_description:   { type: ["string", "null"] },
          legal_description: { type: ["string", "null"] },
          assessed_value:    { type: ["number", "null"] },
        },
      },
      confidence_flags: {
        type: "array",
        items: {
          type: "object",
          required: ["field", "reason"],
          properties: {
            field:  { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    },
  },
};

// ─── Shared extracted-fields type ─────────────────────────────────────────────

export type ExtractedProperty = {
  address: string | null;
  city: string | null;
  submarket: string | null;
  owner_name: string | null;
  ownership_type: string;
  size_sqft: number | null;
  property_type: string;
  last_sale_date: string | null;
  last_sale_price: number | null;
  clear_height_ft?: number | null;
  dock_doors?: number | null;
  drive_in_doors?: number | null;
  power_amps?: number | null;
  power_phase?: string | null;
  yard_acres?: number | null;
  column_spacing?: string | null;
  sprinkler_type?: string | null;
  availability_status?: string | null;
  asking_rent_psf?: number | null;
  nnn_cam_psf?: number | null;
  lease_structure?: string | null;
  building_composition: {
    year_built?: number | null;
    lot_size_sqft?: number | null;
    stories?: number | null;
    units?: number | null;
    parking_spaces?: number | null;
    dor_code?: string | null;
    dor_description?: string | null;
    legal_description?: string | null;
    assessed_value?: number | null;
  };
  confidence_flags: { field: string; reason: string }[];
  custom_fields?: Record<string, string | number | null>;
};

// ─── Content block types ──────────────────────────────────────────────────────

export type TextContent  = { type: "text";  text: string; hint?: string };
export type PdfContent   = { type: "pdf";   buffer: Buffer };
export type ImageContent = {
  type: "image";
  buffer: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
};
export type PipelineContent = TextContent | PdfContent | ImageContent;

// ─── Extraction validation ────────────────────────────────────────────────────
// Validates the structure of Claude's response before any DB write.
// Returns an error string if invalid, null if valid.

const VALID_OWNERSHIP_TYPES = ["institutional", "private", "REIT", "owner-occupant", "unknown"];
const VALID_PROPERTY_TYPES  = ["industrial", "office", "retail", "multifamily", "land", "residential", "mixed-use", "other"];

export function validateExtractedProperty(fields: unknown): string | null {
  if (!fields || typeof fields !== "object") return "Extraction returned no data.";
  const f = fields as Record<string, unknown>;
  if (typeof f.ownership_type !== "string" || !VALID_OWNERSHIP_TYPES.includes(f.ownership_type)) {
    return `Invalid ownership_type: ${JSON.stringify(f.ownership_type)}`;
  }
  if (typeof f.property_type !== "string" || !VALID_PROPERTY_TYPES.includes(f.property_type)) {
    return `Invalid property_type: ${JSON.stringify(f.property_type)}`;
  }
  if (!Array.isArray(f.confidence_flags)) {
    return "confidence_flags must be an array.";
  }
  return null;
}

// ─── Core extraction ─────────────────────────────────────────────────────────
// All formats funnel to a single Claude call with the unified tool above.

export async function extractPropertyFields(
  content: PipelineContent,
  systemPrompt?: string,
  customExtractFields?: FieldDefinition[]
): Promise<ExtractedProperty> {
  const anthropic = new Anthropic();

  let userContent: Anthropic.MessageParam["content"];

  if (content.type === "text") {
    userContent =
      (content.hint ? `Context: ${content.hint}\n\n` : "") + content.text;
  } else if (content.type === "pdf") {
    userContent = [
      {
        type: "document" as const,
        source: {
          type: "base64" as const,
          media_type: "application/pdf" as const,
          data: content.buffer.toString("base64"),
        },
      },
      { type: "text" as const, text: "Extract all property fields from this document." },
    ];
  } else {
    userContent = [
      {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: content.mimeType,
          data: content.buffer.toString("base64"),
        },
      },
      { type: "text" as const, text: "Extract all property fields visible in this image." },
    ];
  }

  // Extend tool schema with broker-defined extract fields if provided
  let toolForCall = PROPERTY_EXTRACT_TOOL;
  if (customExtractFields && customExtractFields.length > 0) {
    const customProps = buildCustomFieldsSchema(customExtractFields);
    const baseProps = (PROPERTY_EXTRACT_TOOL.input_schema as Record<string, unknown>)
      .properties as Record<string, unknown>;
    toolForCall = {
      ...PROPERTY_EXTRACT_TOOL,
      input_schema: {
        ...PROPERTY_EXTRACT_TOOL.input_schema,
        properties: {
          ...baseProps,
          custom_fields: {
            type: "object",
            description: "Broker-defined custom fields — extract each from the source. For confidence_flags entries about these, use field name 'custom_fields.<key>'.",
            properties: customProps,
          },
        },
      } as Anthropic.Tool["input_schema"],
    };
  }

  const message = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 3072,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    tools: [toolForCall],
    tool_choice: { type: "tool", name: "extract_property_fields" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolBlock = message.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Could not extract property fields. Try again.");
  }

  const validationError = validateExtractedProperty(toolBlock.input);
  if (validationError) {
    throw new Error(`Extraction validation failed: ${validationError}`);
  }

  return toolBlock.input as ExtractedProperty;
}

// ─── Shared save ─────────────────────────────────────────────────────────────
// Thin wrapper over upsertProperty. Callers pass any address/city overrides
// (e.g. MDPA knows the canonical address from the API).

export async function savePipelineProperty(
  supabase: SupabaseClient,
  userId: string,
  fields: ExtractedProperty,
  source: string,
  sourceUrl?: string | null,
  overrides?: {
    address?: string | null;
    city?: string | null;
    submarket?: string | null;
    owner_mailing_address?: string | null;
    owner_contacts?: StoredOwnerContact[];
  }
): Promise<string> {
  const bc = fields.building_composition;
  const industrialDefs = await ensureIndustrialFieldDefs(supabase, userId);
  const persist = persistIndustrialFromExtract(industrialDefs, fields);
  const { data: propertyDefs } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("entity_type", "property");
  const custom = fillCustomFieldsFromBuiltins(
    (propertyDefs ?? []) as FieldDefinition[],
    persist.custom,
    {
      size_sqft: fields.size_sqft,
      land_sqft: bc?.lot_size_sqft != null ? Math.round(bc.lot_size_sqft as number) : null,
      building_composition: bc,
    },
  );
  const id = await upsertProperty(supabase, userId, {
    owner_id: userId,
    address:               overrides?.address    ?? fields.address,
    city:                  overrides?.city       ?? fields.city,
    submarket:             overrides?.submarket  ?? fields.submarket,
    owner_name:            fields.owner_name,
    ownership_type:        fields.ownership_type,
    size_sqft:             fields.size_sqft,
    property_type:         fields.property_type,
    last_sale_date:        fields.last_sale_date  || null,
    last_sale_price:       fields.last_sale_price ?? null,
    building_composition:  bc as Record<string, unknown>,
    land_sqft:             (bc?.lot_size_sqft != null ? Math.round(bc.lot_size_sqft as number) : null) ?? null,
    asset_description:     (bc?.dor_description as string | null | undefined) ?? null,
    owner_mailing_address: overrides?.owner_mailing_address ?? null,
    owner_contacts:        overrides?.owner_contacts ?? [],
    source,
    source_url:            sourceUrl ?? null,
    ingested_at:           new Date().toISOString(),
    confidence_flags:      fields.confidence_flags,
    custom_fields:         custom,
    ...persist.columns,
  });

  const address = overrides?.address ?? fields.address;
  if (address?.trim()) {
    await enqueueJob(supabase as never, userId, "listing_discover", { propertyId: id });
  }
  return id;
}
