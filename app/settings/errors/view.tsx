"use client";

import { useState, useCallback, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, CheckCheck, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ErrorLogRow } from "@/lib/logger";
import {
  getErrorLogs,
  resolveErrorLog,
  dismissErrorLog,
  dismissAllErrorLogs,
  resolveAllErrorLogs,
} from "./actions";

const PAGE_SIZE = 30;

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

interface Props {
  initialRows: ErrorLogRow[];
  initialTotal: number;
  initialFilter: "unresolved" | "all";
}

export function ErrorLogsView({ initialRows, initialTotal, initialFilter }: Props) {
  const [rows, setRows]     = useState<ErrorLogRow[]>(initialRows);
  const [total, setTotal]   = useState(initialTotal);
  const [page, setPage]     = useState(0);
  const [filter, setFilter] = useState<"unresolved" | "all">(initialFilter);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState<"resolve" | "dismiss" | null>(null);
  const [isPending, startTransition] = useTransition();

  const load = useCallback((p: number, f: "unresolved" | "all") => {
    startTransition(async () => {
      const result = await getErrorLogs(f, p);
      if (!("error" in result)) {
        setRows(result.rows);
        setTotal(result.total);
        setPage(p);
      }
    });
  }, []);

  const switchFilter = (f: "unresolved" | "all") => {
    setFilter(f);
    load(0, f);
  };

  const handleResolve = useCallback((id: string) => {
    startTransition(async () => {
      await resolveErrorLog(id);
      if (filter === "unresolved") {
        setRows((prev) => prev.filter((r) => r.id !== id));
        setTotal((prev) => Math.max(0, prev - 1));
      } else {
        setRows((prev) =>
          prev.map((r) => r.id === id ? { ...r, resolved_at: new Date().toISOString() } : r)
        );
      }
    });
  }, [filter]);

  const handleDismiss = useCallback((id: string) => {
    startTransition(async () => {
      await dismissErrorLog(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
    });
  }, []);

  const handleBulkResolve = useCallback(() => {
    startTransition(async () => {
      await resolveAllErrorLogs();
      setRows([]);
      setTotal(0);
      setConfirmBulk(null);
    });
  }, []);

  const handleBulkDismiss = useCallback(() => {
    startTransition(async () => {
      await dismissAllErrorLogs();
      setRows([]);
      setTotal(0);
      setConfirmBulk(null);
    });
  }, []);

  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="shrink-0 border-b px-4 sm:px-6 py-4 flex items-center gap-4 justify-between flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-base font-semibold">App errors</h1>
          {total > 0 && (
            <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {total}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Filter tabs */}
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(["unresolved", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => switchFilter(f)}
                className={cn(
                  "px-3 py-1.5 capitalize transition-colors",
                  filter === f
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Bulk actions */}
          {rows.length > 0 && !confirmBulk && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground text-xs h-7"
                onClick={() => setConfirmBulk("resolve")}
              >
                <CheckCheck className="size-3.5 mr-1" /> Resolve all
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive text-xs h-7"
                onClick={() => setConfirmBulk("dismiss")}
              >
                <Trash2 className="size-3.5 mr-1" /> Dismiss all
              </Button>
            </>
          )}
          {confirmBulk && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">
                {confirmBulk === "resolve" ? "Mark all resolved?" : `Delete all ${total} errors?`}
              </span>
              <Button
                size="sm"
                variant={confirmBulk === "dismiss" ? "destructive" : "default"}
                className="h-7 text-xs"
                onClick={confirmBulk === "resolve" ? handleBulkResolve : handleBulkDismiss}
                disabled={isPending}
              >
                Confirm
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmBulk(null)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <div className="size-12 rounded-full bg-muted flex items-center justify-center">
              <CheckCircle2 className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">
              {filter === "unresolved" ? "No unresolved errors" : "No errors logged"}
            </p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Unexpected server action failures will appear here with full context for debugging.
            </p>
          </div>
        ) : (
          <div className={cn("divide-y", isPending && "opacity-60 pointer-events-none")}>
            {rows.map((row) => {
              const hasStack   = Boolean(row.stack);
              const hasContext = Object.keys(row.context ?? {}).length > 0;
              const isExpanded = expanded === row.id;

              return (
                <div key={row.id} className="px-4 sm:px-6 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={cn(
                            "text-xs font-medium rounded px-1.5 py-0.5",
                            row.severity === "error"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400"
                          )}
                        >
                          {row.severity}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground">{row.action}</span>
                        {row.resolved_at && (
                          <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-0.5">
                            <CheckCircle2 className="size-3" /> resolved
                          </span>
                        )}
                      </div>

                      <p className="text-sm text-foreground mt-0.5 break-words">{row.message}</p>

                      {(hasStack || hasContext) && (
                        <button
                          className="text-xs text-muted-foreground hover:text-foreground text-left mt-0.5"
                          onClick={() => setExpanded(isExpanded ? null : row.id)}
                        >
                          {isExpanded ? "Hide detail ↑" : "Show detail ↓"}
                        </button>
                      )}

                      {isExpanded && (
                        <div className="mt-2 space-y-2">
                          {hasContext && (
                            <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                              {JSON.stringify(row.context, null, 2)}
                            </pre>
                          )}
                          {hasStack && (
                            <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap break-all text-muted-foreground">
                              {row.stack}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatRelative(row.occurred_at)}
                      </span>
                      <div className="flex items-center gap-2">
                        {!row.resolved_at && (
                          <button
                            onClick={() => handleResolve(row.id)}
                            className="text-muted-foreground hover:text-green-600 dark:hover:text-green-400 transition-colors"
                            title="Mark resolved"
                          >
                            <CheckCheck className="size-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDismiss(row.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          title="Dismiss"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {total > PAGE_SIZE && (
        <footer className="shrink-0 border-t px-6 py-2 flex items-center justify-between text-xs text-muted-foreground bg-background">
          <span>
            {page * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => load(page - 1, filter)}
              disabled={!hasPrev || isPending}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="size-3.5" /> Prev
            </button>
            <button
              onClick={() => load(page + 1, filter)}
              disabled={!hasNext || isPending}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next <ChevronRight className="size-3.5" />
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}

export function ErrorLogsEmptyBanner({ ingestionCount }: { ingestionCount?: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center px-6">
      <div className="size-12 rounded-full bg-muted flex items-center justify-center">
        <AlertTriangle className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">No app errors logged</p>
      {ingestionCount != null && ingestionCount > 0 && (
        <p className="text-xs text-muted-foreground max-w-xs">
          There {ingestionCount === 1 ? "is" : "are"} {ingestionCount} ingestion error{ingestionCount !== 1 ? "s" : ""}.{" "}
          <Link href="/properties/errors" className="underline underline-offset-2">
            View ingestion errors →
          </Link>
        </p>
      )}
    </div>
  );
}
