"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BookmarkPlus,
  ChevronDown,
  Loader2,
  Mail,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchResult } from "./actions";
import {
  deleteSmartList,
  getSmartListContactIdsForOutreach,
  listSmartLists,
  saveSmartList,
  type SmartListEntity,
  type SmartListWithCounts,
} from "./smart-list-actions";

function countForEntity(list: SmartListWithCounts, entity: SmartListEntity): number {
  if (entity === "properties") return list.counts.properties;
  if (entity === "leases") return list.counts.leases;
  return list.counts.contacts;
}

function queryTextForSave(searchQuery: string, filters: SearchResult): string {
  return searchQuery.trim() || filters.explanation.trim();
}

// ─── Search mode: save new filters or delete an open list ─────────────────────

export function SearchListActions({
  entityType,
  savableFilters,
  activeFilters,
  searchQuery,
  activeListId,
  activeListName,
  onSaved,
  onDeleted,
  savePrompt,
  onSavePromptHandled,
}: {
  entityType: SmartListEntity;
  /** Filters that can be saved (null when a list is already open). */
  savableFilters: SearchResult | null;
  /** Currently applied filters (AI search or open smart list). */
  activeFilters: SearchResult | null;
  searchQuery: string;
  activeListId: string | null;
  activeListName: string | null;
  onSaved: (id: string, name: string) => void;
  onDeleted: () => void;
  savePrompt?: boolean;
  onSavePromptHandled?: () => void;
}) {
  const router = useRouter();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outreachPending, setOutreachPending] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (savePrompt && savableFilters) {
      setSaveName(savableFilters.explanation.slice(0, 80));
      setSaveOpen(true);
      onSavePromptHandled?.();
    }
  }, [savePrompt, savableFilters, onSavePromptHandled]);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!savableFilters) return;
    const queryText = queryTextForSave(searchQuery, savableFilters);
    if (!queryText) {
      setError("Nothing to save.");
      return;
    }
    startTransition(async () => {
      setError(null);
      const listName = saveName || savableFilters.explanation;
      const res = await saveSmartList(queryText, savableFilters, entityType, listName || undefined);
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaveOpen(false);
      setSaveName("");
      if (res.id) onSaved(res.id, listName.slice(0, 120));
    });
  }

  function handleDelete() {
    if (!activeListId) return;
    startTransition(async () => {
      setError(null);
      const res = await deleteSmartList(activeListId);
      if (res.error) setError(res.error);
      else onDeleted();
    });
  }

  async function handleOutreach() {
    if (!activeFilters) return;
    setOutreachPending(true);
    const res = await getSmartListContactIdsForOutreach(activeFilters);
    setOutreachPending(false);
    if (res.error) { setError(res.error); return; }
    if (res.contactIds.length === 0) { setError("No contacts in segment."); return; }
    sessionStorage.setItem("beacon_outreach_selection", JSON.stringify(res.contactIds));
    router.push("/outreach");
  }

  const canOutreach = entityType === "contacts" && activeFilters &&
    (activeFilters.target === "contacts" || activeFilters.target === "both");

  if (activeListId) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        {error && <span className="text-xs text-destructive">{error}</span>}
        <span className="inline-flex items-center gap-1.5 text-xs border border-primary/30 bg-primary/5 text-primary rounded-md px-2.5 py-1 max-w-[14rem]">
          <Sparkles className="size-3 shrink-0" />
          <span className="truncate font-medium">{activeListName ?? "Smart list"}</span>
        </span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="inline-flex items-center gap-1 text-xs text-destructive border border-destructive/30 rounded-md px-2.5 py-1 hover:bg-destructive/5 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          Delete
        </button>
        {canOutreach && (
          <button
            type="button"
            onClick={handleOutreach}
            disabled={outreachPending}
            className="inline-flex items-center gap-1 text-xs font-medium bg-violet-600 text-white rounded-md px-2.5 py-1 disabled:opacity-50"
          >
            {outreachPending ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
            Outreach all
          </button>
        )}
      </div>
    );
  }

  if (!savableFilters) return null;

  return (
    <div className="flex items-center gap-2 shrink-0">
      {error && <span className="text-xs text-destructive">{error}</span>}
      {!saveOpen ? (
        <button
          type="button"
          onClick={() => {
            setSaveName(savableFilters.explanation.slice(0, 80));
            setSaveOpen(true);
          }}
          className="inline-flex items-center gap-1 text-xs font-medium border rounded-md px-2.5 py-1 hover:bg-muted/50"
        >
          <BookmarkPlus className="size-3.5" />
          Save list
        </button>
      ) : (
        <form onSubmit={handleSave} className="flex items-center gap-1.5">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="List name"
            className="text-xs border rounded-md px-2 py-1 w-40 bg-background outline-none focus:ring-1 ring-ring"
            autoFocus
          />
          <button
            type="submit"
            disabled={isPending}
            className="text-xs font-medium bg-primary text-primary-foreground rounded-md px-2.5 py-1 disabled:opacity-50"
          >
            {isPending ? "…" : "Save"}
          </button>
          <button type="button" onClick={() => setSaveOpen(false)} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </form>
      )}
      {canOutreach && !saveOpen && (
        <button
          type="button"
          onClick={handleOutreach}
          disabled={outreachPending}
          className="inline-flex items-center gap-1 text-xs font-medium bg-violet-600 text-white rounded-md px-2.5 py-1 disabled:opacity-50"
        >
          {outreachPending ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
          Outreach all
        </button>
      )}
    </div>
  );
}

