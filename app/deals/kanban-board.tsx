"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2, ChevronRight, ChevronLeft,
  DollarSign, Trash2, User, AlertTriangle, Phone, MapPin, Mail,
} from "lucide-react";
import { DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { todayLocal } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  STAGE_LABELS, STAGE_COLORS, TERMINAL_STAGES,
  isDealStale, daysInStage, fmtCommission, nextStage, prevStage, isStageAllowedForType,
  type Deal, type DealStage,
} from "@/lib/deals";
import { createActivity } from "@/app/activities/actions";
import { formatCallOutcomeNote } from "@/lib/activity-touch";
import { ComposeOutreach } from "@/components/compose-outreach";

export function StagePill({ stage }: { stage: DealStage }) {
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
  dragDisabled,
}: {
  deal: Deal;
  onStageChange: (id: string, stage: DealStage) => void;
  onDelete: (id: string) => void;
  isUpdating: boolean;
  dragDisabled: boolean;
}) {
  const stale = isDealStale(deal);
  const days = daysInStage(deal);
  const contact = deal.contacts;
  const property = deal.properties;
  const next = nextStage(deal.stage, deal.deal_type);
  const prev = prevStage(deal.stage, deal.deal_type);
  const isTerminal = (TERMINAL_STAGES as readonly string[]).includes(deal.stage);
  const [logPending, startLog] = useTransition();
  const [composeOpen, setComposeOpen] = useState(false);
  const router = useRouter();

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
    disabled: dragDisabled,
  });
  const dragStyle = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 20 }
    : undefined;

  function quickTouch(type: "call" | "meeting") {
    startLog(async () => {
      await createActivity({
        contact_id: deal.contact_id,
        property_id: deal.property_id,
        deal_id: deal.id,
        activity_type: type,
        notes: type === "call"
          ? formatCallOutcomeNote("connected", `Re: ${deal.name}`)
          : `Tour / meeting — ${deal.name}`,
      });
      router.refresh();
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={dragStyle}
      {...attributes}
      className={cn(
        "rounded-xl border bg-card p-3 space-y-2 text-sm transition-colors",
        stale && "border-amber-500/40 bg-amber-500/[0.02]",
        isUpdating && "opacity-60",
        isDragging && "opacity-50 shadow-lg cursor-grabbing"
      )}
    >
      {/* Name + drag handle + stale indicator */}
      <div className="flex items-start gap-1.5 justify-between">
        <div className="flex items-start gap-1 flex-1 min-w-0">
          <span
            {...listeners}
            title="Drag to change stage"
            className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground select-none"
          >
            ⠿
          </span>
          <Link
            href={`/deals/${deal.id}`}
            className="font-medium leading-snug flex-1 min-w-0 hover:underline underline-offset-2"
          >
            {deal.name}
          </Link>
        </div>
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

      {deal.contact_id && (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            disabled={logPending}
            onClick={() => quickTouch("call")}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <Phone className="size-2.5" /> Call
          </button>
          <button
            type="button"
            disabled={logPending}
            onClick={() => quickTouch("meeting")}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <MapPin className="size-2.5" /> Tour
          </button>
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
          >
            <Mail className="size-2.5" /> Outreach
          </button>
        </div>
      )}
      {composeOpen && deal.contact_id && (
        <div className="rounded-lg border bg-muted/20 p-2 space-y-2">
          <div className="flex justify-between items-center">
            <p className="text-[10px] font-medium text-muted-foreground">Outreach</p>
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => setComposeOpen(false)}
            >
              Close
            </button>
          </div>
          <ComposeOutreach
            contactId={deal.contact_id}
            contactName={contact?.name ?? null}
            contactEmail={null}
            onSent={() => router.refresh()}
            onDone={() => { setComposeOpen(false); router.refresh(); }}
          />
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
            <p className={cn(
              "tabular-nums",
              deal.next_action_due < todayLocal()
                ? "text-destructive font-medium"
                : "text-muted-foreground",
            )}>
              {deal.next_action_due < todayLocal() ? "Overdue " : "Next due "}
              {new Date(deal.next_action_due + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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

      <details className="text-[10px] text-muted-foreground">
        <summary className="cursor-pointer select-none hover:text-foreground">More</summary>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete "${deal.name}"?`)) onDelete(deal.id);
          }}
          className="mt-1 flex items-center gap-1 text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 className="size-3" />
          Delete
        </button>
      </details>
    </div>
  );
}

function StageColumn({
  stage,
  deals,
  onStageChange,
  onDelete,
  updatingId,
  dragDisabled,
}: {
  stage: DealStage;
  deals: Deal[];
  onStageChange: (id: string, stage: DealStage) => void;
  onDelete: (id: string) => void;
  updatingId: string | null;
  dragDisabled: boolean;
}) {
  const isTerminal = (TERMINAL_STAGES as readonly string[]).includes(stage);
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div
      className={cn(
        "w-56 shrink-0 flex flex-col gap-2",
        isTerminal && "opacity-80"
      )}
    >
      {/* Column header */}
      <div className="flex items-center gap-1.5 px-1">
        <StagePill stage={stage} />
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {deals.length}
        </span>
      </div>

      {/* Cards */}
      <div
        ref={setNodeRef}
        className={cn(
          "space-y-2 min-h-16 rounded-xl transition-colors",
          isOver && "bg-primary/5 ring-2 ring-primary/30"
        )}
      >
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            onStageChange={onStageChange}
            onDelete={onDelete}
            isUpdating={updatingId === deal.id}
            dragDisabled={dragDisabled}
          />
        ))}
        {deals.length === 0 && (
          <div className="rounded-xl border border-dashed bg-muted/20 px-3 py-6 text-center">
            <p className="text-xs text-muted-foreground">No deals</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function KanbanBoard({
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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const byStage = new Map<DealStage, Deal[]>();
  for (const stage of stages) byStage.set(stage, []);
  const dealById = new Map<string, Deal>();
  for (const deal of deals) {
    dealById.set(deal.id, deal);
    const list = byStage.get(deal.stage);
    if (list) list.push(deal);
    else if (stages.length > 0) {
      // Stage outside filtered set — park in first column so the deal stays visible
      const fallback = byStage.get(stages[0]);
      fallback?.push(deal);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const dealId = active.id as string;
    const targetStage = over.id as DealStage;
    const deal = dealById.get(dealId);
    if (!deal || deal.stage === targetStage) return;
    if (!isStageAllowedForType(targetStage, deal.deal_type)) return;
    onStageChange(dealId, targetStage);
  }

  return (
    <DndContext id="deals-kanban" sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-3 min-w-max">
          {stages.map((stage) => (
            <StageColumn
              key={stage}
              stage={stage}
              deals={byStage.get(stage) ?? []}
              onStageChange={onStageChange}
              onDelete={onDelete}
              updatingId={updatingId}
              dragDisabled={updatingId !== null}
            />
          ))}
        </div>
      </div>
    </DndContext>
  );
}
