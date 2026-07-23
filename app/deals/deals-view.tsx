"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Briefcase, Building2, ChevronRight, ChevronLeft,
  DollarSign, Trash2, User, AlertTriangle, LayoutGrid, List,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEAL_STAGES, DEAL_TYPES, DEAL_TYPE_LABELS, STAGE_LABELS, STAGE_COLORS, TERMINAL_STAGES,
  isDealStale, daysInStage, fmtCommission, nextStage, prevStage, stagesForDealType,
  type Deal, type DealStage, type DealType,
} from "@/lib/deals";
import { updateDealStage, deleteDeal } from "./actions";
import { CreateDealDialog } from "./create-deal-dialog";

function StagePill({ stage }: { stage: DealStage }) {
  return (
    <span className={cn("text-[10px] font-semibold uppercase tracking-wide border rounded-full px-2 py-0.5", STAGE_COLORS[stage])}>
      {STAGE_LABELS[stage]}
    </span>
  );
}

function DealCard({
  deal,
  onStageChange,
  onDelete,
  isUpdating,
}: {
  deal: Deal;
  onStageChange: (id: string, stage: DealStage) => void;
  onDelete: (id: string) => void;
  isUpdating: boolean;
}) {
  const stale = isDealStale(deal);
  const days = daysInStage(deal);
  const contact = deal.contacts;
  const property = deal.properties;
  const next = nextStage(deal.stage, deal.deal_type);
  const prev = prevStage(deal.stage, deal.deal_type);
  const isTerminal = (TERMINAL_STAGES as readonly string[]).includes(deal.stage);

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3 space-y-2 text-sm transition-colors",
        stale && "border-amber-500/40 bg-amber-500/[0.02]",
        isUpdating && "opacity-60"
      )}
    >
      {/* Name + stale indicator */}
      <div className="flex items-start gap-1.5 justify-between">
        <p className="font-medium leading-snug flex-1 min-w-0">{deal.name}</p>
        <div className="flex items-center gap-1 shrink-0">
          {stale && <AlertTriangle className="size-3 text-amber-500" />}
          <span className="text-[10px] tabular-nums text-muted-foreground">{days}d</span>
        </div>
      </div>

      {/* Contact + property */}
      {(contact?.name || property?.address) && (
        <div className="space-y-0.5">
          {contact?.name && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
              <User className="size-3 shrink-0" />
              {contact.name}{contact.company ? ` · ${contact.company}` : ""}
            </p>
          )}
          {property?.address && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
              <Building2 className="size-3 shrink-0" />
              {property.address}{property.city ? `, ${property.city}` : ""}
            </p>
          )}
        </div>
      )}

      {/* Commission + next action due */}
      {(deal.estimated_commission != null || deal.next_action_due) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {deal.estimated_commission != null && (
            <p className="font-medium flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <DollarSign className="size-3" />
              {fmtCommission(deal.estimated_commission)} est.
            </p>
          )}
          {deal.next_action_due && (
            <p className="text-muted-foreground tabular-nums">
              Next due {new Date(deal.next_action_due + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </p>
          )}
        </div>
      )}

      {/* Next action */}
      {deal.next_action && (
        <p className="text-xs text-muted-foreground italic truncate">↳ {deal.next_action}</p>
      )}

      {/* Controls */}
      {!isTerminal && (
        <div className="flex items-center gap-1 pt-1 border-t">
          <button
            type="button"
            disabled={!prev || isUpdating}
            onClick={() => prev && onStageChange(deal.id, prev)}
            title={prev ? `Move to ${STAGE_LABELS[prev]}` : undefined}
            className="flex items-center gap-0.5 h-6 px-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="size-3" />
          </button>
          <span className="flex-1" />
          {next && (
            <button
              type="button"
              disabled={isUpdating}
              onClick={() => onStageChange(deal.id, next)}
              title={`Move to ${STAGE_LABELS[next]}`}
              className="flex items-center gap-1 h-6 px-2 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              {STAGE_LABELS[next]}
              <ChevronRight className="size-3" />
            </button>
          )}
        </div>
      )}

      {/* Delete */}
      <button
        type="button"
        onClick={() => {
          if (confirm(`Delete "${deal.name}"?`)) onDelete(deal.id);
        }}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors"
      >
        <Trash2 className="size-3" />
        Delete
      </button>
    </div>
  );
}

