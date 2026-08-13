/**
 * Turns raw exception text from ingestion (curl subprocess output, Anthropic
 * API error bodies, upstream county/registry errors) into something a broker
 * can act on. The raw text is never shown in the UI — logIngestionError
 * keeps it in error_detail.raw_message for support/debugging, but the
 * message stored in error_message (what app/properties/errors/view.tsx
 * renders) always goes through here first.
 */

import type { IngestionStage } from "@/lib/ingestion-logger";

const FILE_PATH_PATTERN = /[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s\\]+|\/(?:home|Users|tmp|var)\/[^\s]+/;

function extractAnthropicMessage(raw: string): { type: string | null; message: string | null } {
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return { type: null, message: null };
  try {
    const parsed = JSON.parse(raw.slice(jsonStart));
    const err = parsed?.error ?? parsed;
    if (err && typeof err.message === "string") {
      return { type: typeof err.type === "string" ? err.type : null, message: err.message };
    }
  } catch {
    // Not parseable JSON — fall through.
  }
  return { type: null, message: null };
}

function sanitizeAiExtractError(raw: string): string {
  const { type, message } = extractAnthropicMessage(raw);
  if (type === "invalid_request_error" && /credit balance/i.test(message ?? "")) {
    return "AI extraction is paused — the extraction service is out of usage credits. This is on our end, not your data; try again shortly.";
  }
  if (type === "rate_limit_error") {
    return "AI extraction hit a rate limit — try again in a minute.";
  }
  if (type === "overloaded_error") {
    return "The AI extraction service is temporarily overloaded — try again shortly.";
  }
  if (type || message) {
    return "AI extraction failed — try again, or try a different document if it keeps failing.";
  }
  return "AI extraction failed unexpectedly — try again.";
}

function sanitizeSunbizError(raw: string): string {
  if (/HTTP 403/.test(raw) || /Cloudflare/i.test(raw)) {
    return "Sunbiz blocked this lookup (rate-limited). Try again later, or search sunbiz.org directly.";
  }
  if (/Command failed|curl/.test(raw)) {
    return "Sunbiz lookup failed — the state registry may be temporarily unreachable. Try again, or search sunbiz.org directly.";
  }
  return "Sunbiz lookup failed. Try again, or search sunbiz.org directly.";
}

/** Strips any server filesystem path a message might still contain, regardless of stage. */
function stripFilePaths(message: string): string {
  return FILE_PATH_PATTERN.test(message)
    ? message.replace(FILE_PATH_PATTERN, "[internal path removed]")
    : message;
}

export function sanitizeIngestionError(stage: IngestionStage, rawMessage: string): string {
  if (stage === "ai_extract") return sanitizeAiExtractError(rawMessage);
  if (stage === "sunbiz_search" || stage === "sunbiz_detail") return sanitizeSunbizError(rawMessage);
  return stripFilePaths(rawMessage);
}
