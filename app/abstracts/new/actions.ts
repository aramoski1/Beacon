"use server";

import { redirect } from "next/navigation";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { fetchFieldDefs, buildCustomFieldsSchema } from "@/lib/custom-fields";

// ─── Tool definition ──────────────────────────────────────────────────────────

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "extract_lease_fields",
  description:
    "Extract structured fields from a commercial real estate lease document. " +
    "Return every field you can find. For dates use ISO 8601 (YYYY-MM-DD). " +
    "For base_rate, return the numeric value only (annual per-sqft is preferred). " +
    "Cite the page number or section for every field extracted.",
  input_schema: {
    type: "object" as const,
    required: [
      "execution_date",
      "expiration_date",
      "term",
      "base_rate",
      "escalations",
      "options",
      "key_provisions",
      "field_citations",
    ],
    properties: {
      execution_date: { type: "string" },
      expiration_date: { type: "string" },
      term: { type: "string" },
      base_rate: { type: "number" },
      escalations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            rate: { type: "string" },
            effective_date: { type: "string" },
          },
          required: ["description", "rate"],
        },
      },
      options: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["renewal", "termination", "expansion"] },
            description: { type: "string" },
            notice_period: { type: "string" },
          },
          required: ["type", "description"],
        },
      },
      key_provisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            provision: { type: "string" },
            citation: { type: "string" },
          },
          required: ["provision"],
        },
      },
      field_citations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: { type: "string" },
            page: { type: "string" },
            text: { type: "string" },
          },
          required: ["field", "page", "text"],
        },
      },
      premises_address: {
        type: "string",
        description: "Street address of the leased premises (e.g. '123 Main St, Suite 400'). Extract from the lease preamble.",
      },
    },
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type LeasePreview = {
  execution_date: string | null;
  expiration_date: string | null;
  term: string | null;
  base_rate: number | null;
  escalations: { description: string; rate: string; effective_date?: string }[];
  options: { type: string; description: string; notice_period?: string }[];
  key_provisions: { provision: string; citation?: string }[];
  field_citations: { field: string; page: string; text: string }[];
  custom_fields?: Record<string, string | number | null>;
  premises_address?: string | null;
  linked_property?: string | null;
  storagePath: string;
};

export type AbstractResult = { error: string } | { preview: LeasePreview };

// ─── Property list for picker (all properties, client-side filtered) ─────────

export async function getAllPropertiesForPicker(): Promise<
  { id: string; address: string; city: string | null }[]
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("properties")
    .select("id, address, city")
    .eq("owner_id", user.id)
    .order("address", { ascending: true })
    .limit(1000);
  return (data ?? []) as { id: string; address: string; city: string | null }[];
}

// Kept for any callers that still use server-side search
export async function searchPropertiesForPicker(
  query: string,
): Promise<{ id: string; address: string; city: string | null }[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const q = query.trim();
  if (!q) return [];
  const { data } = await supabase
    .from("properties")
    .select("id, address, city")
    .eq("owner_id", user.id)
    .ilike("address", `%${q}%`)
    .order("address", { ascending: true })
    .limit(8);
  return (data ?? []) as { id: string; address: string; city: string | null }[];
}

// ─── Extract action — uploads PDF and returns preview; does NOT save ──────────

export async function abstractLease(formData: FormData): Promise<AbstractResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const file = formData.get("pdf") as File | null;
  if (!file || file.size === 0) return { error: "Please select a PDF file." };
  if (file.type !== "application/pdf") return { error: "Only PDF files are supported." };
  if (file.size > 32 * 1024 * 1024) return { error: "File must be under 32 MB." };

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${user.id}/${Date.now()}-${safeName}`;

  // Upload to storage first (so it's available even if broker discards the abstract)
  const { error: uploadError } = await supabase.storage
    .from("leases")
    .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });

  if (uploadError) return { error: `Storage upload failed: ${uploadError.message}` };

  // Build a dynamic tool schema that includes any broker-defined custom lease fields
  const customLeaseFields = await fetchFieldDefs(supabase, "lease");
  let extractTool = EXTRACT_TOOL;
  if (customLeaseFields.length > 0) {
    const customProps = buildCustomFieldsSchema(customLeaseFields);
    const baseProps = (EXTRACT_TOOL.input_schema as Record<string, unknown>)
      .properties as Record<string, unknown>;
    extractTool = {
      ...EXTRACT_TOOL,
      input_schema: {
        ...EXTRACT_TOOL.input_schema,
        properties: {
          ...baseProps,
          custom_fields: {
            type: "object",
            description: "Broker-defined custom fields — extract each from the lease document",
            properties: customProps,
          },
        },
      } as Anthropic.Tool["input_schema"],
    };
  }

  const anthropic = new Anthropic();
  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8192,
      tools: [extractTool],
      tool_choice: { type: "tool", name: "extract_lease_fields" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: buffer.toString("base64"),
              },
            },
            {
              type: "text",
              text: "Extract all fields from this lease document using the extract_lease_fields tool. Be thorough, cite the specific page and section for every field you extract.",
            },
          ],
        },
      ],
    });
  } catch (err: unknown) {
    return { error: `AI extraction failed: ${err instanceof Error ? err.message : "Unknown error"}` };
  }

  const toolBlock = message.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return { error: "Claude did not return structured fields. Try again." };
  }

  const fields = toolBlock.input as Omit<LeasePreview, "storagePath">;
  return { preview: { ...fields, storagePath } };
}

// ─── Broker confirmed — save to DB ────────────────────────────────────────────

export async function saveAbstractLease(
  preview: LeasePreview
): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // Validate the storage path belongs to this user (prevents path tampering)
  if (!preview.storagePath.startsWith(user.id + "/")) {
    return { error: "Invalid storage path." };
  }

  const { data: record, error: dbError } = await supabase
    .from("lease_abstracts")
    .insert({
      owner_id: user.id,
      linked_property: preview.linked_property ?? null,
      source_document: preview.storagePath,
      execution_date: preview.execution_date || null,
      expiration_date: preview.expiration_date || null,
      term: preview.term || null,
      base_rate: preview.base_rate ?? null,
      escalations: preview.escalations ?? [],
      options: preview.options ?? [],
      key_provisions: preview.key_provisions ?? [],
      field_citations: preview.field_citations ?? [],
      custom_fields: preview.custom_fields ?? {},
    })
    .select("id")
    .single();

  if (dbError) return { error: `Database error: ${dbError.message}` };
  return { id: record.id };
}
