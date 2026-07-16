"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Files, Upload, X, Loader2, CheckCircle2, AlertCircle, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { abstractLease, saveAbstractLease } from "./actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemStatus =
  | { kind: "pending" }
  | { kind: "analyzing" }
  | { kind: "saving" }
  | { kind: "done"; abstractId: string }
  | { kind: "error"; message: string };

interface BatchItem {
  uid: string;
  file: File;
  status: ItemStatus;
}

// ─── Status icon + label ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ItemStatus }) {
  if (status.kind === "pending") {
    return <span className="text-xs text-muted-foreground">Pending</span>;
  }
  if (status.kind === "analyzing") {
    return (
      <span className="flex items-center gap-1 text-xs text-primary">
        <Loader2 className="size-3 animate-spin" />
        Analyzing…
      </span>
    );
  }
  if (status.kind === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs text-primary">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status.kind === "done") {
    return (
      <Link
        href={`/abstracts/${status.abstractId}`}
        className="flex items-center gap-1 text-xs text-emerald-600 hover:underline underline-offset-2"
      >
        <CheckCircle2 className="size-3" />
        Done — view →
      </Link>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-destructive" title={status.message}>
      <AlertCircle className="size-3" />
      {status.message.slice(0, 60)}
    </span>
  );
}

// ─── Batch upload component ───────────────────────────────────────────────────

export function BatchUpload() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function updateStatus(uid: string, status: ItemStatus) {
    setItems(prev => prev.map(it => it.uid === uid ? { ...it, status } : it));
  }

  function addFiles(files: FileList | File[]) {
    const pdfs = Array.from(files).filter(f => f.type === "application/pdf");
    if (pdfs.length === 0) return;
    setItems(prev => [
      ...prev,
      ...pdfs.map(file => ({
        uid: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        status: { kind: "pending" as const },
      })),
    ]);
  }

  function removeItem(uid: string) {
    setItems(prev => prev.filter(it => it.uid !== uid));
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }, []);

  const pendingCount = items.filter(it => it.status.kind === "pending").length;
  const doneCount = items.filter(it => it.status.kind === "done").length;
  const errorCount = items.filter(it => it.status.kind === "error").length;

  async function runBatch() {
    setRunning(true);
    // Snapshot pending UIDs in order
    const pending = items.filter(it => it.status.kind === "pending").map(it => it.uid);

    for (const uid of pending) {
      const item = items.find(it => it.uid === uid);
      if (!item) continue;

      // Analyze
      updateStatus(uid, { kind: "analyzing" });
      const fd = new FormData();
      fd.set("pdf", item.file);
      const result = await abstractLease(fd);

      if ("error" in result) {
        updateStatus(uid, { kind: "error", message: result.error });
        continue;
      }

      // Save
      updateStatus(uid, { kind: "saving" });
      const saved = await saveAbstractLease(result.preview);

      if ("error" in saved) {
        updateStatus(uid, { kind: "error", message: saved.error });
        continue;
      }

      updateStatus(uid, { kind: "done", abstractId: saved.id });
    }

    setRunning(false);
  }

  return (
    <div className="space-y-4">

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !running && inputRef.current?.click()}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
          dragOver
            ? "border-primary bg-primary/5 cursor-copy"
            : running
            ? "border-border bg-muted cursor-not-allowed"
            : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/60 cursor-pointer",
        )}
      >
        <Files className="size-8 text-muted-foreground" />
        <div>
          <p className="font-medium text-sm">Drop PDFs here or click to browse</p>
          <p className="text-xs text-muted-foreground mt-0.5">Multiple files supported · PDF only · max 32 MB each</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          disabled={running}
          className="hidden"
          onChange={e => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {/* File queue */}
      {items.length > 0 && (
        <div className="rounded-lg border divide-y overflow-hidden">
          {/* Queue header */}
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 text-xs text-muted-foreground">
            <span className="flex-1">{items.length} file{items.length !== 1 ? "s" : ""}</span>
            {doneCount > 0 && <span className="text-emerald-600">{doneCount} done</span>}
            {errorCount > 0 && <span className="text-destructive">{errorCount} failed</span>}
            {pendingCount > 0 && !running && <span>{pendingCount} pending</span>}
          </div>

          {/* File rows */}
          {items.map(item => (
            <div
              key={item.uid}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5",
                item.status.kind === "done" && "bg-emerald-50/50 dark:bg-emerald-950/20",
                item.status.kind === "error" && "bg-destructive/5",
              )}
            >
              <FileText className="size-4 text-muted-foreground shrink-0" />
              <span className="flex-1 text-sm truncate min-w-0" title={item.file.name}>
                {item.file.name}
              </span>
              <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                {(item.file.size / 1024 / 1024).toFixed(1)} MB
              </span>
              <StatusBadge status={item.status} />
              {item.status.kind === "pending" && !running && (
                <button
                  onClick={() => removeItem(item.uid)}
                  className="ml-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title="Remove"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {items.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={runBatch}
            disabled={running || pendingCount === 0}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {running ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Abstracting…
              </>
            ) : (
              <>
                <Upload className="size-3.5" />
                Abstract {pendingCount > 0 ? `${pendingCount} file${pendingCount !== 1 ? "s" : ""}` : "all"}
              </>
            )}
          </button>
          {!running && (
            <button
              onClick={() => setItems([])}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear all
            </button>
          )}
          {pendingCount > 0 && !running && (
            <p className="text-xs text-muted-foreground">
              Each lease takes 20–60 s to analyze
            </p>
          )}
        </div>
      )}
    </div>
  );
}
