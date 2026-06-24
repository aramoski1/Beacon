// Server-only ingestion error logger.
// Writes to the ingestion_errors table. Never throws — logging failures must
// never crash or alter the result of the ingestion action that calls this.

import type { SupabaseClient } from "@supabase/supabase-js";

export type IngestionStage =
  | "gis_fetch"   // Miami-Dade GIS address search
  | "mdpa_fetch"  // MDPA folio detail lookup
  | "jina_fetch"  // Jina Reader web page fetch
  | "ai_extract"  // Claude field extraction
  | "db_save";    // Supabase upsert

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
  try {
    await supabase.from("ingestion_errors").insert({
      owner_id:      userId,
      stage:         opts.stage,
      source_type:   opts.source_type,
      source_ref:    opts.source_ref ?? null,
      error_message: opts.error_message,
      error_detail:  opts.error_detail ?? {},
    });
  } catch {
    // Intentionally swallowed — logging must never affect the caller's result
  }
}
