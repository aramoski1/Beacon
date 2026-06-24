"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  extractPropertyFields,
  savePipelineProperty,
  type ExtractedProperty,
  type PipelineContent,
} from "@/lib/property-pipeline";
import { fetchFieldDefs } from "@/lib/custom-fields";
import { logIngestionError } from "@/lib/ingestion-logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UploadPreview = ExtractedProperty & {
  fileName: string;
  sourceLabel: string;
};

export type UploadIngestResult =
  | { error: string }
  | { preview: UploadPreview };

// ─── File → PipelineContent ───────────────────────────────────────────────────

async function fileToContent(file: File): Promise<{ content: PipelineContent; label: string }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name   = file.name.toLowerCase();
  const mime   = file.type;

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return { content: { type: "pdf", buffer }, label: "PDF" };
  }

  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(name)) {
    const imageTypes: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
      "image/jpeg": "image/jpeg",
      "image/png":  "image/png",
      "image/gif":  "image/gif",
      "image/webp": "image/webp",
    };
    const mimeType = imageTypes[mime] ?? (name.endsWith(".png") ? "image/png" : "image/jpeg");
    return { content: { type: "image", buffer, mimeType }, label: "image" };
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel" ||
    name.endsWith(".xlsx") ||
    name.endsWith(".xls")
  ) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
    return {
      content: { type: "text", text: csv, hint: `Excel spreadsheet (${sheetName})` },
      label: "Excel",
    };
  }

  const text = buffer.toString("utf-8");
  const label = name.endsWith(".csv") ? "CSV" : "text file";
  return {
    content: { type: "text", text: text.slice(0, 30_000), hint: label },
    label,
  };
}

// ─── ingestUpload ─────────────────────────────────────────────────────────────

export async function ingestUpload(
  formData: FormData
): Promise<UploadIngestResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const file        = formData.get("file") as File | null;
  const pastedText  = (formData.get("paste") as string | null)?.trim();

  let pipelineContent: PipelineContent;
  let fileName: string;
  let sourceLabel: string;

  if (pastedText && pastedText.length >= 20) {
    pipelineContent = {
      type: "text",
      text: pastedText.slice(0, 30_000),
      hint: "pasted property details",
    };
    fileName    = "pasted text";
    sourceLabel = "pasted text";
  } else if (file && file.size > 0) {
    const maxBytes = 32 * 1024 * 1024;
    if (file.size > maxBytes) return { error: "File is too large (max 32 MB)." };

    const parsed  = await fileToContent(file);
    pipelineContent = parsed.content;
    fileName        = file.name;
    sourceLabel     = parsed.label;
  } else {
    return { error: "Upload a file or paste property details." };
  }

  const customExtractFields = (await fetchFieldDefs(supabase, "property")).filter(
    f => f.fill_mode === "extract"
  );
  let fields: ExtractedProperty;
  try {
    fields = await extractPropertyFields(pipelineContent, undefined, customExtractFields);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "ai_extract",
      source_type: "upload",
      source_ref: fileName,
      error_message: msg,
    });
    return { error: `Extraction failed: ${msg}` };
  }

  if (!fields.address) {
    return {
      error:
        "No property address found. Make sure the file contains an address, or add it to your pasted text.",
    };
  }

  return { preview: { ...fields, fileName, sourceLabel } };
}

// ─── saveIngestedUpload ───────────────────────────────────────────────────────

export async function saveIngestedUpload(
  preview: UploadPreview
): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // Guard: refuse to save a record with no address (defense-in-depth)
  if (!preview.address?.trim()) {
    return { error: "Cannot save a property without an address." };
  }

  try {
    const id = await savePipelineProperty(
      supabase,
      user.id,
      preview,
      "upload",
      `upload:${preview.fileName}`
    );
    return { id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "db_save",
      source_type: "upload",
      source_ref: preview.fileName,
      error_message: msg,
    });
    return { error: msg };
  }
}
