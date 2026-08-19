"use client";

import { useState, useTransition } from "react";
import { Tag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";
import { updateDeal } from "../actions";
import type { DealCustomFields } from "@/lib/deals";

function FieldValueInput({
  field,
  value,
  onSave,
}: {
  field: FieldDefinition;
  value: string | number | null;
  onSave: (v: string | number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed) {
      if (value != null) onSave(null);
      return;
    }
    const next: string | number = field.field_type === "number" ? Number(trimmed) : trimmed;
    if (next !== value) onSave(next);
  }

  if (editing) {
    if (field.field_type === "select" && field.select_options?.length) {
      return (
        <select
          autoFocus
          value={draft}
          onChange={(e) => { setDraft(e.target.value); }}
          onBlur={commit}
          className="text-sm font-medium px-1.5 py-0.5 -mx-1.5 border border-border rounded outline-none focus:ring-1 ring-ring w-full bg-background"
        >
          <option value="">—</option>
          {field.select_options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        autoFocus
        type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setDraft(value != null ? String(value) : ""); setEditing(false); }
        }}
        className="text-sm font-medium px-1.5 py-0.5 -mx-1.5 border border-border rounded outline-none focus:ring-1 ring-ring w-full bg-background"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(value != null ? String(value) : ""); setEditing(true); }}
      className="text-sm font-medium mt-0.5 text-left rounded px-1.5 py-0.5 -mx-1.5 hover:bg-muted/60 transition-colors w-full truncate"
    >
      {value != null ? String(value) : <span className="text-muted-foreground/50 font-normal italic">Click to add</span>}
    </button>
  );
}

export function DealCustomFields({
  dealId,
  fieldDefs,
  initialValues,
}: {
  dealId: string;
  fieldDefs: FieldDefinition[];
  initialValues: DealCustomFields | null;
}) {
  const [values, setValues] = useState<DealCustomFields>(initialValues ?? {});
  const [, startTransition] = useTransition();

  if (fieldDefs.length === 0) return null;

  function handleSave(slug: string, next: string | number | null) {
    const updated = { ...values, [slug]: next };
    setValues(updated);
    startTransition(async () => {
      await updateDeal(dealId, { custom_fields: updated });
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Tag className="size-4" />
          Custom fields
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {fieldDefs.map((f) => {
            const slug = fieldSlug(f.field_name);
            return (
              <div key={f.id} className="space-y-0.5">
                <dt className="text-xs text-muted-foreground">{f.field_name}</dt>
                <dd>
                  <FieldValueInput
                    field={f}
                    value={values[slug] ?? null}
                    onSave={(v) => handleSave(slug, v)}
                  />
                </dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}
