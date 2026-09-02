"use client";

import { Plug } from "lucide-react";
import { OAUTH_PROVIDERS, type OauthProvider } from "@/lib/oauth-providers";

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
            <p className="text-[11px] font-mono text-muted-foreground">{p.envKeys.join(", ")}</p>
            <a
              href={`/auth/${p.id}/callback`}
              className="inline-flex text-xs font-medium rounded-md border px-3 py-1.5 hover:bg-muted/50"
            >
              {ready ? "Connect" : "Setup required"}
            </a>
          </div>
        );
      })}
    </div>
  );
}
