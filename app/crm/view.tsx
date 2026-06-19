"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, FileText, ExternalLink, Loader2, Search, Sparkles, X, Trash2, CalendarDays, DollarSign, Settings2, Plus } from "lucide-react";
import { interpretSearch, deleteProperty, type SearchResult, type PropertySearchFilters, type ContactSearchFilters } from "./actions";
import { createFieldDefinition, deleteFieldDefinition } from "@/app/settings/fields/actions";
import { fieldSlug, type FieldDefinition, type EntityType, type FieldType } from "@/lib/custom-fields";

// ─── Types ────────────────────────────────────────────────────────────────────

type Property = {
  id: string;
  address: string | null;
  city: string | null;
  owner_name: string | null;
  ownership_type: string | null;
  size_sqft: number | null;
  size_category: string | null;
  geographic_category: string | null;
  property_type: string | null;
  last_sale_price: number | null;
  source: string | null;
  source_url: string | null;
  ingested_at: string | null;
  custom_fields: Record<string, unknown> | null;
};

type Contact = {
  id: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  contact_tier: number | null;
  client_status: string | null;
  action_tags: string[];
  size_category: string | null;
  geographic_category: string | null;
  ownership_type: string | null;
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
  sizeCat: string;
  geoCat: string;
  ownership: string;
  tag: string;
};

// ─── Client-side search filter application ────────────────────────────────────
// Claude returns structured filter objects. We apply them in JS — no SQL built.

function applyPropertySearch(rows: Property[], f: PropertySearchFilters): Property[] {
  const now = Date.now();
  void now; // not needed for properties but keep consistent signature
  return rows.filter((p) => {
    if (f.property_type && p.property_type !== f.property_type) return false;
    if (f.ownership_type && p.ownership_type !== f.ownership_type) return false;
    if (f.size_sqft_min != null && (p.size_sqft == null || p.size_sqft < f.size_sqft_min)) return false;
    if (f.size_sqft_max != null && p.size_sqft != null && p.size_sqft > f.size_sqft_max) return false;
    if (f.last_sale_price_min != null && (p.last_sale_price == null || p.last_sale_price < f.last_sale_price_min)) return false;
    if (f.last_sale_price_max != null && p.last_sale_price != null && p.last_sale_price > f.last_sale_price_max) return false;
    if (f.geographic_keyword) {
      const kw = f.geographic_keyword.toLowerCase();
      const hit = [p.address, p.city, p.geographic_category].some((s) => s?.toLowerCase().includes(kw));
      if (!hit) return false;
    }
    if (f.owner_name_contains && !p.owner_name?.toLowerCase().includes(f.owner_name_contains.toLowerCase())) return false;
    if (f.size_category_keyword && !p.size_category?.toLowerCase().includes(f.size_category_keyword.toLowerCase())) return false;
    return true;
  });
}

function applyContactSearch(rows: Contact[], f: ContactSearchFilters): Contact[] {
  const now = Date.now();
  return rows.filter((c) => {
    if (f.contact_tier != null && c.contact_tier !== f.contact_tier) return false;
    if (f.client_status && c.client_status !== f.client_status) return false;
    if (f.action_tags_includes && !(c.action_tags ?? []).includes(f.action_tags_includes)) return false;
    if (f.not_contacted_in_days != null) {
      const cutoff = now - f.not_contacted_in_days * 86_400_000;
      // Include if never contacted OR last contact is older than cutoff
      if (c.last_contacted_at && new Date(c.last_contacted_at).getTime() >= cutoff) return false;
    }
    if (f.last_contacted_within_days != null) {
      const cutoff = now - f.last_contacted_within_days * 86_400_000;
      if (!c.last_contacted_at || new Date(c.last_contacted_at).getTime() < cutoff) return false;
    }
    if (f.geographic_keyword && !c.geographic_category?.toLowerCase().includes(f.geographic_keyword.toLowerCase())) return false;
    if (f.size_category_keyword && !c.size_category?.toLowerCase().includes(f.size_category_keyword.toLowerCase())) return false;
    if (f.ownership_type_keyword && !c.ownership_type?.toLowerCase().includes(f.ownership_type_keyword.toLowerCase())) return false;
    if (f.name_contains && !c.name?.toLowerCase().includes(f.name_contains.toLowerCase())) return false;
    if (f.company_contains && !c.company?.toLowerCase().includes(f.company_contains.toLowerCase())) return false;
    return true;
  });
}

