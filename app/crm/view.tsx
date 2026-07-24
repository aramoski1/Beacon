"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { syncPropertyEntity } from "@/lib/entities";
import { contactIdsByPropertyIds, contactIdsForProperties, propertyIdsByContactIds } from "@/lib/contact-properties";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, FileText, ExternalLink, Loader2, Sparkles, X, Trash2, ShieldAlert, AlertCircle, ChevronLeft, ChevronRight, SlidersHorizontal, Check, Mail, Settings2, Zap, Phone, Layers, Briefcase } from "lucide-react";
import { CustomFieldsPanel } from "@/components/custom-fields-panel";
import type { EntityType } from "@/lib/custom-fields";
import { ComposeOutreach } from "@/components/compose-outreach";
import { EnhanceDialog } from "./enhance-dialog";
import { BulkEnrichPanel, type BulkProperty } from "./bulk-enrich-panel";
import { interpretSearch, deleteProperty, deleteContact, deleteLease, promotePropertyOwnerToCrm, type SearchResult, type PropertySearchFilters, type ContactSearchFilters, type LeaseSearchFilters } from "./actions";
import { SmartListsBar, BarModeToggle, SearchListActions } from "./smart-lists-bar";
import { primaryTabForSearch, resolveSavableSearchResult } from "@/lib/crm-search-filters";
import type { SmartListWithCounts } from "./smart-list-actions";
import {
  applyPropertyFilters,
  applyContactFilters,
  applyLeaseFilters,
  fetchMatchingPropertyIdsFromClient,
} from "@/lib/crm-search-filters";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";
import { SourceChip } from "@/components/source-chip";
import { TableSkeleton } from "@/components/ui/skeleton";
import { resolvePropertyOwnerContacts, preferDisplayOwnerContact, stagingDiffersFromCrm, type StoredOwnerContact } from "@/lib/owner-contacts";
import { cadenceChipForContact, cadenceMapFromSettings, type CadenceSettingsSlice } from "@/lib/cadence";
import { createActivity, savePropertyGridActivity } from "@/app/activities/actions";
import { formatCallOutcomeNote } from "@/lib/activity-touch";
import { ownerPortfolioHref } from "@/lib/owner-portfolio";
import { CreateDealDialog } from "@/app/deals/create-deal-dialog";
import {
  GRID_ACTIVITY_TIP,
  isPropertyActivityField,
} from "@/lib/property-grid-activity";
import {
  contactsExportHref,
  exportIdsQuery,
  MAX_EXPORT_IDS,
  propertiesExportHref,
} from "@/lib/crm-export";

// ─── Types ────────────────────────────────────────────────────────────────────

type Property = {
  id: string;
  address: string | null;
  city: string | null;
  owner_name: string | null;
  ownership_type: string | null;
  owner_email: string | null;
  owner_contact_name: string | null;
  owner_contact_address: string | null;
  owner_contacts: StoredOwnerContact[] | null;
  owner_mailing_address: string | null;
  last_activity_date: string | null;
  last_activity_type: string | null;
  last_activity_notes: string | null;
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
  phone_mobile: string | null;
  mailing_address: string | null;
  contact_tier: number | null;
  client_status: string | null;        // legacy
  relationship_stage: string | null;   // new
  ownership_role: string | null;       // new
  asset_focus: string[] | null;        // new
  submarket: string | null;            // new
  portfolio_size: string | null;       // new
  lead_source: string | null;          // new
  action_tags: string[];
  size_category: string | null;
  geographic_category: string | null;
  ownership_type: string | null;
  contact_type: string | null;
  last_contacted_at: string | null;
  linked_properties?: string[] | null;
};

