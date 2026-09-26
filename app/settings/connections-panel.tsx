"use client";

import { Plug } from "lucide-react";
import { OAUTH_PROVIDERS, type OauthProvider } from "@/lib/oauth-providers";

function providerNote(id: OauthProvider): string {
  if (id === "google_gmail" || id === "microsoft_mail") {
    return "Not in this build. Outreach stays Open in email.";
  }
  if (id === "google_calendar" || id === "microsoft_calendar") {
    return "Not in this build. Tours stay on the Tours page — no calendar sync yet.";
  }
  return "Not in this build. Deal documents stay as downloads — no e-sign yet.";
}

export function ConnectionsPanel({
  configured,
}: {
  configured: Record<OauthProvider, boolean>;
}) {
  return (
    <div className="space-y-4">
      {OAUTH_PROVIDERS.map((p) => {
        const ready = configured[p.id];
        return (
          <div key={p.id} className="rounded-lg border p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium flex items-center gap-2">
                <Plug className="size-3.5 text-muted-foreground" />
                {p.label}
              </p>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {ready ? "Keys present" : "Not configured"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{p.description}</p>
            <p className="text-xs text-muted-foreground">{providerNote(p.id)}</p>
            <button
              type="button"
              disabled
              className="inline-flex text-xs font-medium rounded-md border px-3 py-1.5 opacity-50 cursor-not-allowed"
            >
              Connect — not in this build
            </button>
          </div>
        );
      })}
    </div>
  );
}