// ─── Constants ────────────────────────────────────────────────────────────────

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
  onSave,
  displayClassName,
}: {
  value: string | null;
  placeholder?: string;
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

  return (
    <span
      onClick={() => { setDraft(value ?? ""); setEditing(true); }}
      className={cn("cursor-text rounded px-1 py-0.5 -mx-1 hover:bg-muted/60 text-sm", displayClassName)}
      title="Click to edit"
    >
      {value ?? <span className="text-muted-foreground">{placeholder}</span>}
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

// ─── Filter bar ───────────────────────────────────────────────────────────────

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

// ─── Tables ───────────────────────────────────────────────────────────────────

const thCls = "px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap";
const tdCls = "px-3 py-2 align-middle border-b border-border/50";

function PropertiesTable({
  rows,
  customDefs,
  onSave,
  deletingId,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  rows: Property[];
  customDefs: FieldDefinition[];
  onSave: (id: string, field: string, value: unknown) => void;
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

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead className="bg-muted/40 sticky top-0 z-10">
          <tr>
            <th className={thCls}>Address</th>
            <th className={thCls}>Owner</th>
            <th className={thCls}>Type</th>
            <th className={thCls}>Ownership</th>
            <th className={thCls}>Size cat</th>
            <th className={thCls}>Geo cat</th>
            <th className={thCls}>Sqft</th>
            <th className={thCls}>Last sale</th>
            <th className={thCls}>Source</th>
            {customDefs.map((def) => (
              <th key={def.id} className={thCls}>
                {def.field_name}
                {def.fill_mode === "extract" && (
                  <span className="ml-1 text-muted-foreground/50 font-normal" title="Auto-extracted by AI">✦</span>
                )}
              </th>
            ))}
            <th className={thCls + " w-8"} />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className={cn("group hover:bg-muted/20 transition-colors", deletingId === p.id && "bg-destructive/5")}>
              <td className={tdCls}>
                <div className="flex items-start gap-1.5 min-w-0">
                  <Link
                    href={`/properties/${p.id}`}
                    className="shrink-0 mt-1 text-muted-foreground hover:text-primary"
                    title="Open property"
                  >
                    <ExternalLink className="size-3" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <EditableText
                      value={p.address}
                      placeholder="No address"
                      displayClassName="font-medium block truncate max-w-48"
                      onSave={(v) => onSave(p.id, "address", v)}
                    />
                    <EditableText
                      value={p.city}
                      placeholder="City"
                      displayClassName="text-xs text-muted-foreground"
                      onSave={(v) => onSave(p.id, "city", v)}
                    />
                  </div>
                </div>
              </td>
              <td className={tdCls}>
                <EditableText
                  value={p.owner_name}
                  placeholder="—"
                  onSave={(v) => onSave(p.id, "owner_name", v)}
                />
              </td>
              <td className={cn(tdCls, "min-w-28")}>
                <EditableSelect
                  value={p.property_type}
                  options={PROP_TYPES}
                  onSave={(v) => onSave(p.id, "property_type", v)}
                />
              </td>
              <td className={cn(tdCls, "min-w-36")}>
                <EditableSelect
                  value={p.ownership_type}
                  options={OWNERSHIP_TYPES}
                  onSave={(v) => onSave(p.id, "ownership_type", v)}
                />
              </td>
              <td className={cn(tdCls, "min-w-28")}>
                <EditableText
                  value={p.size_category}
                  onSave={(v) => onSave(p.id, "size_category", v)}
                />
              </td>
              <td className={cn(tdCls, "min-w-28")}>
                <EditableText
                  value={p.geographic_category}
                  onSave={(v) => onSave(p.id, "geographic_category", v)}
                />
              </td>
              <td className={cn(tdCls, "min-w-24")}>
                <EditableText
                  value={p.size_sqft != null ? String(p.size_sqft) : null}
                  placeholder="—"
                  displayClassName="text-muted-foreground"
                  onSave={(v) => {
                    const n = v ? Number(v.replace(/[^0-9.]/g, "")) : NaN;
                    onSave(p.id, "size_sqft", isNaN(n) ? null : n);
                  }}
                />
              </td>
              <td className={cn(tdCls, "min-w-24")}>
                <EditableText
                  value={p.last_sale_price != null ? String(p.last_sale_price) : null}
                  placeholder="—"
                  displayClassName="text-muted-foreground"
                  onSave={(v) => {
                    const n = v ? Number(v.replace(/[^0-9.]/g, "")) : NaN;
                    onSave(p.id, "last_sale_price", isNaN(n) ? null : n);
                  }}
                />
              </td>
              <td className={tdCls}>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-xs whitespace-nowrap">
                    {p.source === "tax_roll" ? "Tax roll" : p.source === "url" ? "URL" : p.source ?? "—"}
                  </Badge>
                  {p.source === "url" && p.source_url && (
                    <a href={p.source_url} target="_blank" rel="noopener noreferrer" title={p.source_url}>
                      <ExternalLink className="size-3 text-muted-foreground hover:text-foreground" />
                    </a>
                  )}
                </div>
              </td>
              {customDefs.map((def) => {
                const slug = fieldSlug(def.field_name);
                const rawVal = p.custom_fields?.[slug];
                const strVal = rawVal != null ? String(rawVal) : null;
                return (
                  <td key={def.id} className={cn(tdCls, "min-w-32")}>
                    <EditableText
                      value={strVal}
                      placeholder="—"
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
              <td className={cn(tdCls, "w-8 text-right pr-2")}>
                {deletingId === p.id ? (
                  <span className="flex items-center gap-1 text-xs text-destructive whitespace-nowrap">
                    <button
                      onClick={() => onDeleteConfirm(p.id)}
                      className="font-medium hover:underline"
                    >
                      Delete
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button onClick={onDeleteCancel} className="text-muted-foreground hover:text-foreground">
                      <X className="size-3" />
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => onDeleteRequest(p.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    title="Delete property"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContactsTable({
  rows,
  onSave,
}: {
  rows: Contact[];
  onSave: (id: string, field: string, value: unknown) => void;
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

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead className="bg-muted/40 sticky top-0 z-10">
          <tr>
            <th className={thCls}>Name</th>
            <th className={thCls}>Company</th>
            <th className={thCls}>Tier</th>
            <th className={thCls}>Status</th>
            <th className={thCls}>Tags</th>
            <th className={thCls}>Size cat</th>
            <th className={thCls}>Geo cat</th>
            <th className={thCls}>Ownership</th>
            <th className={thCls}>Last contact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-muted/20 transition-colors">
              <td className={tdCls}>
                <div>
                  <Link href={`/contacts/${c.id}`} className="font-medium hover:underline underline-offset-2">
                    {c.name ?? <span className="text-muted-foreground italic">No name</span>}
                  </Link>
                  {c.email && (
                    <div className="text-xs text-muted-foreground truncate max-w-44">{c.email}</div>
                  )}
                </div>
              </td>
              <td className={tdCls}>
                <span className="text-muted-foreground max-w-36 block truncate">{c.company ?? "—"}</span>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function LeasesTable({ rows }: { rows: LeaseAbstract[] }) {
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

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead className="bg-muted/40 sticky top-0 z-10">
          <tr>
            <th className={thCls}>Document</th>
            <th className={thCls}>Status</th>
            <th className={thCls}>Execution</th>
            <th className={thCls}>Expiration</th>
            <th className={thCls}>Term</th>
            <th className={thCls}>Base rate</th>
            <th className={thCls}>Added</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const status = leaseStatus(a.expiration_date);
            return (
              <tr key={a.id} className="hover:bg-muted/20 transition-colors">
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

// ─── Main view ────────────────────────────────────────────────────────────────

const EMPTY_PROP_FILTERS: PropFilters = { propType: "", ownership: "", sizeCat: "", geoCat: "" };
const EMPTY_CON_FILTERS: ConFilters = { tier: "", status: "", sizeCat: "", geoCat: "", ownership: "", tag: "" };

export default function CRMView() {
  const [tab, setTab] = useState<"properties" | "leases" | "contacts" | "fields">("properties");
  const [properties, setProperties] = useState<Property[]>([]);
  const [leases, setLeases] = useState<LeaseAbstract[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [customPropertyDefs, setCustomPropertyDefs] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [propFilters, setPropFilters] = useState<PropFilters>(EMPTY_PROP_FILTERS);
  const [conFilters, setConFilters] = useState<ConFilters>(EMPTY_CON_FILTERS);

  // ── Search state ────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeSearch, setActiveSearch] = useState<SearchResult | null>(null);
  const searchMode = activeSearch !== null;

  const reloadCustomDefs = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("field_definitions")
      .select("*")
      .eq("entity_type", "property")
      .order("created_at", { ascending: true });
    setCustomPropertyDefs((data ?? []) as FieldDefinition[]);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("properties").select("*").order("created_at", { ascending: false }),
      supabase.from("lease_abstracts").select("id, source_document, execution_date, expiration_date, term, base_rate, created_at").order("created_at", { ascending: false }),
      supabase.from("contacts").select("*").order("created_at", { ascending: false }),
      supabase.from("field_definitions").select("*").eq("entity_type", "property").order("created_at", { ascending: true }),
    ]).then(([{ data: p }, { data: l }, { data: c }, { data: fd }]) => {
      setProperties(p ?? []);
      setLeases((l ?? []) as LeaseAbstract[]);
      setContacts((c ?? []).map((x) => ({ ...x, action_tags: x.action_tags ?? [] })));
      setCustomPropertyDefs((fd ?? []) as FieldDefinition[]);
      setLoading(false);
    });
  }, []);

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

  // ── Delete handler ──────────────────────────────────────────────────────────

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteConfirm = useCallback(async (id: string) => {
    setProperties((prev) => prev.filter((p) => p.id !== id));
    setDeletingId(null);
    const result = await deleteProperty(id);
    if (result.error) {
      // Reload on failure so the row reappears
      const supabase = createClient();
      const { data } = await supabase.from("properties").select("*").order("created_at", { ascending: false });
      setProperties(data ?? []);
    }
  }, []);

  // ── Search handler ──────────────────────────────────────────────────────────

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    const result = await interpretSearch(searchQuery);
    setSearching(false);
    if ("error" in result) {
      setSearchError(result.error);
      return;
    }
    setActiveSearch(result);
    // Auto-switch to the primary target tab (leases has no AI search target)
    if (result.target === "properties") setTab("properties");
    if (result.target === "contacts") setTab("contacts");
  }

  function clearSearch() {
    setActiveSearch(null);
    setSearchQuery("");
    setSearchError(null);
  }

  // ── Derived filter options (for browse mode) ──────────────────────────────

  const propSizeCatOpts = useMemo(
    () => uniq(properties.map((p) => p.size_category)).map((v) => ({ value: v, label: v })),
    [properties]
  );
  const propGeoCatOpts = useMemo(
    () => uniq(properties.map((p) => p.geographic_category)).map((v) => ({ value: v, label: v })),
    [properties]
  );
  const conSizeCatOpts = useMemo(
    () => uniq(contacts.map((c) => c.size_category)).map((v) => ({ value: v, label: v })),
    [contacts]
  );
  const conGeoCatOpts = useMemo(
    () => uniq(contacts.map((c) => c.geographic_category)).map((v) => ({ value: v, label: v })),
    [contacts]
  );
  const conOwnershipOpts = useMemo(
    () => uniq(contacts.map((c) => c.ownership_type)).map((v) => ({ value: v, label: v })),
    [contacts]
  );
  const conTagOpts = useMemo(
    () => uniq(contacts.flatMap((c) => c.action_tags ?? [])).map((v) => ({ value: v, label: v })),
    [contacts]
  );

  // ── Filtered rows ─────────────────────────────────────────────────────────

  const filteredProps = useMemo(() => {
    if (searchMode) {
      // Search mode: apply Claude's structured filters (JS predicates only)
      if (!activeSearch?.properties) return properties;
      return applyPropertySearch(properties, activeSearch.properties);
    }
    // Browse mode: apply dropdown filters
    return properties.filter((p) => {
      if (propFilters.propType && p.property_type !== propFilters.propType) return false;
      if (propFilters.ownership && p.ownership_type !== propFilters.ownership) return false;
      if (propFilters.sizeCat && p.size_category !== propFilters.sizeCat) return false;
      if (propFilters.geoCat && p.geographic_category !== propFilters.geoCat) return false;
      return true;
    });
  }, [properties, propFilters, searchMode, activeSearch]);

  const filteredContacts = useMemo(() => {
    if (searchMode) {
      if (!activeSearch?.contacts) return contacts;
      return applyContactSearch(contacts, activeSearch.contacts);
    }
    return contacts.filter((c) => {
      if (conFilters.tier && c.contact_tier !== Number(conFilters.tier)) return false;
      if (conFilters.status && c.client_status !== conFilters.status) return false;
      if (conFilters.sizeCat && c.size_category !== conFilters.sizeCat) return false;
      if (conFilters.geoCat && c.geographic_category !== conFilters.geoCat) return false;
      if (conFilters.ownership && c.ownership_type !== conFilters.ownership) return false;
      if (conFilters.tag && !(c.action_tags ?? []).includes(conFilters.tag)) return false;
      return true;
    });
  }, [contacts, conFilters, searchMode, activeSearch]);

  const propFiltersActive = !searchMode && Object.values(propFilters).some(Boolean);
  const conFiltersActive = !searchMode && Object.values(conFilters).some(Boolean);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <header className="shrink-0 border-b px-6 py-3 flex items-center gap-4">
        <h1 className="text-lg font-bold tracking-tight shrink-0">CRM</h1>
        {!loading && (
          <span className="text-xs text-muted-foreground shrink-0">
            {properties.length} {properties.length === 1 ? "property" : "properties"} ·{" "}
            {leases.length} {leases.length === 1 ? "lease" : "leases"} ·{" "}
            {contacts.length} {contacts.length === 1 ? "contact" : "contacts"}
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
        </div>
      </header>

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
          {!loading && (
            <span className="ml-1.5 text-xs text-muted-foreground">
              ({filteredProps.length}
              {(propFiltersActive || searchMode) && filteredProps.length !== properties.length && ` / ${properties.length}`})
            </span>
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
          {!loading && (
            <span className="ml-1.5 text-xs text-muted-foreground">({leases.length})</span>
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
          {!loading && (
            <span className="ml-1.5 text-xs text-muted-foreground">
              ({filteredContacts.length}
              {(conFiltersActive || searchMode) && filteredContacts.length !== contacts.length && ` / ${contacts.length}`})
            </span>
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
          <p className="text-xs text-destructive">{searchError}</p>
        )}

        {tab === "fields" ? (
          <span className="text-xs text-muted-foreground">
            Define custom fields that appear on properties, leases, and contacts
          </span>
        ) : searchMode ? (
          /* AI search explanation banner */
          <div className="flex items-center gap-2 flex-1">
            <Sparkles className="size-3.5 text-primary shrink-0" />
            <span className="text-xs text-foreground">{activeSearch!.explanation}</span>
            <button
              onClick={clearSearch}
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <X className="size-3" />
              Clear search
            </button>
          </div>
        ) : tab === "leases" ? (
          <span className="text-xs text-muted-foreground">
            {leases.length} {leases.length === 1 ? "abstract" : "abstracts"}
            {leases.filter((a) => leaseStatus(a.expiration_date) === "expiring").length > 0 && (
              <span className="ml-2 text-amber-600 font-medium">
                · {leases.filter((a) => leaseStatus(a.expiration_date) === "expiring").length} expiring soon
              </span>
            )}
          </span>
        ) : tab === "properties" ? (
          <>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide mr-1">Filter</span>
            <FilterSelect
              label="Type"
              value={propFilters.propType}
              options={PROP_TYPES}
              onChange={(v) => setPropFilters((f) => ({ ...f, propType: v }))}
            />
            <FilterSelect
              label="Ownership"
              value={propFilters.ownership}
              options={OWNERSHIP_TYPES}
              onChange={(v) => setPropFilters((f) => ({ ...f, ownership: v }))}
            />
            {propSizeCatOpts.length > 0 && (
              <FilterSelect
                label="Size cat"
                value={propFilters.sizeCat}
                options={propSizeCatOpts}
                onChange={(v) => setPropFilters((f) => ({ ...f, sizeCat: v }))}
              />
            )}
            {propGeoCatOpts.length > 0 && (
              <FilterSelect
                label="Geo cat"
                value={propFilters.geoCat}
                options={propGeoCatOpts}
                onChange={(v) => setPropFilters((f) => ({ ...f, geoCat: v }))}
              />
            )}
            {propFiltersActive && (
              <button
                onClick={() => setPropFilters(EMPTY_PROP_FILTERS)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                Clear filters
              </button>
            )}
          </>
        ) : (
          <>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide mr-1">Filter</span>
            <FilterSelect
              label="Tier"
              value={conFilters.tier}
              options={[
                { value: "1", label: "Tier 1" },
                { value: "2", label: "Tier 2" },
                { value: "3", label: "Tier 3" },
              ]}
              onChange={(v) => setConFilters((f) => ({ ...f, tier: v }))}
            />
            <FilterSelect
              label="Status"
              value={conFilters.status}
              options={CLIENT_STATUSES}
              onChange={(v) => setConFilters((f) => ({ ...f, status: v }))}
            />
            {conTagOpts.length > 0 && (
              <FilterSelect
                label="Tag"
                value={conFilters.tag}
                options={conTagOpts}
                onChange={(v) => setConFilters((f) => ({ ...f, tag: v }))}
              />
            )}
            {conSizeCatOpts.length > 0 && (
              <FilterSelect
                label="Size cat"
                value={conFilters.sizeCat}
                options={conSizeCatOpts}
                onChange={(v) => setConFilters((f) => ({ ...f, sizeCat: v }))}
              />
            )}
            {conGeoCatOpts.length > 0 && (
              <FilterSelect
                label="Geo cat"
                value={conFilters.geoCat}
                options={conGeoCatOpts}
                onChange={(v) => setConFilters((f) => ({ ...f, geoCat: v }))}
              />
            )}
            {conOwnershipOpts.length > 0 && (
              <FilterSelect
                label="Ownership"
                value={conFilters.ownership}
                options={conOwnershipOpts}
                onChange={(v) => setConFilters((f) => ({ ...f, ownership: v }))}
              />
            )}
            {conFiltersActive && (
              <button
                onClick={() => setConFilters(EMPTY_CON_FILTERS)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                Clear filters
              </button>
            )}
          </>
        )}
      </div>

      {/* Table area */}
      <div className="flex-1 overflow-auto">
        {tab === "fields" ? (
          <FieldsPanel onChanged={reloadCustomDefs} />
        ) : loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : tab === "properties" ? (
          <PropertiesTable
            rows={filteredProps}
            customDefs={customPropertyDefs}
            onSave={saveProp}
            deletingId={deletingId}
            onDeleteRequest={setDeletingId}
            onDeleteConfirm={handleDeleteConfirm}
            onDeleteCancel={() => setDeletingId(null)}
          />
        ) : tab === "leases" ? (
          <LeasesTable rows={leases} />
        ) : (
          <ContactsTable rows={filteredContacts} onSave={saveContact} />
        )}
      </div>
    </div>
  );
}
