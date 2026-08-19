import Link from "next/link";
import { cn } from "@/lib/utils";
import { STAGE_LABELS, STAGE_COLORS, fmtCommission, daysInStage } from "@/lib/deals";
import type { DealsForecast } from "./actions";

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function ForecastPanel({ forecast }: { forecast: DealsForecast }) {
  const { weightedPipelineValue, totalPipelineValue, byStage, winRate, staleCount, agingDeals } = forecast;

  const tiles: { label: string; value: string; sub?: string }[] = [
    {
      label: "Weighted pipeline",
      value: fmtCommission(weightedPipelineValue),
      sub: `of ${fmtCommission(totalPipelineValue)} total est. fees`,
    },
    {
      label: "Win rate",
      value: fmtPct(winRate),
      sub: "closed vs. closed + lost",
    },
    {
      label: "Stale deals",
      value: String(staleCount),
      sub: "14+ days in stage",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border bg-card px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t.label}
            </p>
            <p className="text-xl font-bold tabular-nums tracking-tight mt-0.5">{t.value}</p>
            {t.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{t.sub}</p>}
          </div>
        ))}
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-muted/30">
          <p className="text-xs font-semibold text-muted-foreground">Pipeline by stage</p>
        </div>
        {byStage.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">No active deals.</p>
        ) : (
          <div className="divide-y">
            {byStage.map((s) => (
              <div key={s.stage} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-wide border rounded-full px-2 py-0.5 shrink-0",
                    STAGE_COLORS[s.stage],
                  )}
                >
                  {STAGE_LABELS[s.stage]}
                </span>
                <span className="text-xs text-muted-foreground">{s.count} deal{s.count === 1 ? "" : "s"}</span>
                <span className="ml-auto text-sm font-medium tabular-nums">{fmtCommission(s.value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {agingDeals.length > 0 && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-muted/30">
            <p className="text-xs font-semibold text-muted-foreground">Aging deals (longest in stage)</p>
          </div>
          <div className="divide-y">
            {agingDeals.map((d) => (
              <Link
                key={d.id}
                href={`/deals/${d.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors"
              >
                <span className="text-sm font-medium truncate flex-1 min-w-0">{d.name}</span>
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-wide border rounded-full px-2 py-0.5 shrink-0",
                    STAGE_COLORS[d.stage],
                  )}
                >
                  {STAGE_LABELS[d.stage]}
                </span>
                <span className="text-xs text-amber-600 dark:text-amber-400 tabular-nums shrink-0">
                  {daysInStage(d)}d
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
