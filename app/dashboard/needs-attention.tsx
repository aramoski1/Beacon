"use client";

import { CheckCircle2 } from "lucide-react";
import type { EnrichedActionItem } from "@/lib/action-item-signals";
import type { FollowUpRow } from "@/app/follow-ups/actions";
import { EnrichedContactList } from "./enriched-contact-list";
import { DashboardFollowUpList } from "./follow-up-list";

export function NeedsAttentionToday({
  enrichedItems,
  followUpsOverdue,
  followUpsToday,
}: {
  enrichedItems: EnrichedActionItem[];
  followUpsOverdue: FollowUpRow[];
  followUpsToday: FollowUpRow[];
}) {
  const hasOutreach = enrichedItems.some((c) => c.daysOverdue >= 0);
  const hasFollowUps = followUpsOverdue.length + followUpsToday.length > 0;

  if (!hasOutreach && !hasFollowUps) {
    return (
      <div className="rounded-xl border bg-card px-5 py-8 text-center">
        <CheckCircle2 className="size-8 mx-auto mb-2 text-emerald-600/80" />
        <p className="text-sm font-medium">You&apos;re caught up for today</p>
        <p className="text-xs text-muted-foreground mt-1">
          No overdue outreach or follow-ups. Check upcoming items below.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden divide-y">
      {hasOutreach && (
        <div className="p-4 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Outreach on cadence
          </p>
          <EnrichedContactList items={enrichedItems} limit={8} />
        </div>
      )}
      {hasFollowUps && (
        <div className="p-4 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Follow-ups due
          </p>
          <DashboardFollowUpList
            initialOverdue={followUpsOverdue}
            initialToday={followUpsToday}
            compact
          />
        </div>
      )}
    </div>
  );
}
