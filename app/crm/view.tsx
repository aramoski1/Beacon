"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { syncPropertyEntity } from "@/lib/entities";
import { contactIdsByPropertyIds, contactIdsForProperties, propertyIdsByContactIds } from "@/lib/contact-properties";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, FileText, ExternalLink, Loader2, Sparkles, X, Trash2, AlertCircle, ChevronLeft, ChevronRight, SlidersHorizontal, Check, Mail, Settings2, Zap, Phone, Layers, Briefcase } from "lucide-react";
import { CustomFieldsPanel } from "@/components/custom-fields-panel";
import type { EntityType } from "@/lib/custom-fields";
import { ComposeOutreach } from "@/components/compose-outreach";
import { EnhanceDialog } from "./enhance-dialog";
import { BulkEnrichPanel, type BulkProperty } from "./bulk-enrich-panel";
import { interpretSearch, deleteProperty, deleteContact, deleteLease, promotePropertyOwnerToCrm, linkContactsToProperty, type SearchResult, type PropertySearchFilters, type ContactSearchFilters, type LeaseSearchFilters } from "./actions";
import { LinkToPropertyDialog } from "@/components/link-to-property-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { resolveCustomFieldValue } from "@/lib/custom-field-aliases";
import { isCustomGroup } from "@/lib/industrial-fields";
import { buildContactOccupancy } from "@/lib/contact-occupancy";
import { ensureIndustrialSpecs } from "@/app/settings/fields/actions";
import { SourceChip } from "@/components/source-chip";
import { TableSkeleton } from "@/components/ui/skeleton";
import { resolvePropertyOwnerContacts, preferDisplayOwnerContact, type StoredOwnerContact } from "@/lib/owner-contacts";
import { cadenceChipForContact, cadenceMapFromSettings, type CadenceSettingsSlice } from "@/lib/cadence";
import { createActivity, savePropertyGridActivity } from "@/app/activities/actions";
import { formatCallOutcomeNote } from "@/lib/activity-touch";
import { ownerPortfolioHref } from "@/lib/owner-portfolio";
import { CreateDealDialog } from "@/app/deals/create-deal-dialog";
import { formatPsf } from "@/lib/format-money";
import { formatLocalDate } from "@/lib/dates";
import { leaseDisplayTitle } from "@/lib/lease-radar";
import {
  GRID_ACTIVITY_TIP,
  isPropertyActivityField,
} from "@/lib/property-grid-activity";
import {
  contactsExportHref,
  exportIdsQuery,
  leasesExportHref,
  MAX_EXPORT_IDS,
  propertiesExportHref,
} from "@/lib/crm-export";

// ─── Types ────────────────────────────────────────────────────────────────────

type Property = {
  id: string;
  owner_id?: string;
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
  building_composition?: {
    year_built?: number | null;
    lot_size_sqft?: number | null;
    stories?: number | null;
    units?: number | null;
    assessed_value?: number | null;
  } | null;
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
  owner_id?: string;
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
  book_address?: string | null;
  book_sf?: number | null;
  book_leased_sf?: number | null;
  book_expiry?: string | null;
  book_landlord?: string | null;
};

type LeaseAbstract = {
  id: string;
  owner_id?: string;
  source_document: string | null;
  execution_date: string | null;
  expiration_date: string | null;
  term: string | null;
  base_rate: number | null;
  leased_sf: number | null;
  tenant_contact_id: string | null;
  created_at: string;
  linked_property: string | null;
  property_address?: string | null;
  tenant_name?: string | null;
};

