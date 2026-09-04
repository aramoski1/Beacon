"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Settings2, Warehouse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomFieldsPanel } from "@/components/custom-fields-panel";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";
import {
  AVAILABILITY_STATUS,
  LEASE_STRUCTURES,
  POWER_PHASES,
  SPRINKLER_TYPES,
  industrialSuffix,
} from "@/lib/industrial-fields";
import { parseNumericSpec } from "@/lib/industrial-extract";
import { saveIndustrialSpec } from "./actions";

function labeledOptions(
  slug: string,
  selectOptions: string[] | null,
): { value: string; label: string }[] {
  const catalogs: Record<string, readonly { value: string; label: string }[]> = {
    phase: POWER_PHASES,
    power_phase: POWER_PHASES,
    sprinkler: SPRINKLER_TYPES,
    sprinkler_type: SPRINKLER_TYPES,
    availability: AVAILABILITY_STATUS,
    availability_status: AVAILABILITY_STATUS,
    lease_structure: LEASE_STRUCTURES,
  };
  if (catalogs[slug]) return [...catalogs[slug]];
  return (selectOptions ?? []).map((o) => ({ value: o, label: o }));
}

function NumField({
  value,
  onSave,
  suffix,
}: {
  value: number | null;
  onSave: (v: number | null) => void;
  suffix?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  function commit() {
    setEditing(false);
    const n = draft.trim() === "" ? null : Number(draft.replace(/,/g, ""));
    const next = n != null && !Number.isNaN(n) ? n : null;
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
          if (e.key === "Escape") { setDraft(value != null ? String(value) : ""); setEditing(false); }
        }}
        className="text-sm font-medium px-1.5 py-0.5 -mx-1.5 border rounded outline-none focus:ring-1 ring-ring w-full bg-background"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(value != null ? String(value) : ""); setEditing(true); }}
      className="font-medium mt-0.5 text-left rounded px-1.5 py-0.5 -mx-1.5 hover:bg-muted/60 w-full"
    >
      {value != null ? (
        <>{value.toLocaleString()}{suffix ? <span className="text-muted-foreground font-normal"> {suffix}</span> : null}</>
      ) : (
        <span className="text-muted-foreground/50 font-normal italic">Click to add</span>
      )}
    </button>
  );
}

function TextField({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
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
        className="text-sm font-medium px-1.5 py-0.5 -mx-1.5 border rounded outline-none focus:ring-1 ring-ring w-full bg-background"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => { setDraft(value ?? ""); setEditing(true); }}
      className="font-medium mt-0.5 text-left rounded px-1.5 py-0.5 -mx-1.5 hover:bg-muted/60 w-full truncate"
    >
      {value ?? <span className="text-muted-foreground/50 font-normal italic">Click to add</span>}
    </button>
  );
}

function SelectField({
  value, options, onSave,
}: {
  value: string | null;
  options: { value: string; label: string }[];
  onSave: (v: string | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onSave(e.target.value || null)}
      className="font-medium mt-0.5 rounded px-1.5 py-0.5 -mx-1.5 hover:bg-muted/60 w-full bg-transparent outline-none cursor-pointer text-sm"
    >
      <option value="">Click to set</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function DateField({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
  return (
    <input
      type="date"
      value={value ?? ""}
      onChange={(e) => onSave(e.target.value || null)}
      className="font-medium mt-0.5 rounded px-1.5 py-0.5 -mx-1.5 hover:bg-muted/60 w-full bg-transparent outline-none cursor-pointer text-sm"
    />
  );
}

export function IndustrialSection({
  propertyId,
  defs,
  values,
}: {
  propertyId: string;
  defs: FieldDefinition[];
  values: Record<string, string | number | null>;
}) {
  const router = useRouter();
  const [local, setLocal] = useState(values);
  const [customize, setCustomize] = useState(false);
  const filled = defs.filter((def) => {
    const raw = local[fieldSlug(def.field_name)];
    return raw != null && raw !== "";
  }).length;
  const showListingCta = defs.length > 0 && filled <= 1;

  async function save(slug: string, value: string | number | null) {
    setLocal((prev) => ({ ...prev, [slug]: value }));
    const result = await saveIndustrialSpec(propertyId, slug, value);
    if (result.error) {
      window.alert(`Failed to save: ${result.error}`);
      setLocal((prev) => ({ ...prev, [slug]: values[slug] ?? null }));
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Warehouse className="size-4" />
              Industrial / flex specs
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Defaults can be removed. Add any spec you track.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCustomize(true)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <Settings2 className="size-3.5" />
            Customize
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {defs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No specs configured. Use the gear to add fields.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {defs.map((def) => {
              const slug = fieldSlug(def.field_name);
              const raw = local[slug];
              return (
                <div key={def.id}>
                  <dt className="text-xs text-muted-foreground">{def.field_name}</dt>
                  <dd>
                    {def.field_type === "number" ? (
                      <NumField
                        value={parseNumericSpec(raw)}
                        suffix={industrialSuffix(slug)}
                        onSave={(v) => save(slug, v)}
                      />
                    ) : def.field_type === "select" ? (
                      <SelectField
                        value={raw != null ? String(raw) : null}
                        options={labeledOptions(slug, def.select_options)}
                        onSave={(v) => save(slug, v)}
                      />
                    ) : def.field_type === "date" ? (
                      <DateField
                        value={raw != null ? String(raw) : null}
                        onSave={(v) => save(slug, v)}
                      />
                    ) : (
                      <TextField
                        value={raw != null ? String(raw) : null}
                        onSave={(v) => save(slug, v)}
                      />
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        {showListingCta && (
          <p className="mt-4 text-xs text-muted-foreground">
            County records do not include docks or clear height.{" "}
            <a
              href="#enrich-listing"
              className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2 hover:text-primary"
            >
              <Search className="size-3" />
              Find listing specs
            </a>
          </p>
        )}
      </CardContent>
      {customize && (
        <CustomFieldsPanel
          entityType="property"
          fieldGroup="industrial"
          onClose={() => {
            setCustomize(false);
            router.refresh();
          }}
        />
      )}
    </Card>
  );
}