type LeaseAbstract = {
  id: string;
  source_document: string | null;
  execution_date: string | null;
  expiration_date: string | null;
  term: string | null;
  base_rate: number | null;
  created_at: string;
  linked_property: string | null;
  property_address?: string | null;
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

const RELATIONSHIP_STAGES = [
  { value: "prospect",    label: "Prospect" },
  { value: "active",      label: "Active" },
  { value: "client",      label: "Client" },
  { value: "past_client", label: "Past client" },
  { value: "dormant",     label: "Dormant" },
];

const OWNERSHIP_ROLES = [
  { value: "managing_member",   label: "Mng. Member" },
  { value: "authorized_signer", label: "Auth. Signer" },
  { value: "registered_agent",  label: "Reg. Agent" },
  { value: "principal",         label: "Principal" },
  { value: "other",             label: "Other" },
];

const LEAD_SOURCES = [
  { value: "sunbiz",                label: "Sunbiz" },
  { value: "referral",              label: "Referral" },
  { value: "cold",                  label: "Cold" },
  { value: "costar",                label: "CoStar" },
  { value: "existing_relationship", label: "Existing relationship" },
  { value: "other",                 label: "Other" },
];

type ColDef = { id: string; label: string; alwaysOn?: boolean };

const PROP_COL_DEFS: ColDef[] = [
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

const CON_COL_DEFS: ColDef[] = [
  { id: "name",        label: "Name",           alwaysOn: true },
  { id: "company",     label: "Company" },
  { id: "type",        label: "Ownership Role" },
  { id: "tier",        label: "Tier" },
  { id: "status",      label: "Stage" },
  { id: "tags",        label: "Asset Focus" },
  { id: "sizecat",     label: "Portfolio" },
  { id: "geocat",      label: "Submarket" },
  { id: "ownership",   label: "Lead Source" },
  { id: "lastcontact", label: "Last contact" },
  { id: "cadence",     label: "Cadence" },
];

const LEASE_COL_DEFS: ColDef[] = [
  { id: "doc",      label: "Document",   alwaysOn: true },
  { id: "property", label: "Property" },
  { id: "status",   label: "Status" },
  { id: "exec",     label: "Execution" },
  { id: "exp",      label: "Expiration" },
  { id: "term",     label: "Term" },
  { id: "rate",     label: "Base rate" },
  { id: "added",    label: "Added" },
];

const ACTIVITY_TYPES = [
  { value: "call",    label: "Call" },
  { value: "email",   label: "Email" },
  { value: "letter",  label: "Letter" },
  { value: "meeting", label: "Meeting" },
  { value: "note",    label: "Note" },
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

function StageBadge({
  stage,
  onSave,
}: {
  stage: string | null;
  onSave: (v: string | null) => void;
}) {
  const cls =
    stage === "active" || stage === "client"
      ? "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-300"
      : stage === "prospect"
      ? "bg-purple-100 text-purple-900 dark:bg-purple-900/30 dark:text-purple-300"
      : stage === "past_client"
      ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
      : stage === "dormant"
      ? "bg-muted text-muted-foreground"
      : "border border-dashed border-muted-foreground/40 text-muted-foreground";

  return (
    <select
      value={stage ?? ""}
      onChange={(e) => onSave(e.target.value || null)}
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-semibold cursor-pointer border-0 outline-none appearance-none",
        cls
      )}
      title="Set relationship stage"
    >
      <option value="">—</option>
      {RELATIONSHIP_STAGES.map((s) => (
        <option key={s.value} value={s.value}>{s.label}</option>
      ))}
    </select>
  );
}

function ownershipRoleCls(r: string | null) {
  if (r === "managing_member" || r === "principal")
    return "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-400";
  if (r === "authorized_signer")
    return "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400";
  if (r === "registered_agent")
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400";
  return "border border-dashed border-muted-foreground/40 text-muted-foreground";
}

function OwnershipRoleBadge({
  role,
  onSave,
}: {
  role: string | null;
  onSave: (v: string | null) => void;
}) {
  return (
    <select
      value={role ?? ""}
      onChange={(e) => onSave(e.target.value || null)}
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-semibold cursor-pointer border-0 outline-none appearance-none",
        ownershipRoleCls(role),
      )}
      title="Set ownership role"
    >
      <option value="">—</option>
      {OWNERSHIP_ROLES.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

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
  colDefs,
}: {
  isVis: (id: string) => boolean;
  toggle: (id: string, alwaysOn?: boolean) => void;
  colDefs: ColDef[];
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

  const hiddenCount = colDefs.filter(({ id, alwaysOn }) => !alwaysOn && !isVis(id)).length;

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
          {colDefs.map(({ id, label, alwaysOn }) => {
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
const thR = cn(thCls, "text-right");
const tdR = cn(tdCls, "text-right tabular-nums text-muted-foreground whitespace-nowrap");

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
  onPromoted,
  deletingId,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  selectedIds,
  onToggle,
  onToggleAll,
  totalInDb,
}: {
  rows: Property[];
  propContacts: Map<string, LinkedContactInfo[]>;
  customDefs: FieldDefinition[];
  colVis: ReturnType<typeof useColVis>;
  onSave: (id: string, field: string, value: unknown) => void;
  onSaveContact: (contactId: string, field: string, value: unknown) => void;
  onPromoted: () => void;
  deletingId: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (allSelected: boolean) => void;
  totalInDb?: number;
}) {
  if (rows.length === 0) {
    const isFirstTime = totalInDb === 0;
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
        <Building2 className="size-10 text-muted-foreground/40" />
        {isFirstTime ? (
          <>
            <div>
              <p className="text-sm font-medium">No properties yet</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Import a spreadsheet to populate your workspace fast, or look up properties one by one.
              </p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Link
                href="/onboarding"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Import from spreadsheet
              </Link>
              <Link
                href="/properties/new"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border hover:bg-muted/50 transition-colors"
              >
                Look up a property
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">No properties match these filters.</p>
            <Link href="/properties/new" className="text-xs underline underline-offset-2 text-primary">
              Look up a property →
            </Link>
          </>
        )}
      </div>
    );
  }

  const { startResize, cs: colStyle } = useColResize();
  function col(id: string) { return !colVis.isVis(id) ? "hidden" : undefined; }

  return (
    <div>
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/40 sticky top-0 z-10">
          <tr>
            <th className={cn(thCls, "w-8 pl-3 pr-1")}>
              <input
                type="checkbox"
                aria-label="Select all"
                checked={rows.length > 0 && rows.every((r) => selectedIds.has(r.id))}
                ref={(el) => {
                  if (el) el.indeterminate = rows.some((r) => selectedIds.has(r.id)) && !rows.every((r) => selectedIds.has(r.id));
                }}
                onChange={(e) => onToggleAll(e.target.checked)}
                className="cursor-pointer accent-primary"
              />
            </th>
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
            const displayOwner = preferDisplayOwnerContact({
              linkedCrm: cs.map((c) => ({
                id: c.id,
                name: c.name,
                email: c.email,
                mailing_address: c.mailing_address,
              })),
              ownerContacts: p.owner_contacts,
              ownerName: p.owner_name,
              ownerMailingAddress: p.owner_mailing_address,
              ownerEmail: p.owner_email,
            });
            const ownerContacts = displayOwner?.staging?.length
              ? displayOwner.staging
              : resolvePropertyOwnerContacts(
                  p.owner_contacts,
                  p.owner_name,
                  p.owner_mailing_address,
                  { owner_contact_name: p.owner_contact_name, owner_contact_address: p.owner_contact_address },
                );
            function updateOwnerContact(index: number, field: "name" | "address", value: string | null) {
              const next = ownerContacts.map((oc, i) =>
                i === index ? { ...oc, [field]: value ?? (field === "name" ? "" : null) } : oc
              );
              onSave(p.id, "owner_contacts", next.filter((oc) => oc.name.trim()));
            }
            function saveCrmField(field: "name" | "email" | "mailing_address", value: string | null) {
              if (!displayOwner?.contactId) return;
              const ok = window.confirm(
                "Update the CRM contact used for outreach and cadence? This does not change staging on the property row.",
              );
              if (!ok) return;
              onSaveContact(displayOwner.contactId, field, value);
            }
            async function handlePromote() {
              const res = await promotePropertyOwnerToCrm(p.id);
              if (res.error) {
                window.alert(res.error);
                return;
              }
              onPromoted();
            }
            return (
              <tr key={p.id} className={cn("crm-row hover:bg-muted/20 transition-colors", deletingId === p.id && "bg-destructive/5", selectedIds.has(p.id) && "bg-primary/5")}>
                {/* Select */}
                <td className={cn(tdCls, "w-8 pl-3 pr-1")}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${p.address ?? p.id}`}
                    checked={selectedIds.has(p.id)}
                    onChange={() => onToggle(p.id)}
                    className="cursor-pointer accent-primary"
                  />
                </td>
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

                {/* Owner Contact — CRM preferred; staging on property when unlinked */}
                <td className={cn(tdCls, "min-w-[100px]", col("contact"))}>
                  {displayOwner?.source === "crm" && displayOwner.contactId ? (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-primary shrink-0">CRM</span>
                        <Link
                          href={`/contacts/${displayOwner.contactId}`}
                          className="text-[10px] text-muted-foreground hover:text-primary truncate"
                        >
                          open
                        </Link>
                      </div>
                      <EditableText
                        value={displayOwner.name}
                        placeholder="—"
                        displayClassName="truncate block font-medium"
                        onSave={(v) => saveCrmField("name", v)}
                      />
                      {stagingDiffersFromCrm(displayOwner.staging, displayOwner.name) && (
                        <p className="text-[10px] text-amber-700 dark:text-amber-400 truncate" title="Staging on property differs from CRM">
                          On property: {displayOwner.staging[0]?.name}
                        </p>
                      )}
                    </div>
                  ) : ownerContacts.length > 0 ? (
                    <div className="space-y-0.5">
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">On property</span>
                      {ownerContacts.map((oc, i) => (
                        <EditableText
                          key={i}
                          value={oc.name}
                          placeholder="—"
                          displayClassName="truncate block font-medium"
                          onSave={(v) => updateOwnerContact(i, "name", v)}
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() => void handlePromote()}
                        className="text-[10px] text-primary hover:underline underline-offset-2"
                        title="Create a CRM contact for outreach and cadence"
                      >
                        Promote to CRM
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">On property</span>
                      <EditableText
                        value={null}
                        placeholder="—"
                        displayClassName="truncate block font-medium"
                        onSave={(v) =>
                          onSave(
                            p.id,
                            "owner_contacts",
                            v?.trim()
                              ? [{ name: v.trim(), title: "", address: null }]
                              : []
                          )
                        }
                      />
                    </div>
                  )}
                </td>

                {/* Owner Address */}
                <td className={cn(tdCls, "min-w-[120px]", col("addr2"))}>
                  {displayOwner?.source === "crm" && displayOwner.contactId ? (
                    <EditableText
                      value={displayOwner.address}
                      placeholder="—"
                      displayClassName="truncate block text-muted-foreground"
                      onSave={(v) => saveCrmField("mailing_address", v)}
                    />
                  ) : ownerContacts.length > 0 ? (
                    ownerContacts.map((oc, i) => (
                      <EditableText
                        key={i}
                        value={oc.address}
                        placeholder="—"
                        displayClassName="truncate block text-muted-foreground"
                        onSave={(v) => updateOwnerContact(i, "address", v)}
                      />
                    ))
                  ) : (
                    <EditableText
                      value={p.owner_mailing_address}
                      placeholder="—"
                      displayClassName="truncate block text-muted-foreground"
                      onSave={(v) => onSave(p.id, "owner_mailing_address", v)}
                    />
                  )}
                </td>

                {/* Owner Email */}
                <td className={cn(tdCls, "min-w-[130px]", col("email"))}>
                  {displayOwner?.source === "crm" && displayOwner.contactId ? (
                    <EditableText
                      value={displayOwner.email}
                      placeholder="—"
                      displayClassName="truncate block text-primary"
                      onSave={(v) => saveCrmField("email", v)}
                    />
                  ) : (
                    <EditableText
                      value={p.owner_email ?? null}
                      placeholder="—"
                      displayClassName="truncate block text-primary"
                      onSave={(v) => onSave(p.id, "owner_email", v)}
                    />
                  )}
                </td>

                {/* Activity Date/Type */}
                <td className={cn(tdCls, "min-w-[130px]", col("activity"))} title={GRID_ACTIVITY_TIP}>
                  <div>
                    <EditableText
                      value={p.last_activity_date ?? activity?.last_activity_date?.slice(0, 10) ?? null}
                      displayValue={fmtDate(p.last_activity_date ?? activity?.last_activity_date ?? null)}
                      placeholder="log date"
                      displayClassName="text-muted-foreground whitespace-nowrap"
                      onSave={(v) => onSave(p.id, "last_activity_date", v)}
                    />
                    <EditableSelect
                      value={p.last_activity_type ?? activity?.last_activity_type ?? null}
                      options={ACTIVITY_TYPES}
                      onSave={(v) => onSave(p.id, "last_activity_type", v)}
                    />
                  </div>
                </td>

                {/* Notes */}
                <td className={cn(tdCls, "min-w-[120px] max-w-[200px]", col("notes"))} title={GRID_ACTIVITY_TIP}>
                  <EditableText
                    value={p.last_activity_notes ?? activity?.last_activity_notes ?? null}
                    placeholder="log notes"
                    displayClassName="line-clamp-2 text-muted-foreground"
                    onSave={(v) => onSave(p.id, "last_activity_notes", v)}
                  />
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
  onTouchLogged,
  cadenceMap,
  deletingId,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  userEmail,
  colVis,
  selectedIds,
  onToggle,
  onToggleAll,
  totalInDb,
  onClearFilters,
}: {
  rows: Contact[];
  onSave: (id: string, field: string, value: unknown) => void;
  onTouchLogged: () => void;
  cadenceMap: Record<number, number>;
  deletingId: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
  userEmail?: string | null;
  colVis: ReturnType<typeof useColVis>;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (allSelected: boolean) => void;
  totalInDb?: number;
  onClearFilters?: () => void;
}) {
  const { startResize: cStartResize, cs: cColStyle } = useColResize();
  function col(id: string) { return !colVis.isVis(id) ? "hidden" : undefined; }
  const [cPopup, setCPopup] = useState<CellPopup>(null);
  const [composeTarget, setComposeTarget] = useState<{ id: string; name: string | null; email: string | null } | null>(null);
  const [logPendingId, setLogPendingId] = useState<string | null>(null);

  function cShowPopup(text: string, e: React.MouseEvent) {
    if (!text) return;
    setCPopup({ text, x: e.clientX, y: e.clientY });
  }

  async function logCall(contactId: string) {
    setLogPendingId(contactId);
    const res = await createActivity({
      contact_id: contactId,
      activity_type: "call",
      notes: formatCallOutcomeNote("connected"),
    });
    setLogPendingId(null);
    if (res.error) {
      window.alert(res.error);
      return;
    }
    onTouchLogged();
  }

  if (rows.length === 0) {
    const isFirstTime = totalInDb === 0;
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
        <Users className="size-10 text-muted-foreground/40" />
        {isFirstTime ? (
          <>
            <div>
              <p className="text-sm font-medium">No contacts yet</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Add people you call, or promote owner contacts from the Properties grid.
              </p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Link
                href="/contacts/new"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Add a contact
              </Link>
              <Link
                href="/onboarding"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border hover:bg-muted/50 transition-colors"
              >
                Import from spreadsheet
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">No contacts match these filters.</p>
            <div className="flex items-center gap-3">
              {onClearFilters && (
                <button
                  type="button"
                  onClick={onClearFilters}
                  className="text-xs underline underline-offset-2 text-primary"
                >
                  Clear filters
                </button>
              )}
              <Link href="/contacts/new" className="text-xs underline underline-offset-2 text-primary">
                Add a contact →
              </Link>
            </div>
          </>
        )}
      </div>
    );
  }

  const chipCls: Record<string, string> = {
    overdue: "bg-destructive/10 text-destructive",
    due_soon: "bg-amber-500/15 text-amber-800 dark:text-amber-400",
    ok: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-400",
    never: "bg-muted text-muted-foreground",
    no_tier: "bg-muted text-muted-foreground",
  };
  return (
    <>
    <div>
      <Popup popup={cPopup} onClose={() => setCPopup(null)} />
      <table className="w-full text-sm border-collapse">
        <thead className="bg-muted/40 sticky top-0 z-10">
          <tr>
            <th className={cn(thCls, "w-8 pl-3 pr-1")}>
              <input
                type="checkbox"
                aria-label="Select all contacts"
                checked={rows.length > 0 && rows.every((r) => selectedIds.has(r.id))}
                ref={(el) => {
                  if (el) el.indeterminate = rows.some((r) => selectedIds.has(r.id)) && !rows.every((r) => selectedIds.has(r.id));
                }}
                onChange={(e) => onToggleAll(e.target.checked)}
                className="size-3.5 rounded border-border accent-primary cursor-pointer"
              />
            </th>
            <th className={thCls} style={cColStyle("name")}>Name<RH col="name" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("company"))} style={cColStyle("company")}>Company<RH col="company" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("type"))} style={cColStyle("type")}>Ownership Role<RH col="type" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("tier"))} style={cColStyle("tier")}>Tier<RH col="tier" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("status"))} style={cColStyle("status")}>Stage<RH col="status" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("tags"))} style={cColStyle("tags")}>Asset Focus<RH col="tags" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("sizecat"))} style={cColStyle("sizecat")}>Portfolio<RH col="sizecat" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("geocat"))} style={cColStyle("geocat")}>Submarket<RH col="geocat" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("ownership"))} style={cColStyle("ownership")}>Lead Source<RH col="ownership" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("lastcontact"))} style={cColStyle("lastcontact")}>Last contact<RH col="lastcontact" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("cadence"))} style={cColStyle("cadence")}>Cadence<RH col="cadence" onStart={cStartResize} /></th>
            <th className={cn(thCls, "w-8 text-right pr-0")} />
            <th className={cn(thCls, "w-8 text-right pr-2")} />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const chip = cadenceChipForContact(c, cadenceMap);
            const portfolioHref =
              (c.linked_properties?.length ?? 0) > 0
                ? ownerPortfolioHref({ type: "contact", contactId: c.id })
                : null;
            return (
            <tr key={c.id} className={cn("crm-row hover:bg-muted/20 transition-colors", deletingId === c.id && "bg-destructive/5", selectedIds.has(c.id) && "bg-primary/5")}>
              <td className={cn(tdCls, "w-8 pl-3 pr-1")}>
                <input
                  type="checkbox"
                  aria-label={`Select ${c.name ?? "contact"}`}
                  checked={selectedIds.has(c.id)}
                  onChange={() => onToggle(c.id)}
                  className="size-3.5 rounded border-border accent-primary cursor-pointer"
                />
              </td>
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
              <td className={cn(tdCls, col("company"))}>
                <span title={c.company ?? ""} onClick={(e) => { if (c.company) cShowPopup(c.company, e); }} className="text-muted-foreground block truncate cursor-pointer hover:text-foreground">{c.company ?? "—"}</span>
              </td>
              <td className={cn(tdCls, "min-w-28", col("type"))}>
                <OwnershipRoleBadge role={c.ownership_role} onSave={(v) => onSave(c.id, "ownership_role", v)} />
              </td>
              <td className={cn(tdCls, "min-w-24", col("tier"))}>
                <TierBadge tier={c.contact_tier} onSave={(v) => onSave(c.id, "contact_tier", v)} />
              </td>
              <td className={cn(tdCls, "min-w-32", col("status"))}>
                <StageBadge stage={c.relationship_stage || c.client_status} onSave={(v) => onSave(c.id, "relationship_stage", v)} />
              </td>
              <td className={cn(tdCls, "min-w-40", col("tags"))}>
                <EditableTags
                  tags={c.asset_focus ?? []}
                  onSave={(v) => onSave(c.id, "asset_focus", v)}
                />
              </td>
              <td className={cn(tdCls, "min-w-28", col("sizecat"))}>
                <EditableText
                  value={c.portfolio_size}
                  onSave={(v) => onSave(c.id, "portfolio_size", v)}
                />
              </td>
              <td className={cn(tdCls, "min-w-28", col("geocat"))}>
                <EditableText
                  value={c.submarket || c.geographic_category}
                  onSave={(v) => onSave(c.id, "submarket", v)}
                />
              </td>
              <td className={cn(tdCls, "min-w-36", col("ownership"))}>
                <EditableSelect
                  value={c.lead_source}
                  options={LEAD_SOURCES}
                  onSave={(v) => onSave(c.id, "lead_source", v)}
                />
              </td>
              <td className={cn(tdCls, col("lastcontact"))}>
                <span className="text-muted-foreground whitespace-nowrap text-xs">
                  {fmtDate(c.last_contacted_at) ?? "—"}
                </span>
              </td>
              <td className={cn(tdCls, col("cadence"))}>
                <span className={cn("inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap", chipCls[chip.status])}>
                  {chip.label}
                </span>
              </td>
              {/* Row actions */}
              <td className={cn(tdCls, "crm-row-action-cell text-right pr-0 whitespace-nowrap sticky right-8 bg-background")}>
                <div className="inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={logPendingId === c.id}
                    onClick={() => void logCall(c.id)}
                    className="crm-row-action text-muted-foreground hover:text-primary disabled:opacity-50"
                    title="Log call (bumps cadence)"
                  >
                    {logPendingId === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Phone className="size-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposeTarget({ id: c.id, name: c.name, email: c.email })}
                    className="crm-row-action text-muted-foreground hover:text-primary"
                    title="Email"
                  >
                    <Mail className="size-3.5" />
                  </button>
                  {portfolioHref && (
                    <Link
                      href={portfolioHref}
                      className="crm-row-action text-muted-foreground hover:text-primary"
                      title="Owner portfolio"
                    >
                      <Layers className="size-3.5" />
                    </Link>
                  )}
                  <CreateDealDialog
                    contactId={c.id}
                    contactName={c.name}
                    trigger={
                      <button
                        type="button"
                        className="crm-row-action text-muted-foreground hover:text-primary"
                        title="New pursuit"
                      >
                        <Briefcase className="size-3.5" />
                      </button>
                    }
                  />
                </div>
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
            );
          })}
        </tbody>
      </table>
    </div>

    {/* Compose modal */}
    {composeTarget && (
      <div
        className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) setComposeTarget(null); }}
      >
        <div className="bg-background rounded-xl border shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div>
              <p className="font-medium text-sm">
                Email {composeTarget.name ?? "contact"}
              </p>
              {composeTarget.email && (
                <p className="text-xs text-muted-foreground">{composeTarget.email}</p>
              )}
            </div>
            <button
              onClick={() => setComposeTarget(null)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="p-4">
            <ComposeOutreach
              contactId={composeTarget.id}
              contactName={composeTarget.name}
              contactEmail={composeTarget.email}
              userEmail={userEmail}
              onSent={() => {}}
              onDone={() => setComposeTarget(null)}
            />
          </div>
        </div>
      </div>
    )}
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
  colVis,
}: {
  rows: LeaseAbstract[];
  deletingId: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
  colVis: ReturnType<typeof useColVis>;
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
  function col(id: string) { return !colVis.isVis(id) ? "hidden" : undefined; }
  const hasExpiringSoon = rows.some((a) => leaseStatus(a.expiration_date) === "expiring");

  return (
    <div>
      <div className="px-3 sm:px-0 pb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Inventory here · urgency on Lease radar.</span>
        {hasExpiringSoon && (
          <Link href="/lease-radar" className="text-primary underline underline-offset-2 hover:text-primary/80">
            Open Lease radar →
          </Link>
        )}
      </div>
      <table className="w-full text-sm border-collapse">
        <thead className="bg-muted/40 sticky top-0 z-10">
          <tr>
            <th className={thCls} style={lColStyle("doc")}>Document<RH col="doc" onStart={lStartResize} /></th>
            <th className={cn(thCls, col("property"))} style={lColStyle("property")}>Property<RH col="property" onStart={lStartResize} /></th>
            <th className={cn(thCls, col("status"))} style={lColStyle("status")}>Status<RH col="status" onStart={lStartResize} /></th>
            <th className={cn(thCls, col("exec"))} style={lColStyle("exec")}>Execution<RH col="exec" onStart={lStartResize} /></th>
            <th className={cn(thCls, col("exp"))} style={lColStyle("exp")}>Expiration<RH col="exp" onStart={lStartResize} /></th>
            <th className={cn(thCls, col("term"))} style={lColStyle("term")}>Term<RH col="term" onStart={lStartResize} /></th>
            <th className={cn(thR, col("rate"))} style={lColStyle("rate")}>Base rate<RH col="rate" onStart={lStartResize} /></th>
            <th className={cn(thCls, col("added"))} style={lColStyle("added")}>Added<RH col="added" onStart={lStartResize} /></th>
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
                <td className={cn(tdCls, col("property"))}>
                  {a.linked_property ? (
                    <Link
                      href={`/properties/${a.linked_property}`}
                      className="text-muted-foreground hover:text-foreground hover:underline underline-offset-2 truncate block max-w-48"
                      title={a.property_address ?? undefined}
                    >
                      {a.property_address ?? "Linked property"}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </td>
                <td className={cn(tdCls, col("status"))}>
                  <span className={cn("text-xs font-medium rounded-full px-2 py-0.5", LEASE_STATUS_CLS[status])}>
                    {LEASE_STATUS_LABEL[status]}
                  </span>
                </td>
                <td className={cn(tdCls, col("exec"))}>
                  <span className="text-muted-foreground whitespace-nowrap text-xs">
                    {fmtDate(a.execution_date) ?? "—"}
                  </span>
                </td>
                <td className={cn(tdCls, col("exp"))}>
                  <span className="text-muted-foreground whitespace-nowrap text-xs">
                    {fmtDate(a.expiration_date) ?? "—"}
                  </span>
                </td>
                <td className={cn(tdCls, col("term"))}>
                  <span className="text-muted-foreground whitespace-nowrap">{a.term ?? "—"}</span>
                </td>
                <td className={cn(tdR, col("rate"))}>
                  {a.base_rate != null ? `$${a.base_rate}/sf` : "—"}
                </td>
                <td className={cn(tdCls, col("added"))}>
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

// ─── Load error ───────────────────────────────────────────────────────────────

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
      <AlertCircle className="size-8 text-destructive/50" />
      <p className="text-sm text-muted-foreground">Failed to load data</p>
      <p className="text-xs text-muted-foreground/60 max-w-sm">{message}</p>
      <button
        onClick={onRetry}
        className="text-xs underline underline-offset-2 text-primary hover:text-primary/80"
      >
        Try again
      </button>
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

const VALID_TABS = ["properties", "leases", "contacts"] as const;
type Tab = typeof VALID_TABS[number];
type BarMode = "search" | "smart-lists";

const SEARCH_PLACEHOLDERS: Record<Tab, string> = {
  properties: "e.g. industrial over 50k SF in Doral…",
  leases: "e.g. leases expiring this quarter…",
  contacts: "e.g. tier 1 owners not contacted in 90 days…",
};

export default function CRMView({ initialTab, userEmail }: { initialTab?: string; userEmail?: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(
    VALID_TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "properties"
  );

  const selectTab = useCallback((next: Tab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "properties") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `/crm?${qs}` : "/crm", { scroll: false });
  }, [router, searchParams]);

  // Honor URL on load and browser back/forward
  useEffect(() => {
    const raw = searchParams.get("tab");
    const next = VALID_TABS.includes(raw as Tab) ? (raw as Tab) : "properties";
    setTab((cur) => (cur === next ? cur : next));
  }, [searchParams]);

  const propColVis   = useColVis("beacon_crm_col_visibility");
  const conColVis    = useColVis("beacon_crm_con_col_visibility");
  const leaseColVis  = useColVis("beacon_crm_lease_col_visibility");

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

  // ── Load error state ───────────────────────────────────────────────────────
  const [propsError, setPropsError] = useState<string | null>(null);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [leasesError, setLeasesError] = useState<string | null>(null);
  const [cadenceMap, setCadenceMap] = useState<Record<number, number>>(() => cadenceMapFromSettings(null));

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

  // Single AI search query (shared across entity tabs)
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeSearch, setActiveSearch] = useState<SearchResult | null>(null);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [activeListName, setActiveListName] = useState<string | null>(null);
  const [barMode, setBarMode] = useState<BarMode>("search");
  const [smartListSavePrompt, setSmartListSavePrompt] = useState(false);
  const searchMode = activeSearch !== null;

  const pendingSave = resolveSavableSearchResult(
    tab,
    activeSearch,
    activeListId,
    propFilters,
    conFilters,
    leaseFilters,
  );

  // Restore AI search forwarded from dashboard
  useEffect(() => {
    const raw = sessionStorage.getItem("beacon_crm_search");
    if (!raw) return;
    sessionStorage.removeItem("beacon_crm_search");
    try {
      const { query, result } = JSON.parse(raw) as { query: string; result: SearchResult };
      setSearchQuery(query);
      setActiveSearch(result);
      setActiveListId(null);
      selectTab(primaryTabForSearch(result));
    } catch { /* ignore malformed payload */ }
  }, [selectTab]);

  // ── Selection + bulk enrich state ─────────────────────────────────────────
  const [selectedPropIds, setSelectedPropIds] = useState<Set<string>>(new Set());
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [enrichPanelOpen, setEnrichPanelOpen] = useState(false);

  // Clear selection when the query context changes — not on every row reload
  // (reload mid-enrich / optimistic edits must not wipe the selection).
  useEffect(() => {
    setSelectedPropIds(new Set());
  }, [propPage, propFilters, activeSearch]);

  useEffect(() => {
    setSelectedContactIds(new Set());
  }, [conPage, conFilters, activeSearch, tab]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("user_settings")
        .select("cadence_tier1_days, cadence_tier2_days, cadence_tier3_days")
        .eq("owner_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setCadenceMap(cadenceMapFromSettings(data as CadenceSettingsSlice | null));
    })();
    return () => { cancelled = true; };
  }, []);

  function togglePropSelection(id: string) {
    setSelectedPropIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAllProps(allSelected: boolean) {
    setSelectedPropIds(allSelected ? new Set(properties.map((p) => p.id)) : new Set());
  }

  function toggleContactSelection(id: string) {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAllContacts(allSelected: boolean) {
    setSelectedContactIds(allSelected ? new Set(contacts.map((c) => c.id)) : new Set());
  }

  function handleOutreachSelected() {
    if (selectedContactIds.size === 0) return;
    sessionStorage.setItem(
      "beacon_outreach_selection",
      JSON.stringify([...selectedContactIds])
    );
    router.push("/outreach");
  }

  const selectedProperties: BulkProperty[] = properties
    .filter((p) => selectedPropIds.has(p.id))
    .map((p) => ({
      id: p.id,
      address: p.address,
      source: p.source,
      source_url: p.source_url,
      owner_name: p.owner_name,
    }));

  // ── Fields panel ───────────────────────────────────────────────────────────
  const [showFieldsPanel, setShowFieldsPanel] = useState(false);

  // ── Delete state ───────────────────────────────────────────────────────────
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);
  const [deletingLeaseId, setDeletingLeaseId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Load filter options once ───────────────────────────────────────────────
  const loadFilterOpts = useCallback(async () => {
    const supabase = createClient();
    const [{ data: pData }, { data: cData }] = await Promise.all([
      supabase.from("properties").select("size_category, geographic_category").limit(2000),
      supabase.from("contacts").select("ownership_role, submarket, portfolio_size, lead_source, action_tags").limit(2000),
    ]);
    if (pData) {
      setPropFilterOpts({
        sizeCat: uniq(pData.map((r) => r.size_category)),
        geoCat: uniq(pData.map((r) => r.geographic_category)),
      });
    }
    if (cData) {
      setConFilterOpts({
        contactTypes: uniq(cData.map((r) => r.ownership_role)),
        sizeCat: uniq(cData.map((r) => r.portfolio_size)),
        geoCat: uniq(cData.map((r) => r.submarket)),
        ownership: uniq(cData.map((r) => r.lead_source)),
        tags: uniq(cData.flatMap((r) => (r.action_tags as string[] | null) ?? [])),
      });
    }
  }, []);

  useEffect(() => { loadFilterOpts(); }, [loadFilterOpts]);

  // ── Load properties (server-filtered + paginated) ──────────────────────────
  const loadProperties = useCallback(async () => {
    setPropsLoading(true);
    setPropsError(null);
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
      q = applyPropertyFilters(q, f);
    } else {
      if (propFilters.propType) q = q.eq("property_type", propFilters.propType);
      if (propFilters.ownership) q = q.eq("ownership_type", propFilters.ownership);
      if (propFilters.sizeCat) q = q.eq("size_category", propFilters.sizeCat);
      if (propFilters.geoCat) q = q.eq("geographic_category", propFilters.geoCat);
    }

    const { data, count, error } = await q;
    if (error) {
      setPropsError(error.message);
      setProperties([]);
      setTotalProps(0);
      setPropContacts(new Map());
      setPropsLoading(false);
      return;
    }

    const rows: Property[] = data ?? [];
    setProperties(rows);
    setTotalProps(count ?? 0);

    // Fetch linked contacts + their most recent activity for this page of properties
    const idSet = new Set(rows.map((p) => p.id));
    if (idSet.size > 0) {
      const propIds = [...idSet];
      const { data: { user } } = await supabase.auth.getUser();
      const byProp = user
        ? await contactIdsByPropertyIds(supabase, user.id, propIds)
        : new Map<string, string[]>();
      const allContactIds = [...new Set([...byProp.values()].flat())];

      type RawContact = {
        id: string;
        name: string | null;
        email: string | null;
        mailing_address: string | null;
        linked_properties?: string[] | null;
      };

      let contacts: RawContact[] = [];
      if (allContactIds.length > 0) {
        const { data: contactData } = await supabase
          .from("contacts")
          .select("id, name, email, mailing_address")
          .in("id", allContactIds)
          .order("created_at", { ascending: true });
        contacts = (contactData ?? []) as RawContact[];
      }

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
          .order("activity_date", { ascending: false })
          .limit(200);
        for (const a of (activityData ?? []) as RawActivity[]) {
          if (!activityMap.has(a.contact_id)) {
            activityMap.set(a.contact_id, a);
          }
        }
      }

      const contactById = new Map(contacts.map((c) => [c.id, c]));
      const map = new Map<string, LinkedContactInfo[]>();
      for (const [propId, cids] of byProp.entries()) {
        if (!idSet.has(propId)) continue;
        for (const cid of cids) {
          const c = contactById.get(cid);
          if (!c) continue;
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
          const list = map.get(propId) ?? [];
          list.push(info);
          map.set(propId, list);
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
    setContactsError(null);
    const supabase = createClient();
    const from = conPage * PAGE_SIZE;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from("contacts")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (activeSearch?.contacts || activeSearch?.target === "both") {
      if (activeSearch?.target === "both" && activeSearch.properties) {
        const propertyIds = await fetchMatchingPropertyIdsFromClient(supabase, activeSearch.properties);
        if (propertyIds.length === 0) {
          setContacts([]);
          setTotalCons(0);
          setContactsLoading(false);
          return;
        }
        const { data: { user } } = await supabase.auth.getUser();
        const linkedIds = user
          ? await contactIdsForProperties(supabase, user.id, propertyIds)
          : [];
        if (linkedIds.length === 0) {
          setContacts([]);
          setTotalCons(0);
          setContactsLoading(false);
          return;
        }
        q = q.in("id", linkedIds);
      }
      if (activeSearch?.contacts) {
        q = applyContactFilters(q, activeSearch.contacts);
      }
    } else {
      if (conFilters.tier) q = q.eq("contact_tier", Number(conFilters.tier));
      if (conFilters.status) q = q.eq("relationship_stage", conFilters.status);
      if (conFilters.contactType) q = q.eq("ownership_role", conFilters.contactType);
      if (conFilters.sizeCat) q = q.eq("portfolio_size", conFilters.sizeCat);
      if (conFilters.geoCat) q = q.eq("submarket", conFilters.geoCat);
      if (conFilters.ownership) q = q.eq("lead_source", conFilters.ownership);
      if (conFilters.tag) q = q.contains("action_tags", [conFilters.tag]);
    }

    const { data, count, error } = await q;
    if (error) {
      setContactsError(error.message);
      setContacts([]);
      setTotalCons(0);
      setContactsLoading(false);
      return;
    }
    const rows = (data ?? []).map((x: Contact) => ({ ...x, action_tags: x.action_tags ?? [] }));
    const { data: { user } } = await supabase.auth.getUser();
    if (user && rows.length > 0) {
      try {
        const byContact = await propertyIdsByContactIds(
          supabase,
          user.id,
          rows.map((c: Contact) => c.id),
        );
        for (const c of rows) {
          c.linked_properties = byContact.get(c.id) ?? c.linked_properties ?? [];
        }
      } catch {
        // Portfolio deep-links are best-effort.
      }
    }
    setContacts(rows);
    setTotalCons(count ?? 0);
    setContactsLoading(false);
  }, [conPage, conFilters, activeSearch]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  // ── Load leases (server-filtered + paginated) ─────────────────────────────
  const loadLeases = useCallback(async () => {
    setLeasesLoading(true);
    setLeasesError(null);
    const supabase = createClient();
    const from = leasePage * PAGE_SIZE;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from("lease_abstracts")
      .select("id, source_document, execution_date, expiration_date, term, base_rate, created_at, linked_property", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (activeSearch?.leases) {
      q = applyLeaseFilters(q, activeSearch.leases as LeaseSearchFilters);
    } else {
      if (leaseFilters.status) {
        const now = new Date().toISOString();
        const in90 = new Date(Date.now() + 90 * 86_400_000).toISOString();
        if (leaseFilters.status === "active") q = q.not("expiration_date", "is", null).gte("expiration_date", in90);
        if (leaseFilters.status === "expiring") q = q.not("expiration_date", "is", null).gt("expiration_date", now).lt("expiration_date", in90);
        if (leaseFilters.status === "expired") q = q.not("expiration_date", "is", null).lt("expiration_date", now);
      }
    }

    const { data, count, error } = await q;
    if (error) {
      setLeasesError(error.message);
      setLeases([]);
      setTotalLeases(0);
      setLeasesLoading(false);
      return;
    }
    const leaseRows = (data ?? []) as LeaseAbstract[];
    const propIds = Array.from(
      new Set(leaseRows.map((l) => l.linked_property).filter((id): id is string => Boolean(id))),
    );
    if (propIds.length > 0) {
      const { data: props } = await supabase
        .from("properties")
        .select("id, address, city")
        .in("id", propIds);
      const addrById = new Map(
        (props ?? []).map((p: { id: string; address: string | null; city: string | null }) => [
          p.id,
          [p.address, p.city].filter(Boolean).join(", ") || null,
        ]),
      );
      for (const row of leaseRows) {
        if (row.linked_property) {
          row.property_address = addrById.get(row.linked_property) ?? null;
        }
      }
    }
    setLeases(leaseRows);
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
    if (isPropertyActivityField(field)) {
      const res = await savePropertyGridActivity({ propertyId: id, field, value });
      if (res.error) {
        window.alert(res.error);
        // Reload to undo optimistic shadow if server rejected
        void loadProperties();
      }
      return;
    }
    const supabase = createClient();
    await supabase
      .from("properties")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (field === "owner_name") {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        try {
          await syncPropertyEntity(supabase, user.id, id, typeof value === "string" ? value : null);
        } catch {
          // Property saved; entity sync is best-effort.
        }
      }
    }
  }, [loadProperties]);

  const saveContact = useCallback(async (id: string, field: string, value: unknown) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
    const supabase = createClient();
    await supabase
      .from("contacts")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", id);
  }, []);

  // Saves a linked contact field AND updates propContacts (for Owner Email in property rows)
  const savePropContact = useCallback(async (id: string, field: string, value: unknown) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
    setPropContacts((prev) => {
      const next = new Map(prev);
      for (const [propId, list] of next.entries()) {
        next.set(propId, list.map((c) => c.id === id ? { ...c, [field]: value } : c));
      }
      return next;
    });
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
    } else {
      // Contact may have been the source of owner name/address display — refresh properties.
      await loadProperties();
    }
  }, [loadContacts, loadProperties]);

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
    const trimmed = query.trim();
    setSearching(true);
    setSearchError(null);
    setSearchQuery(trimmed);
    const result = await interpretSearch(trimmed);
    setSearching(false);
    if ("error" in result) {
      setSearchError(result.error);
      return;
    }
    setPropPage(0);
    setConPage(0);
    setLeasePage(0);
    setActiveSearch(result);
    setActiveListId(null);
    setActiveListName(null);
    selectTab(primaryTabForSearch(result));
  }

  function applySmartList(list: SmartListWithCounts) {
    setPropPage(0);
    setConPage(0);
    setLeasePage(0);
    setPropFilters(EMPTY_PROP_FILTERS);
    setConFilters(EMPTY_CON_FILTERS);
    setLeaseFilters(EMPTY_LEASE_FILTERS);
    setSearchQuery(list.query_text);
    setActiveSearch(list.filters);
    setActiveListId(list.id);
    setActiveListName(list.name);
    setSearchError(null);
    selectTab(list.entity_type);
    setBarMode("search");
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    await runSearch(searchQuery);
  }

  function clearSearch() {
    setActiveSearch(null);
    setActiveListId(null);
    setActiveListName(null);
    setSearchQuery("");
    setSearchError(null);
    setPropFilters(EMPTY_PROP_FILTERS);
    setConFilters(EMPTY_CON_FILTERS);
    setLeaseFilters(EMPTY_LEASE_FILTERS);
    setPropPage(0);
    setConPage(0);
    setLeasePage(0);
  }

  // ── Filter helpers (reset page on filter change) ───────────────────────────
  function updatePropFilter<K extends keyof PropFilters>(key: K, value: PropFilters[K]) {
    setPropFilters((f) => ({ ...f, [key]: value }));
    setActiveListId(null);
    setActiveListName(null);
    setPropPage(0);
  }

  function updateConFilter<K extends keyof ConFilters>(key: K, value: ConFilters[K]) {
    setConFilters((f) => ({ ...f, [key]: value }));
    setActiveListId(null);
    setActiveListName(null);
    setConPage(0);
  }

  function updateLeaseFilter<K extends keyof LeaseFilters>(key: K, value: LeaseFilters[K]) {
    setLeaseFilters((f) => ({ ...f, [key]: value }));
    setActiveListId(null);
    setActiveListName(null);
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
      <header className="shrink-0 border-b px-3 py-3 sm:px-6 flex items-center gap-4 flex-wrap">
        <h1 className="text-lg font-semibold tracking-tight shrink-0">Workspace</h1>
        {(totalProps !== null || totalLeases !== null || totalCons !== null) && (
          <span className="text-xs text-muted-foreground shrink-0">
            {totalProps ?? "…"} {totalProps === 1 ? "property" : "properties"} ·{" "}
            {totalLeases ?? "…"} {totalLeases === 1 ? "lease" : "leases"} ·{" "}
            {totalCons ?? "…"} {totalCons === 1 ? "contact" : "contacts"}
          </span>
        )}

        <div className="hidden sm:flex items-center gap-2 ml-auto shrink-0">
          <a
            href={propertiesExportHref()}
            download="beacon-properties.xlsx"
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 transition-colors"
            title="Full book — all properties"
          >
            Export all properties ↓
          </a>
          <a
            href="/api/export/leases"
            download="beacon-leases.xlsx"
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 transition-colors"
            title="Full book — all leases"
          >
            Export all leases ↓
          </a>
          <a
            href={contactsExportHref()}
            download="beacon-contacts.xlsx"
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 transition-colors"
            title="Full book — all contacts"
          >
            Export all contacts ↓
          </a>
          <Link
            href="/properties/audit"
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 transition-colors flex items-center gap-1.5 text-muted-foreground"
            title="Advanced — property data audit"
          >
            <ShieldAlert className="size-3.5" />
            Advanced: audit
          </Link>
          <Link
            href="/properties/errors"
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 transition-colors flex items-center gap-1.5 text-muted-foreground"
            title="Advanced — ingestion errors"
          >
            <AlertCircle className="size-3.5" />
            Advanced: errors
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
      <div className="shrink-0 border-b px-3 sm:px-6 flex gap-0 overflow-x-auto">
        <button
          onClick={() => selectTab("properties")}
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
          onClick={() => selectTab("leases")}
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
          onClick={() => selectTab("contacts")}
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

      </div>

      {/* Filter / search context bar — one search bar + smart lists per entity tab */}
      <div className="shrink-0 border-b px-3 py-2 sm:px-6 flex flex-col gap-2 bg-muted/10">
        {searchError && (
          <p className="text-xs text-destructive">{searchError}</p>
        )}

        <div className="flex items-center gap-3 flex-wrap min-h-9">
          <BarModeToggle mode={barMode} onChange={setBarMode} />

          {barMode === "search" ? (
            <>
              {/* min-w keeps the input from collapsing to 0 and overlapping the mode toggle */}
              <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 min-w-[12rem] max-w-md">
                <div className="relative flex-1 min-w-[8rem]">
                  {searching ? (
                    <Loader2 className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground animate-spin" />
                  ) : (
                    <Sparkles className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                  )}
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (!e.target.value) clearSearch();
                    }}
                    placeholder={SEARCH_PLACEHOLDERS[tab]}
                    disabled={searching}
                    className="w-full pl-7 pr-2 py-1 text-xs border border-border rounded-md outline-none focus:ring-1 ring-ring bg-background placeholder:text-muted-foreground/60 disabled:opacity-60"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching || !searchQuery.trim()}
                  className="shrink-0 px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded-md disabled:opacity-40"
                >
                  {searching ? "…" : "Search"}
                </button>
              </form>

              {activeSearch && (
                <SearchExplanation explanation={activeSearch.explanation} onClear={clearSearch} />
              )}
              {!searchMode && (
                <>
                  {tab === "leases" && (
                    <>
                      <FilterSelect
                        label="Status"
                        value={leaseFilters.status}
                        options={[
                          { value: "active", label: "Active" },
                          { value: "expiring", label: "Expiring soon" },
                          { value: "expired", label: "Expired" },
                        ]}
                        onChange={(v) => updateLeaseFilter("status", v)}
                      />
                      {leaseFiltersActive && (
                        <button
                          type="button"
                          onClick={() => {
                            setLeaseFilters(EMPTY_LEASE_FILTERS);
                            setActiveListId(null);
                            setActiveListName(null);
                            setLeasePage(0);
                          }}
                          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                        >
                          Clear filters
                        </button>
                      )}
                      <div className="ml-auto shrink-0 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowFieldsPanel(true)}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <Settings2 className="size-3" />
                          Manage fields
                        </button>
                        <ColVisPopover isVis={leaseColVis.isVis} toggle={leaseColVis.toggle} colDefs={LEASE_COL_DEFS} />
                      </div>
                    </>
                  )}
                  {tab === "properties" && (
                    <>
                      <FilterSelect label="Type" value={propFilters.propType} options={PROP_TYPES} onChange={(v) => updatePropFilter("propType", v)} />
                      <FilterSelect label="Ownership" value={propFilters.ownership} options={OWNERSHIP_TYPES} onChange={(v) => updatePropFilter("ownership", v)} />
                      {propFilterOpts.sizeCat.length > 0 && (
                        <FilterSelect label="Size cat" value={propFilters.sizeCat} options={propFilterOpts.sizeCat.map((v) => ({ value: v, label: v }))} onChange={(v) => updatePropFilter("sizeCat", v)} />
                      )}
                      {propFilterOpts.geoCat.length > 0 && (
                        <FilterSelect label="Geo cat" value={propFilters.geoCat} options={propFilterOpts.geoCat.map((v) => ({ value: v, label: v }))} onChange={(v) => updatePropFilter("geoCat", v)} />
                      )}
                      {propFiltersActive && (
                        <button type="button" onClick={() => { setPropFilters(EMPTY_PROP_FILTERS); setActiveListId(null); setActiveListName(null); setPropPage(0); }} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
                          Clear filters
                        </button>
                      )}
                      <div className="ml-auto shrink-0 flex items-center gap-2">
                        {selectedPropIds.size > 0 && (
                          <>
                            <a
                              href={
                                exportIdsQuery([...selectedPropIds])
                                  ? propertiesExportHref([...selectedPropIds])
                                  : undefined
                              }
                              download="beacon-properties-selected.xlsx"
                              onClick={(e) => {
                                if (selectedPropIds.size > MAX_EXPORT_IDS) {
                                  e.preventDefault();
                                  window.alert(`Export selected caps at ${MAX_EXPORT_IDS} rows. Narrow your selection.`);
                                }
                              }}
                              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                              title={`Export ${selectedPropIds.size} selected (max ${MAX_EXPORT_IDS})`}
                            >
                              Export selected
                            </a>
                            <button
                              type="button"
                              onClick={() => setEnrichPanelOpen(true)}
                              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-primary/40 bg-primary/5 text-primary font-medium hover:bg-primary/10 transition-colors"
                            >
                              <Sparkles className="size-3" />
                              Enrich {selectedPropIds.size} selected
                            </button>
                          </>
                        )}
                        {properties.length > 0 && (
                          <a
                            href={propertiesExportHref(properties.map((p) => p.id))}
                            download="beacon-properties-page.xlsx"
                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title={`This page only (${properties.length} rows) — not the full filtered set if paginated`}
                          >
                            Export this page
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowFieldsPanel(true)}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <Settings2 className="size-3" />
                          Manage fields
                        </button>
                        <ColVisPopover isVis={propColVis.isVis} toggle={propColVis.toggle} colDefs={PROP_COL_DEFS} />
                      </div>
                    </>
                  )}
                  {tab === "contacts" && (
                    <>
                      <FilterSelect label="Tier" value={conFilters.tier} options={[{ value: "1", label: "Tier 1" }, { value: "2", label: "Tier 2" }, { value: "3", label: "Tier 3" }]} onChange={(v) => updateConFilter("tier", v)} />
                      <FilterSelect label="Stage" value={conFilters.status} options={RELATIONSHIP_STAGES} onChange={(v) => updateConFilter("status", v)} />
                      {conFilterOpts.contactTypes.length > 0 && (
                        <FilterSelect label="Role" value={conFilters.contactType} options={conFilterOpts.contactTypes.map((v) => ({ value: v, label: v }))} onChange={(v) => updateConFilter("contactType", v)} />
                      )}
                      {conFilterOpts.geoCat.length > 0 && (
                        <FilterSelect label="Submarket" value={conFilters.geoCat} options={conFilterOpts.geoCat.map((v) => ({ value: v, label: v }))} onChange={(v) => updateConFilter("geoCat", v)} />
                      )}
                      {conFilterOpts.sizeCat.length > 0 && (
                        <FilterSelect label="Portfolio" value={conFilters.sizeCat} options={conFilterOpts.sizeCat.map((v) => ({ value: v, label: v }))} onChange={(v) => updateConFilter("sizeCat", v)} />
                      )}
                      {conFilterOpts.ownership.length > 0 && (
                        <FilterSelect label="Lead source" value={conFilters.ownership} options={conFilterOpts.ownership.map((v) => ({ value: v, label: v }))} onChange={(v) => updateConFilter("ownership", v)} />
                      )}
                      {conFilterOpts.tags.length > 0 && (
                        <FilterSelect label="Tag" value={conFilters.tag} options={conFilterOpts.tags.map((v) => ({ value: v, label: v }))} onChange={(v) => updateConFilter("tag", v)} />
                      )}
                      {conFiltersActive && (
                        <button type="button" onClick={() => { setConFilters(EMPTY_CON_FILTERS); setActiveListId(null); setActiveListName(null); setConPage(0); }} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
                          Clear filters
                        </button>
                      )}
                      <div className="ml-auto shrink-0 flex items-center gap-2">
                        {selectedContactIds.size > 0 && (
                          <>
                            <a
                              href={
                                exportIdsQuery([...selectedContactIds])
                                  ? contactsExportHref([...selectedContactIds])
                                  : undefined
                              }
                              download="beacon-contacts-selected.xlsx"
                              onClick={(e) => {
                                if (selectedContactIds.size > MAX_EXPORT_IDS) {
                                  e.preventDefault();
                                  window.alert(`Export selected caps at ${MAX_EXPORT_IDS} rows. Narrow your selection.`);
                                }
                              }}
                              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                              title={`Export ${selectedContactIds.size} selected (max ${MAX_EXPORT_IDS})`}
                            >
                              Export selected
                            </a>
                            <button
                              type="button"
                              onClick={handleOutreachSelected}
                              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-violet-500/40 bg-violet-600 text-white font-medium hover:bg-violet-700 transition-colors"
                            >
                              <Zap className="size-3" />
                              Outreach {selectedContactIds.size} selected
                            </button>
                          </>
                        )}
                        {contacts.length > 0 && (
                          <a
                            href={contactsExportHref(contacts.map((c) => c.id))}
                            download="beacon-contacts-page.xlsx"
                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title={`This page only (${contacts.length} rows) — not the full filtered set if paginated`}
                          >
                            Export this page
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowFieldsPanel(true)}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <Settings2 className="size-3" />
                          Manage fields
                        </button>
                        <ColVisPopover isVis={conColVis.isVis} toggle={conColVis.toggle} colDefs={CON_COL_DEFS} />
                      </div>
                    </>
                  )}
                </>
              )}

              <SearchListActions
                entityType={tab}
                savableFilters={pendingSave}
                activeFilters={activeSearch}
                searchQuery={searchQuery}
                activeListId={activeListId}
                activeListName={activeListName}
                onSaved={(id, name) => {
                  setActiveListId(id);
                  setActiveListName(name);
                  if (pendingSave) {
                    setActiveSearch(pendingSave);
                    setPropFilters(EMPTY_PROP_FILTERS);
                    setConFilters(EMPTY_CON_FILTERS);
                    setLeaseFilters(EMPTY_LEASE_FILTERS);
                  }
                }}
                onDeleted={clearSearch}
                savePrompt={smartListSavePrompt}
                onSavePromptHandled={() => setSmartListSavePrompt(false)}
              />
            </>
          ) : (
            <SmartListsBar
              entityType={tab}
              activeListId={activeListId}
              onSelectList={applySmartList}
              onClearList={clearSearch}
            />
          )}
        </div>
      </div>

      {/* Table area + pagination */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          {tab === "properties" ? (
            propsError ? (
              <LoadError message={propsError} onRetry={loadProperties} />
            ) : totalProps === null ? (
              <TableSkeleton rows={10} cols={8} />
            ) : (
              <div className={cn(propsLoading && "opacity-60 pointer-events-none")}>
                <PropertiesTable
                  rows={properties}
                  propContacts={propContacts}
                  customDefs={customPropertyDefs}
                  colVis={propColVis}
                  onSave={saveProp}
                  onSaveContact={savePropContact}
                  onPromoted={loadProperties}
                  deletingId={deletingId}
                  onDeleteRequest={setDeletingId}
                  onDeleteConfirm={handleDeleteConfirm}
                  onDeleteCancel={() => setDeletingId(null)}
                  selectedIds={selectedPropIds}
                  onToggle={togglePropSelection}
                  onToggleAll={toggleAllProps}
                  totalInDb={totalProps ?? undefined}
                />
              </div>
            )
          ) : tab === "leases" ? (
            leasesError ? (
              <LoadError message={leasesError} onRetry={loadLeases} />
            ) : totalLeases === null ? (
              <TableSkeleton rows={10} cols={5} />
            ) : (
              <div className={cn(leasesLoading && "opacity-60 pointer-events-none")}>
                <LeasesTable
                  rows={leases}
                  deletingId={deletingLeaseId}
                  onDeleteRequest={setDeletingLeaseId}
                  onDeleteConfirm={handleDeleteLeaseConfirm}
                  onDeleteCancel={() => setDeletingLeaseId(null)}
                  colVis={leaseColVis}
                />
              </div>
            )
          ) : (
            contactsError ? (
              <LoadError message={contactsError} onRetry={loadContacts} />
            ) : totalCons === null ? (
              <TableSkeleton rows={10} cols={7} />
            ) : (
              <div className={cn(contactsLoading && "opacity-60 pointer-events-none")}>
                <ContactsTable
                  rows={contacts}
                  onSave={saveContact}
                  onTouchLogged={loadContacts}
                  cadenceMap={cadenceMap}
                  deletingId={deletingContactId}
                  onDeleteRequest={setDeletingContactId}
                  onDeleteConfirm={handleDeleteContactConfirm}
                  onDeleteCancel={() => setDeletingContactId(null)}
                  userEmail={userEmail}
                  colVis={conColVis}
                  selectedIds={selectedContactIds}
                  onToggle={toggleContactSelection}
                  onToggleAll={toggleAllContacts}
                  totalInDb={totalCons ?? undefined}
                  onClearFilters={clearSearch}
                />
              </div>
            )
          )}
        </div>

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

      {/* Bulk enrichment panel */}
      {enrichPanelOpen && selectedProperties.length > 0 && (
        <BulkEnrichPanel
          properties={selectedProperties}
          onClose={() => setEnrichPanelOpen(false)}
          onDone={() => {
            setEnrichPanelOpen(false);
            setSelectedPropIds(new Set());
            loadProperties();
          }}
        />
      )}

      {/* Custom fields panel (contextual to active tab) */}
      {showFieldsPanel && (
        <CustomFieldsPanel
          entityType={
            (tab === "properties" ? "property" : tab === "contacts" ? "contact" : "lease") as EntityType
          }
          onClose={() => setShowFieldsPanel(false)}
        />
      )}
    </div>
  );
}
