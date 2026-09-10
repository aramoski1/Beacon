"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { BookmarkPlus, ChevronDown, Loader2, Target, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { deleteBuyBox, saveBuyBox, type BuyBox } from "./actions";
import type { LeadSearchCriteria } from "@/lib/lead-finder";

/**
 * Saved-search UI for the lead finder, matching the Workspace's smart-lists
 * pattern (app/crm/smart-lists-bar.tsx): a dropdown picker to load a saved
 * buy box, plus a separate inline "save" action for the current criteria.
 * Same visual language (Sparkles-style dropdown, hover-revealed delete,
 * BookmarkPlus save trigger) — different domain object (buy box vs. smart
 * list), same interaction shape.
 */

// ─── Picker: choose a saved buy box ────────────────────────────────────────────

export function BuyBoxPicker({
  buyBoxes,
  activeBuyBoxId,
  onSelect,
  onDeleted,
  onClear,
}: {
  buyBoxes: BuyBox[];
  activeBuyBoxId: string | null;
  onSelect: (box: BuyBox) => void;
  onDeleted: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selected = buyBoxes.find((b) => b.id === activeBuyBoxId) ?? null;

  function handleDelete(id: string) {
    startTransition(async () => {
      setError(null);
      const res = await deleteBuyBox(id);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      onDeleted(id);
      setOpen(false);
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div ref={containerRef} className="relative min-w-[12rem] max-w-sm">
        {error && <p className="absolute -top-5 left-0 text-xs text-destructive">{error}</p>}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "w-full flex items-center gap-2 text-xs border rounded-md px-2.5 py-1.5 bg-background hover:bg-muted/40 transition-colors text-left",
            open && "ring-1 ring-ring",
            selected && "border-primary/30 bg-primary/5",
          )}
        >
          <Target className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={cn("flex-1 truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.name : buyBoxes.length === 0 ? "No saved buy boxes yet" : "Choose a buy box…"}
          </span>
          <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[16rem] max-h-64 overflow-auto rounded-md border bg-popover shadow-md py-1">
            {buyBoxes.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Save your current criteria below to create one.
              </p>
            ) : (
              buyBoxes.map((box) => {
                const active = activeBuyBoxId === box.id;
                return (
                  <div
                    key={box.id}
                    className={cn("flex items-center gap-1 px-1", active && "bg-primary/5")}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(box);
                        setOpen(false);
                      }}
                      className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-muted/50 rounded-sm"
                    >
                      <span className="truncate font-medium">{box.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(box.id);
                      }}
                      disabled={isPending}
                      className="p-1.5 text-muted-foreground hover:text-destructive shrink-0"
                      title="Delete buy box"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {selected && (
        <>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground border rounded-md px-2.5 py-1.5 hover:bg-muted/50 hover:text-foreground"
          >
            <X className="size-3.5" />
            Clear
          </button>
          <button
            type="button"
            onClick={() => handleDelete(selected.id)}
            disabled={isPending}
            className="inline-flex items-center gap-1 text-xs text-destructive border border-destructive/30 rounded-md px-2.5 py-1.5 hover:bg-destructive/5 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Delete
          </button>
        </>
      )}
    </div>
  );
}

// ─── Save action: save the current criteria as a new buy box ──────────────────

export function SaveBuyBoxAction({
  criteria,
  onSaved,
}: {
  criteria: LeadSearchCriteria;
  onSaved: (box: BuyBox) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give this buy box a name.");
      return;
    }
    startTransition(async () => {
      setError(null);
      const res = await saveBuyBox(trimmed, criteria);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setName("");
      onSaved({ id: res.id, name: trimmed, criteria, updatedAt: new Date().toISOString() });
    });
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      {error && <span className="text-xs text-destructive">{error}</span>}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-xs font-medium border rounded-md px-2.5 py-1.5 hover:bg-muted/50"
        >
          <BookmarkPlus className="size-3.5" />
          Save buy box
        </button>
      ) : (
        <form onSubmit={handleSave} className="flex items-center gap-1.5">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Buy box name"
            className="text-xs border rounded-md px-2 py-1.5 w-40 bg-background outline-none focus:ring-1 ring-ring"
            autoFocus
          />
          <button
            type="submit"
            disabled={isPending}
            className="text-xs font-medium bg-primary text-primary-foreground rounded-md px-2.5 py-1.5 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </form>
      )}
    </div>
  );
}
