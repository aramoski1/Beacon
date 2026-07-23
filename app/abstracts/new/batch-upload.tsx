"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import {
  Files, Upload, X, Loader2, CheckCircle2, AlertCircle, FileText, Building2, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  abstractLease,
  saveAbstractLease,
  getAllPropertiesForPicker,
  type LeasePreview,
} from "./actions";
import { matchPropertyByAddress } from "@/lib/lease-property";

// ─── Types ────────────────────────────────────────────────────────────────────

type PropertyOption = { id: string; address: string; city: string | null };

type ItemStatus =
  | { kind: "pending" }
  | { kind: "analyzing" }
  | { kind: "needs_property"; preview: LeasePreview }
  | { kind: "saving" }
  | { kind: "done"; abstractId: string }
  | { kind: "error"; message: string };

interface BatchItem {
  uid: string;
  file: File;
  status: ItemStatus;
  propertyId: string | null;
  propertyLabel: string | null;
  saveError: string | null;
}

// ─── Compact property picker for a batch row ──────────────────────────────────

function RowPropertyPicker({
  value,
  label,
  premisesHint,
  allProperties,
  disabled,
  onChange,
}: {
  value: string | null;
  label: string | null;
  premisesHint: string | null | undefined;
  allProperties: PropertyOption[];
  disabled?: boolean;
  onChange: (id: string, label: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = query.trim()
    ? allProperties.filter((p) =>
        (p.address + (p.city ? ` ${p.city}` : "")).toLowerCase().includes(query.toLowerCase())
      )
    : allProperties;

  if (value && label) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <Building2 className="size-3.5 text-primary shrink-0" />
        <span className="text-xs font-medium truncate" title={label}>{label}</span>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange("", "")}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title="Change property"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative min-w-[12rem] max-w-xs flex-1">
      {premisesHint && (
        <p className="text-[10px] text-muted-foreground mb-0.5 truncate" title={premisesHint}>
          Extracted: {premisesHint}
        </p>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Link a property…"
          disabled={disabled}
          className="w-full pl-7 pr-2 py-1 text-xs border border-border rounded-md outline-none focus:ring-2 ring-ring bg-background disabled:opacity-60"
        />
      </div>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-background shadow-md overflow-y-auto max-h-40">
          {filtered.length > 0 ? filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(r.id, r.address + (r.city ? `, ${r.city}` : ""));
                setQuery("");
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted/60 flex items-center gap-1.5"
            >
              <Building2 className="size-3 text-muted-foreground shrink-0" />
              <span className="truncate">{r.address}{r.city ? `, ${r.city}` : ""}</span>
            </button>
          )) : (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No match</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

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
  if (status.kind === "needs_property") {
    return (
      <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
        <AlertCircle className="size-3" />
        Needs property
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
  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getAllPropertiesForPicker().then(setAllProperties);
  }, []);

  function updateItem(uid: string, patch: Partial<BatchItem>) {
    setItems((prev) => prev.map((it) => (it.uid === uid ? { ...it, ...patch } : it)));
  }

  function addFiles(files: FileList | File[]) {
    const pdfs = Array.from(files).filter((f) => f.type === "application/pdf");
    if (pdfs.length === 0) return;
    setItems((prev) => [
      ...prev,
      ...pdfs.map((file) => ({
        uid: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        status: { kind: "pending" as const },
        propertyId: null,
        propertyLabel: null,
        saveError: null,
      })),
    ]);
  }

  function removeItem(uid: string) {
    setItems((prev) => prev.filter((it) => it.uid !== uid));
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }, []);

  const pendingCount = items.filter((it) => it.status.kind === "pending").length;
  const needsPropertyCount = items.filter((it) => it.status.kind === "needs_property").length;
  const readyToSaveCount = items.filter(
    (it) => it.status.kind === "needs_property" && it.propertyId,
  ).length;
  const doneCount = items.filter((it) => it.status.kind === "done").length;
  const errorCount = items.filter((it) => it.status.kind === "error").length;

  /** Phase 1: extract each pending PDF — stop at needs_property (no orphan saves). */
  async function runExtract() {
    setRunning(true);
    const pending = items.filter((it) => it.status.kind === "pending").map((it) => it.uid);

    for (const uid of pending) {
      const item = items.find((it) => it.uid === uid);
      if (!item) continue;

      updateItem(uid, { status: { kind: "analyzing" } });
      const fd = new FormData();
      fd.set("pdf", item.file);
      const result = await abstractLease(fd);

      if ("error" in result) {
        updateItem(uid, { status: { kind: "error", message: result.error } });
        continue;
      }

      const match = matchPropertyByAddress(allProperties, result.preview.premises_address);
      updateItem(uid, {
        status: { kind: "needs_property", preview: result.preview },
        propertyId: match?.id ?? null,
        propertyLabel: match
          ? match.address + (match.city ? `, ${match.city}` : "")
          : null,
      });
    }

    setRunning(false);
  }

  /** Phase 2: save only rows that have a confirmed property link. */
  async function runSaveLinked() {
    setRunning(true);
    const ready = items.filter(
      (it) => it.status.kind === "needs_property" && it.propertyId,
    );

    for (const item of ready) {
      if (item.status.kind !== "needs_property" || !item.propertyId) continue;
      const preview = item.status.preview;
      updateItem(item.uid, { status: { kind: "saving" }, saveError: null });

      const saved = await saveAbstractLease({
        ...preview,
        linked_property: item.propertyId,
      });

      if ("error" in saved) {
        updateItem(item.uid, {
          status: { kind: "needs_property", preview },
          saveError: saved.error,
        });
        continue;
      }

      updateItem(item.uid, {
        status: { kind: "done", abstractId: saved.id },
        saveError: null,
      });
    }

    setRunning(false);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
        Every lease must be linked to a property before save. Orphan leases won&apos;t appear in
        Lease radar — radar can&apos;t track expiration without a property.
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
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
          <p className="text-xs text-muted-foreground mt-0.5">
            Multiple files · PDF only · max 32 MB each · property required per lease
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          disabled={running}
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {/* File queue */}
      {items.length > 0 && (
        <div className="rounded-lg border divide-y overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 text-xs text-muted-foreground">
            <span className="flex-1">{items.length} file{items.length !== 1 ? "s" : ""}</span>
            {doneCount > 0 && <span className="text-emerald-600">{doneCount} done</span>}
            {needsPropertyCount > 0 && (
              <span className="text-amber-700 dark:text-amber-400">
                {needsPropertyCount} need property
              </span>
            )}
            {errorCount > 0 && <span className="text-destructive">{errorCount} failed</span>}
            {pendingCount > 0 && !running && <span>{pendingCount} pending</span>}
          </div>

          {items.map((item) => (
            <div
              key={item.uid}
              className={cn(
                "flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center",
                item.status.kind === "done" && "bg-emerald-50/50 dark:bg-emerald-950/20",
                item.status.kind === "error" && "bg-destructive/5",
                item.status.kind === "needs_property" && "bg-amber-50/40 dark:bg-amber-950/10",
              )}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <FileText className="size-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm truncate min-w-0" title={item.file.name}>
                  {item.file.name}
                </span>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  {(item.file.size / 1024 / 1024).toFixed(1)} MB
                </span>
                <StatusBadge status={item.status} />
              </div>

              {item.status.kind === "needs_property" && (
                <div className="flex flex-col gap-1 sm:items-end min-w-0">
                  <RowPropertyPicker
                    value={item.propertyId}
                    label={item.propertyLabel}
                    premisesHint={item.status.preview.premises_address}
                    allProperties={allProperties}
                    disabled={running}
                    onChange={(id, lbl) => {
                      if (!id) {
                        updateItem(item.uid, {
                          propertyId: null,
                          propertyLabel: null,
                          saveError: null,
                        });
                        return;
                      }
                      updateItem(item.uid, {
                        propertyId: id,
                        propertyLabel: lbl,
                        saveError: null,
                      });
                    }}
                  />
                  {item.saveError && (
                    <p className="text-[10px] text-destructive max-w-xs">{item.saveError}</p>
                  )}
                </div>
              )}

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
        <div className="flex flex-wrap items-center gap-3">
          {pendingCount > 0 && (
            <button
              onClick={runExtract}
              disabled={running}
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
                  Abstract {pendingCount} file{pendingCount !== 1 ? "s" : ""}
                </>
              )}
            </button>
          )}

          {needsPropertyCount > 0 && (
            <button
              onClick={runSaveLinked}
              disabled={running || readyToSaveCount === 0}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                "bg-emerald-600 text-white hover:bg-emerald-700",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {running ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-3.5" />
                  Save {readyToSaveCount} linked
                  {needsPropertyCount > readyToSaveCount
                    ? ` (${needsPropertyCount - readyToSaveCount} still need a property)`
                    : ""}
                </>
              )}
            </button>
          )}

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
              Each lease takes 20–60 s to analyze — then link a property before save
            </p>
          )}
        </div>
      )}
    </div>
  );
}
