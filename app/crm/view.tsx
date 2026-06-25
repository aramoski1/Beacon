"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, FileText, ExternalLink, Loader2, Search, Sparkles, X, Trash2, CalendarDays, DollarSign, Settings2, Plus, ShieldAlert, AlertCircle, ChevronLeft, ChevronRight, MapPin, SlidersHorizontal, Check } from "lucide-react";
import { EnhanceDialog } from "./enhance-dialog";
import { interpretSearch, deleteProperty, deleteContact, deleteLease, type SearchResult, type PropertySearchFilters, type ContactSearchFilters, type LeaseSearchFilters } from "./actions";
import { createFieldDefinition, deleteFieldDefinition } from "@/app/settings/fields/actions";
import { fieldSlug, type FieldDefinition, type EntityType, type FieldType } from "@/lib/custom-fields";
import { SourceChip } from "@/components/source-chip";
import { TableSkeleton } from "@/components/ui/skeleton";

// ─── Types ────────────────────────────────────────────────────────────────────

type Property = {
  id: string;
  address: string | null;
  city: string | null;
  owner_name: string | null;
  ownership_type: string | null;
  size_sqft: number | null;
  land_sqft: number | null;
  asset_description: string | null;
  prospect_number: number | null;
  size_category: string | null;
  geographic_category: string | null;
  property_type: string | null;
  last_sale_date: string | null;
  last_sale_price: number | null;
  source: string | null;
  source_url: string | null;
  ingested_at: string | null;
  custom_fields: Record<string, unknown> | null;
};

type LinkedContactInfo = {
  id: string;
  name: string | null;
  email: string | null;
  mailing_address: string | null;
  last_activity_date: string | null;
  last_activity_type: string | null;
  last_activity_notes: string | null;
};

type Contact = {
  id: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  mailing_address: string | null;
  contact_tier: number | null;
  client_status: string | null;
  action_tags: string[];
  size_category: string | null;
  geographic_category: string | null;
  ownership_type: string | null;
  contact_type: string | null;
  last_contacted_at: string | null;
};

type LeaseAbstract = {
  id: string;
  source_document: string | null;
  execution_date: string | null;
  expiration_date: string | null;
  term: string | null;
  base_rate: number | null;
  created_at: string;
};

type PropFilters = {
  propType: string;
  ownership: string;
  sizeCat: string;
  geoCat: string;
};
type ConFilters = {
  tier: string;
  status: string;
  contactType: string;
  sizeCat: string;
  geoCat: string;
  ownership: string;
  tag: string;
};
type LeaseFilters = {
  status: string; // "active" | "expiring" | "expired" | ""
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const PROP_TYPES = [
  { value: "industrial", label: "Industrial" },
  { value: "office", label: "Office" },
  { value: "retail", label: "Retail" },
  { value: "multifamily", label: "Multifamily" },
  { value: "land", label: "Land" },
  { value: "residential", label: "Residential" },
  { value: "mixed-use", label: "Mixed-use" },
  { value: "other", label: "Other" },
];

const OWNERSHIP_TYPES = [
  { value: "institutional", label: "Institutional" },
  { value: "private", label: "Private" },
  { value: "REIT", label: "REIT" },
  { value: "owner-occupant", label: "Owner-occupant" },
  { value: "unknown", label: "Unknown" },
];

const CLIENT_STATUSES = [
  { value: "prospect", label: "Prospect" },
  { value: "active client", label: "Active client" },
  { value: "past client", label: "Past client" },
];

const CONTACT_TYPES = [
  { value: "owner", label: "Owner" },
  { value: "tenant", label: "Tenant" },
  { value: "other", label: "Other" },
];

const PROP_COL_DEFS: { id: string; label: string; alwaysOn?: boolean }[] = [
  { id: "prospect", label: "Prospect #" },
  { id: "owner",    label: "Ownership Entity" },
  { id: "address",  label: "Property Address", alwaysOn: true },
  { id: "bsf",      label: "Building SF" },
  { id: "lsf",      label: "Land SF" },
  { id: "asset",    label: "Asset Description" },
  { id: "contact",  label: "Owner Contact" },
  { id: "addr2",    label: "Owner Address" },
  { id: "email",    label: "Owner Email" },
  { id: "activity", label: "Activity Date/Type" },
  { id: "notes",    label: "Notes" },
  { id: "saledate", label: "Last Sale Date" },
  { id: "saleval",  label: "Last Sale Value" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null) {
  if (n == null) return null;
  return n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `$${Math.round(n / 1_000)}K`
    : `$${n}`;
}

function fmtSqft(n: number | null) {
  if (n == null) return null;
  return n.toLocaleString("en-US") + " sf";
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function uniq(arr: (string | null | undefined)[]): string[] {
  return [...new Set(arr.filter((x): x is string => !!x))].sort();
}

// ─── Editable cells ───────────────────────────────────────────────────────────

function EditableSelect({
  value,
  options,
  onSave,
}: {
  value: string | null;
  options: { value: string; label: string }[];
  onSave: (v: string | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onSave(e.target.value || null)}
      className="bg-transparent border-0 outline-none text-sm cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-muted/60 focus:bg-muted/60 max-w-36"
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function EditableText({
  value,
  placeholder = "—",
  displayValue,
  onSave,
  displayClassName,
}: {
  value: string | null;
  placeholder?: string;
  displayValue?: string | null;
  onSave: (v: string | null) => void;
  displayClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    setEditing(false);
    onSave(draft.trim() || null);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); }
        }}
        className="text-sm px-1 py-0.5 border border-border rounded outline-none focus:ring-1 ring-ring w-full bg-background"
      />
    );
  }

  const shown = displayValue !== undefined ? displayValue : value;
  return (
    <span
      onClick={() => { setDraft(value ?? ""); setEditing(true); }}
      className={cn("cursor-text rounded px-1 py-0.5 -mx-1 hover:bg-muted/60 text-sm", displayClassName)}
      title={String(shown ?? "")}
    >
      {shown ?? <span className="text-muted-foreground">{placeholder}</span>}
    </span>
  );
}

function EditableTags({
  tags,
  onSave,
}: {
  tags: string[];
  onSave: (v: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  function remove(tag: string) {
    onSave(tags.filter((t) => t !== tag));
  }

  function add() {
    const t = draft.trim();
    if (t && !tags.includes(t)) onSave([...tags, t]);
    setDraft("");
    setAdding(false);
  }

  return (
    <div className="flex flex-wrap gap-1 items-center min-h-6 py-0.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
        >
          {tag}
          <button
            onClick={() => remove(tag)}
            className="ml-0.5 text-muted-foreground hover:text-foreground leading-none"
            title={`Remove "${tag}"`}
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); add(); }
            if (e.key === "Escape") { setDraft(""); setAdding(false); }
          }}
          className="text-xs px-1.5 py-0.5 border border-border rounded outline-none focus:ring-1 ring-ring w-24 bg-background"
          placeholder="tag name…"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-muted-foreground hover:text-foreground text-xs rounded-full border border-dashed px-2 py-0.5 hover:border-foreground transition-colors"
        >
          + tag
        </button>
      )}
    </div>
  );
}

function TierBadge({
  tier,
  onSave,
}: {
  tier: number | null;
  onSave: (v: number | null) => void;
}) {
  const cls =
    tier === 1
      ? "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300"
      : tier === 2
      ? "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300"
      : tier === 3
      ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
      : "border border-dashed border-muted-foreground/40 text-muted-foreground";

  return (
    <select
      value={tier ?? ""}
      onChange={(e) => onSave(e.target.value ? Number(e.target.value) : null)}
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-semibold cursor-pointer border-0 outline-none appearance-none text-center",
        cls
      )}
      title="Set tier"
    >
      <option value="">—</option>
      <option value="1">Tier 1</option>
      <option value="2">Tier 2</option>
      <option value="3">Tier 3</option>
    </select>
  );
}

function StatusBadge({
  status,
  onSave,
}: {
  status: string | null;
  onSave: (v: string | null) => void;
}) {
  const cls =
    status === "active client"
      ? "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-300"
      : status === "prospect"
      ? "bg-purple-100 text-purple-900 dark:bg-purple-900/30 dark:text-purple-300"
      : status === "past client"
      ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
      : "border border-dashed border-muted-foreground/40 text-muted-foreground";

  return (
    <select
      value={status ?? ""}
      onChange={(e) => onSave(e.target.value || null)}
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-semibold cursor-pointer border-0 outline-none appearance-none",
        cls
      )}
      title="Set client status"
    >
      <option value="">—</option>
      <option value="prospect">Prospect</option>
      <option value="active client">Active client</option>
      <option value="past client">Past client</option>
    </select>
  );
}

function contactTypeCls(t: string | null) {
  if (t === "owner") return "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-400";
  if (t === "tenant") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400";
  if (t === "other") return "bg-muted text-muted-foreground";
  return "border border-dashed border-muted-foreground/40 text-muted-foreground";
}

