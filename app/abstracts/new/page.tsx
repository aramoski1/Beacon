"use client";

import { useTransition, useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  FileText,
  Upload,
  CheckCircle2,
  CalendarDays,
  DollarSign,
  TrendingUp,
  Key,
  Building2,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  abstractLease,
  saveAbstractLease,
  getAllPropertiesForPicker,
  type LeasePreview,
  type AbstractResult,
} from "./actions";
import { createClient } from "@/lib/supabase/client";
import { fetchFieldDefs, fieldSlug, type FieldDefinition } from "@/lib/custom-fields";
import { BatchUpload } from "./batch-upload";
import { cn } from "@/lib/utils";

// ─── Preview helpers ──────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function optionVariant(type: string): "default" | "secondary" | "outline" {
  if (type === "renewal") return "default";
  if (type === "termination") return "secondary";
  return "outline";
}

// ─── Property picker ──────────────────────────────────────────────────────────

type PropertyOption = { id: string; address: string; city: string | null };

function PropertyPicker({
  value,
  label,
  onChange,
  initialSearch,
}: {
  value: string | null;
  label: string | null;
  onChange: (id: string | null, label: string | null) => void;
  initialSearch?: string | null;
}) {
  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getAllPropertiesForPicker().then((props) => {
      setAllProperties(props);
      setLoading(false);
      // Auto-select when the lease's extracted address matches a property
      if (initialSearch && !value) {
        const q = initialSearch.toLowerCase();
        const match = props.find((p) => p.address.toLowerCase().includes(q));
        if (match) {
          onChange(match.id, match.address + (match.city ? `, ${match.city}` : ""));
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = query.trim()
    ? allProperties.filter((p) =>
        (p.address + (p.city ? ` ${p.city}` : "")).toLowerCase().includes(query.toLowerCase())
      )
    : allProperties;

  if (value && label) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
        <Building2 className="size-4 text-primary shrink-0" />
        <span className="text-sm font-medium flex-1 min-w-0 truncate">{label}</span>
        <button
          type="button"
          onClick={() => onChange(null, null)}
          className="text-muted-foreground hover:text-foreground shrink-0"
          title="Clear"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={loading ? "Loading properties…" : `Search ${allProperties.length} properties…`}
          disabled={loading}
          className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-md outline-none focus:ring-2 ring-ring bg-background placeholder:text-muted-foreground/60 disabled:opacity-60"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />
        )}
      </div>
      {open && !loading && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-background shadow-lg overflow-y-auto max-h-56">
          {filtered.length > 0 ? filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(r.id, r.address + (r.city ? `, ${r.city}` : ""));
                setQuery("");
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors flex items-center gap-2"
            >
              <Building2 className="size-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{r.address}{r.city ? `, ${r.city}` : ""}</span>
            </button>
          )) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No properties match &ldquo;{query}&rdquo;
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Preview card ─────────────────────────────────────────────────────────────

function LeasePreviewCard({
  preview,
  fileName,
  linkedPropertyId,
  linkedPropertyLabel,
  onPropertyChange,
  onSave,
  onDiscard,
  saving,
}: {
  preview: LeasePreview;
  fileName: string;
  linkedPropertyId: string | null;
  linkedPropertyLabel: string | null;
  onPropertyChange: (id: string | null, label: string | null) => void;
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
}) {
  const [customDefs, setCustomDefs] = useState<FieldDefinition[]>([]);

  useEffect(() => {
    const supabase = createClient();
    fetchFieldDefs(supabase, "lease").then(setCustomDefs);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 text-green-500 shrink-0" />
        Extracted from <span className="font-medium text-foreground">{fileName}</span> — review before saving.
      </div>

      {/* Summary card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="size-4" />
            Lease summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground flex items-center gap-1">
                <CalendarDays className="size-3" /> Execution
              </dt>
              <dd className="text-sm font-medium mt-0.5">{formatDate(preview.execution_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground flex items-center gap-1">
                <CalendarDays className="size-3" /> Expiration
              </dt>
              <dd className="text-sm font-medium mt-0.5">{formatDate(preview.expiration_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Term</dt>
              <dd className="text-sm font-medium mt-0.5">{preview.term ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground flex items-center gap-1">
                <DollarSign className="size-3" /> Base rate
              </dt>
              <dd className="text-sm font-medium mt-0.5">
                {preview.base_rate != null ? `$${preview.base_rate}/sqft` : "—"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Escalations */}
      {preview.escalations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="size-4" /> Escalations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {preview.escalations.map((e, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-muted-foreground shrink-0">·</span>
                  <span>{e.description} — <span className="font-medium">{e.rate}</span>
                    {e.effective_date && <span className="text-muted-foreground"> (effective {e.effective_date})</span>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Options */}
      {preview.options.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Options</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {preview.options.map((o, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <Badge variant={optionVariant(o.type)} className="capitalize text-xs shrink-0 mt-0.5">
                    {o.type}
                  </Badge>
                  <span>
                    {o.description}
                    {o.notice_period && (
                      <span className="text-muted-foreground"> · {o.notice_period} notice</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Key provisions */}
      {preview.key_provisions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Key className="size-4" /> Key provisions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {preview.key_provisions.slice(0, 5).map((kp, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-muted-foreground shrink-0">·</span>
                  <span>
                    {kp.provision}
                    {kp.citation && (
                      <span className="ml-1 text-xs text-muted-foreground font-mono">{kp.citation}</span>
                    )}
                  </span>
                </li>
              ))}
              {preview.key_provisions.length > 5 && (
                <li className="text-xs text-muted-foreground">
                  + {preview.key_provisions.length - 5} more provisions after saving
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Custom fields extracted from lease */}
      {customDefs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Custom fields</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              {customDefs.map(f => {
                const slug = fieldSlug(f.field_name);
                const val  = preview.custom_fields?.[slug];
                return (
                  <div key={f.id} className="space-y-0.5">
                    <dt className="text-xs text-muted-foreground">{f.field_name}</dt>
                    <dd className="text-sm font-medium">
                      {val != null ? String(val) : <span className="text-muted-foreground/50">—</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Property link — required before saving */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Building2 className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium">
            Link to property <span className="text-destructive">*</span>
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Required — without a property, Lease radar can&apos;t track this expiration.
        </p>
        <PropertyPicker
          value={linkedPropertyId}
          label={linkedPropertyLabel}
          onChange={onPropertyChange}
          initialSearch={preview.premises_address}
        />
        {!linkedPropertyId && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            This lease isn&apos;t on a property — radar can&apos;t track expiration. Select a property to save.
          </p>
        )}
      </div>

      <Separator />

      <div className="flex gap-3">
        <Button
          onClick={onSave}
          disabled={saving || !linkedPropertyId}
          className="flex-1"
          title={!linkedPropertyId ? "Link a property first" : undefined}
        >
          {saving ? <><Loader2 className="animate-spin" />Saving…</> : "Save to database"}
        </Button>
        <Button variant="outline" onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewAbstractPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [preview, setPreview] = useState<LeasePreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [linkedPropId, setLinkedPropId] = useState<string | null>(null);
  const [linkedPropLabel, setLinkedPropLabel] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setLinkedPropId(null);
    setLinkedPropLabel(null);
    const formData = new FormData();
    formData.set("pdf", file);
    startTransition(async () => {
      const result: AbstractResult = await abstractLease(formData);
      if ("error" in result) setError(result.error);
      else setPreview(result.preview);
    });
  }

  function handleSave() {
    if (!preview || !linkedPropId) return;
    setError(null);
    startTransition(async () => {
      const result = await saveAbstractLease({ ...preview, linked_property: linkedPropId });
      if ("error" in result) setError(result.error);
      else router.push(`/abstracts/${result.id}`);
    });
  }

  function handleDiscard() {
    setPreview(null);
    setError(null);
    setFileName("");
    setLinkedPropId(null);
    setLinkedPropLabel(null);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Lease abstraction</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a lease PDF and Beacon will extract the key fields automatically.
        </p>
      </div>

      {/* Single / Batch toggle — hide when previewing a single file */}
      {!preview && (
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
          {(["single", "batch"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "px-4 py-1.5 text-sm rounded-md transition-colors capitalize",
                mode === m
                  ? "bg-background shadow text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "single" ? "Single" : "Batch"}
            </button>
          ))}
        </div>
      )}

      {/* Batch mode */}
      {mode === "batch" && !preview && <BatchUpload />}

      {/* Single mode — upload zone — shown only when no preview yet */}
      {mode === "single" && !preview && (
        <div className="space-y-4">
          <div
            onClick={() => !isPending && inputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
              isPending
                ? "border-border bg-muted cursor-not-allowed"
                : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/60 cursor-pointer"
            }`}
          >
            {isPending ? (
              <>
                <Loader2 className="size-8 text-muted-foreground animate-spin" />
                <div>
                  <p className="font-medium text-sm">Analyzing lease…</p>
                  <p className="text-xs text-muted-foreground mt-0.5">This usually takes 20–60 seconds</p>
                </div>
              </>
            ) : (
              <>
                <FileText className="size-8 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">Click to select a PDF</p>
                  <p className="text-xs text-muted-foreground mt-0.5">PDF only · max 32 MB</p>
                </div>
              </>
            )}

            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              disabled={isPending}
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}

      {/* Preview */}
      {preview && (
        <>
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <LeasePreviewCard
            preview={preview}
            fileName={fileName}
            linkedPropertyId={linkedPropId}
            linkedPropertyLabel={linkedPropLabel}
            onPropertyChange={(id, label) => {
              setLinkedPropId(id);
              setLinkedPropLabel(label);
            }}
            onSave={handleSave}
            onDiscard={handleDiscard}
            saving={isPending}
          />
        </>
      )}
    </div>
  );
}
