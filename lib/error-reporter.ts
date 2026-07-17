// Sentry-compatible error reporting hook.
// Gated behind BEACON_ERROR_DSN env var — absent means no external reporting.
//
// Supported DSN formats:
//   Sentry DSN  https://<key>@<host>/<projectId>  → Sentry store API (no SDK needed)
//   Generic URL https://any-webhook-url            → POST structured JSON
//
// Never throws — reporting failures must never affect the caller.

export type ExternalErrorReport = {
  action: string;
  userId?: string;
  context?: Record<string, unknown>;
  severity?: "error" | "warn";
};

// Parses a Sentry DSN and returns the store endpoint + auth key.
function parseSentryDsn(dsn: string): { storeUrl: string; authKey: string } | null {
  try {
    const url = new URL(dsn);
    const key = url.username;
    if (!key) return null;
    const projectId = url.pathname.replace(/^\/+/, "").split("/")[0];
    if (!projectId || isNaN(Number(projectId))) return null;
    const base = `${url.protocol}//${url.host}`;
    return {
      storeUrl: `${base}/api/${projectId}/store/`,
      authKey: key,
    };
  } catch {
    return null;
  }
}

function parseStackFrames(stack?: string) {
  if (!stack) return [];
  return stack
    .split("\n")
    .slice(1)
    .map((line) => {
      const m = line.trim().match(/^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
      if (!m) return { filename: line.trim() };
      return {
        function: m[1] ?? "<anonymous>",
        filename: m[2],
        lineno: parseInt(m[3], 10),
        colno: parseInt(m[4], 10),
        in_app: !m[2]?.includes("node_modules"),
      };
    })
    .reverse(); // Sentry wants innermost frame first
}

export async function captureException(
  error: Error,
  report: ExternalErrorReport
): Promise<void> {
  const dsn = process.env.BEACON_ERROR_DSN;
  if (!dsn) return;

  const sentry = parseSentryDsn(dsn);

  try {
    if (sentry) {
      await fetch(sentry.storeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": [
            "Sentry sentry_version=7",
            "sentry_client=beacon/1.0",
            `sentry_key=${sentry.authKey}`,
          ].join(", "),
        },
        body: JSON.stringify({
          event_id: crypto.randomUUID().replace(/-/g, ""),
          timestamp: new Date().toISOString(),
          platform: "node",
          level: report.severity ?? "error",
          transaction: report.action,
          exception: {
            values: [
              {
                type: error.name || "Error",
                value: error.message,
                stacktrace: { frames: parseStackFrames(error.stack) },
              },
            ],
          },
          tags: { action: report.action },
          user: report.userId ? { id: report.userId } : undefined,
          extra: report.context,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } else {
      // Generic webhook — POST structured JSON
      await fetch(dsn, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          action: report.action,
          severity: report.severity ?? "error",
          message: error.message,
          stack: error.stack,
          userId: report.userId,
          context: report.context,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    }
  } catch {
    // Never propagate — logging must not affect the caller
  }
}
