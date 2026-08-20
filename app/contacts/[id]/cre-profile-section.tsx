"use client";

import { useState } from "react";
import { Briefcase } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const OWNERSHIP_ROLE_OPTIONS = [
  { value: "managing_member", label: "Managing Member" },
  { value: "authorized_signer", label: "Authorized Signer" },
  { value: "registered_agent", label: "Registered Agent" },
  { value: "principal", label: "Principal" },
  { value: "other", label: "Other" },
];

const LEAD_SOURCE_OPTIONS = [
  { value: "sunbiz", label: "Sunbiz" },
  { value: "referral", label: "Referral" },
  { value: "cold", label: "Cold" },
  { value: "costar", label: "CoStar" },
  { value: "existing_relationship", label: "Existing relationship" },
  { value: "other", label: "Other" },
];

// ─── Inline-editable primitives (scoped to this section) ─────────────────────

function FieldText({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  function commit() {
    setEditing(false);
    const next = draft.trim() || null;
    if (next !== value) onSave(next);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); }
        }}
        className="text-sm font-medium px-1.5 py-0.5 -mx-1.5 border border-border rounded outline-none focus:ring-1 ring-ring w-full bg-background"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(value ?? ""); setEditing(true); }}
      className="font-medium mt-0.5 text-left rounded px-1.5 py-0.5 -mx-1.5 hover:bg-muted/60 transition-colors w-full truncate"
    >
      {value ?? <span className="text-muted-foreground/50 font-normal italic">Click to add</span>}
    </button>
  );
}

function FieldSelect({
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
      className={cn(
        "font-medium mt-0.5 rounded px-1.5 py-0.5 -mx-1.5 hover:bg-muted/60 transition-colors w-full bg-transparent outline-none cursor-pointer",
        !value && "text-muted-foreground/50 font-normal italic",
      )}
    >
      <option value="">Click to set</option>
      {options.map((o) => (
        <option key={o.value} value={o.value} className="text-foreground not-italic font-normal">
          {o.label}
        </option>
      ))}
    </select>
  );
}

function FieldTags({
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
    <div className="flex flex-wrap gap-1.5 items-center">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
        >
          {tag}
          <button
            type="button"
            onClick={() => remove(tag)}
            className="text-muted-foreground hover:text-foreground leading-none"
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
          className="text-xs px-2 py-0.5 border border-border rounded-full outline-none focus:ring-1 ring-ring w-28 bg-background"
          placeholder="e.g. industrial"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-muted-foreground hover:text-foreground text-xs rounded-full border border-dashed px-2.5 py-0.5 hover:border-foreground transition-colors"
        >
          + Add
        </button>
      )}
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

export type CreProfileValues = {
  ownership_role: string | null;
  submarket: string | null;
  portfolio_size: string | null;
  lead_source: string | null;
  size_category: string | null;
  ownership_type: string | null;
  asset_focus: string[];
};

export function CreProfileSection({
  contactId,
  initial,
}: {
  contactId: string;
  initial: CreProfileValues;
}) {
  const [values, setValues] = useState(initial);

  async function save<K extends keyof CreProfileValues>(field: K, value: CreProfileValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
    const supabase = createClient();
    // RLS is the real gate (own row, or a firm-shared 'team' row per
    // Beacon_Team_Multitenancy_Plan.md §7.6) — no client-side owner_id
    // filter on top, since it would incorrectly reject a legitimate edit
    // to a teammate's shared contact.
    const { error } = await supabase
      .from("contacts")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", contactId);
    if (error) {
      window.alert(`Failed to save: ${error.message}`);
      setValues((prev) => ({ ...prev, [field]: initial[field] }));
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Briefcase className="size-4" />
          CRE profile
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Ownership role</dt>
            <dd>
              <FieldSelect
                value={values.ownership_role}
                options={OWNERSHIP_ROLE_OPTIONS}
                onSave={(v) => save("ownership_role", v)}
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Submarket</dt>
            <dd>
              <FieldText value={values.submarket} onSave={(v) => save("submarket", v)} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Portfolio size</dt>
            <dd>
              <FieldText value={values.portfolio_size} onSave={(v) => save("portfolio_size", v)} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Lead source</dt>
            <dd>
              <FieldSelect
                value={values.lead_source}
                options={LEAD_SOURCE_OPTIONS}
                onSave={(v) => save("lead_source", v)}
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Size category</dt>
            <dd>
              <FieldText value={values.size_category} onSave={(v) => save("size_category", v)} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Ownership type</dt>
            <dd>
              <FieldText value={values.ownership_type} onSave={(v) => save("ownership_type", v)} />
            </dd>
          </div>
        </dl>

        <div>
          <p className="text-xs text-muted-foreground mb-2">Asset focus</p>
          <FieldTags tags={values.asset_focus} onSave={(v) => save("asset_focus", v)} />
        </div>
      </CardContent>
    </Card>
  );
}