// ─── Smart lists mode: dropdown picker ──────────────────────────────────────

export function SmartListsBar({
  entityType,
  activeListId,
  onSelectList,
  onClearList,
}: {
  entityType: SmartListEntity;
  activeListId: string | null;
  onSelectList: (list: SmartListWithCounts) => void;
  onClearList: () => void;
}) {
  const [lists, setLists] = useState<SmartListWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLists(await listSmartLists(entityType));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load smart lists.");
    } finally {
      setLoading(false);
    }
  }, [entityType]);

  useEffect(() => {
    refreshLists();
  }, [refreshLists]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selected = lists.find((l) => l.id === activeListId) ?? null;

  function handleDelete(id: string) {
    startTransition(async () => {
      setError(null);
      const res = await deleteSmartList(id);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (activeListId === id) onClearList();
      await refreshLists();
    });
  }

  return (
    <div ref={containerRef} className="flex items-center gap-2 flex-1 min-w-0">
      {error && <span className="text-xs text-destructive shrink-0">{error}</span>}

      <div className="relative min-w-[12rem] max-w-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={loading && lists.length === 0}
          className={cn(
            "w-full flex items-center gap-2 text-xs border rounded-md px-2.5 py-1.5 bg-background hover:bg-muted/40 transition-colors text-left",
            open && "ring-1 ring-ring",
          )}
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin shrink-0 text-muted-foreground" />
          ) : (
            <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className={cn("flex-1 truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.name : lists.length === 0 ? "No saved lists yet" : "Choose a smart list…"}
          </span>
          {selected && (
            <span className="tabular-nums text-[10px] text-muted-foreground shrink-0">
              {countForEntity(selected, entityType)}
            </span>
          )}
          <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[16rem] max-h-64 overflow-auto rounded-md border bg-popover shadow-md py-1">
            {lists.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Save filters from Search mode to create a list.
              </p>
            ) : (
              lists.map((list) => {
                const count = countForEntity(list, entityType);
                const active = activeListId === list.id;
                return (
                  <div
                    key={list.id}
                    className={cn(
                      "flex items-center gap-1 px-1 group",
                      active && "bg-primary/5",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectList(list);
                        setOpen(false);
                      }}
                      className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-muted/50 rounded-sm"
                      title={list.query_text}
                    >
                      <span className="truncate font-medium">{list.name}</span>
                      <span className="ml-auto tabular-nums text-[10px] text-muted-foreground shrink-0">{count}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(list.id);
                      }}
                      disabled={isPending}
                      className="p-1.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 shrink-0"
                      title="Delete list"
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
    </div>
  );
}

export function BarModeToggle({
  mode,
  onChange,
}: {
  mode: "search" | "smart-lists";
  onChange: (mode: "search" | "smart-lists") => void;
}) {
  return (
    <div className="flex shrink-0 rounded-md border p-0.5 bg-muted/30">
      <button
        type="button"
        onClick={() => onChange("search")}
        className={cn(
          "px-2.5 py-1 text-xs font-medium rounded transition-colors",
          mode === "search" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        Search
      </button>
      <button
        type="button"
        onClick={() => onChange("smart-lists")}
        className={cn(
          "px-2.5 py-1 text-xs font-medium rounded transition-colors inline-flex items-center gap-1",
          mode === "smart-lists" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Sparkles className="size-3" />
        Smart lists
      </button>
    </div>
  );
}