function KanbanBoard({
  deals,
  stages,
  onStageChange,
  onDelete,
  updatingId,
}: {
  deals: Deal[];
  stages: readonly DealStage[];
  onStageChange: (id: string, stage: DealStage) => void;
  onDelete: (id: string) => void;
  updatingId: string | null;
}) {
  const byStage = new Map<DealStage, Deal[]>();
  for (const stage of stages) byStage.set(stage, []);
  for (const deal of deals) {
    const list = byStage.get(deal.stage);
    if (list) list.push(deal);
    else if (stages.length > 0) {
      // Stage outside filtered set — park in first column so the deal stays visible
      const fallback = byStage.get(stages[0]);
      fallback?.push(deal);
    }
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-3 min-w-max">
        {stages.map((stage) => {
          const stageDeas = byStage.get(stage) ?? [];
          const isTerminal = (TERMINAL_STAGES as readonly string[]).includes(stage);
          return (
            <div
              key={stage}
              className={cn(
                "w-56 shrink-0 flex flex-col gap-2",
                isTerminal && "opacity-80"
              )}
            >
              {/* Column header */}
              <div className="flex items-center gap-1.5 px-1">
                <StagePill stage={stage} />
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {stageDeas.length}
                </span>
              </div>

              {/* Cards */}
              <div className="space-y-2">
                {stageDeas.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    onStageChange={onStageChange}
                    onDelete={onDelete}
                    isUpdating={updatingId === deal.id}
                  />
                ))}
                {stageDeas.length === 0 && (
                  <div className="rounded-xl border border-dashed bg-muted/20 px-3 py-6 text-center">
                    <p className="text-xs text-muted-foreground">No deals</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({
  deals,
  onStageChange,
  onDelete,
  updatingId,
}: {
  deals: Deal[];
  onStageChange: (id: string, stage: DealStage) => void;
  onDelete: (id: string) => void;
  updatingId: string | null;
}) {
  const [stageFilter, setStageFilter] = useState<DealStage | "all">("all");

  const filtered = stageFilter === "all"
    ? deals
    : deals.filter((d) => d.stage === stageFilter);

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
      {/* Stage filter */}
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

      <div className="rounded-xl border bg-card overflow-hidden divide-y">
        {filtered.map((deal) => {
          const stale = isDealStale(deal);
          const days = daysInStage(deal);
          const next = nextStage(deal.stage, deal.deal_type);
          const isTerminal = (TERMINAL_STAGES as readonly string[]).includes(deal.stage);
          return (
            <div
              key={deal.id}
              className={cn(
                "flex items-center gap-4 px-4 py-3",
                stale && "bg-amber-500/[0.02]",
                updatingId === deal.id && "opacity-60"
              )}
            >
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{deal.name}</p>
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

export function DealsView({ initialDeals }: { initialDeals: Deal[] }) {
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [typeFilter, setTypeFilter] = useState<DealType | "all">("all");
  const [isPending, startTransition] = useTransition();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const router = useRouter();

  function handleStageChange(dealId: string, stage: DealStage) {
    setUpdatingId(dealId);
    setDeals((prev) =>
      prev.map((d) =>
        d.id === dealId ? { ...d, stage, updated_at: new Date().toISOString() } : d
      )
    );
    startTransition(async () => {
      const result = await updateDealStage(dealId, stage);
      if (result.error) {
        // Revert on error
        setDeals(initialDeals);
      }
      setUpdatingId(null);
      router.refresh();
    });
  }

  function handleDelete(dealId: string) {
    setDeals((prev) => prev.filter((d) => d.id !== dealId));
    startTransition(async () => {
      const result = await deleteDeal(dealId);
      if (result.error) {
        setDeals(initialDeals);
      }
      router.refresh();
    });
  }

  function handleCreated(deal: Deal) {
    setDeals((prev) => [deal, ...prev]);
  }

  const filteredDeals =
    typeFilter === "all" ? deals : deals.filter((d) => (d.deal_type ?? "tenant_rep") === typeFilter);

  const kanbanStages =
    typeFilter === "all" ? DEAL_STAGES : stagesForDealType(typeFilter);

  const activeCount = filteredDeals.filter((d) => !(TERMINAL_STAGES as readonly string[]).includes(d.stage)).length;
  const staleCount = filteredDeals.filter((d) => isDealStale(d)).length;

  return (
    <div className="space-y-6">
      {/* Sub-header */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {activeCount} active{staleCount > 0 && (
              <span className="ml-1.5 text-amber-600 dark:text-amber-400 font-medium">
                · {staleCount} stale
              </span>
            )}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as DealType | "all")}
            className="h-8 rounded-md border bg-background px-2 text-xs"
            aria-label="Filter by deal type"
          >
            <option value="all">All types</option>
            {DEAL_TYPES.map((t) => (
              <option key={t} value={t}>{DEAL_TYPE_LABELS[t]}</option>
            ))}
          </select>
          {/* View toggle */}
          <div className="flex rounded-lg border bg-muted/40 p-0.5">
            <button
              onClick={() => setView("kanban")}
              className={cn(
                "flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors",
                view === "kanban" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutGrid className="size-3.5" />
              Kanban
            </button>
            <button
              onClick={() => setView("list")}
              className={cn(
                "flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors",
                view === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <List className="size-3.5" />
              List
            </button>
          </div>
          <CreateDealDialog onCreated={handleCreated} />
        </div>
      </div>

      {view === "kanban" ? (
        <KanbanBoard
          deals={filteredDeals}
          stages={kanbanStages}
          onStageChange={handleStageChange}
          onDelete={handleDelete}
          updatingId={updatingId}
        />
      ) : (
        <ListView
          deals={filteredDeals}
          onStageChange={handleStageChange}
          onDelete={handleDelete}
          updatingId={updatingId}
        />
      )}
    </div>
  );
}
