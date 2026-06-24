"use client";

import { useState, useCallback, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Trash2, AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { IngestionErrorRow } from "@/lib/ingestion-logger";
import { getIngestionErrors, dismissError, dismissAllErrors } from "./actions";

const PAGE_SIZE = 50;

const STAGE_LABELS: Record<string, string> = {
  gis_fetch:  "Address lookup",
  mdpa_fetch: "Property detail fetch",
  jina_fetch: "Web page fetch",
  ai_extract: "AI extraction",
  db_save:    "Database save",
};

const SOURCE_LABELS: Record<string, string> = {
  address: "Address",
  url:     "URL",
  upload:  "Upload",
};

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

interface Props {
  initialRows: IngestionErrorRow[];
  initialTotal: number;
}

export function ErrorsView({ initialRows, initialTotal }: Props) {
  const [rows, setRows]   = useState<IngestionErrorRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage]   = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [isPending, startTransition] = useTransition();

  const load = useCallback((p: number) => {
    startTransition(async () => {
      const result = await getIngestionErrors(p);
      if (!("error" in result)) {
        setRows(result.rows);
        setTotal(result.total);
        setPage(p);
      }
    });
  }, []);

  const handleDismiss = useCallback((id: string) => {
    startTransition(async () => {
      await dismissError(id);
      setRows(prev => prev.filter(r => r.id !== id));
      setTotal(prev => Math.max(0, prev - 1));
    });
  }, []);

  const handleClearAll = useCallback(() => {
    startTransition(async () => {
      await dismissAllErrors();
      setRows([]);
      setTotal(0);
      setPage(0);
      setConfirmClearAll(false);
    });
  }, []);

  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="shrink-0 border-b px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/crm" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-base font-semibold">Ingestion errors</h1>
          {total > 0 && (
            <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {total}
            </span>
          )}
        </div>
        {rows.length > 0 && (
          confirmClearAll ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Clear all {total} errors?</span>
              <Button size="sm" variant="destructive" onClick={handleClearAll} disabled={isPending}>
                Yes, clear all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmClearAll(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmClearAll(true)}
            >
              <Trash2 className="size-3.5 mr-1.5" />
              Clear all
            </Button>
          )
        )}
      </header>

      <main className="flex-1 overflow-auto">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <div className="size-12 rounded-full bg-muted flex items-center justify-center">
              <AlertTriangle className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No ingestion errors</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              When an address lookup, web fetch, or AI extraction fails, the error will appear here.
            </p>
          </div>
        ) : (
          <div className={cn("divide-y", isPending && "opacity-60 pointer-events-none")}>
            {rows.map(row => (
              <div key={row.id} className="px-6 py-4 flex flex-col gap-1">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium bg-destructive/10 text-destructive rounded px-1.5 py-0.5">
                        {STAGE_LABELS[row.stage] ?? row.stage}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {SOURCE_LABELS[row.source_type] ?? row.source_type}
                      </span>
                      {row.source_ref && (
                        <span className="text-xs text-muted-foreground font-mono truncate max-w-xs" title={row.source_ref}>
                          {row.source_ref.length > 60 ? row.source_ref.slice(0, 57) + "…" : row.source_ref}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-foreground mt-1">{row.error_message}</p>
                    {row.error_detail && Object.keys(row.error_detail).length > 0 && (
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground text-left mt-0.5"
                        onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                      >
                        {expanded === row.id ? "Hide detail ↑" : "Show detail ↓"}
                      </button>
                    )}
                    {expanded === row.id && (
                      <pre className="mt-2 text-xs bg-muted rounded p-3 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                        {JSON.stringify(row.error_detail, null, 2)}
                      </pre>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-3">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatRelative(row.occurred_at)}
                    </span>
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
            ))}
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
              onClick={() => load(page - 1)}
              disabled={!hasPrev || isPending}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="size-3.5" /> Prev
            </button>
            <button
              onClick={() => load(page + 1)}
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
