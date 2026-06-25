"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  CheckSquare, CheckCircle2, Plus, Loader2, Building2, User,
  AlertTriangle, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  markFollowUpDone,
  createFollowUp,
  getFollowUps,
  type FollowUpRow,
} from "./actions";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

function dueBadge(due: string) {
  const today = new Date().toISOString().slice(0, 10);
  if (due < today) {
    const diff = Math.floor(
      (new Date(today).getTime() - new Date(due).getTime()) / 86_400_000
    );
    return { label: `${diff}d overdue`, cls: "bg-destructive/10 text-destructive font-semibold" };
  }
  if (due === today) return { label: "Due today", cls: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400 font-medium" };
  return { label: fmtDate(due), cls: "bg-muted text-muted-foreground" };
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function FollowUpRow({
  row,
  onDone,
}: {
  row: FollowUpRow;
  onDone: (id: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = row.due_date < today;
  const badge = dueBadge(row.due_date);

  return (
    <tr className={cn(
      "group hover:bg-muted/30 transition-colors",
      isOverdue && "bg-destructive/5 hover:bg-destructive/10"
    )}>
      <td className="px-4 py-3 w-8">
        <button
          onClick={() => startTransition(async () => {
            const res = await markFollowUpDone(row.id);
            if (!res.error) onDone(row.id);
          })}
          disabled={isPending}
          className={cn(
            "rounded transition-colors",
            isPending ? "text-muted-foreground" :
              isOverdue ? "text-destructive hover:text-destructive/70" :
              "text-muted-foreground hover:text-primary"
          )}
          title="Mark done"
        >
          {isPending
            ? <Loader2 className="size-4 animate-spin" />
            : <CheckSquare className="size-4" />}
        </button>
      </td>
      <td className="px-4 py-3">
        <p className={cn("text-sm font-medium", isOverdue && "text-destructive")}>
          {row.description}
        </p>
      </td>
      <td className="px-4 py-3 hidden sm:table-cell">
        {row.contact_id ? (
          <Link
            href={`/contacts/${row.contact_id}`}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            <User className="size-3.5 shrink-0" />
            {row.contact_name ?? "—"}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        {row.property_id ? (
          <Link
            href={`/properties/${row.property_id}`}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit max-w-[200px]"
          >
            <Building2 className="size-3.5 shrink-0" />
            <span className="truncate">{row.property_address ?? "—"}</span>
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs", badge.cls)}>
          {badge.label}
        </span>
      </td>
    </tr>
  );
}

// ─── Add form ─────────────────────────────────────────────────────────────────

function AddFollowUpForm({
  onAdded,
  onClose,
}: {
  onAdded: (row: FollowUpRow) => void;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const defaultDate = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const description = (fd.get("description") as string)?.trim();
    const due_date    = fd.get("due_date") as string;
    if (!description || !due_date) return;

    startTransition(async () => {
      const res = await createFollowUp({ description, due_date });
      if (res.error) { setError(res.error); return; }
      // Reload page data via re-fetch to get the new row with linked data
      const all = await getFollowUps("open");
      const newRow = all.find((r) => r.id === res.id);
      if (newRow) onAdded(newRow);
      else onClose();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-muted/10 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">New follow-up</p>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Description</label>
          <input
            name="description"
            type="text"
            placeholder="e.g. Call back about lease renewal"
            required
            disabled={isPending}
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background outline-none focus:ring-2 ring-ring"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Due date</label>
          <input
            name="due_date"
            type="date"
            defaultValue={defaultDate}
            required
            disabled={isPending}
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background outline-none focus:ring-2 ring-ring"
          />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? <><Loader2 className="size-3.5 animate-spin" />Saving…</> : "Add follow-up"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function FollowUpsView({ initialFollowUps }: { initialFollowUps: FollowUpRow[] }) {
  const [followUps, setFollowUps] = useState<FollowUpRow[]>(initialFollowUps);
  const [showDone, setShowDone]   = useState(false);
  const [showAdd, setShowAdd]     = useState(false);
  const [isLoading, startTransition] = useTransition();

  const today = new Date().toISOString().slice(0, 10);

  const overdue  = followUps.filter((r) => !r.done && r.due_date < today);
  const dueToday = followUps.filter((r) => !r.done && r.due_date === today);
  const upcoming = followUps.filter((r) => !r.done && r.due_date > today);
  const done     = followUps.filter((r) => r.done);

  function handleDone(id: string) {
    setFollowUps((prev) => prev.map((r) => r.id === id ? { ...r, done: true, done_at: new Date().toISOString() } : r));
  }

  function handleAdded(row: FollowUpRow) {
    setFollowUps((prev) => [...prev, row]);
    setShowAdd(false);
  }

  function toggleDone() {
    if (!showDone) {
      startTransition(async () => {
        const doneRows = await getFollowUps("done");
        setFollowUps((prev) => {
          const ids = new Set(doneRows.map((r) => r.id));
          return [...prev.filter((r) => !r.done || ids.has(r.id)), ...doneRows.filter((r) => !prev.some((p) => p.id === r.id))];
        });
        setShowDone(true);
      });
    } else {
      setShowDone(false);
    }
  }

  const thCls = "text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground";

  function FollowUpTable({ rows, label, labelCls }: { rows: FollowUpRow[]; label: string; labelCls?: string }) {
    if (rows.length === 0) return null;
    return (
      <div className="space-y-1">
        <p className={cn("text-xs font-semibold uppercase tracking-wide px-1", labelCls ?? "text-muted-foreground")}>
          {label} · {rows.length}
        </p>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {rows.map((r) => (
                <FollowUpRow key={r.id} row={r} onDone={handleDone} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const openCount = overdue.length + dueToday.length + upcoming.length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Follow-ups</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {openCount} open
            {overdue.length > 0 && (
              <span className="ml-1.5 text-destructive font-medium">· {overdue.length} overdue</span>
            )}
          </p>
        </div>
        <Button
          onClick={() => setShowAdd((v) => !v)}
          size="sm"
          variant={showAdd ? "outline" : "default"}
          className="gap-1.5"
        >
          {showAdd ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
          {showAdd ? "Cancel" : "Add follow-up"}
        </Button>
      </div>

      {/* Add form */}
      {showAdd && (
        <AddFollowUpForm onAdded={handleAdded} onClose={() => setShowAdd(false)} />
      )}

      {/* Overdue urgency banner */}
      {overdue.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
          <AlertTriangle className="size-4 text-destructive shrink-0" />
          <p className="text-sm font-medium text-destructive">
            {overdue.length} follow-up{overdue.length !== 1 ? "s" : ""} past due — take action now
          </p>
        </div>
      )}

      {/* Tables: open */}
      {openCount === 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <CheckCircle2 className="size-4 text-green-600" />
          All caught up — no open follow-ups.
        </div>
      )}

      <div className="space-y-6">
        <FollowUpTable rows={overdue}  label="Overdue"   labelCls="text-destructive" />
        <FollowUpTable rows={dueToday} label="Due today" labelCls="text-orange-600 dark:text-orange-400" />
        <FollowUpTable rows={upcoming} label="Upcoming" />
      </div>

      {/* Done toggle */}
      <div>
        <button
          onClick={toggleDone}
          disabled={isLoading}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
        >
          {isLoading
            ? <Loader2 className="size-3.5 animate-spin" />
            : <CheckCircle2 className="size-3.5" />}
          {showDone ? "Hide completed" : "Show completed"}
          {done.length > 0 && ` (${done.length})`}
        </button>

        {showDone && done.length > 0 && (
          <div className="mt-3 rounded-lg border overflow-hidden opacity-60">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className={cn(thCls, "w-8")} />
                  <th className={thCls}>Description</th>
                  <th className={cn(thCls, "hidden sm:table-cell")}>Contact</th>
                  <th className={cn(thCls, "hidden md:table-cell")}>Property</th>
                  <th className={thCls}>Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {done.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <CheckCircle2 className="size-4 text-green-600" />
                    </td>
                    <td className="px-4 py-2.5 text-sm line-through text-muted-foreground">{r.description}</td>
                    <td className="px-4 py-2.5 hidden sm:table-cell text-sm text-muted-foreground">{r.contact_name ?? "—"}</td>
                    <td className="px-4 py-2.5 hidden md:table-cell text-sm text-muted-foreground truncate max-w-[180px]">{r.property_address ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {r.done_at
                        ? new Date(r.done_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
