"use client";

import { useState, useTransition } from "react";
import { BrainCircuit, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { generatePortfolioBriefing } from "./portfolio-briefing-actions";
import type { PortfolioBriefing } from "./portfolio-briefing-actions";
import type { OwnerPortfolioData } from "@/lib/owner-portfolio";
import { ComposeOutreach } from "@/components/compose-outreach";

const URGENCY_STYLES: Record<PortfolioBriefing["nextActions"][number]["urgency"], string> = {
  critical: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  high: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  medium: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
};

const URGENCY_LABEL: Record<PortfolioBriefing["nextActions"][number]["urgency"], string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
};

type State =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "ready"; briefing: PortfolioBriefing }
  | { kind: "error"; message: string };

export function PortfolioBriefing({ data }: { data: OwnerPortfolioData }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function generate() {
    setState({ kind: "generating" });
    startTransition(async () => {
      const result = await generatePortfolioBriefing(data);
      if (result.error) {
        setState({ kind: "error", message: result.error });
      } else {
        setState({ kind: "ready", briefing: result.briefing! });
      }
    });
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-violet-500/[0.03] flex items-center gap-2">
        <BrainCircuit className="size-4 text-violet-500 shrink-0" />
        <span className="text-sm font-semibold">Portfolio intelligence</span>
        {state.kind === "ready" && (
          <button
            onClick={generate}
            disabled={isPending}
            className="ml-auto text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Refresh
          </button>
        )}
      </div>

      <div className="px-4 py-4">
        {state.kind === "idle" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm text-muted-foreground max-w-sm">
              Generate an AI summary of this portfolio — relationship status, lease exposure, and who to call next.
            </p>
            <button
              onClick={generate}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium bg-violet-500/10 text-violet-700 dark:text-violet-400 hover:bg-violet-500/15 border border-violet-500/20 transition-colors"
            >
              <BrainCircuit className="size-4" />
              Generate intelligence
            </button>
          </div>
        )}

        {state.kind === "generating" && (
          <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm">Analyzing portfolio…</span>
          </div>
        )}

        {state.kind === "error" && (
          <div className="flex items-start gap-3 py-3">
            <TriangleAlert className="size-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-destructive">{state.message}</p>
              <button
                onClick={generate}
                className="mt-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {state.kind === "ready" && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {state.briefing.whereThingsStand}
            </p>

            {state.briefing.nextActions.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Next actions
                </p>
                {state.briefing.nextActions.map((action, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 space-y-1",
                      URGENCY_STYLES[action.urgency],
                    )}
                  >
                    <div className="flex items-center gap-2 justify-between">
                      <span className="text-sm font-medium">{action.contactName}</span>
                      <span className={cn(
                        "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded",
                        URGENCY_STYLES[action.urgency],
                      )}>
                        {URGENCY_LABEL[action.urgency]}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed opacity-90">{action.reason}</p>
                    {action.contactId && (
                      <div className="pt-1">
                        <ComposeOutreach
                          contactId={action.contactId}
                          contactName={action.contactName}
                          contactEmail={null}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              Generated {new Date(state.briefing.generatedAt).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
