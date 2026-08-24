// Server-only ingestion error logger.
// Writes to the ingestion_errors table and fires the external error-reporting
// hook (if BEACON_ERROR_DSN is configured). Never throws — logging failures
// must never crash or alter the result of the ingestion action that calls this.

import type { SupabaseClient } from "@supabase/supabase-js";
import { captureException } from "@/lib/error-reporter";
import { sanitizeIngestionError } from "@/lib/error-messages";

export type IngestionStage =
  | "gis_fetch"      // County GIS address search
  | "mdpa_fetch"     // MDPA folio detail lookup
  | "bcpa_fetch"     // BCPA folio detail lookup (Florida DOR statewide service)
  | "pbcpa_fetch"    // PBCPA folio detail lookup (PAO.PROPINFO_PUB table)
  | "magis_fetch"    // MassGIS parcel detail lookup (Massachusetts_Property_Tax_Parcels)
  | "jina_fetch"     // Jina Reader web page fetch
  | "ai_extract"     // Claude field extraction
  | "db_save"        // Supabase upsert
  | "sunbiz_search"  // Sunbiz entity name search
  | "sunbiz_detail"; // Sunbiz corporation detail page fetch

export type IngestionSourceType = "address" | "url" | "upload";

export interface IngestionErrorRow {
  id: string;
  owner_id: string;
  occurred_at: string;
  source_type: IngestionSourceType;
  stage: IngestionStage;
  source_ref: string | null;
  error_message: string;
  error_detail: Record<string, unknown>;
}

export async function logIngestionError(
  supabase: SupabaseClient,
  userId: string,
  opts: {
    stage: IngestionStage;
    source_type: IngestionSourceType;
    source_ref?: string | null;
    error_message: string;
    error_detail?: Record<string, unknown>;
  }
): Promise<void> {
  // The broker-facing message is sanitized (no subprocess command lines, no
  // server file paths, no raw upstream API JSON) — the original is kept in
  // error_detail.raw_message for support/debugging, never rendered in the UI.
  const displayMessage = sanitizeIngestionError(opts.stage, opts.error_message);

  // DB insert and external reporting run independently so one failure
  // cannot suppress the other.
  try {
    await supabase.from("ingestion_errors").insert({
      owner_id:      userId,
      stage:         opts.stage,
      source_type:   opts.source_type,
      source_ref:    opts.source_ref ?? null,
      error_message: displayMessage,
      error_detail:  { ...(opts.error_detail ?? {}), raw_message: opts.error_message },
    });
  } catch {
    // Intentionally swallowed
  }

  await captureException(new Error(opts.error_message), {
    action:  `ingestion/${opts.stage}`,
    userId,
    context: {
      source_type: opts.source_type,
      source_ref:  opts.source_ref ?? null,
      ...(opts.error_detail ?? {}),
    },
    severity: "error",
  });
}
