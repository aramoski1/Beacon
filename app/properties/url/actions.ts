"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { extractPropertyFields, savePipelineProperty, type ExtractedProperty } from "@/lib/property-pipeline";
import { fetchFieldDefs } from "@/lib/custom-fields";
import { logIngestionError } from "@/lib/ingestion-logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UrlPreview = ExtractedProperty & { source_url: string };

export type UrlIngestResult =
  | { error: string; detail?: never }
  | { error: "fetch_failed"; detail: string }
  | { preview: UrlPreview };

// ─── Jina AI Reader fetch ─────────────────────────────────────────────────────
// Renders JavaScript and returns clean text — handles Zillow, LoopNet, Crexi, etc.

async function fetchListingText(url: string): Promise<string> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-Return-Format": "text",
    "X-Timeout": "25",
  };
  if (process.env.JINA_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.JINA_API_KEY}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(jinaUrl, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.text()).trim().slice(0, 30_000);
    if (
      text.length < 200 ||
      text.toLowerCase().includes("access denied") ||
      text.toLowerCase().includes("blocked")
    ) {
      throw new Error("blocked");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// ─── URL ingestion ────────────────────────────────────────────────────────────

export async function ingestUrl(formData: FormData): Promise<UrlIngestResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const raw = (formData.get("url") as string | null)?.trim();
  if (!raw) return { error: "Please enter a URL." };

  let url: URL;
  try {
    url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    return { error: "Enter a valid http:// or https:// URL." };
  }

  let pageText: string;
  try {
    pageText = await fetchListingText(url.toString());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Only log unexpected failures — blocked sites are a normal user experience
    if (!msg.includes("blocked") && !msg.includes("403") && !msg.includes("401")) {
      await logIngestionError(supabase, user.id, {
        stage: "jina_fetch",
        source_type: "url",
        source_ref: url.toString(),
        error_message: msg,
      });
    }
    if (msg.includes("abort") || msg.includes("timeout")) {
      return { error: "fetch_failed", detail: "The page took too long to load." };
    }
    if (msg === "blocked" || msg.includes("403") || msg.includes("401")) {
      return {
        error: "fetch_failed",
        detail:
          "This site blocks automated access (Zillow, LoopNet, and similar portals all do this). Paste the listing text below instead.",
      };
    }
    return { error: "fetch_failed", detail: `Could not fetch the page: ${msg}` };
  }

  const customExtractFields = (await fetchFieldDefs(supabase, "property")).filter(
    f => f.fill_mode === "extract"
  );
  try {
    const fields = await extractPropertyFields(
      { type: "text", text: pageText, hint: `from listing URL: ${url.toString()}` },
      undefined,
      customExtractFields
    );
    if (!fields.address) {
      return {
        error:
          "Could not extract a property address from this page. Make sure the URL points to a specific property listing, not a search results page.",
      };
    }
    return { preview: { ...fields, source_url: url.toString() } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "ai_extract",
      source_type: "url",
      source_ref: url.toString(),
      error_message: msg,
    });
    return { error: `AI extraction failed: ${msg}` };
  }
}

// ─── Paste-text fallback ─────────────────────────────────────────────────────

export async function ingestPastedContent(
  formData: FormData
): Promise<UrlIngestResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const text = (formData.get("content") as string | null)?.trim();
  const sourceUrl = (formData.get("url") as string | null)?.trim() ?? "";

  if (!text || text.length < 50)
    return { error: "Please paste at least a few lines of listing content." };

  const customExtractFields = (await fetchFieldDefs(supabase, "property")).filter(
    f => f.fill_mode === "extract"
  );
  try {
    const fields = await extractPropertyFields(
      {
        type: "text",
        text: text.slice(0, 25_000),
        hint: sourceUrl ? `from listing URL: ${sourceUrl}` : "pasted listing content",
      },
      undefined,
      customExtractFields
    );
    if (!fields.address) {
      return {
        error:
          "No property address found in the pasted text. Include the full address in what you paste.",
      };
    }
    return { preview: { ...fields, source_url: sourceUrl || "manual" } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "ai_extract",
      source_type: "url",
      source_ref: sourceUrl || "(pasted text)",
      error_message: msg,
    });
    return { error: `AI extraction failed: ${msg}` };
  }
}

// ─── Broker confirmed — save to DB ────────────────────────────────────────────

export async function saveIngestedUrl(
  preview: UrlPreview
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
    const id = await savePipelineProperty(supabase, user.id, preview, "url", preview.source_url);
    return { id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "db_save",
      source_type: "url",
      source_ref: preview.source_url,
      error_message: msg,
    });
    return { error: msg };
  }
}
