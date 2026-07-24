"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { X, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  getFieldDefinitions,
  createFieldDefinition,
  deleteFieldDefinition,
} from "@/app/settings/fields/actions";
import type { FieldDefinition, EntityType, FieldType } from "@/lib/custom-fields";

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text:   "Text",
  number: "Number",
  date:   "Date",
  select: "Select",
};

const ENTITY_LABELS: Record<EntityType, string> = {
  property: "Property",
  contact:  "Contact",
  lease:    "Lease",
};

const ENTITY_HINTS: Record<EntityType, string> = {
  property: "Extract fields — Claude pulls values from a matched county record, an uploaded flyer/OM, pasted listing text, or a listing URL (never typed in manually). Manual fields — the broker fills them in.",
  contact:  "These fields appear on the Add Contact form for manual input.",
  lease:    "Claude extracts these fields from the lease PDF automatically.",
};

// ─── Add-field form ───────────────────────────────────────────────────────────

function AddFieldForm({
  entityType,
  onCreated,
}: {
  entityType: EntityType;
  onCreated: () => void;
}) {
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
      <Button variant="outline" size="sm" onClick={() => setShowForm(true)} className="w-full mt-2">
        <Plus className="size-3.5" />
        Add field
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border p-4 space-y-3 bg-muted/20 mt-2">
      <p className="text-sm font-medium">New custom field</p>

      <div className="space-y-1.5">
        <Label htmlFor="cfp-field_name">Field name</Label>
        <Input
          id="cfp-field_name"
          name="field_name"
          placeholder="e.g. Cap Rate"
          required
          disabled={isPending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cfp-field_type">Type</Label>
        <select
          id="cfp-field_type"
          name="field_type"
          value={fieldType}
          onChange={(e) => setFieldType(e.target.value as FieldType)}
          disabled={isPending}
          className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background"
        >
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="date">Date</option>
          <option value="select">Select (dropdown)</option>
        </select>
      </div>

      {fieldType === "select" && (
        <div className="space-y-1.5">
          <Label htmlFor="cfp-select_options">Options</Label>
          <Input
            id="cfp-select_options"
            name="select_options"
            placeholder="Option A, Option B, Option C"
            disabled={isPending}
          />
          <p className="text-xs text-muted-foreground">Comma-separated list of choices.</p>
        </div>
      )}

      {entityType === "property" && (
        <div className="space-y-1.5">
          <Label htmlFor="cfp-fill_mode">Fill mode</Label>
          <select
            id="cfp-fill_mode"
            name="fill_mode"
            required
            disabled={isPending}
            className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background"
          >
            <option value="">— Choose —</option>
            <option value="extract">Extract — Claude pulls it from the source</option>
            <option value="manual">Manual — broker fills it in</option>
          </select>
          <p className="text-xs text-muted-foreground">
            Extract fields populate from a county record match, an uploaded document, pasted text,
            or a listing URL on the property page — not from typing.
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending} size="sm">
          {isPending ? <Loader2 className="animate-spin" /> : <Plus className="size-3.5" />}
          Add
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => { setShowForm(false); setError(null); }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Field row ────────────────────────────────────────────────────────────────

function FieldRow({ field, onDeleted }: { field: FieldDefinition; onDeleted: () => void }) {
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
          <Badge variant="outline" className="text-xs py-0">
            {FIELD_TYPE_LABELS[field.field_type]}
          </Badge>
          {field.fill_mode && (
            <Badge variant="secondary" className="text-xs py-0 capitalize">
              {field.fill_mode}
            </Badge>
          )}
          {field.select_options?.length ? (
            <span className="text-xs text-muted-foreground">
              {field.select_options.join(", ")}
            </span>
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

// ─── Panel ────────────────────────────────────────────────────────────────────

export function CustomFieldsPanel({
  entityType,
  onClose,
}: {
  entityType: EntityType;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFields = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getFieldDefinitions();
      setFields(all.filter((f) => f.entity_type === entityType));
    } finally {
      setLoading(false);
    }
  }, [entityType]);

  useEffect(() => { loadFields(); }, [loadFields]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="relative z-10 h-full w-full max-w-sm bg-background border-l shadow-xl flex flex-col">
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b shrink-0">
          <div>
            <h2 className="text-sm font-semibold">{ENTITY_LABELS[entityType]} — Custom fields</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{ENTITY_HINTS[entityType]}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : fields.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No custom fields yet.</p>
          ) : (
            <div>
              {fields.map((f) => (
                <FieldRow key={f.id} field={f} onDeleted={loadFields} />
              ))}
            </div>
          )}
          <AddFieldForm entityType={entityType} onCreated={loadFields} />
        </div>
      </div>
    </div>
  );
}
