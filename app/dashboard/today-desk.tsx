"use client";

import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TODAY_KIND_LABEL,
  type TodayDeskItem,
  type TodayDeskKind,
} from "@/lib/today-desk";

const KIND_CLS: Record<TodayDeskKind, string> = {
  lease_urgent: "bg-amber-500/15 text-amber-800 dark:text-amber-400",
  option_notice: "bg-rose-500/15 text-rose-800 dark:text-rose-400",
  exchange_1031: "bg-sky-500/15 text-sky-800 dark:text-sky-400",
  ownership: "bg-violet-500/15 text-violet-800 dark:text-violet-400",
  follow_up: "bg-orange-500/15 text-orange-800 dark:text-orange-400",
  deal_due: "bg-blue-500/15 text-blue-800 dark:text-blue-400",
  outreach: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-400",
};

export function TodayDesk({ items }: { items: TodayDeskItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-5 py-8 text-center">
        <CheckCircle2 className="size-8 mx-auto mb-2 text-emerald-600/80" />
        <p className="text-sm font-medium">Nothing due</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          Prospect, enrich a property, or abstract a lease — Today fills when cadence,
          pursuits, ownership flips, 1031 clocks, option notices, or rollovers need you.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden divide-y">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors group"
        >
          <span
            className={cn(
              "mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              KIND_CLS[item.kind],
            )}
          >
            {TODAY_KIND_LABEL[item.kind]}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{item.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.why}</p>
          </div>
          <ArrowRight className="size-3.5 shrink-0 mt-1 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>
      ))}
    </div>
  );
}
