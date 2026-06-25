"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getFieldDefinitions, createFieldDefinition, deleteFieldDefinition } from "./actions";
import type { FieldDefinition, EntityType, FieldType } from "@/lib/custom-fields";

// ─── Tab config ───────────────────────────────────────────────────────────────

type TabEntity = EntityType;

const TABS: { key: TabEntity; label: string }[] = [
  { key: "property", label: "Property" },
  { key: "lease",    label: "Lease" },
  { key: "contact",  label: "Contact" },
];

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text:   "Text",
  number: "Number",
  date:   "Date",
  select: "Select",
};

// ─── Add-field form ───────────────────────────────────────────────────────────

function AddFieldForm({
  entityType,
  onCreated,
}: {
  entityType: TabEntity;
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
      <Button variant="outline" size="sm" onClick={() => setShowForm(true)} className="w-full">
        <Plus className="size-3.5" />
        Add field
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border p-4 space-y-3 bg-muted/20">
      <p className="text-sm font-medium">New custom field</p>

      <div className="space-y-1.5">
        <Label htmlFor="field_name">Field name</Label>
        <Input id="field_name" name="field_name" placeholder="e.g. Cap Rate" required disabled={isPending} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="field_type">Type</Label>
        <select
          id="field_type"
          name="field_type"
          value={fieldType}
          onChange={e => setFieldType(e.target.value as FieldType)}
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
          <Label htmlFor="select_options">Options</Label>
          <Input
            id="select_options"
            name="select_options"
            placeholder="Option A, Option B, Option C"
            disabled={isPending}
          />
          <p className="text-xs text-muted-foreground">Comma-separated list of choices.</p>
        </div>
      )}

      {entityType === "property" && (
        <div className="space-y-1.5">
          <Label htmlFor="fill_mode">Fill mode</Label>
          <select
            id="fill_mode"
            name="fill_mode"
            required
            disabled={isPending}
            className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background"
          >
            <option value="">— Choose —</option>
            <option value="extract">Extract — Claude pulls it from the source</option>
            <option value="manual">Manual — broker fills it in</option>
          </select>
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

function FieldRow({
  field,
  onDeleted,
}: {
  field: FieldDefinition;
  onDeleted: () => void;
}) {
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CustomFieldsPage() {
  const [tab, setTab] = useState<TabEntity>("property");
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFields = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getFieldDefinitions();
      setFields(all);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFields(); }, [loadFields]);

  const tabFields = fields.filter(f => f.entity_type === tab);

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Custom fields</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add fields to properties, leases, and contacts beyond the built-in defaults.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border border-border rounded-lg p-1 w-fit">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {TABS.find(t => t.key === tab)?.label} fields
          </CardTitle>
          {tab === "property" && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Extract fields — Claude pulls the value from the source record.
              Manual fields — the broker fills them in when saving a property.
            </p>
          )}
          {tab === "lease" && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Claude extracts these fields from the lease PDF automatically.
            </p>
          )}
          {tab === "contact" && (
            <p className="text-xs text-muted-foreground mt-0.5">
              These fields appear on the Add Contact form for manual input.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : tabFields.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No custom fields yet.</p>
          ) : (
            <div>
              {tabFields.map(f => (
                <FieldRow key={f.id} field={f} onDeleted={loadFields} />
              ))}
            </div>
          )}

          <AddFieldForm entityType={tab} onCreated={loadFields} />
        </CardContent>
      </Card>
    </div>
  );
}
