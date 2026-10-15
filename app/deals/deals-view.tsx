"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, List, BarChart3, Settings2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEAL_STAGES, DEAL_TYPES, DEAL_TYPE_LABELS, TERMINAL_STAGES,
  isDealStale, daysInStage, stagesForDealType,
  type Deal, type DealStage, type DealType,
} from "@/lib/deals";
import { updateDealStage, deleteDeal, type DealsForecast } from "./actions";
import { CreateDealDialog } from "./create-deal-dialog";
import { CustomFieldsPanel } from "@/components/custom-fields-panel";
import { KanbanBoard } from "./kanban-board";
import { ListView } from "./list-view";
import { ForecastPanel } from "./forecast-panel";

type SortKey = "updated_desc" | "commission_desc" | "close_asc" | "days_desc";

const SORT_LABELS: Record<SortKey, string> = {
  updated_desc: "Recently updated",
  commission_desc: "Highest commission",
  close_asc: "Soonest close",
  days_desc: "Longest in stage",
};

function sortDeals(deals: Deal[], sortBy: SortKey): Deal[] {
  const sorted = [...deals];
  switch (sortBy) {
    case "commission_desc":
      return sorted.sort((a, b) => (b.estimated_commission ?? -1) - (a.estimated_commission ?? -1));
    case "close_asc":
      return sorted.sort((a, b) => {
        if (!a.expected_close_date && !b.expected_close_date) return 0;
        if (!a.expected_close_date) return 1;
        if (!b.expected_close_date) return -1;
        return a.expected_close_date.localeCompare(b.expected_close_date);
      });
    case "days_desc":
      return sorted.sort((a, b) => daysInStage(b) - daysInStage(a));
    case "updated_desc":
    default:
      return sorted.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }
}

function matchesSearch(deal: Deal, query: string): boolean {
  const q = query.toLowerCase();
  return (
    deal.name.toLowerCase().includes(q) ||
    (deal.contacts?.name?.toLowerCase().includes(q) ?? false) ||
    (deal.contacts?.company?.toLowerCase().includes(q) ?? false) ||
    (deal.properties?.address?.toLowerCase().includes(q) ?? false) ||
    (deal.properties?.city?.toLowerCase().includes(q) ?? false)
  );
}

export function DealsView({
  initialDeals,
  initialForecast,
  autoOpenCreate = false,
}: {
  initialDeals: Deal[];
  initialForecast: DealsForecast;
  autoOpenCreate?: boolean;
}) {
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [view, setView] = useState<"kanban" | "list" | "forecast">("kanban");
  const [typeFilter, setTypeFilter] = useState<DealType | "all">("tenant_rep");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("updated_desc");
  const [, startTransition] = useTransition();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [showFieldsPanel, setShowFieldsPanel] = useState(false);
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

  function handleBulkStageChange(dealIds: string[], stage: DealStage) {
    const idSet = new Set(dealIds);
    setDeals((prev) =>
      prev.map((d) => (idSet.has(d.id) ? { ...d, stage, updated_at: new Date().toISOString() } : d))
    );
    startTransition(async () => {
      await Promise.all(dealIds.map((id) => updateDealStage(id, stage)));
      router.refresh();
    });
  }

  function handleBulkDelete(dealIds: string[]) {
    const idSet = new Set(dealIds);
    setDeals((prev) => prev.filter((d) => !idSet.has(d.id)));
    startTransition(async () => {
      await Promise.all(dealIds.map((id) => deleteDeal(id)));
      router.refresh();
    });
  }

  function handleCreated(deal: Deal) {
    setDeals((prev) => [deal, ...prev]);
  }

  const filteredDeals = useMemo(() => {
    let result = typeFilter === "all" ? deals : deals.filter((d) => (d.deal_type ?? "tenant_rep") === typeFilter);
    if (searchQuery.trim()) result = result.filter((d) => matchesSearch(d, searchQuery.trim()));
    return sortDeals(result, sortBy);
  }, [deals, typeFilter, searchQuery, sortBy]);

  const kanbanStages =
    typeFilter === "all" ? DEAL_STAGES : stagesForDealType(typeFilter);

  const activeCount = filteredDeals.filter((d) => !(TERMINAL_STAGES as readonly string[]).includes(d.stage)).length;
  const staleCount = filteredDeals.filter((d) => isDealStale(d)).length;

  return (
    <div className="space-y-6 min-w-0 w-full">
      {/* Sub-header */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground shrink-0">
          {activeCount} active{staleCount > 0 && (
            <span
              className="ml-1.5 text-amber-600 dark:text-amber-400 font-medium"
              title="No stage change in 14+ days"
            >
              · {staleCount} stale
            </span>
          )}
        </span>

        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search deals…"
            className="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-xs outline-none focus:ring-2 ring-ring"
          />
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
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="h-8 rounded-md border bg-background px-2 text-xs"
            aria-label="Sort deals"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
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
            <button
              onClick={() => setView("forecast")}
              className={cn(
                "flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors",
                view === "forecast" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BarChart3 className="size-3.5" />
              Forecast
            </button>
          </div>
          <button
            onClick={() => setShowFieldsPanel(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Settings2 className="size-3" />
            Manage fields
          </button>
          <CreateDealDialog onCreated={handleCreated} defaultOpen={autoOpenCreate} />
        </div>
      </div>

      {showFieldsPanel && (
        <CustomFieldsPanel entityType="deal" onClose={() => setShowFieldsPanel(false)} />
      )}

      {view === "kanban" && typeFilter === "all" && (
        <div className="space-y-8 min-w-0 w-full">
          {DEAL_TYPES.map((t) => {
            const typeDeals = filteredDeals.filter((d) => (d.deal_type ?? "tenant_rep") === t);
            if (typeDeals.length === 0) return null;
            return (
              <div key={t} className="space-y-3">
                <h2 className="text-sm font-semibold">{DEAL_TYPE_LABELS[t]}</h2>
                <KanbanBoard
                  deals={typeDeals}
                  stages={stagesForDealType(t)}
                  onStageChange={handleStageChange}
                  onDelete={handleDelete}
                  updatingId={updatingId}
                />
              </div>
            );
          })}
        </div>
      )}
      {view === "kanban" && typeFilter !== "all" && (
        <KanbanBoard
          deals={filteredDeals}
          stages={kanbanStages}
          onStageChange={handleStageChange}
          onDelete={handleDelete}
          updatingId={updatingId}
        />
      )}
      {view === "list" && (
        <ListView
          deals={filteredDeals}
          onStageChange={handleStageChange}
          onDelete={handleDelete}
          onBulkStageChange={handleBulkStageChange}
          onBulkDelete={handleBulkDelete}
          updatingId={updatingId}
        />
      )}
      {view === "forecast" && <ForecastPanel forecast={initialForecast} />}
    </div>
  );
}