function ContactTypeBadge({
  contactType,
  onSave,
}: {
  contactType: string | null;
  onSave: (v: string | null) => void;
}) {
  return (
    <select
      value={contactType ?? ""}
      onChange={(e) => onSave(e.target.value || null)}
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-semibold cursor-pointer border-0 outline-none appearance-none capitalize",
        contactTypeCls(contactType),
      )}
      title="Set contact type"
    >
      <option value="">—</option>
      {CONTACT_TYPES.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function TabSearchInput({
  value,
  placeholder,
  searching,
  onChange,
  onSearch,
  onClear,
}: {
  value: string;
  placeholder: string;
  searching: boolean;
  onChange: (v: string) => void;
  onSearch: (q: string) => void;
  onClear: () => void;
}) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSearch(value); }}
      className="relative flex items-center shrink-0"
    >
      {searching ? (
        <Loader2 className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground animate-spin" />
      ) : (
        <Sparkles className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { onChange(""); onClear(); } }}
        placeholder={placeholder}
        disabled={searching}
        className={cn(
          "pl-6 pr-6 py-1 text-xs border border-border rounded outline-none focus:ring-1 ring-ring bg-background w-56 placeholder:text-muted-foreground/60 disabled:opacity-60",
          value && "border-primary"
        )}
      />
      {value && !searching && (
        <button
          type="button"
          onClick={() => { onChange(""); onClear(); }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </form>
  );
}

function SearchExplanation({ explanation, onClear }: { explanation: string; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <span className="text-muted-foreground/40 shrink-0">·</span>
      <span className="text-xs text-foreground truncate">{explanation}</span>
      <button
        onClick={onClear}
        className="ml-auto shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="size-3" />
        Clear
      </button>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs shrink-0">
      <span className="text-muted-foreground">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "text-xs border border-border rounded px-2 py-1 outline-none focus:ring-1 ring-ring cursor-pointer bg-background",
          value && "border-primary text-primary font-medium"
        )}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ─── Column visibility ────────────────────────────────────────────────────────

function useColVis(storageKey: string) {
  const [vis, setVis] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const s = localStorage.getItem(storageKey);
      return s ? (JSON.parse(s) as Record<string, boolean>) : {};
    } catch { return {}; }
  });
  function isVis(id: string) { return vis[id] ?? true; }
  function toggle(id: string, alwaysOn?: boolean) {
    if (alwaysOn) return;
    setVis((prev) => {
      const next = { ...prev, [id]: !(prev[id] ?? true) };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }
  return { isVis, toggle };
}

function ColVisPopover({
  isVis,
  toggle,
}: {
  isVis: (id: string) => boolean;
  toggle: (id: string, alwaysOn?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const hiddenCount = PROP_COL_DEFS.filter(({ id, alwaysOn }) => !alwaysOn && !isVis(id)).length;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors",
          open || hiddenCount > 0
            ? "border-primary/40 bg-primary/5 text-primary"
            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
      >
        <SlidersHorizontal className="size-3" />
        Columns
        {hiddenCount > 0 && (
          <span className="ml-0.5 tabular-nums text-[10px] font-bold bg-primary text-primary-foreground rounded-full px-1 min-w-[1rem] text-center leading-4">
            {hiddenCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-popover border rounded-lg shadow-lg py-1.5">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 select-none">
            Show / hide columns
          </p>
          {PROP_COL_DEFS.map(({ id, label, alwaysOn }) => {
            const visible = isVis(id);
            return (
              <button
                key={id}
                type="button"
                disabled={alwaysOn}
                onClick={() => toggle(id, alwaysOn)}
                className={cn(
                  "flex items-center gap-2.5 w-full px-3 py-1.5 text-left transition-colors",
                  alwaysOn ? "opacity-40 cursor-default" : "hover:bg-muted/50 cursor-pointer",
                )}
              >
                <span className={cn(
                  "size-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors",
                  visible ? "bg-primary border-primary" : "border-border"
                )}>
                  {visible && <Check className="size-2.5 text-primary-foreground" />}
                </span>
                <span className={cn("text-xs", visible ? "text-foreground" : "text-muted-foreground/60")}>
                  {label}
                </span>
                {alwaysOn && (
                  <span className="ml-auto text-[10px] text-muted-foreground/40">always</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tables ───────────────────────────────────────────────────────────────────

const thCls = "px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap relative";
const tdCls = "px-3 py-2 align-middle border-b border-border/50";

// ─── Column resize ────────────────────────────────────────────────────────────

function useColResize() {
  const [widths, setWidths] = useState<Record<string, number>>({});

  function startResize(col: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th")!;
    const startW = th.getBoundingClientRect().width;
    const startX = e.clientX;
    function move(ev: MouseEvent) {
      setWidths(w => ({ ...w, [col]: Math.max(40, startW + ev.clientX - startX) }));
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function cs(col: string): React.CSSProperties {
    const w = widths[col];
    return w ? { width: w, minWidth: w, maxWidth: w } : {};
  }

  return { startResize, cs };
}

function RH({ col, onStart }: { col: string; onStart: (col: string, e: React.MouseEvent) => void }) {
  return (
    <span
      className="absolute right-0 inset-y-0 w-1 cursor-col-resize select-none hover:bg-primary/40 active:bg-primary/60 z-10"
      onMouseDown={(e) => onStart(col, e)}
    />
  );
}

// ─── Full-text click popup ────────────────────────────────────────────────────

type CellPopup = { text: string; x: number; y: number } | null;

function DeleteCell({
  id,
  label,
  deletingId,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  id: string;
  label: string;
  deletingId: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
}) {
  const isDeleting = deletingId === id;
  return (
    <td className={cn(tdCls, "crm-row-action-cell w-10 text-right pr-2 whitespace-nowrap sticky right-0 bg-background")}>
      {isDeleting ? (
        <span className="inline-flex items-center gap-1 text-xs text-destructive whitespace-nowrap">
          <button type="button" onClick={() => onDeleteConfirm(id)} className="font-medium hover:underline">
            Delete
          </button>
          <span className="text-muted-foreground">·</span>
          <button type="button" onClick={onDeleteCancel} className="text-muted-foreground hover:text-foreground" title="Cancel">
            <X className="size-3" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onDeleteRequest(id)}
          className="crm-row-action text-muted-foreground hover:text-destructive"
          title={`Delete ${label}`}
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </td>
  );
}

function Popup({ popup, onClose }: { popup: CellPopup; onClose: () => void }) {
  if (!popup) return null;
  const x = Math.min(popup.x + 8, (typeof window !== "undefined" ? window.innerWidth : 800) - 340);
  const y = popup.y + 8;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-popover border rounded-md shadow-lg px-3 py-2.5 text-sm max-w-xs break-words whitespace-pre-wrap"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        {popup.text}
      </div>
    </>
  );
}

function PropertiesTable({
  rows,
  propContacts,
  customDefs,
  colVis,
  onSave,
  onSaveContact,
  deletingId,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  rows: Property[];
  propContacts: Map<string, LinkedContactInfo[]>;
  customDefs: FieldDefinition[];
  colVis: ReturnType<typeof useColVis>;
  onSave: (id: string, field: string, value: unknown) => void;
  onSaveContact: (contactId: string, field: string, value: unknown) => void;
  deletingId: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
        <Building2 className="size-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No properties match these filters.</p>
        <Link href="/properties/new" className="text-xs underline underline-offset-2 text-primary">
          Look up a property →
        </Link>
      </div>
    );
  }

  const thR = cn(thCls, "text-right");
  const tdR = cn(tdCls, "text-right tabular-nums text-muted-foreground whitespace-nowrap");
  const { startResize, cs: colStyle } = useColResize();
  function col(id: string) { return !colVis.isVis(id) ? "hidden" : undefined; }
  const [popup, setPopup] = useState<CellPopup>(null);
  function showPopup(text: string, e: React.MouseEvent) {
    if (!text) return;
    setPopup({ text, x: e.clientX, y: e.clientY });
  }

  return (
    <div className="overflow-x-auto">
      <Popup popup={popup} onClose={() => setPopup(null)} />
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/40 sticky top-0 z-10">
          <tr>
            <th className={cn(thR, "w-12", col("prospect"))} style={colStyle("prospect")}>Prospect #<RH col="prospect" onStart={startResize} /></th>
            <th className={cn(thCls, col("owner"))} style={colStyle("owner")}>Ownership Entity<RH col="owner" onStart={startResize} /></th>
            <th className={thCls} style={colStyle("address")}>Property Address<RH col="address" onStart={startResize} /></th>
            <th className={cn(thR, col("bsf"))} style={colStyle("bsf")}>Building SF<RH col="bsf" onStart={startResize} /></th>
            <th className={cn(thR, col("lsf"))} style={colStyle("lsf")}>Land SF<RH col="lsf" onStart={startResize} /></th>
            <th className={cn(thCls, col("asset"))} style={colStyle("asset")}>Asset Description<RH col="asset" onStart={startResize} /></th>
            <th className={cn(thCls, col("contact"))} style={colStyle("contact")}>Owner Contact<RH col="contact" onStart={startResize} /></th>
            <th className={cn(thCls, col("addr2"))} style={colStyle("addr2")}>Owner Address<RH col="addr2" onStart={startResize} /></th>
            <th className={cn(thCls, col("email"))} style={colStyle("email")}>Owner Email<RH col="email" onStart={startResize} /></th>
            <th className={cn(thCls, col("activity"))} style={colStyle("activity")}>Activity Date/Type<RH col="activity" onStart={startResize} /></th>
            <th className={cn(thCls, col("notes"))} style={colStyle("notes")}>Notes<RH col="notes" onStart={startResize} /></th>
            <th className={cn(thCls, col("saledate"))} style={colStyle("saledate")}>Last Sale Date<RH col="saledate" onStart={startResize} /></th>
            <th className={cn(thR, col("saleval"))} style={colStyle("saleval")}>Last Sale Value<RH col="saleval" onStart={startResize} /></th>
            {customDefs.map((f) => (
              <th key={f.id} className={thCls} style={colStyle(`cf_${f.id}`)}>{f.field_name}<RH col={`cf_${f.id}`} onStart={startResize} /></th>
            ))}
            <th className={cn(thCls, "w-8")} />
            <th className={cn(thCls, "w-8 text-right pr-2")} />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const cs = propContacts.get(p.id) ?? [];
            const activity = cs
              .filter(c => c.last_activity_date)
              .sort((a, b) => new Date(b.last_activity_date!).getTime() - new Date(a.last_activity_date!).getTime())[0];
            return (
              <tr key={p.id} className={cn("crm-row hover:bg-muted/20 transition-colors", deletingId === p.id && "bg-destructive/5")}>
                {/* Prospect # */}
                <td className={cn(tdR, "w-12 font-mono", col("prospect"))}>
                  <EditableText
                    value={p.prospect_number != null ? String(p.prospect_number) : null}
                    displayValue={p.prospect_number != null ? `#${p.prospect_number}` : null}
                    placeholder="—"
                    displayClassName="tabular-nums"
                    onSave={(v) => {
                      const n = v ? parseInt(v.replace(/\D/g, ""), 10) : null;
                      onSave(p.id, "prospect_number", n != null && !isNaN(n) ? n : null);
                    }}
                  />
                </td>

                {/* Ownership Entity */}
                <td className={cn(tdCls, "min-w-[120px]", col("owner"))}>
                  <EditableText
                    value={p.owner_name}
                    placeholder="—"
                    displayClassName="truncate block"
                    onSave={(v) => onSave(p.id, "owner_name", v)}
                  />
                </td>

                {/* Property Address */}
                <td className={cn(tdCls, "min-w-[160px]")}>
                  <div className="flex items-start gap-1.5">
                    <Link
                      href={`/properties/${p.id}`}
                      className="shrink-0 mt-0.5 text-muted-foreground hover:text-primary"
                      title="Open property"
                    >
                      <ExternalLink className="size-3" />
                    </Link>
                    <div className="min-w-0">
                      <EditableText
                        value={p.address}
                        placeholder="No address"
                        displayClassName="font-medium truncate block"
                        onSave={(v) => onSave(p.id, "address", v)}
                      />
                      <EditableText
                        value={p.city}
                        placeholder="city"
                        displayClassName="text-muted-foreground"
                        onSave={(v) => onSave(p.id, "city", v)}
                      />
                      {(p.source || p.source_url) && (
                        <SourceChip source={p.source} sourceUrl={p.source_url} className="mt-1" />
                      )}
                    </div>
                  </div>
                </td>

                {/* Building SF */}
                <td className={cn(tdR, "w-20", col("bsf"))}>
                  <EditableText
                    value={p.size_sqft != null ? String(p.size_sqft) : null}
                    displayValue={p.size_sqft != null ? p.size_sqft.toLocaleString() : null}
                    placeholder="—"
                    displayClassName="tabular-nums text-muted-foreground"
                    onSave={(v) => {
                      const n = v ? parseFloat(v.replace(/,/g, "")) : null;
                      onSave(p.id, "size_sqft", n != null && !isNaN(n) ? n : null);
                    }}
                  />
                </td>

                {/* Land SF */}
                <td className={cn(tdR, "w-20", col("lsf"))}>
                  <EditableText
                    value={p.land_sqft != null ? String(p.land_sqft) : null}
                    displayValue={p.land_sqft != null ? p.land_sqft.toLocaleString() : null}
                    placeholder="—"
                    displayClassName="tabular-nums text-muted-foreground"
                    onSave={(v) => {
                      const n = v ? parseFloat(v.replace(/,/g, "")) : null;
                      onSave(p.id, "land_sqft", n != null && !isNaN(n) ? n : null);
                    }}
                  />
                </td>

                {/* Asset Description */}
                <td className={cn(tdCls, "min-w-[120px]", col("asset"))}>
                  <EditableText
                    value={p.asset_description}
                    placeholder="—"
                    displayClassName="truncate block text-muted-foreground"
                    onSave={(v) => onSave(p.id, "asset_description", v)}
                  />
                </td>

                {/* Owner Contact */}
                <td className={cn(tdCls, "min-w-[100px]", col("contact"))}>
                  {cs.length > 0
                    ? cs.map((c) => (
                        <EditableText
                          key={c.id}
                          value={c.name}
                          placeholder="—"
                          displayClassName="truncate block font-medium"
                          onSave={(v) => onSaveContact(c.id, "name", v)}
                        />
                      ))
                    : <span className="text-muted-foreground/30 italic">—</span>}
                </td>

                {/* Owner Address */}
                <td className={cn(tdCls, "min-w-[120px]", col("addr2"))}>
                  {cs.length > 0
                    ? cs.map((c) => (
                        <EditableText
                          key={c.id}
                          value={c.mailing_address}
                          placeholder="—"
                          displayClassName="truncate block text-muted-foreground"
                          onSave={(v) => onSaveContact(c.id, "mailing_address", v)}
                        />
                      ))
                    : <span className="text-muted-foreground/30 italic">—</span>}
                </td>

                {/* Owner Email */}
                <td className={cn(tdCls, "min-w-[130px]", col("email"))}>
                  {cs.length > 0
                    ? cs.map((c) => (
                        <EditableText
                          key={c.id}
                          value={c.email}
                          placeholder="—"
                          displayClassName="truncate block text-primary"
                          onSave={(v) => onSaveContact(c.id, "email", v)}
                        />
                      ))
                    : <span className="text-muted-foreground/30 italic">—</span>}
                </td>

                {/* Activity Date/Type — most recent across all linked contacts */}
                <td className={cn(tdCls, "min-w-[110px] whitespace-nowrap", col("activity"))}>
                  {activity?.last_activity_date ? (() => {
                    const actText = [fmtDate(activity.last_activity_date), activity.last_activity_type].filter(Boolean).join(" · ");
                    return (
                      <span className="text-muted-foreground cursor-pointer hover:text-foreground" onClick={(e) => showPopup(actText, e)}>
                        {fmtDate(activity.last_activity_date)}
                        {activity.last_activity_type && (
                          <span className="ml-1 text-muted-foreground/60 capitalize">· {activity.last_activity_type}</span>
                        )}
                      </span>
                    );
                  })() : <span className="text-muted-foreground/30 italic">—</span>}
                </td>

                {/* Notes */}
                <td className={cn(tdCls, "min-w-[120px] max-w-[200px]", col("notes"))}>
                  {activity?.last_activity_notes
                    ? <span className="line-clamp-2 text-muted-foreground cursor-pointer hover:text-foreground" onClick={(e) => showPopup(activity.last_activity_notes!, e)}>{activity.last_activity_notes}</span>
                    : <span className="text-muted-foreground/30 italic">—</span>}
                </td>

                {/* Last Sale Date */}
                <td className={cn(tdCls, "whitespace-nowrap w-24", col("saledate"))}>
                  <EditableText
                    value={p.last_sale_date ? p.last_sale_date.slice(0, 10) : null}
                    displayValue={fmtDate(p.last_sale_date)}
                    placeholder="—"
                    displayClassName="text-muted-foreground whitespace-nowrap"
                    onSave={(v) => onSave(p.id, "last_sale_date", v || null)}
                  />
                </td>

                {/* Last Sale Value */}
                <td className={cn(tdR, "w-24", col("saleval"))}>
                  <EditableText
                    value={p.last_sale_price != null ? String(p.last_sale_price) : null}
                    displayValue={p.last_sale_price != null ? fmt(p.last_sale_price) : null}
                    placeholder="—"
                    displayClassName="tabular-nums text-muted-foreground"
                    onSave={(v) => {
                      const n = v ? parseFloat(v.replace(/[^0-9.]/g, "")) : null;
                      onSave(p.id, "last_sale_price", n != null && !isNaN(n) ? n : null);
                    }}
                  />
                </td>

                {/* Custom fields */}
                {customDefs.map((f) => {
                  const slug = fieldSlug(f.field_name);
                  const val = p.custom_fields?.[slug];
                  return (
                    <td key={f.id} className={cn(tdCls, "min-w-[100px] max-w-[160px]")}>
                      <EditableText
                        value={val != null ? String(val) : null}
                        placeholder="—"
                        displayClassName="truncate block text-muted-foreground"
                        onSave={(v) =>
                          onSave(p.id, "custom_fields", {
                            ...(p.custom_fields ?? {}),
                            [slug]: v,
                          })
                        }
                      />
                    </td>
                  );
                })}

                {/* Enhance with county data */}
                {p.source !== "tax_roll" && !p.source_url?.startsWith("mdpa:") && (
                  <td className={cn(tdCls, "w-8 text-center")}>
                    <EnhanceDialog
                      propertyId={p.id}
                      propertyAddress={p.address}
                    />
                  </td>
                )}
                {(p.source === "tax_roll" || p.source_url?.startsWith("mdpa:")) && (
                  <td className={cn(tdCls, "w-8")} />
                )}

                <DeleteCell
                  id={p.id}
                  label="property"
                  deletingId={deletingId}
                  onDeleteRequest={onDeleteRequest}
                  onDeleteConfirm={onDeleteConfirm}
                  onDeleteCancel={onDeleteCancel}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ContactsTable({
  rows,
  onSave,
  deletingId,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  rows: Contact[];
  onSave: (id: string, field: string, value: unknown) => void;
  deletingId: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
        <Users className="size-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No contacts match these filters.</p>
        <Link href="/contacts/new" className="text-xs underline underline-offset-2 text-primary">
          Add a contact →
        </Link>
      </div>
    );
  }

  const { startResize: cStartResize, cs: cColStyle } = useColResize();
  const [cPopup, setCPopup] = useState<CellPopup>(null);
  function cShowPopup(text: string, e: React.MouseEvent) {
    if (!text) return;
    setCPopup({ text, x: e.clientX, y: e.clientY });
  }

  return (
    <>
    <div className="overflow-x-auto">
      <Popup popup={cPopup} onClose={() => setCPopup(null)} />
      <table className="w-full text-sm border-collapse">
        <thead className="bg-muted/40 sticky top-0 z-10">
          <tr>
            <th className={thCls} style={cColStyle("name")}>Name<RH col="name" onStart={cStartResize} /></th>
            <th className={thCls} style={cColStyle("company")}>Company<RH col="company" onStart={cStartResize} /></th>
            <th className={thCls} style={cColStyle("type")}>Type<RH col="type" onStart={cStartResize} /></th>
            <th className={thCls} style={cColStyle("tier")}>Tier<RH col="tier" onStart={cStartResize} /></th>
            <th className={thCls} style={cColStyle("status")}>Status<RH col="status" onStart={cStartResize} /></th>
            <th className={thCls} style={cColStyle("tags")}>Tags<RH col="tags" onStart={cStartResize} /></th>
            <th className={thCls} style={cColStyle("sizecat")}>Size cat<RH col="sizecat" onStart={cStartResize} /></th>
            <th className={thCls} style={cColStyle("geocat")}>Geo cat<RH col="geocat" onStart={cStartResize} /></th>
            <th className={thCls} style={cColStyle("ownership")}>Ownership<RH col="ownership" onStart={cStartResize} /></th>
            <th className={thCls} style={cColStyle("lastcontact")}>Last contact<RH col="lastcontact" onStart={cStartResize} /></th>
            <th className={cn(thCls, "w-8 text-right pr-2")} />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className={cn("crm-row hover:bg-muted/20 transition-colors", deletingId === c.id && "bg-destructive/5")}>
              <td className={tdCls}>
                <div>
                  <Link href={`/contacts/${c.id}`} className="font-medium hover:underline underline-offset-2">
                    {c.name ?? <span className="text-muted-foreground italic">No name</span>}
                  </Link>
                  {c.email && (
                    <div title={c.email} onClick={(e) => cShowPopup(c.email!, e)} className="text-xs text-muted-foreground truncate cursor-pointer hover:text-foreground">{c.email}</div>
                  )}
                </div>
              </td>
              <td className={tdCls}>
                <span title={c.company ?? ""} onClick={(e) => { if (c.company) cShowPopup(c.company, e); }} className="text-muted-foreground block truncate cursor-pointer hover:text-foreground">{c.company ?? "—"}</span>
              </td>
              <td className={cn(tdCls, "min-w-24")}>
                <ContactTypeBadge contactType={c.contact_type} onSave={(v) => onSave(c.id, "contact_type", v)} />
              </td>
              <td className={cn(tdCls, "min-w-24")}>
                <TierBadge tier={c.contact_tier} onSave={(v) => onSave(c.id, "contact_tier", v)} />
              </td>
              <td className={cn(tdCls, "min-w-32")}>
                <StatusBadge status={c.client_status} onSave={(v) => onSave(c.id, "client_status", v)} />
              </td>
              <td className={cn(tdCls, "min-w-40")}>
                <EditableTags
                  tags={c.action_tags ?? []}
                  onSave={(v) => onSave(c.id, "action_tags", v)}
                />
              </td>
              <td className={cn(tdCls, "min-w-28")}>
                <EditableText
                  value={c.size_category}
                  onSave={(v) => onSave(c.id, "size_category", v)}
                />
              </td>
              <td className={cn(tdCls, "min-w-28")}>
                <EditableText
                  value={c.geographic_category}
                  onSave={(v) => onSave(c.id, "geographic_category", v)}
                />
              </td>
              <td className={cn(tdCls, "min-w-36")}>
                <EditableText
                  value={c.ownership_type}
                  onSave={(v) => onSave(c.id, "ownership_type", v)}
                />
              </td>
              <td className={tdCls}>
                <span className="text-muted-foreground whitespace-nowrap text-xs">
                  {fmtDate(c.last_contacted_at) ?? "—"}
                </span>
              </td>
              <DeleteCell
                id={c.id}
                label="contact"
                deletingId={deletingId}
                onDeleteRequest={onDeleteRequest}
                onDeleteConfirm={onDeleteConfirm}
                onDeleteCancel={onDeleteCancel}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

// ─── Lease helpers ────────────────────────────────────────────────────────────

function leaseStatus(expiration: string | null): "active" | "expiring" | "expired" | "unknown" {
  if (!expiration) return "unknown";
  const exp = new Date(expiration).getTime();
  const now = Date.now();
  if (exp < now) return "expired";
  if (exp < now + 90 * 86_400_000) return "expiring";
  return "active";
}

function sourceFileName(path: string | null) {
  if (!path) return "Unnamed lease";
  return path.split("/").pop() ?? path;
}

const LEASE_STATUS_CLS: Record<string, string> = {
  active:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  expiring: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  expired:  "bg-muted text-muted-foreground",
  unknown:  "bg-muted text-muted-foreground",
};
const LEASE_STATUS_LABEL: Record<string, string> = {
  active: "Active", expiring: "Expiring soon", expired: "Expired", unknown: "No expiry",
};

function LeasesTable({
  rows,
  deletingId,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  rows: LeaseAbstract[];
  deletingId: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
        <FileText className="size-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No lease abstracts yet.</p>
        <Link href="/abstracts/new" className="text-xs underline underline-offset-2 text-primary">
          Abstract a lease →
        </Link>
      </div>
    );
  }

  const { startResize: lStartResize, cs: lColStyle } = useColResize();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead className="bg-muted/40 sticky top-0 z-10">
          <tr>
            <th className={thCls} style={lColStyle("doc")}>Document<RH col="doc" onStart={lStartResize} /></th>
            <th className={thCls} style={lColStyle("status")}>Status<RH col="status" onStart={lStartResize} /></th>
            <th className={thCls} style={lColStyle("exec")}>Execution<RH col="exec" onStart={lStartResize} /></th>
            <th className={thCls} style={lColStyle("exp")}>Expiration<RH col="exp" onStart={lStartResize} /></th>
            <th className={thCls} style={lColStyle("term")}>Term<RH col="term" onStart={lStartResize} /></th>
            <th className={thCls} style={lColStyle("rate")}>Base rate<RH col="rate" onStart={lStartResize} /></th>
            <th className={thCls} style={lColStyle("added")}>Added<RH col="added" onStart={lStartResize} /></th>
            <th className={cn(thCls, "w-8 text-right pr-2")} />
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const status = leaseStatus(a.expiration_date);
            return (
              <tr key={a.id} className={cn("crm-row hover:bg-muted/20 transition-colors", deletingId === a.id && "bg-destructive/5")}>
                <td className={tdCls}>
                  <Link
                    href={`/abstracts/${a.id}`}
                    className="font-medium hover:underline underline-offset-2 flex items-center gap-1.5 max-w-64 truncate"
                    title={sourceFileName(a.source_document)}
                  >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    {sourceFileName(a.source_document)}
                  </Link>
                </td>
                <td className={tdCls}>
                  <span className={cn("text-xs font-medium rounded-full px-2 py-0.5", LEASE_STATUS_CLS[status])}>
                    {LEASE_STATUS_LABEL[status]}
                  </span>
                </td>
                <td className={tdCls}>
                  <span className="text-muted-foreground whitespace-nowrap text-xs">
                    {fmtDate(a.execution_date) ?? "—"}
                  </span>
                </td>
                <td className={tdCls}>
                  <span className="text-muted-foreground whitespace-nowrap text-xs">
                    {fmtDate(a.expiration_date) ?? "—"}
                  </span>
                </td>
                <td className={tdCls}>
                  <span className="text-muted-foreground whitespace-nowrap">{a.term ?? "—"}</span>
                </td>
                <td className={tdCls}>
                  <span className="text-muted-foreground whitespace-nowrap">
                    {a.base_rate != null ? (
                      <span className="flex items-center gap-0.5">
                        <DollarSign className="size-3" />{a.base_rate}/sf
                      </span>
                    ) : "—"}
                  </span>
                </td>
                <td className={tdCls}>
                  <span className="text-muted-foreground text-xs whitespace-nowrap">
                    {fmtDate(a.created_at) ?? "—"}
                  </span>
                </td>
                <DeleteCell
                  id={a.id}
                  label="lease"
                  deletingId={deletingId}
                  onDeleteRequest={onDeleteRequest}
                  onDeleteConfirm={onDeleteConfirm}
                  onDeleteCancel={onDeleteCancel}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Fields management panel ─────────────────────────────────────────────────

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text", number: "Number", date: "Date", select: "Select",
};

const ENTITY_TABS: { key: EntityType; label: string }[] = [
  { key: "property", label: "Property" },
  { key: "lease",    label: "Lease" },
  { key: "contact",  label: "Contact" },
];

function AddCustomFieldForm({ entityType, onCreated }: { entityType: EntityType; onCreated: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [showForm, setShowForm] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("entity_type", entityType);
    startTransition(async () => {
      const result = await createFieldDefinition(fd);
      if ("error" in result) {
        setError(result.error);
      } else {
        setShowForm(false);
        setFieldType("text");
        onCreated();
      }
    });
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-dashed hover:border-primary hover:text-primary transition-colors text-muted-foreground w-full"
      >
        <Plus className="size-3.5" />
        Add field
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border p-4 space-y-3 bg-muted/10">
      <p className="text-sm font-medium">New custom field</p>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Field name</label>
        <input
          name="field_name"
          placeholder="e.g. Cap Rate"
          required
          disabled={isPending}
          className="w-full border border-border rounded-md px-3 py-1.5 text-sm outline-none focus:ring-2 ring-ring bg-background"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Type</label>
        <select
          name="field_type"
          value={fieldType}
          onChange={(e) => setFieldType(e.target.value as FieldType)}
          disabled={isPending}
          className="w-full border border-border rounded-md px-3 py-1.5 text-sm outline-none focus:ring-2 ring-ring bg-background"
        >
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="date">Date</option>
          <option value="select">Select (dropdown)</option>
        </select>
      </div>

      {fieldType === "select" && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Options</label>
          <input
            name="select_options"
            placeholder="Option A, Option B, Option C"
            disabled={isPending}
            className="w-full border border-border rounded-md px-3 py-1.5 text-sm outline-none focus:ring-2 ring-ring bg-background"
          />
          <p className="text-xs text-muted-foreground">Comma-separated list of choices.</p>
        </div>
      )}

      {entityType === "property" && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Fill mode</label>
          <select
            name="fill_mode"
            required
            disabled={isPending}
            className="w-full border border-border rounded-md px-3 py-1.5 text-sm outline-none focus:ring-2 ring-ring bg-background"
          >
            <option value="">— Choose —</option>
            <option value="extract">Extract — Claude pulls it from the source</option>
            <option value="manual">Manual — broker fills it in</option>
          </select>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Add
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => { setShowForm(false); setError(null); }}
          className="px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-muted-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function FieldItem({ field, onDeleted }: { field: FieldDefinition; onDeleted: () => void }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      await deleteFieldDefinition(field.id);
      onDeleted();
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{field.field_name}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-xs border border-border rounded px-1.5 py-0.5 text-muted-foreground">
            {FIELD_TYPE_LABELS[field.field_type]}
          </span>
          {field.fill_mode && (
            <span className="text-xs bg-muted rounded px-1.5 py-0.5 capitalize text-muted-foreground">
              {field.fill_mode}
            </span>
          )}
          {field.select_options?.length ? (
            <span className="text-xs text-muted-foreground">{field.select_options.join(", ")}</span>
          ) : null}
        </div>
      </div>
      <button
        onClick={handleDelete}
        disabled={isPending}
        className="shrink-0 p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
        title="Delete field"
      >
        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      </button>
    </div>
  );
}

function FieldsPanel({ onChanged }: { onChanged?: () => void }) {
  const [entityTab, setEntityTab] = useState<EntityType>("property");
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFields = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("field_definitions")
      .select("*")
      .order("entity_type")
      .order("created_at", { ascending: true });
    setFields((data ?? []) as FieldDefinition[]);
    setLoading(false);
  }, []);

  const handleChanged = useCallback(async () => {
    await loadFields();
    onChanged?.();
  }, [loadFields, onChanged]);

  useEffect(() => { loadFields(); }, [loadFields]);

  const tabFields = fields.filter((f) => f.entity_type === entityTab);

  return (
    <div className="max-w-xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h2 className="text-base font-semibold">Custom fields</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Add fields to properties, leases, and contacts beyond the built-in defaults.
        </p>
      </div>

      <div className="flex gap-1 border border-border rounded-lg p-1 w-fit">
        {ENTITY_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setEntityTab(key)}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
              entityTab === key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border">
        <div className="px-4 py-3 border-b">
          <p className="text-sm font-medium">
            {ENTITY_TABS.find((t) => t.key === entityTab)?.label} fields
          </p>
          {entityTab === "property" && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Extract — Claude pulls the value from the source. Manual — broker fills it in when saving.
            </p>
          )}
          {entityTab === "lease" && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Claude extracts these fields from the lease PDF automatically.
            </p>
          )}
          {entityTab === "contact" && (
            <p className="text-xs text-muted-foreground mt-0.5">
              These fields appear on the Add Contact form for manual input.
            </p>
          )}
        </div>
        <div className="p-4 space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : tabFields.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No custom fields yet.</p>
          ) : (
            <div>
              {tabFields.map((f) => (
                <FieldItem key={f.id} field={f} onDeleted={handleChanged} />
              ))}
            </div>
          )}
          <AddCustomFieldForm entityType={entityTab} onCreated={handleChanged} />
        </div>
      </div>
    </div>
  );
}

// ─── Pagination bar ───────────────────────────────────────────────────────────

function PaginationBar({
  page,
  total,
  loading,
  onPrev,
  onNext,
}: {
  page: number;
  total: number | null;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (total === null) return null;
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE + PAGE_SIZE, total);
  const hasPrev = page > 0;
  const hasNext = to < total;

  return (
    <div className="shrink-0 border-t px-4 py-2 flex items-center justify-between gap-2 text-xs text-muted-foreground bg-background">
      <span className="flex items-center gap-1.5">
        {total === 0 ? "No results" : `${from}–${to} of ${total}`}
        {loading && <Loader2 className="size-3 animate-spin" />}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={onPrev}
          disabled={!hasPrev || loading}
          className="flex items-center gap-0.5 px-2 py-1 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="size-3.5" /> Prev
        </button>
        <button
          onClick={onNext}
          disabled={!hasNext || loading}
          className="flex items-center gap-0.5 px-2 py-1 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

const EMPTY_PROP_FILTERS: PropFilters   = { propType: "", ownership: "", sizeCat: "", geoCat: "" };
const EMPTY_CON_FILTERS: ConFilters     = { tier: "", status: "", contactType: "", sizeCat: "", geoCat: "", ownership: "", tag: "" };
const EMPTY_LEASE_FILTERS: LeaseFilters = { status: "" };

export default function CRMView() {
  const [tab, setTab] = useState<"properties" | "leases" | "contacts" | "fields">("properties");
  const propColVis = useColVis("beacon_crm_col_visibility");

  // ── Data state ─────────────────────────────────────────────────────────────
  const [properties, setProperties] = useState<Property[]>([]);
  const [propContacts, setPropContacts] = useState<Map<string, LinkedContactInfo[]>>(new Map());
  const [leases, setLeases] = useState<LeaseAbstract[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [customPropertyDefs, setCustomPropertyDefs] = useState<FieldDefinition[]>([]);

  // ── Pagination state ───────────────────────────────────────────────────────
  const [propPage, setPropPage] = useState(0);
  const [totalProps, setTotalProps] = useState<number | null>(null);
  const [leasePage, setLeasePage] = useState(0);
  const [totalLeases, setTotalLeases] = useState<number | null>(null);
  const [conPage, setConPage] = useState(0);
  const [totalCons, setTotalCons] = useState<number | null>(null);

  // ── Loading state ──────────────────────────────────────────────────────────
  const [propsLoading, setPropsLoading] = useState(true);
  const [leasesLoading, setLeasesLoading] = useState(true);
  const [contactsLoading, setContactsLoading] = useState(true);

  // ── Filter options (full distinct-value scan, loaded once on mount) ────────
  const [propFilterOpts, setPropFilterOpts] = useState<{ sizeCat: string[]; geoCat: string[] }>({
    sizeCat: [],
    geoCat: [],
  });
  const [conFilterOpts, setConFilterOpts] = useState<{
    contactTypes: string[];
    sizeCat: string[];
    geoCat: string[];
    ownership: string[];
    tags: string[];
  }>({ contactTypes: [], sizeCat: [], geoCat: [], ownership: [], tags: [] });

  // ── Filter state ───────────────────────────────────────────────────────────
  const [propFilters, setPropFilters] = useState<PropFilters>(EMPTY_PROP_FILTERS);
  const [conFilters, setConFilters] = useState<ConFilters>(EMPTY_CON_FILTERS);
  const [leaseFilters, setLeaseFilters] = useState<LeaseFilters>(EMPTY_LEASE_FILTERS);

  // Per-tab AI search draft text (what the user is currently typing)
  const [propTabQuery, setPropTabQuery]   = useState("");
  const [conTabQuery, setConTabQuery]     = useState("");
  const [leaseTabQuery, setLeaseTabQuery] = useState("");

  // ── Search state ───────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeSearch, setActiveSearch] = useState<SearchResult | null>(null);
  const searchMode = activeSearch !== null;

  // Restore AI search forwarded from dashboard
  useEffect(() => {
    const raw = sessionStorage.getItem("beacon_crm_search");
    if (!raw) return;
    sessionStorage.removeItem("beacon_crm_search");
    try {
      const { query, result } = JSON.parse(raw) as { query: string; result: SearchResult };
      setSearchQuery(query);
      setActiveSearch(result);
      if (result.target === "properties") setTab("properties");
      if (result.target === "contacts") setTab("contacts");
      if (result.target === "leases") setTab("leases");
    } catch { /* ignore malformed payload */ }
  }, []);

  // ── Delete state ───────────────────────────────────────────────────────────
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);
  const [deletingLeaseId, setDeletingLeaseId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Load filter options once ───────────────────────────────────────────────
  const loadFilterOpts = useCallback(async () => {
    const supabase = createClient();
    const [{ data: pData }, { data: cData }] = await Promise.all([
      supabase.from("properties").select("size_category, geographic_category"),
      supabase.from("contacts").select("contact_type, size_category, geographic_category, ownership_type, action_tags"),
    ]);
    if (pData) {
      setPropFilterOpts({
        sizeCat: uniq(pData.map((r) => r.size_category)),
        geoCat: uniq(pData.map((r) => r.geographic_category)),
      });
    }
    if (cData) {
      setConFilterOpts({
        contactTypes: uniq(cData.map((r) => r.contact_type)),
        sizeCat: uniq(cData.map((r) => r.size_category)),
        geoCat: uniq(cData.map((r) => r.geographic_category)),
        ownership: uniq(cData.map((r) => r.ownership_type)),
        tags: uniq(cData.flatMap((r) => (r.action_tags as string[] | null) ?? [])),
      });
    }
  }, []);

  useEffect(() => { loadFilterOpts(); }, [loadFilterOpts]);

  // ── Load properties (server-filtered + paginated) ──────────────────────────
  const loadProperties = useCallback(async () => {
    setPropsLoading(true);
    const supabase = createClient();
    const from = propPage * PAGE_SIZE;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from("properties")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (activeSearch?.properties) {
      const f = activeSearch.properties;
      if (f.property_type) q = q.eq("property_type", f.property_type);
      if (f.ownership_type) q = q.eq("ownership_type", f.ownership_type);
      if (f.size_sqft_min != null) q = q.gte("size_sqft", f.size_sqft_min);
      if (f.size_sqft_max != null) q = q.lte("size_sqft", f.size_sqft_max);
      if (f.last_sale_price_min != null) q = q.gte("last_sale_price", f.last_sale_price_min);
      if (f.last_sale_price_max != null) q = q.lte("last_sale_price", f.last_sale_price_max);
      if (f.geographic_keyword) {
        const kw = f.geographic_keyword.replace(/[%_,]/g, "");
        q = q.or(`address.ilike.%${kw}%,city.ilike.%${kw}%,geographic_category.ilike.%${kw}%`);
      }
      if (f.owner_name_contains) q = q.ilike("owner_name", `%${f.owner_name_contains}%`);
      if (f.size_category_keyword) q = q.ilike("size_category", `%${f.size_category_keyword}%`);
    } else {
      if (propFilters.propType) q = q.eq("property_type", propFilters.propType);
      if (propFilters.ownership) q = q.eq("ownership_type", propFilters.ownership);
      if (propFilters.sizeCat) q = q.eq("size_category", propFilters.sizeCat);
      if (propFilters.geoCat) q = q.eq("geographic_category", propFilters.geoCat);
    }

    const { data, count } = await q;
    const rows: Property[] = data ?? [];
    setProperties(rows);
    setTotalProps(count ?? 0);

    // Fetch linked contacts + their most recent activity for this page of properties
    const idSet = new Set(rows.map((p) => p.id));
    if (idSet.size > 0) {
      const { data: contactData } = await supabase
        .from("contacts")
        .select("id, name, email, mailing_address, linked_properties")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .overlaps("linked_properties", [...idSet] as any)
        .order("created_at", { ascending: true });

      type RawContact = {
        id: string;
        name: string | null;
        email: string | null;
        mailing_address: string | null;
        linked_properties: string[] | null;
      };

      const contacts = (contactData ?? []) as RawContact[];
      const contactIds = contacts.map((c) => c.id);

      // Fetch most recent activity per contact
      type RawActivity = {
        contact_id: string;
        activity_date: string;
        activity_type: string;
        notes: string | null;
      };
      const activityMap = new Map<string, RawActivity>();
      if (contactIds.length > 0) {
        const { data: activityData } = await supabase
          .from("activities")
          .select("contact_id, activity_date, activity_type, notes")
          .in("contact_id", contactIds)
          .order("activity_date", { ascending: false });
        for (const a of (activityData ?? []) as RawActivity[]) {
          if (!activityMap.has(a.contact_id)) {
            activityMap.set(a.contact_id, a);
          }
        }
      }

      const map = new Map<string, LinkedContactInfo[]>();
      for (const c of contacts) {
        for (const propId of c.linked_properties ?? []) {
          if (!idSet.has(propId)) continue;
          const a = activityMap.get(c.id);
          const info: LinkedContactInfo = {
            id: c.id,
            name: c.name,
            email: c.email,
            mailing_address: c.mailing_address,
            last_activity_date: a?.activity_date ?? null,
            last_activity_type: a?.activity_type ?? null,
            last_activity_notes: a?.notes ?? null,
          };
          const existing = map.get(propId);
          if (existing) existing.push(info);
          else map.set(propId, [info]);
        }
      }
      setPropContacts(map);
    } else {
      setPropContacts(new Map());
    }

    setPropsLoading(false);
  }, [propPage, propFilters, activeSearch]);

  useEffect(() => { loadProperties(); }, [loadProperties]);

  // ── Load contacts (server-filtered + paginated) ────────────────────────────
  const loadContacts = useCallback(async () => {
    setContactsLoading(true);
    const supabase = createClient();
    const from = conPage * PAGE_SIZE;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from("contacts")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (activeSearch?.contacts) {
      const f = activeSearch.contacts;
      if (f.contact_tier != null) q = q.eq("contact_tier", f.contact_tier);
      if (f.client_status) q = q.eq("client_status", f.client_status);
      if (f.action_tags_includes) q = q.contains("action_tags", [f.action_tags_includes]);
      if (f.not_contacted_in_days != null) {
        const cutoff = new Date(Date.now() - f.not_contacted_in_days * 86_400_000).toISOString();
        q = q.or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoff}`);
      }
      if (f.last_contacted_within_days != null) {
        const cutoff = new Date(Date.now() - f.last_contacted_within_days * 86_400_000).toISOString();
        q = q.not("last_contacted_at", "is", null).gte("last_contacted_at", cutoff);
      }
      if (f.geographic_keyword) q = q.ilike("geographic_category", `%${f.geographic_keyword}%`);
      if (f.size_category_keyword) q = q.ilike("size_category", `%${f.size_category_keyword}%`);
      if (f.ownership_type_keyword) q = q.ilike("ownership_type", `%${f.ownership_type_keyword}%`);
      if (f.name_contains) q = q.ilike("name", `%${f.name_contains}%`);
      if (f.company_contains) q = q.ilike("company", `%${f.company_contains}%`);
    } else {
      if (conFilters.tier) q = q.eq("contact_tier", Number(conFilters.tier));
      if (conFilters.status) q = q.eq("client_status", conFilters.status);
      if (conFilters.contactType) q = q.eq("contact_type", conFilters.contactType);
      if (conFilters.sizeCat) q = q.eq("size_category", conFilters.sizeCat);
      if (conFilters.geoCat) q = q.eq("geographic_category", conFilters.geoCat);
      if (conFilters.ownership) q = q.eq("ownership_type", conFilters.ownership);
      if (conFilters.tag) q = q.contains("action_tags", [conFilters.tag]);
    }

    const { data, count } = await q;
    setContacts((data ?? []).map((x: Contact) => ({ ...x, action_tags: x.action_tags ?? [] })));
    setTotalCons(count ?? 0);
    setContactsLoading(false);
  }, [conPage, conFilters, activeSearch]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  // ── Load leases (server-filtered + paginated) ─────────────────────────────
  const loadLeases = useCallback(async () => {
    setLeasesLoading(true);
    const supabase = createClient();
    const from = leasePage * PAGE_SIZE;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from("lease_abstracts")
      .select("id, source_document, execution_date, expiration_date, term, base_rate, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    const now = new Date().toISOString();
    const in90 = new Date(Date.now() + 90 * 86_400_000).toISOString();

    const applyLeaseStatus = (status: string) => {
      if (status === "active")   return q.not("expiration_date", "is", null).gte("expiration_date", in90);
      if (status === "expiring") return q.not("expiration_date", "is", null).gt("expiration_date", now).lt("expiration_date", in90);
      if (status === "expired")  return q.not("expiration_date", "is", null).lt("expiration_date", now);
      return q;
    };

    if (activeSearch?.leases) {
      const f = activeSearch.leases as LeaseSearchFilters;
      if (f.status) q = applyLeaseStatus(f.status);
      if (f.expiring_within_days != null) {
        const cutoff = new Date(Date.now() + f.expiring_within_days * 86_400_000).toISOString();
        q = q.not("expiration_date", "is", null).gt("expiration_date", now).lt("expiration_date", cutoff);
      }
      if (f.base_rate_min != null) q = q.gte("base_rate", f.base_rate_min);
      if (f.base_rate_max != null) q = q.lte("base_rate", f.base_rate_max);
    } else {
      if (leaseFilters.status) q = applyLeaseStatus(leaseFilters.status);
    }

    const { data, count } = await q;
    setLeases((data ?? []) as LeaseAbstract[]);
    setTotalLeases(count ?? 0);
    setLeasesLoading(false);
  }, [leasePage, leaseFilters, activeSearch]);

  useEffect(() => { loadLeases(); }, [loadLeases]);

  // ── Reload custom field definitions ───────────────────────────────────────
  const reloadCustomDefs = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("field_definitions")
      .select("*")
      .eq("entity_type", "property")
      .order("created_at", { ascending: true });
    setCustomPropertyDefs((data ?? []) as FieldDefinition[]);
  }, []);

  useEffect(() => { reloadCustomDefs(); }, [reloadCustomDefs]);

  // ── Optimistic inline edits ────────────────────────────────────────────────
  const saveProp = useCallback(async (id: string, field: string, value: unknown) => {
    setProperties((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
    const supabase = createClient();
    await supabase
      .from("properties")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", id);
  }, []);

  const saveContact = useCallback(async (id: string, field: string, value: unknown) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
    const supabase = createClient();
    await supabase
      .from("contacts")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", id);
  }, []);

  // ── Delete handlers ────────────────────────────────────────────────────────
  const handleDeleteConfirm = useCallback(async (id: string) => {
    setProperties((prev) => prev.filter((p) => p.id !== id));
    setTotalProps((t) => (t !== null ? t - 1 : null));
    setDeletingId(null);
    setDeleteError(null);
    const result = await deleteProperty(id);
    if (result.error) {
      setDeleteError(result.error);
      await loadProperties();
    }
  }, [loadProperties]);

  const handleDeleteContactConfirm = useCallback(async (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
    setTotalCons((t) => (t !== null ? t - 1 : null));
    setDeletingContactId(null);
    setDeleteError(null);
    const result = await deleteContact(id);
    if (result.error) {
      setDeleteError(result.error);
      await loadContacts();
    }
  }, [loadContacts]);

  const handleDeleteLeaseConfirm = useCallback(async (id: string) => {
    setLeases((prev) => prev.filter((a) => a.id !== id));
    setTotalLeases((t) => (t !== null ? t - 1 : null));
    setDeletingLeaseId(null);
    setDeleteError(null);
    const result = await deleteLease(id);
    if (result.error) {
      setDeleteError(result.error);
      await loadLeases();
    }
  }, [loadLeases]);

  // ── Search handler ─────────────────────────────────────────────────────────
  async function runSearch(query: string) {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    const result = await interpretSearch(query);
    setSearching(false);
    if ("error" in result) {
      setSearchError(result.error);
      return;
    }
    setPropPage(0);
    setConPage(0);
    setLeasePage(0);
    setActiveSearch(result);
    if (result.target === "properties") setTab("properties");
    if (result.target === "contacts") setTab("contacts");
    if (result.target === "leases") setTab("leases");
  }

  // Header form (cross-tab search kept for "both" queries)
  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    await runSearch(searchQuery);
  }

  function clearSearch() {
    setActiveSearch(null);
    setSearchQuery("");
    setSearchError(null);
    setPropPage(0);
    setConPage(0);
    setLeasePage(0);
    setPropTabQuery("");
    setConTabQuery("");
    setLeaseTabQuery("");
  }

  // ── Filter helpers (reset page on filter change) ───────────────────────────
  function updatePropFilter<K extends keyof PropFilters>(key: K, value: PropFilters[K]) {
    setPropFilters((f) => ({ ...f, [key]: value }));
    setPropPage(0);
  }

  function updateConFilter<K extends keyof ConFilters>(key: K, value: ConFilters[K]) {
    setConFilters((f) => ({ ...f, [key]: value }));
    setConPage(0);
  }

  function updateLeaseFilter<K extends keyof LeaseFilters>(key: K, value: LeaseFilters[K]) {
    setLeaseFilters((f) => ({ ...f, [key]: value }));
    setLeasePage(0);
  }

  // ── Flags ──────────────────────────────────────────────────────────────────
  const propFiltersActive = !searchMode && Object.values(propFilters).some(Boolean);
  const conFiltersActive = !searchMode && Object.values(conFilters).some(Boolean);
  const leaseFiltersActive = !searchMode && Object.values(leaseFilters).some(Boolean);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <header className="shrink-0 border-b px-6 py-3 flex items-center gap-4">
        <h1 className="text-lg font-semibold tracking-tight shrink-0">CRM</h1>
        {(totalProps !== null || totalLeases !== null || totalCons !== null) && (
          <span className="text-xs text-muted-foreground shrink-0">
            {totalProps ?? "…"} {totalProps === 1 ? "property" : "properties"} ·{" "}
            {totalLeases ?? "…"} {totalLeases === 1 ? "lease" : "leases"} ·{" "}
            {totalCons ?? "…"} {totalCons === 1 ? "contact" : "contacts"}
          </span>
        )}

        {/* AI Search bar */}
        <form onSubmit={handleSearch} className="flex flex-1 gap-2 max-w-2xl ml-2">
          <div className="relative flex-1">
            {searching ? (
              <Loader2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground animate-spin" />
            ) : (
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            )}
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (!e.target.value) clearSearch();
              }}
              placeholder="Search in plain English — 'industrial owners over 100k sqft…'"
              disabled={searching}
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-border rounded-md outline-none focus:ring-2 ring-ring bg-background placeholder:text-muted-foreground/60 disabled:opacity-60"
            />
          </div>
          <button
            type="submit"
            disabled={searching || !searchQuery.trim()}
            className="shrink-0 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        <div className="shrink-0 flex items-center gap-2">
          <Link href="/contacts/new" className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 transition-colors">
            + Contact
          </Link>
          <Link href="/abstracts/new" className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 transition-colors">
            + Abstract
          </Link>
          <Link href="/properties/new" className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 transition-colors">
            + Property
          </Link>
          <a
            href="/api/export/properties"
            download="beacon-properties.xlsx"
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 transition-colors"
          >
            Export properties ↓
          </a>
          <a
            href="/api/export/leases"
            download="beacon-leases.xlsx"
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 transition-colors"
          >
            Export leases ↓
          </a>
          <a
            href="/api/export/contacts"
            download="beacon-contacts.xlsx"
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 transition-colors"
          >
            Export contacts ↓
          </a>
          <Link
            href="/properties/audit"
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 transition-colors flex items-center gap-1.5 text-muted-foreground hover:text-destructive"
          >
            <ShieldAlert className="size-3.5" />
            Data audit
          </Link>
          <Link
            href="/properties/errors"
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 transition-colors flex items-center gap-1.5 text-muted-foreground hover:text-destructive"
          >
            <AlertCircle className="size-3.5" />
            Errors
          </Link>
        </div>
      </header>

      {deleteError && (
        <div className="shrink-0 mx-6 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" />
          Delete failed: {deleteError}
          <button
            type="button"
            onClick={() => setDeleteError(null)}
            className="ml-auto text-muted-foreground hover:text-foreground"
            title="Dismiss"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="shrink-0 border-b px-6 flex gap-0">
        <button
          onClick={() => setTab("properties")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
            tab === "properties"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
          )}
        >
          <Building2 className="size-3.5 inline mr-1.5 -mt-0.5" />
          Properties
          {totalProps !== null && (
            <span className="ml-1.5 text-xs text-muted-foreground">({totalProps})</span>
          )}
        </button>

        <button
          onClick={() => setTab("leases")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
            tab === "leases"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
          )}
        >
          <FileText className="size-3.5 inline mr-1.5 -mt-0.5" />
          Leases
          {totalLeases !== null && (
            <span className="ml-1.5 text-xs text-muted-foreground">({totalLeases})</span>
          )}
        </button>

        <button
          onClick={() => setTab("contacts")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
            tab === "contacts"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
          )}
        >
          <Users className="size-3.5 inline mr-1.5 -mt-0.5" />
          Contacts
          {totalCons !== null && (
            <span className="ml-1.5 text-xs text-muted-foreground">({totalCons})</span>
          )}
        </button>

        <button
          onClick={() => setTab("fields")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
            tab === "fields"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
          )}
        >
          <Settings2 className="size-3.5 inline mr-1.5 -mt-0.5" />
          Fields
        </button>
      </div>

      {/* Filter / search context bar */}
      <div className="shrink-0 border-b px-6 py-2 flex items-center gap-3 flex-wrap bg-muted/10 min-h-11">
        {searchError && (
          <p className="text-xs text-destructive w-full">{searchError}</p>
        )}

        {tab === "fields" ? (
          <span className="text-xs text-muted-foreground">
            Define custom fields that appear on properties, leases, and contacts
          </span>
        ) : tab === "leases" ? (
          <>
            <TabSearchInput
              value={leaseTabQuery}
              placeholder="e.g. leases expiring this quarter…"
              searching={searching}
              onChange={setLeaseTabQuery}
              onSearch={runSearch}
              onClear={clearSearch}
            />
            {searchMode ? (
              <SearchExplanation explanation={activeSearch!.explanation} onClear={clearSearch} />
            ) : (
              <>
                <FilterSelect
                  label="Status"
                  value={leaseFilters.status}
                  options={[
                    { value: "active",   label: "Active" },
                    { value: "expiring", label: "Expiring soon" },
                    { value: "expired",  label: "Expired" },
                  ]}
                  onChange={(v) => updateLeaseFilter("status", v)}
                />
                {leaseFiltersActive && (
                  <button
                    onClick={() => { setLeaseFilters(EMPTY_LEASE_FILTERS); setLeasePage(0); }}
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    Clear filters
                  </button>
                )}
              </>
            )}
          </>
        ) : tab === "properties" ? (
          <>
            <TabSearchInput
              value={propTabQuery}
              placeholder="e.g. industrial over 50k SF in Doral…"
              searching={searching}
              onChange={setPropTabQuery}
              onSearch={runSearch}
              onClear={clearSearch}
            />
            {searchMode ? (
              <SearchExplanation explanation={activeSearch!.explanation} onClear={clearSearch} />
            ) : (
              <>
                <FilterSelect
                  label="Type"
                  value={propFilters.propType}
                  options={PROP_TYPES}
                  onChange={(v) => updatePropFilter("propType", v)}
                />
                <FilterSelect
                  label="Ownership"
                  value={propFilters.ownership}
                  options={OWNERSHIP_TYPES}
                  onChange={(v) => updatePropFilter("ownership", v)}
                />
                {propFilterOpts.sizeCat.length > 0 && (
                  <FilterSelect
                    label="Size cat"
                    value={propFilters.sizeCat}
                    options={propFilterOpts.sizeCat.map((v) => ({ value: v, label: v }))}
                    onChange={(v) => updatePropFilter("sizeCat", v)}
                  />
                )}
                {propFilterOpts.geoCat.length > 0 && (
                  <FilterSelect
                    label="Geo cat"
                    value={propFilters.geoCat}
                    options={propFilterOpts.geoCat.map((v) => ({ value: v, label: v }))}
                    onChange={(v) => updatePropFilter("geoCat", v)}
                  />
                )}
              </>
            )}
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {propFiltersActive && !searchMode && (
                <button
                  onClick={() => { setPropFilters(EMPTY_PROP_FILTERS); setPropPage(0); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Clear filters
                </button>
              )}
              <ColVisPopover isVis={propColVis.isVis} toggle={propColVis.toggle} />
            </div>
          </>
        ) : (
          <>
            <TabSearchInput
              value={conTabQuery}
              placeholder="e.g. tier 1 prospects not contacted in 30 days…"
              searching={searching}
              onChange={setConTabQuery}
              onSearch={runSearch}
              onClear={clearSearch}
            />
            {searchMode ? (
              <SearchExplanation explanation={activeSearch!.explanation} onClear={clearSearch} />
            ) : (
              <>
                <FilterSelect
                  label="Tier"
                  value={conFilters.tier}
                  options={[
                    { value: "1", label: "Tier 1" },
                    { value: "2", label: "Tier 2" },
                    { value: "3", label: "Tier 3" },
                  ]}
                  onChange={(v) => updateConFilter("tier", v)}
                />
                <FilterSelect
                  label="Status"
                  value={conFilters.status}
                  options={CLIENT_STATUSES}
                  onChange={(v) => updateConFilter("status", v)}
                />
                <FilterSelect
                  label="Type"
                  value={conFilters.contactType}
                  options={CONTACT_TYPES}
                  onChange={(v) => updateConFilter("contactType", v)}
                />
                {conFilterOpts.tags.length > 0 && (
                  <FilterSelect
                    label="Tag"
                    value={conFilters.tag}
                    options={conFilterOpts.tags.map((v) => ({ value: v, label: v }))}
                    onChange={(v) => updateConFilter("tag", v)}
                  />
                )}
                {conFilterOpts.sizeCat.length > 0 && (
                  <FilterSelect
                    label="Size cat"
                    value={conFilters.sizeCat}
                    options={conFilterOpts.sizeCat.map((v) => ({ value: v, label: v }))}
                    onChange={(v) => updateConFilter("sizeCat", v)}
                  />
                )}
                {conFilterOpts.geoCat.length > 0 && (
                  <FilterSelect
                    label="Geo cat"
                    value={conFilters.geoCat}
                    options={conFilterOpts.geoCat.map((v) => ({ value: v, label: v }))}
                    onChange={(v) => updateConFilter("geoCat", v)}
                  />
                )}
                {conFilterOpts.ownership.length > 0 && (
                  <FilterSelect
                    label="Ownership"
                    value={conFilters.ownership}
                    options={conFilterOpts.ownership.map((v) => ({ value: v, label: v }))}
                    onChange={(v) => updateConFilter("ownership", v)}
                  />
                )}
                {conFiltersActive && (
                  <button
                    onClick={() => { setConFilters(EMPTY_CON_FILTERS); setConPage(0); }}
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    Clear filters
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Table area + pagination */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          {tab === "fields" ? (
            <FieldsPanel onChanged={reloadCustomDefs} />
          ) : tab === "properties" ? (
            totalProps === null ? (
              <TableSkeleton rows={10} cols={8} />
            ) : (
              <div className={cn(propsLoading && "opacity-60 pointer-events-none")}>
                <PropertiesTable
                  rows={properties}
                  propContacts={propContacts}
                  customDefs={customPropertyDefs}
                  colVis={propColVis}
                  onSave={saveProp}
                  onSaveContact={saveContact}
                  deletingId={deletingId}
                  onDeleteRequest={setDeletingId}
                  onDeleteConfirm={handleDeleteConfirm}
                  onDeleteCancel={() => setDeletingId(null)}
                />
              </div>
            )
          ) : tab === "leases" ? (
            totalLeases === null ? (
              <TableSkeleton rows={10} cols={5} />
            ) : (
              <div className={cn(leasesLoading && "opacity-60 pointer-events-none")}>
                <LeasesTable
                  rows={leases}
                  deletingId={deletingLeaseId}
                  onDeleteRequest={setDeletingLeaseId}
                  onDeleteConfirm={handleDeleteLeaseConfirm}
                  onDeleteCancel={() => setDeletingLeaseId(null)}
                />
              </div>
            )
          ) : (
            totalCons === null ? (
              <TableSkeleton rows={10} cols={7} />
            ) : (
              <div className={cn(contactsLoading && "opacity-60 pointer-events-none")}>
                <ContactsTable
                  rows={contacts}
                  onSave={saveContact}
                  deletingId={deletingContactId}
                  onDeleteRequest={setDeletingContactId}
                  onDeleteConfirm={handleDeleteContactConfirm}
                  onDeleteCancel={() => setDeletingContactId(null)}
                />
              </div>
            )
          )}
        </div>

        {/* Pagination — hidden for Fields tab */}
        {tab === "properties" && (
          <PaginationBar
            page={propPage}
            total={totalProps}
            loading={propsLoading}
            onPrev={() => setPropPage((p) => p - 1)}
            onNext={() => setPropPage((p) => p + 1)}
          />
        )}
        {tab === "leases" && (
          <PaginationBar
            page={leasePage}
            total={totalLeases}
            loading={leasesLoading}
            onPrev={() => setLeasePage((p) => p - 1)}
            onNext={() => setLeasePage((p) => p + 1)}
          />
        )}
        {tab === "contacts" && (
          <PaginationBar
            page={conPage}
            total={totalCons}
            loading={contactsLoading}
            onPrev={() => setConPage((p) => p - 1)}
            onNext={() => setConPage((p) => p + 1)}
          />
        )}
      </div>
    </div>
  );
}
