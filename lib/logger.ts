// Structured server-side logger.
//
// logError / logWarn — persist to error_logs table + trigger captureException
// withAction         — wrap a server action body; catches unexpected throws so
//                      they never surface raw stack traces to the client

import { createClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/error-reporter";

export type LogSeverity = "error" | "warn";

export type LogEntry = {
  action: string;
  message: string;
  severity?: LogSeverity;
  userId?: string | null;
  stack?: string;
  context?: Record<string, unknown>;
};

export type ErrorLogRow = {
  id: string;
  occurred_at: string;
  owner_id: string | null;
  action: string;
  severity: LogSeverity;
  message: string;
  stack: string | null;
  context: Record<string, unknown>;
  resolved_at: string | null;
};

// Write to error_logs. Skipped when there is no userId (pre-auth errors are
// reported externally only). Never throws.
async function persist(entry: LogEntry & { severity: LogSeverity }): Promise<void> {
  if (!entry.userId) return;
  try {
    const supabase = await createClient();
    await supabase.from("error_logs").insert({
      owner_id: entry.userId,
      action:   entry.action,
      severity: entry.severity,
      message:  entry.message,
      stack:    entry.stack ?? null,
      context:  entry.context ?? {},
    });
  } catch {
    // Logging must never crash the caller
  }
}

export async function logError(entry: LogEntry): Promise<void> {
  const full = { ...entry, severity: "error" as const };
  const err = new Error(entry.message);
  if (entry.stack) err.stack = entry.stack;

  // allSettled: DB write and external reporting are independent — one
  // failure must not prevent the other from running.
  await Promise.allSettled([
    persist(full),
    captureException(err, {
      action:   entry.action,
      userId:   entry.userId ?? undefined,
      context:  entry.context,
      severity: "error",
    }),
  ]);
}

export async function logWarn(entry: LogEntry): Promise<void> {
  await persist({ ...entry, severity: "warn" as const });
}

/**
 * Wraps a server action body and catches any unexpected throw.
 *
 * - Expected failures (return { error: "..." }) pass through untouched.
 * - Unexpected throws are logged with full context and converted to a
 *   generic { error } message so raw stack traces never reach the client.
 *
 * Usage:
 *   return withAction("createDeal", () => { ... }, { userId, context: { name } });
 * Redirects from Next.js `redirect()` are rethrown, not converted to `{ error }`.
 */
export function isNextControlFlowError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: string }).digest;
  if (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND"))
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  return message === "NEXT_REDIRECT" || message === "NEXT_NOT_FOUND";
}

export async function withAction<T extends Record<string, unknown>>(
  actionName: string,
  fn: () => Promise<T>,
  opts?: { userId?: string | null; context?: Record<string, unknown> }
): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    const error = e instanceof Error ? e : new Error(String(e));
    // Fire-and-forget: logging must not prevent the sanitized response from
    // reaching the client, even if the logger itself has a transient failure.
    logError({
      action:  actionName,
      message: error.message,
      stack:   error.stack,
      userId:  opts?.userId,
      context: opts?.context,
    }).catch(() => {});
    return { error: "An unexpected error occurred. It has been logged for review." };
  }
}