type PropFilters = {
  propType: string;
  ownership: string;        // "individual" | "entity" | ""
  ownershipChange: string;  // "yes" | "no" | ""
  saleRecency: string;      // "lt1y" | "1to3y" | "3to5y" | "5plus" | ""
};
type ConFilters = {
  tier: string;
  status: string;           // relationship_stage
  assetFocus: string;       // asset_focus_includes
  cadenceStatus: string;    // "overdue" | "due_soon" | "ok" | "never" | ""
  contactType: string;      // owner | tenant | other
};
type LeaseFilters = {
  expirationWindow: string;   // "90d" | "180d" | "12mo" | "beyond12mo" | ""
  linkedPropertyType: string; // property_type enum
  hasTenantContact: string;   // "yes" | "no" | ""
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

// Individual vs entity — derived from ownership_type, itself inferred from
// owner_name at extraction time (LLC/INC/CORP/... → institutional/REIT).
const OWNERSHIP_INDIVIDUAL_ENTITY = [
  { value: "individual", label: "Individual" },
  { value: "entity",     label: "Entity" },
];

const OWNERSHIP_CHANGE_OPTIONS = [
  { value: "yes", label: "Ownership change detected" },
  { value: "no",  label: "No ownership change" },
];

const SALE_RECENCY_OPTIONS = [
  { value: "lt1y",  label: "< 1 year" },
  { value: "1to3y", label: "1–3 years" },
  { value: "3to5y", label: "3–5 years" },
  { value: "5plus", label: "5+ years" },
];

const RELATIONSHIP_STAGES = [
  { value: "prospect",    label: "Prospect" },
  { value: "active",      label: "Active" },
  { value: "client",      label: "Client" },
  { value: "past_client", label: "Past client" },
  { value: "dormant",     label: "Dormant" },
];

const ASSET_FOCUS_OPTIONS = [
  { value: "industrial",  label: "Industrial" },
  { value: "office",      label: "Office" },
  { value: "retail",      label: "Retail" },
  { value: "multifamily", label: "Multifamily" },
  { value: "land",        label: "Land" },
  { value: "mixed_use",   label: "Mixed Use" },
  { value: "other",       label: "Other" },
];

const CADENCE_STATUS_OPTIONS = [
  { value: "overdue",  label: "Overdue" },
  { value: "due_soon", label: "Due soon" },
  { value: "ok",       label: "On track" },
  { value: "never",    label: "Never contacted" },
];

const EXPIRATION_WINDOW_OPTIONS = [
  { value: "90d",        label: "≤ 90 days" },
  { value: "180d",       label: "≤ 180 days" },
  { value: "12mo",       label: "≤ 12 months" },
  { value: "beyond12mo", label: "12+ months out" },
];

const HAS_TENANT_CONTACT_OPTIONS = [
  { value: "yes", label: "Has tenant contact" },
  { value: "no",  label: "No tenant contact" },
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

const CONTACT_TYPE_OPTIONS = [
  { value: "owner",  label: "Owner" },
  { value: "tenant", label: "Tenant" },
  { value: "other",  label: "Other" },
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
  { id: "phone",       label: "Phone" },
  { id: "book",        label: "Book" },
  { id: "company",     label: "Company" },
  { id: "occupancy",   label: "Property / occupancy" },
  { id: "leasedsf",    label: "Tenant SF" },
  { id: "expiry",      label: "Lease expiry" },
  { id: "landlord",    label: "Landlord" },
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
  { id: "doc",      label: "Tenant",     alwaysOn: true },
  { id: "property", label: "Property" },
  { id: "leasedsf", label: "Tenant SF" },
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

function fmtDate(iso: string | null | undefined) {
  return formatLocalDate(iso);
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
  const knownValues = options.map((o) => o.value);
  const hasOtherOption = knownValues.includes("other");
  const isCustomValue = !!value && !knownValues.includes(value);
  // value === "other" with no elaboration yet — the select can't fire onChange for
  // re-picking an option that's already selected, so this must also force the input open.
  const isOtherLiteral = value === "other";

  const [editingOther, setEditingOther] = useState(false);
  const [draft, setDraft] = useState(isCustomValue ? value! : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCustomValue) setDraft(value!);
  }, [value, isCustomValue]);

  const showOtherInput = hasOtherOption && (editingOther || isCustomValue || isOtherLiteral);

  useEffect(() => {
    if (editingOther && !isCustomValue) inputRef.current?.focus();
  }, [editingOther, isCustomValue]);

  function commitOther() {
    setEditingOther(false);
    onSave(draft.trim() || null);
  }

  return (
    <div className="flex items-center gap-1">
      <select
        value={showOtherInput ? "other" : value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "other") {
            setDraft(isCustomValue ? value! : "");
            setEditingOther(true);
          } else {
            setEditingOther(false);
            onSave(v || null);
          }
        }}
        className="bg-transparent border-0 outline-none text-xs cursor-pointer rounded px-1 py-0 -mx-1 hover:bg-muted/60 focus:bg-muted/60 max-w-36"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {showOtherInput && (
        <input
          ref={inputRef}
          value={draft}
          placeholder="Type…"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitOther}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitOther(); }
            if (e.key === "Escape") { setDraft(isCustomValue ? value! : ""); setEditingOther(false); }
          }}
          className="text-xs px-1 py-0.5 border border-border rounded outline-none focus:ring-1 ring-ring w-20 bg-background"
        />
      )}
    </div>
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
        className="text-xs px-1 py-0.5 border border-border rounded outline-none focus:ring-1 ring-ring w-full bg-background"
      />
    );
  }

  const shown = displayValue !== undefined ? displayValue : value;
  return (
    <span
      onClick={() => { setDraft(value ?? ""); setEditing(true); }}
      className={cn("cursor-text rounded px-1 py-0 -mx-1 hover:bg-muted/60 text-xs leading-snug", displayClassName)}
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
  const knownValues = OWNERSHIP_ROLES.map((o) => o.value);
  const isCustomValue = !!role && !knownValues.includes(role);
  // role === "other" with no elaboration yet — the select can't fire onChange for
  // re-picking an option that's already selected, so this must also force the input open.
  const isOtherLiteral = role === "other";

  const [editingOther, setEditingOther] = useState(false);
  const [draft, setDraft] = useState(isCustomValue ? role! : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCustomValue) setDraft(role!);
  }, [role, isCustomValue]);

  const showOtherInput = editingOther || isCustomValue || isOtherLiteral;

  useEffect(() => {
    if (editingOther && !isCustomValue) inputRef.current?.focus();
  }, [editingOther, isCustomValue]);

  function commitOther() {
    setEditingOther(false);
    onSave(draft.trim() || null);
  }

  return (
    <div className="flex items-center gap-1">
      <select
        value={showOtherInput ? "other" : role ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "other") {
            setDraft(isCustomValue ? role! : "");
            setEditingOther(true);
          } else {
            setEditingOther(false);
            onSave(v || null);
          }
        }}
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
      {showOtherInput && (
        <input
          ref={inputRef}
          value={draft}
          placeholder="Type…"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitOther}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitOther(); }
            if (e.key === "Escape") { setDraft(isCustomValue ? role! : ""); setEditingOther(false); }
          }}
          className="text-xs px-1 py-0.5 border border-border rounded outline-none focus:ring-1 ring-ring w-20 bg-background"
        />
      )}
    </div>
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

