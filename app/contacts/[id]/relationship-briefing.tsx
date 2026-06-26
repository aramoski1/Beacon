"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw, Sparkles, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  generateRelationshipBriefing,
  type RelationshipBriefing,
} from "./briefing-actions";

function fmtGeneratedAt(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function RelationshipBriefingPanel({ contactId }: { contactId: string }) {
  const [briefing, setBriefing] = useState<RelationshipBriefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runGenerate() {
    setError(null);
    startTransition(async () => {
      const res = await generateRelationshipBriefing(contactId);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.briefing) setBriefing(res.briefing);
    });
  }

  return (
    <div className="rounded-xl border bg-gradient-to-br from-violet-500/[0.06] to-transparent overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
            <Sparkles className="size-3.5 text-violet-700 dark:text-violet-400" />
          </div>
          <div>
            <p className="text-sm font-semibold">Relationship briefing</p>
            <p className="text-[11px] text-muted-foreground">
              AI summary from activity, properties, outreach & leases
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={runGenerate}
          disabled={isPending}
          className={cn(
            "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium border transition-colors",
            "border-border bg-background hover:bg-muted/60 disabled:opacity-50",
          )}
        >
          {isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Generating…
            </>
          ) : briefing ? (
            <>
              <RefreshCw className="size-3.5" />
              Refresh
            </>
          ) : (
            <>
              <Sparkles className="size-3.5" />
              Generate briefing
            </>
          )}
        </button>
      </div>

      <div className="px-4 py-4 space-y-4">
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {!briefing && !isPending && !error && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            Pulls this contact&apos;s activity history, linked properties, outreach log, and lease expirations into a short &ldquo;where things stand&rdquo; summary with a suggested next move.
          </p>
        )}

        {isPending && !briefing && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="size-4 animate-spin shrink-0" />
            Reading CRM history…
          </div>
        )}

        {briefing && (
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Where things stand
              </p>
              <p className="text-sm leading-relaxed">{briefing.whereThingsStand}</p>
            </div>
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-400 mb-1.5 flex items-center gap-1">
                <Target className="size-3" />
                Suggested next move
              </p>
              <p className="text-sm font-medium leading-relaxed">{briefing.suggestedNextMove}</p>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Generated {fmtGeneratedAt(briefing.generatedAt)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
