"use client";

import { useState } from "react";
import Link from "next/link";
import { Briefcase, Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEAL_STAGES, STAGE_LABELS,
  isDealStale, daysInStage, fmtCommission,
  type Deal, type DealStage,
} from "@/lib/deals";

export function ListView({
  deals,
  onStageChange,
  onDelete,
  onBulkStageChange,
  onBulkDelete,
  updatingId,
}: {
  deals: Deal[];
  onStageChange: (id: string, stage: DealStage) => void;
  onDelete: (id: string) => void;
  onBulkStageChange: (ids: string[], stage: DealStage) => void;
  onBulkDelete: (ids: string[]) => void;
  updatingId: string | null;
}) {
  const [stageFilter, setStageFilter] = useState<DealStage | "all">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filtered = stageFilter === "all"
    ? deals
    : deals.filter((d) => d.stage === stageFilter);

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(filtered.map((d) => d.id)) : new Set());
  }

  function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected pursuit${selectedIds.size === 1 ? "" : "s"}?`)) return;
    onBulkDelete([...selectedIds]);
    setSelectedIds(new Set());
  }

  function handleBulkStageChange(stage: DealStage) {
    if (selectedIds.size === 0) return;
    onBulkStageChange([...selectedIds], stage);
    setSelectedIds(new Set());
  }

  if (deals.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-4 py-12 text-center">
        <Briefcase className="size-8 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm font-medium">No deals yet</p>
        <p className="text-xs text-muted-foreground mt-1">Create your first pursuit to start tracking.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stage filter + bulk actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setStageFilter("all")}
            className={cn(
              "text-xs font-medium px-2.5 py-1 rounded-full border transition-colors",
              stageFilter === "all"
                ? "bg-foreground text-background border-foreground"
                : "text-muted-foreground border-border hover:border-foreground/40"
            )}
          >
            All ({deals.length})
          </button>
          {DEAL_STAGES.map((s) => {
            const count = deals.filter((d) => d.stage === s).length;
            if (count === 0) return null;
            return (
              <button
                key={s}
                onClick={() => setStageFilter(s)}
                className={cn(
                  "text-xs font-medium px-2.5 py-1 rounded-full border transition-colors",
                  stageFilter === s
                    ? "bg-foreground text-background border-foreground"
                    : "text-muted-foreground border-border hover:border-foreground/40"
                )}
              >
                {STAGE_LABELS[s]} ({count})
              </button>
            );
          })}
        </div>

        {selectedIds.size > 0 && (
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) handleBulkStageChange(e.target.value as DealStage);
                e.target.value = "";
              }}
              className="h-7 text-xs rounded-md border bg-background px-2 focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Change stage for selected"
            >
              <option value="" disabled>Change stage…</option>
              {DEAL_STAGES.map((s) => (
                <option key={s} value={s}>{STAGE_LABELS[s]}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 h-7 px-2.5 text-xs rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="size-3" />
              Delete {selectedIds.size}
            </button>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card overflow-hidden divide-y">
        <div className="flex items-center gap-4 px-4 py-2 bg-muted/30">
          <input
            type="checkbox"
            aria-label="Select all"
            checked={filtered.length > 0 && filtered.every((d) => selectedIds.has(d.id))}
            ref={(el) => {
              if (el) {
                el.indeterminate =
                  filtered.some((d) => selectedIds.has(d.id)) && !filtered.every((d) => selectedIds.has(d.id));
              }
            }}
            onChange={(e) => toggleAll(e.target.checked)}
            className="cursor-pointer accent-primary"
          />
          <span className="text-xs text-muted-foreground">Select all</span>
        </div>
        {filtered.map((deal) => {
          const stale = isDealStale(deal);
          const days = daysInStage(deal);
          return (
            <div
              key={deal.id}
              className={cn(
                "flex items-center gap-4 px-4 py-3",
                stale && "bg-amber-500/[0.02]",
                selectedIds.has(deal.id) && "bg-primary/5",
                updatingId === deal.id && "opacity-60"
              )}
            >
              <input
                type="checkbox"
                aria-label={`Select ${deal.name}`}
                checked={selectedIds.has(deal.id)}
                onChange={(e) => toggleOne(deal.id, e.target.checked)}
                className="cursor-pointer accent-primary shrink-0"
              />
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <Link href={`/deals/${deal.id}`} className="text-sm font-medium truncate hover:underline underline-offset-2">
                    {deal.name}
                  </Link>
                  {stale && <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {deal.contacts?.name && <span>{deal.contacts.name}</span>}
                  {deal.properties?.address && <span className="truncate">{deal.properties.address}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {deal.estimated_commission != null && (
                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hidden sm:block">
                    {fmtCommission(deal.estimated_commission)}
                  </span>
                )}
                <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                  {days}d
                </span>
                {/* Stage selector */}
                <select
                  value={deal.stage}
                  disabled={updatingId === deal.id}
                  onChange={(e) => onStageChange(deal.id, e.target.value as DealStage)}
                  className="text-xs rounded-lg border bg-background px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {DEAL_STAGES.map((s) => (
                    <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete "${deal.name}"?`)) onDelete(deal.id);
                  }}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