const thCls = "px-3 py-1.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap relative";
const tdCls = "px-3 py-1.5 align-middle border-b border-border/50 text-xs leading-snug h-[68px]";
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
  warning,
}: {
  id: string;
  label: string;
  deletingId: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
  warning?: string | null;
}) {
  const isDeleting = deletingId === id;
  return (
    <td className={cn(tdCls, "crm-row-action-cell w-10 text-right pr-2 whitespace-nowrap sticky right-0 bg-background")}>
      {isDeleting ? (
        <span className="inline-flex items-center gap-1 text-xs text-destructive whitespace-nowrap">
          {warning && (
            <span className="text-amber-600 dark:text-amber-500" title={warning}>
              {warning} ·
            </span>
          )}
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
  propContactsReady,
  customDefs,
  colVis,
  onSave,
  onSaveContact,
  onPromoted,
  deletingId,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  deleteWarning,
  selectedIds,
  onToggle,
  onToggleAll,
  totalInDb,
  ownerName,
}: {
  rows: Property[];
  propContacts: Map<string, LinkedContactInfo[]>;
  propContactsReady: boolean;
  customDefs: FieldDefinition[];
  colVis: ReturnType<typeof useColVis>;
  onSave: (id: string, field: string, value: unknown) => void;
  onSaveContact: (contactId: string, field: string, value: unknown) => void;
  onPromoted: (propertyId: string, contacts: LinkedContactInfo[]) => void;
  deletingId: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
  deleteWarning?: string | null;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (allSelected: boolean) => void;
  totalInDb?: number;
  /** Beacon_Team_Multitenancy_Plan.md §7.4 — null for your own rows, a label for a teammate's. */
  ownerName?: (ownerId: string | undefined) => string | null;
}) {
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promoteDialog, setPromoteDialog] = useState<{
    propertyId: string;
    propertyLabel: string;
    people: StoredOwnerContact[];
  } | null>(null);
  const [linkConfirm, setLinkConfirm] = useState<{
    propertyId: string;
    propertyLabel: string;
    unlinked: Array<{ id: string; name: string | null }>;
    resultContacts: Array<{ id: string; name: string | null; email: string | null; mailing_address: string | null }>;
  } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [contactFieldConfirm, setContactFieldConfirm] = useState<{
    contactId: string;
    field: "name" | "email" | "mailing_address";
    value: string | null;
  } | null>(null);

  function handleConfirmContactFieldEdit() {
    if (!contactFieldConfirm) return;
    onSaveContact(contactFieldConfirm.contactId, contactFieldConfirm.field, contactFieldConfirm.value);
    setContactFieldConfirm(null);
  }

  function handleCancelContactFieldEdit() {
    setContactFieldConfirm(null);
  }

  function finishPromote(
    propertyId: string,
    contacts: Array<{ id: string; name: string | null; email: string | null; mailing_address: string | null }>,
  ) {
    onPromoted(
      propertyId,
      contacts.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        mailing_address: c.mailing_address,
        last_activity_date: null,
        last_activity_type: null,
        last_activity_notes: null,
      })),
    );
  }

  async function doPromote(propertyId: string, indices: number[] | undefined, propertyLabel: string) {
    setPromotingId(propertyId);
    try {
      const res = await promotePropertyOwnerToCrm(propertyId, indices);
      if (res.error && (!res.contacts || res.contacts.length === 0)) {
        window.alert(res.error);
        return;
      }
      if (res.error) {
        window.alert(res.error);
      }
      if (!res.contacts?.length) {
        window.alert("Promote failed — no contacts were created.");
        return;
      }
      if (res.unlinkedContacts?.length) {
        setLinkConfirm({
          propertyId,
          propertyLabel,
          unlinked: res.unlinkedContacts,
          resultContacts: res.contacts,
        });
      } else {
        finishPromote(propertyId, res.contacts);
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Promote failed.");
    } finally {
      setPromotingId(null);
    }
  }

  async function handleConfirmLink() {
    if (!linkConfirm) return;
    setLinkBusy(true);
    const linkRes = await linkContactsToProperty(
      linkConfirm.propertyId,
      linkConfirm.unlinked.map((c) => c.id),
    );
    if (linkRes.error) window.alert(`Some contacts could not be linked: ${linkRes.error}`);
    finishPromote(linkConfirm.propertyId, linkConfirm.resultContacts);
    setLinkBusy(false);
    setLinkConfirm(null);
  }

  function handleCancelLink() {
    if (!linkConfirm) return;
    finishPromote(linkConfirm.propertyId, linkConfirm.resultContacts);
    setLinkConfirm(null);
  }

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
            function handlePromote() {
              const propertyLabel = p.address ?? "this property";
              if (ownerContacts.length > 1) {
                setPromoteDialog({ propertyId: p.id, propertyLabel, people: ownerContacts });
              } else {
                void doPromote(p.id, undefined, propertyLabel);
              }
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
                      {ownerName?.(p.owner_id) && (
                        <span
                          title="Shared by a teammate"
                          className="mt-1 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                          <Users className="size-2.5" />
                          {ownerName(p.owner_id)}
                        </span>
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

                {/* Owner Contact — all linked CRM contacts, else staging + promote all */}
                <td className={cn(tdCls, "min-w-[100px]", col("contact"))}>
                  {cs.length > 0 ? (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-primary shrink-0">CRM</span>
                        {cs[0] && (
                          <Link
                            href={`/contacts/${cs[0].id}`}
                            className="text-[10px] text-muted-foreground hover:text-primary truncate"
                          >
                            open
                          </Link>
                        )}
                      </div>
                      {cs.map((c) => (
                        <EditableText
                          key={c.id}
                          value={c.name}
                          placeholder="—"
                          displayClassName="truncate block font-medium"
                          onSave={(v) => setContactFieldConfirm({ contactId: c.id, field: "name", value: v })}
                        />
                      ))}
                    </div>
                  ) : ownerContacts.length > 0 ? (
                    <div className="space-y-0.5">
                      {ownerContacts.map((oc, i) => (
                        <EditableText
                          key={i}
                          value={oc.name}
                          placeholder="—"
                          displayClassName="truncate block font-medium"
                          onSave={(v) => updateOwnerContact(i, "name", v)}
                        />
                      ))}
                      {propContactsReady ? (
                        <button
                          type="button"
                          disabled={promotingId === p.id}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void handlePromote();
                          }}
                          className="text-[10px] text-primary hover:underline underline-offset-2 disabled:opacity-50"
                          title={ownerContacts.length > 1 ? "Choose which owner contacts to create as CRM contacts" : "Create a CRM contact for this owner contact"}
                        >
                          {promotingId === p.id ? "Promoting…" : "Promote to CRM"}
                        </button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Checking CRM…</span>
                      )}
                    </div>
                  ) : (
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
                  )}
                </td>

                {/* Owner Address */}
                <td className={cn(tdCls, "min-w-[120px]", col("addr2"))}>
                  {cs.length > 0 ? (
                    cs.map((c) => (
                      <EditableText
                        key={c.id}
                        value={c.mailing_address}
                        placeholder="—"
                        displayClassName="truncate block text-muted-foreground"
                        onSave={(v) => setContactFieldConfirm({ contactId: c.id, field: "mailing_address", value: v })}
                      />
                    ))
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
                  {cs.length > 0 ? (
                    cs.map((c) => (
                      <EditableText
                        key={c.id}
                        value={c.email}
                        placeholder="—"
                        displayClassName="truncate block text-primary"
                        onSave={(v) => setContactFieldConfirm({ contactId: c.id, field: "email", value: v })}
                      />
                    ))
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
                      placeholder="—"
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
                    placeholder="—"
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
                  const val = resolveCustomFieldValue(
                    slug,
                    (p.custom_fields ?? {}) as Record<string, string | number | null>,
                    p,
                  );
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
                  warning={deletingId === p.id ? deleteWarning : null}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
      {promoteDialog && (
        <PromoteContactsDialog
          propertyLabel={promoteDialog.propertyLabel}
          people={promoteDialog.people}
          busy={promotingId === promoteDialog.propertyId}
          onCancel={() => setPromoteDialog(null)}
          onConfirm={(indices) => {
            const { propertyId, propertyLabel } = promoteDialog;
            setPromoteDialog(null);
            void doPromote(propertyId, indices, propertyLabel);
          }}
        />
      )}
      {linkConfirm && (
        <LinkToPropertyDialog
          contactLabel={linkConfirm.unlinked.map((c) => c.name || "Unnamed").join(", ")}
          propertyLabel={linkConfirm.propertyLabel}
          busy={linkBusy}
          onCancel={handleCancelLink}
          onConfirm={handleConfirmLink}
        />
      )}
      {contactFieldConfirm && (
        <ConfirmDialog
          title="Update CRM contact"
          message="Update the CRM contact used for outreach and cadence? This does not change staging on the property row."
          confirmLabel="Update"
          onCancel={handleCancelContactFieldEdit}
          onConfirm={handleConfirmContactFieldEdit}
        />
      )}
    </div>
  );
}

function PromoteContactsDialog({
  propertyLabel,
  people,
  busy,
  onCancel,
  onConfirm,
}: {
  propertyLabel: string;
  people: StoredOwnerContact[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (indices: number[]) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(people.map((_, i) => i)));

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div className="bg-background rounded-xl border shadow-xl w-full max-w-sm p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold">Promote to CRM</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose which owner contact{people.length > 1 ? "s" : ""} on {propertyLabel} to create as CRM contacts.
          </p>
        </div>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {people.map((person, i) => (
            <label
              key={i}
              className="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm cursor-pointer hover:bg-muted/40"
            >
              <input
                type="checkbox"
                className="mt-0.5 accent-primary"
                checked={selected.has(i)}
                onChange={() => toggle(i)}
                disabled={busy}
              />
              <span className="min-w-0">
                <span className="block font-medium truncate">{person.name || "Unnamed"}</span>
                {(person.title || person.address) && (
                  <span className="block text-xs text-muted-foreground truncate">
                    {[person.title, person.address].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => onConfirm([...selected].sort((a, b) => a - b))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Promoting…
              </>
            ) : (
              `Promote${selected.size > 0 ? ` (${selected.size})` : ""}`
            )}
          </button>
        </div>
      </div>
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
  ownerName,
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
  ownerName?: (ownerId: string | undefined) => string | null;
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
      <table className="w-full text-xs border-collapse">
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
            <th className={cn(thCls, col("phone"))} style={cColStyle("phone")}>Phone<RH col="phone" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("book"))} style={cColStyle("book")}>Book<RH col="book" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("company"))} style={cColStyle("company")}>Company<RH col="company" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("occupancy"))} style={cColStyle("occupancy")}>Property / occupancy<RH col="occupancy" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("leasedsf"))} style={cColStyle("leasedsf")}>Tenant SF<RH col="leasedsf" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("expiry"))} style={cColStyle("expiry")}>Lease expiry<RH col="expiry" onStart={cStartResize} /></th>
            <th className={cn(thCls, col("landlord"))} style={cColStyle("landlord")}>Landlord<RH col="landlord" onStart={cStartResize} /></th>
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
                <div className="min-w-0 leading-snug">
                  <Link href={`/contacts/${c.id}`} className="font-medium hover:underline underline-offset-2 truncate block">
                    {c.name ?? <span className="text-muted-foreground italic">No name</span>}
                  </Link>
                  {c.email && (
                    <span title={c.email} onClick={(e) => cShowPopup(c.email!, e)} className="text-[11px] text-muted-foreground truncate cursor-pointer hover:text-foreground block">{c.email}</span>
                  )}
                  {ownerName?.(c.owner_id) && (
                    <span
                      title="Shared by a teammate"
                      className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                    >
                      <Users className="size-2.5" />
                      {ownerName(c.owner_id)}
                    </span>
                  )}
                </div>
              </td>
              <td className={cn(tdCls, "min-w-28", col("phone"))}>
                <EditableText
                  value={c.phone_mobile ?? c.phone}
                  displayClassName="text-muted-foreground truncate block"
                  onSave={(v) => onSave(c.id, "phone_mobile", v)}
                />
              </td>
              <td className={cn(tdCls, "min-w-24", col("book"))}>
                <EditableSelect
                  value={c.contact_type}
                  options={CONTACT_TYPE_OPTIONS}
                  onSave={(v) => onSave(c.id, "contact_type", v)}
                />
              </td>
              <td className={cn(tdCls, col("company"))}>
                <EditableText
                  value={c.company}
                  displayClassName="text-muted-foreground truncate block"
                  onSave={(v) => onSave(c.id, "company", v)}
                />
              </td>
              <td className={cn(tdCls, "min-w-40", col("occupancy"))}>
                {c.book_address ? (
                  <span className="truncate block text-xs" title={c.book_address}>
                    {c.book_address}
                    {c.book_sf != null ? ` · ${Math.round(c.book_sf).toLocaleString()} SF` : ""}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className={cn(tdCls, col("leasedsf"))}>
                <span className="text-xs text-muted-foreground">
                  {c.book_leased_sf != null ? Math.round(c.book_leased_sf).toLocaleString() : "—"}
                </span>
              </td>
              <td className={cn(tdCls, col("expiry"))}>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {fmtDate(c.book_expiry) ?? "—"}
                </span>
              </td>
              <td className={cn(tdCls, "min-w-28", col("landlord"))}>
                <span className="truncate block text-xs text-muted-foreground" title={c.book_landlord ?? undefined}>
                  {c.book_landlord || "—"}
                </span>
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
  ownerName,
}: {
  rows: LeaseAbstract[];
  deletingId: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
  colVis: ReturnType<typeof useColVis>;
  ownerName?: (ownerId: string | undefined) => string | null;
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

  return (
    <div>
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/40 sticky top-0 z-10">
          <tr>
            <th className={thCls} style={lColStyle("doc")}>Tenant<RH col="doc" onStart={lStartResize} /></th>
            <th className={cn(thCls, col("property"))} style={lColStyle("property")}>Property<RH col="property" onStart={lStartResize} /></th>
            <th className={cn(thR, col("leasedsf"))} style={lColStyle("leasedsf")}>Tenant SF<RH col="leasedsf" onStart={lStartResize} /></th>
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
                    title={leaseDisplayTitle({
                      tenant_contact: a.tenant_name ? { id: a.tenant_contact_id ?? "", name: a.tenant_name, email: null, company: null } : null,
                      property_address: a.property_address,
                      source_document: a.source_document,
                    })}
                  >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    {leaseDisplayTitle({
                      tenant_contact: a.tenant_name ? { id: a.tenant_contact_id ?? "", name: a.tenant_name, email: null, company: null } : null,
                      property_address: a.property_address,
                      source_document: a.source_document,
                    })}
                  </Link>
                  {ownerName?.(a.owner_id) && (
                    <span
                      title="Shared by a teammate"
                      className="ml-5 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                    >
                      <Users className="size-2.5" />
                      {ownerName(a.owner_id)}
                    </span>
                  )}
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
                <td className={cn(tdR, col("leasedsf"))}>
                  {a.leased_sf != null ? Math.round(Number(a.leased_sf)).toLocaleString() : "—"}
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
                  {a.base_rate != null ? formatPsf(a.base_rate) : "—"}
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

const EMPTY_PROP_FILTERS: PropFilters   = { propType: "", ownership: "", ownershipChange: "", saleRecency: "" };
const EMPTY_CON_FILTERS: ConFilters     = { tier: "", status: "", assetFocus: "", cadenceStatus: "", contactType: "" };
const EMPTY_LEASE_FILTERS: LeaseFilters = { expirationWindow: "", linkedPropertyType: "", hasTenantContact: "" };

const VALID_TABS = ["properties", "leases", "contacts"] as const;
type Tab = typeof VALID_TABS[number];
type BarMode = "search" | "smart-lists";

const SEARCH_PLACEHOLDERS: Record<Tab, string> = {
  properties: "e.g. industrial over 50k SF in Doral…",
  leases: "e.g. leases expiring this quarter…",
  contacts: "e.g. tier 1 owners not contacted in 90 days…",
};

type WorkspaceScope = "mine" | "firm";

export default function CRMView({
  initialTab,
  userEmail,
  userId,
  isSoloFirm,
  teammateNames,
}: {
  initialTab?: string;
  userEmail?: string | null;
  userId: string;
  isSoloFirm: boolean;
  teammateNames: Record<string, string | null>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(
    VALID_TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "properties"
  );
  // Beacon_Team_Multitenancy_Plan.md §7.2/§7.3 — 2-state toggle, only ever
  // reachable for a multi-member firm; a solo broker's default never changes.
  const [scope, setScope] = useState<WorkspaceScope>("mine");
  const ownerName = useCallback(
    (ownerId: string | undefined) => {
      if (!ownerId || ownerId === userId) return null;
      return teammateNames[ownerId] ?? "Teammate";
    },
    [userId, teammateNames],
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
  const [propContactsReady, setPropContactsReady] = useState(false);
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
  const [leasesLoading, setLeasesLoading] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);

  // ── Load error state ───────────────────────────────────────────────────────
  const [propsError, setPropsError] = useState<string | null>(null);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [leasesError, setLeasesError] = useState<string | null>(null);
  const [cadenceMap, setCadenceMap] = useState<Record<number, number>>(() => cadenceMapFromSettings(null));

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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteWarning, setDeleteWarning] = useState<string | null>(null);

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

    // "My book" narrows below whatever RLS allows; "Entire firm" is the
    // query exactly as it already was, letting RLS itself be the ceiling
    // (Beacon_Team_Multitenancy_Plan.md §7.1).
    if (scope === "mine") q = q.eq("owner_id", userId);

    if (activeSearch?.properties) {
      const f = activeSearch.properties;
      q = applyPropertyFilters(q, f);
    } else {
      const f: PropertySearchFilters = {};
      if (propFilters.propType) f.property_type = propFilters.propType;
      if (propFilters.ownership === "individual" || propFilters.ownership === "entity") {
        f.ownership_individual_or_entity = propFilters.ownership;
      }
      if (propFilters.ownershipChange === "yes" || propFilters.ownershipChange === "no") {
        f.has_ownership_change = propFilters.ownershipChange === "yes";
      }
      if (propFilters.saleRecency) {
        f.last_sale_recency = propFilters.saleRecency as PropertySearchFilters["last_sale_recency"];
      }
      q = applyPropertyFilters(q, f);
    }

    const { data, count, error } = await q;
    if (error) {
      setPropsError(error.message);
      setProperties([]);
      setTotalProps(0);
      setPropContacts(new Map());
      setPropContactsReady(true);
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
    setPropContactsReady(true);

    setPropsLoading(false);
  }, [propPage, propFilters, activeSearch, scope, userId]);

  useEffect(() => {
    if (tab === "properties") void loadProperties();
  }, [loadProperties, tab]);

  // ── Load contacts (server-filtered + paginated) ────────────────────────────
  const loadContacts = useCallback(async () => {
    setContactsLoading(true);
    setContactsError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const from = conPage * PAGE_SIZE;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from("contacts")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (scope === "mine") q = q.eq("owner_id", userId);

    if (activeSearch?.contacts || activeSearch?.target === "both") {
      if (activeSearch?.target === "both" && activeSearch.properties) {
        if (!user) {
          setContacts([]);
          setTotalCons(0);
          setContactsLoading(false);
          return;
        }
        const propertyIds = await fetchMatchingPropertyIdsFromClient(supabase, user.id, activeSearch.properties);
        if (propertyIds.length === 0) {
          setContacts([]);
          setTotalCons(0);
          setContactsLoading(false);
          return;
        }
        const linkedIds = await contactIdsForProperties(supabase, user.id, propertyIds);
        if (linkedIds.length === 0) {
          setContacts([]);
          setTotalCons(0);
          setContactsLoading(false);
          return;
        }
        q = q.in("id", linkedIds);
      }
      if (activeSearch?.contacts) {
        q = applyContactFilters(q, activeSearch.contacts, cadenceMap);
      }
    } else {
      const f: ContactSearchFilters = {};
      if (conFilters.tier) f.contact_tier = Number(conFilters.tier);
      if (conFilters.status) f.relationship_stage = conFilters.status;
      if (conFilters.assetFocus) f.asset_focus_includes = conFilters.assetFocus;
      if (conFilters.cadenceStatus) f.cadence_status = conFilters.cadenceStatus as ContactSearchFilters["cadence_status"];
      if (conFilters.contactType) f.contact_type = conFilters.contactType;
      q = applyContactFilters(q, f, cadenceMap);
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
        const propIds = [...new Set(rows.flatMap((c: Contact) => c.linked_properties ?? []))];
        const [{ data: props }, { data: leases }] = await Promise.all([
          propIds.length
            ? supabase.from("properties").select("id, address, city, submarket, property_type, size_sqft, land_sqft, last_sale_date, last_sale_price, owner_name").in("id", propIds)
            : Promise.resolve({ data: [] as never[] }),
          supabase
            .from("lease_abstracts")
            .select("id, tenant_contact_id, linked_property, expiration_date, leased_sf, landlord_name")
            .in("tenant_contact_id", rows.map((c: Contact) => c.id)),
        ]);
        const propRows = (props ?? []) as Parameters<typeof buildContactOccupancy>[1];
        const leaseRows = (leases ?? []) as Parameters<typeof buildContactOccupancy>[2];
        for (const c of rows) {
          const occ = buildContactOccupancy(c.linked_properties ?? [], propRows, leaseRows, c.id);
          c.book_address = occ.address;
          c.book_sf = occ.sizeSqft;
          c.book_leased_sf = occ.leasedSf;
          c.book_expiry = occ.expiry;
          c.book_landlord = occ.landlord;
        }
      } catch {
        // Portfolio deep-links are best-effort.
      }
    }
    setContacts(rows);
    setTotalCons(count ?? 0);
    setContactsLoading(false);
  }, [conPage, conFilters, activeSearch, cadenceMap, scope, userId]);

  useEffect(() => {
    if (tab === "contacts") void loadContacts();
  }, [loadContacts, tab]);

  // ── Load leases (server-filtered + paginated) ─────────────────────────────
  const loadLeases = useCallback(async () => {
    setLeasesLoading(true);
    setLeasesError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const leaseFilterCtx = user ? { ownerId: user.id, supabase } : undefined;
    const from = leasePage * PAGE_SIZE;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from("lease_abstracts")
      .select("id, owner_id, source_document, execution_date, expiration_date, term, base_rate, leased_sf, tenant_contact_id, created_at, linked_property", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (scope === "mine") q = q.eq("owner_id", userId);

    if (activeSearch?.leases) {
      q = await applyLeaseFilters(q, activeSearch.leases as LeaseSearchFilters, leaseFilterCtx);
    } else {
      const f: LeaseSearchFilters = {};
      if (leaseFilters.expirationWindow) {
        f.expiration_window = leaseFilters.expirationWindow as LeaseSearchFilters["expiration_window"];
      }
      if (leaseFilters.linkedPropertyType) f.linked_property_type = leaseFilters.linkedPropertyType;
      if (leaseFilters.hasTenantContact === "yes" || leaseFilters.hasTenantContact === "no") {
        f.has_tenant_contact = leaseFilters.hasTenantContact === "yes";
      }
      q = await applyLeaseFilters(q, f, leaseFilterCtx);
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
    const tenantIds = Array.from(
      new Set(leaseRows.map((l) => l.tenant_contact_id).filter((id): id is string => Boolean(id))),
    );
    const [propsRes, tenantsRes] = await Promise.all([
      propIds.length > 0
        ? supabase.from("properties").select("id, address, city").in("id", propIds)
        : Promise.resolve({ data: [] as { id: string; address: string | null; city: string | null }[] }),
      tenantIds.length > 0
        ? supabase.from("contacts").select("id, name").in("id", tenantIds)
        : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    ]);
    const addrById = new Map(
      (propsRes.data ?? []).map((p) => [
        p.id,
        [p.address, p.city].filter(Boolean).join(", ") || null,
      ]),
    );
    const nameById = new Map((tenantsRes.data ?? []).map((c) => [c.id, c.name]));
    for (const row of leaseRows) {
      if (row.linked_property) {
        row.property_address = addrById.get(row.linked_property) ?? null;
      }
      if (row.tenant_contact_id) {
        row.tenant_name = nameById.get(row.tenant_contact_id) ?? null;
      }
    }
    setLeases(leaseRows);
    setTotalLeases(count ?? 0);
    setLeasesLoading(false);
  }, [leasePage, leaseFilters, activeSearch, scope, userId]);

  useEffect(() => {
    if (tab === "leases") void loadLeases();
  }, [loadLeases, tab]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    async function loadHeaderCounts() {
      let pq = supabase.from("properties").select("id", { count: "exact", head: true });
      let cq = supabase.from("contacts").select("id", { count: "exact", head: true });
      let lq = supabase.from("lease_abstracts").select("id", { count: "exact", head: true });
      if (scope === "mine") {
        pq = pq.eq("owner_id", userId);
        cq = cq.eq("owner_id", userId);
        lq = lq.eq("owner_id", userId);
      }
      const [p, c, l] = await Promise.all([pq, cq, lq]);
      if (cancelled) return;
      setTotalProps((t) => t ?? p.count ?? 0);
      setTotalCons((t) => t ?? c.count ?? 0);
      setTotalLeases((t) => t ?? l.count ?? 0);
    }
    void loadHeaderCounts();
    return () => { cancelled = true; };
  }, [scope, userId]);

  // ── Reload custom field definitions ───────────────────────────────────────
  const reloadCustomDefs = useCallback(async () => {
    await ensureIndustrialSpecs();
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
    // RLS is the real gate here (own row, or a firm-shared 'team' row per
    // Beacon_Team_Multitenancy_Plan.md §7.6) — no client-side owner_id
    // filter is added on top, since one would incorrectly reject a
    // legitimate edit to a teammate's shared row.
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("properties")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setSaveError(error.message);
      void loadProperties();
      return;
    }
    // Entity sync is intentionally skipped when editing a teammate's shared
    // property — entities/entity_properties stay owner-only in v1 (out of
    // scope per the plan's resolved decision #3), and syncing under the
    // editor's own id would fragment the true owner's entity dedup instead
    // of the property owner's.
    const editedProperty = properties.find((p) => p.id === id);
    const isOwnRow = user && editedProperty && editedProperty.owner_id === user.id;
    if (field === "owner_name" && user && isOwnRow) {
      try {
        await syncPropertyEntity(supabase, user.id, id, typeof value === "string" ? value : null);
      } catch {
        // Property saved; entity sync is best-effort.
      }
    }
  }, [loadProperties, properties]);

  const saveContact = useCallback(async (id: string, field: string, value: unknown) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
    const supabase = createClient();
    const { error } = await supabase
      .from("contacts")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setSaveError(error.message);
      void loadContacts();
    }
  }, [loadContacts]);

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
    const { error } = await supabase
      .from("contacts")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setSaveError(error.message);
      void loadContacts();
    }
  }, [loadContacts]);


  // ── Delete handlers ────────────────────────────────────────────────────────
  const handlePropertyDeleteRequest = useCallback((id: string) => {
    setDeletingId(id);
    setDeleteWarning(null);
    (async () => {
      const supabase = createClient();
      const { count } = await supabase
        .from("lease_abstracts")
        .select("id", { count: "exact", head: true })
        .eq("linked_property", id);
      if (count) {
        setDeleteWarning(`${count} linked lease${count === 1 ? "" : "s"} will be unlinked, not deleted`);
      }
    })();
  }, []);

  const handleDeleteConfirm = useCallback(async (id: string) => {
    setProperties((prev) => prev.filter((p) => p.id !== id));
    setTotalProps((t) => (t !== null ? t - 1 : null));
    setDeletingId(null);
    setDeleteWarning(null);
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
            {[
              totalProps !== null ? `${totalProps} ${totalProps === 1 ? "property" : "properties"}` : null,
              totalLeases !== null ? `${totalLeases} ${totalLeases === 1 ? "lease" : "leases"}` : null,
              totalCons !== null ? `${totalCons} ${totalCons === 1 ? "contact" : "contacts"}` : null,
            ].filter(Boolean).join(" · ")}
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

      {saveError && (
        <div className="shrink-0 mx-6 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" />
          Edit didn&apos;t save: {saveError}
          <button
            type="button"
            onClick={() => setSaveError(null)}
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
          {!isSoloFirm && (
            <div className="flex shrink-0 rounded-md border p-0.5 bg-muted/30">
              <button
                type="button"
                onClick={() => setScope("mine")}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded transition-colors",
                  scope === "mine" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                My book
              </button>
              <button
                type="button"
                onClick={() => setScope("firm")}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded transition-colors inline-flex items-center gap-1",
                  scope === "firm" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Users className="size-3" />
                Entire firm
              </button>
            </div>
          )}
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
                        label="Expiration"
                        value={leaseFilters.expirationWindow}
                        options={EXPIRATION_WINDOW_OPTIONS}
                        onChange={(v) => updateLeaseFilter("expirationWindow", v)}
                      />
                      <FilterSelect
                        label="Tenant contact"
                        value={leaseFilters.hasTenantContact}
                        options={HAS_TENANT_CONTACT_OPTIONS}
                        onChange={(v) => updateLeaseFilter("hasTenantContact", v)}
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
                        {leases.length > 0 && (
                          <a
                            href={leasesExportHref(leases.map((l) => l.id))}
                            download="beacon-leases-page.xlsx"
                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title={`This page only (${leases.length} rows) — not the full filtered set if paginated`}
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
                        <ColVisPopover isVis={leaseColVis.isVis} toggle={leaseColVis.toggle} colDefs={LEASE_COL_DEFS} />
                      </div>
                    </>
                  )}
                  {tab === "properties" && (
                    <>
                      <FilterSelect label="Type" value={propFilters.propType} options={PROP_TYPES} onChange={(v) => updatePropFilter("propType", v)} />
                      <FilterSelect label="Ownership" value={propFilters.ownership} options={OWNERSHIP_INDIVIDUAL_ENTITY} onChange={(v) => updatePropFilter("ownership", v)} />
                      <FilterSelect label="Ownership change" value={propFilters.ownershipChange} options={OWNERSHIP_CHANGE_OPTIONS} onChange={(v) => updatePropFilter("ownershipChange", v)} />
                      <FilterSelect label="Last sale" value={propFilters.saleRecency} options={SALE_RECENCY_OPTIONS} onChange={(v) => updatePropFilter("saleRecency", v)} />
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
                      <div className="flex items-center rounded-md border border-border p-0.5 text-xs">
                        {(["", "owner", "tenant"] as const).map((v) => (
                          <button
                            key={v || "all"}
                            type="button"
                            onClick={() => updateConFilter("contactType", v)}
                            className={cn(
                              "px-2.5 py-1 rounded",
                              (conFilters.contactType || "") === v
                                ? "bg-foreground text-background font-semibold"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {v === "" ? "All contacts" : v === "owner" ? "Owners book" : "Tenants book"}
                          </button>
                        ))}
                      </div>
                      <FilterSelect label="Tier" value={conFilters.tier} options={[{ value: "1", label: "Tier 1" }, { value: "2", label: "Tier 2" }, { value: "3", label: "Tier 3" }]} onChange={(v) => updateConFilter("tier", v)} />
                      <FilterSelect label="Stage" value={conFilters.status} options={RELATIONSHIP_STAGES} onChange={(v) => updateConFilter("status", v)} />
                      <FilterSelect label="Asset focus" value={conFilters.assetFocus} options={ASSET_FOCUS_OPTIONS} onChange={(v) => updateConFilter("assetFocus", v)} />
                      <FilterSelect label="Cadence" value={conFilters.cadenceStatus} options={CADENCE_STATUS_OPTIONS} onChange={(v) => updateConFilter("cadenceStatus", v)} />
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
                activeFilters={activeSearch ?? pendingSave}
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
                  propContactsReady={propContactsReady}
                  customDefs={customPropertyDefs.filter(isCustomGroup)}
                  colVis={propColVis}
                  onSave={saveProp}
                  onSaveContact={savePropContact}
                  onPromoted={(propertyId, contacts) => {
                    setPropContacts((prev) => {
                      const next = new Map(prev);
                      const existing = next.get(propertyId) ?? [];
                      const byId = new Map(existing.map((c) => [c.id, c]));
                      for (const c of contacts) byId.set(c.id, c);
                      next.set(propertyId, [...byId.values()]);
                      return next;
                    });
                    void loadProperties();
                  }}
                  deletingId={deletingId}
                  onDeleteRequest={handlePropertyDeleteRequest}
                  onDeleteConfirm={handleDeleteConfirm}
                  onDeleteCancel={() => { setDeletingId(null); setDeleteWarning(null); }}
                  deleteWarning={deleteWarning}
                  selectedIds={selectedPropIds}
                  onToggle={togglePropSelection}
                  onToggleAll={toggleAllProps}
                  totalInDb={totalProps ?? undefined}
                  ownerName={ownerName}
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
                  ownerName={ownerName}
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
                  ownerName={ownerName}
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
            (tab === "contacts" ? "contact" : tab === "leases" ? "lease" : "property") as EntityType
          }
          onClose={() => setShowFieldsPanel(false)}
        />
      )}
    </div>
  );
}
