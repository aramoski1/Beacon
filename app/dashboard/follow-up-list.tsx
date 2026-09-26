"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckSquare, CheckCircle2, Loader2, Building2, User, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { markFollowUpDone, type FollowUpRow } from "@/app/follow-ups/actions";
import { formatLocalDate, todayLocal } from "@/lib/dates";
import { stripDemoLabel } from "@/lib/demo-display";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDueDate(iso: string) {
  const today = todayLocal();
  if (iso === today) return "today";
  const d = iso.slice(0, 10);
  const todayMs = new Date(`${today}T12:00:00`).getTime();
  const dueMs = new Date(`${d}T12:00:00`).getTime();
  const diff = Math.floor((todayMs - dueMs) / 86_400_000);
  if (diff === 1) return "yesterday";
  if (diff > 1) return `${diff}d overdue`;
  return formatLocalDate(iso, { month: "short", day: "numeric" }) ?? iso;
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function FollowUpItem({
  row,
  onDone,
}: {
  row: FollowUpRow;
  onDone: (id: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const today = todayLocal();
  const isOverdue = row.due_date < today;
  const isDueToday = row.due_date === today;

  return (
    <li className={cn(
      "flex items-start gap-3 px-4 py-3",
      isOverdue && "bg-destructive/5"
    )}>
      <button
        onClick={() => startTransition(async () => {
          const res = await markFollowUpDone(row.id);
          if (!res.error) onDone(row.id);
        })}
        disabled={isPending}
        className={cn(
          "shrink-0 mt-0.5 rounded-full transition-colors",
          isPending ? "text-muted-foreground" : isOverdue
            ? "text-destructive hover:text-destructive/70"
            : "text-muted-foreground hover:text-primary"
        )}
        title="Mark done"
      >
        {isPending
          ? <Loader2 className="size-4 animate-spin" />
          : <CheckSquare className="size-4" />}
      </button>

      <div className="flex-1 min-w-0">
        <p className={cn(
          "text-sm font-medium",
          isOverdue && "text-destructive"
        )}>
          {stripDemoLabel(row.description) ?? row.description}
        </p>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          {row.contact_name && (
            <Link
              href={`/contacts/${row.contact_id}`}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <User className="size-3" />
              {row.contact_name}
            </Link>
          )}
          {row.property_address && (
            <Link
              href={`/properties/${row.property_id}`}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors truncate"
            >
              <Building2 className="size-3 shrink-0" />
              <span className="truncate">{row.property_address}</span>
            </Link>
          )}
        </div>
      </div>

      <span className={cn(
        "shrink-0 text-xs font-medium whitespace-nowrap",
        isOverdue ? "text-destructive" : isDueToday ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"
      )}>
        {fmtDueDate(row.due_date)}
      </span>
    </li>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DashboardFollowUpList({
  initialOverdue,
  initialToday,
  compact,
}: {
  initialOverdue: FollowUpRow[];
  initialToday:   FollowUpRow[];
  /** When true, return null instead of empty-state box (for combined sections). */
  compact?: boolean;
}) {
  const [overdue, setOverdue] = useState(initialOverdue);
  const [today, setToday]     = useState(initialToday);

  function markDone(id: string) {
    setOverdue((prev) => prev.filter((r) => r.id !== id));
    setToday((prev) => prev.filter((r) => r.id !== id));
  }

  const total = overdue.length + today.length;

  if (total === 0) {
    if (compact) return null;
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <CheckCircle2 className="size-4 text-green-600" />
        All caught up — no follow-ups due today.
      </div>
    );
  }

  return (
    <div className={compact ? "" : "rounded-lg border overflow-hidden"}>
      <ul className="divide-y">
        {overdue.map((r) => (
          <FollowUpItem key={r.id} row={r} onDone={markDone} />
        ))}
        {today.map((r) => (
          <FollowUpItem key={r.id} row={r} onDone={markDone} />
        ))}
      </ul>
    </div>
  );
}

// ─── Upcoming follow-ups (future due dates) ───────────────────────────────────

function fmtUpcomingDate(iso: string) {
  const today = todayLocal();
  const due = iso.slice(0, 10);
  const diff = Math.round(
    (new Date(`${due}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000,
  );
  if (diff === 1) return "tomorrow";
  if (diff <= 7) return formatLocalDate(iso, { weekday: "short" }) ?? iso;
  return formatLocalDate(iso, { month: "short", day: "numeric" }) ?? iso;
}

export function UpcomingFollowUpList({ items }: { items: FollowUpRow[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No follow-ups scheduled — set one after outreach or from a contact record.
      </p>
    );
  }

  return (
    <div className="rounded-xl border overflow-hidden divide-y">
      {items.map((row) => (
        <div key={row.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
          <CalendarDays className="size-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <Link
              href={row.contact_id ? `/contacts/${row.contact_id}` : "/follow-ups"}
              className="text-sm font-medium hover:underline underline-offset-2"
            >
              {stripDemoLabel(row.description) ?? row.description}
            </Link>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              {row.contact_name && row.contact_id && (
                <Link
                  href={`/contacts/${row.contact_id}`}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <User className="size-3" />
                  {row.contact_name}
                </Link>
              )}
              {row.property_address && row.property_id && (
                <Link
                  href={`/properties/${row.property_id}`}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground truncate"
                >
                  <Building2 className="size-3 shrink-0" />
                  <span className="truncate">{row.property_address}</span>
                </Link>
              )}
            </div>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
            {fmtUpcomingDate(row.due_date)}
          </span>
        </div>
      ))}
    </div>
  );
}
