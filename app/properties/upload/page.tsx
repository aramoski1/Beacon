"use client";

import { FormEvent, useRef, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Upload,
  ClipboardPaste,
  CheckCircle2,
  AlertTriangle,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  File,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ingestUpload, saveIngestedUpload, type UploadPreview } from "./actions";
import { createClient } from "@/lib/supabase/client";
import { fetchFieldDefs, fieldSlug, type FieldDefinition } from "@/lib/custom-fields";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACCEPTED = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.csv,.xlsx,.xls,.txt";

function fmt(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}
function fmtCurrency(n: number | null) {
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-US");
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf")                                   return <FileText className="size-5 text-red-500" />;
  if (["xlsx", "xls", "csv"].includes(ext ?? ""))     return <FileSpreadsheet className="size-5 text-green-600" />;
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext ?? "")) return <ImageIcon className="size-5 text-blue-500" />;
  return <File className="size-5 text-muted-foreground" />;
}

// ─── Preview card (same pattern as other ingestion flows) ────────────────────

function Field({
  label,
  value,
  flagged,
}: {
  label: string;
  value: string;
  flagged?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium flex items-center gap-1">
        {value}
        {flagged && <AlertTriangle className="size-3 text-yellow-500 shrink-0" />}
      </dd>
    </div>
  );
}

function UploadPreviewCard({
  preview,
  onSave,
  onDiscard,
  saving,
}: {
  preview: UploadPreview;
  onSave: (merged: UploadPreview) => void;
  onDiscard: () => void;
  saving: boolean;
}) {
  const [customDefs, setCustomDefs] = useState<FieldDefinition[]>([]);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const supabase = createClient();
    fetchFieldDefs(supabase, "property").then(setCustomDefs);
  }, []);

  const extractDefs = customDefs.filter(f => f.fill_mode === "extract");
  const manualDefs  = customDefs.filter(f => f.fill_mode === "manual");

  function handleSaveClick() {
    const merged: UploadPreview = {
      ...preview,
      custom_fields: {
        ...(preview.custom_fields ?? {}),
        ...Object.fromEntries(
          manualDefs.map(f => {
            const slug = fieldSlug(f.field_name);
            const raw  = manualValues[slug] ?? "";
            return [slug, raw === "" ? null : f.field_type === "number" ? Number(raw) : raw];
          })
        ),
      },
    };
    onSave(merged);
  }

  const flags = new Set(preview.confidence_flags.map((f) => f.field));
  const bc = preview.building_composition;

  const buildingSummary = [
    bc?.year_built       ? `Built ${bc.year_built}`                                     : null,
    bc?.stories   != null ? `${bc.stories} stor${bc.stories === 1 ? "y" : "ies"}`      : null,
    bc?.units     != null ? `${bc.units} units`                                          : null,
    bc?.lot_size_sqft != null ? `${fmt(bc.lot_size_sqft)} sf lot`                       : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 text-green-500 shrink-0" />
        Extracted from{" "}
        <span className="font-medium text-foreground">{preview.fileName}</span> — review
        before saving.
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-lg">
                {preview.address ?? (
                  <span className="text-muted-foreground italic">Address not found</span>
                )}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                {[preview.city, preview.submarket].filter(Boolean).join(" · ") ||
                  "Unknown location"}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {preview.property_type && (
                <Badge variant="secondary" className="capitalize">
                  {preview.property_type}
                </Badge>
              )}
              <Badge variant="outline">{preview.sourceLabel}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {preview.confidence_flags.length > 0 && (
            <div className="rounded-md border border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-400">
              ⚠{" "}
              {preview.confidence_flags.length} field
              {preview.confidence_flags.length > 1 ? "s" : ""} flagged low-confidence —
              verify after saving.
              <ul className="mt-1 space-y-0.5 list-disc list-inside">
                {preview.confidence_flags.map((f, i) => (
                  <li key={i}>
                    <span className="font-mono">{f.field}</span> — {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Field
              label="Owner"
              value={preview.owner_name ?? "—"}
              flagged={flags.has("owner_name")}
            />
            <Field
              label="Ownership type"
              value={preview.ownership_type}
              flagged={flags.has("ownership_type")}
            />
            <Field
              label="Property type"
              value={preview.property_type}
              flagged={flags.has("property_type")}
            />
            <Field
              label="Building area"
              value={preview.size_sqft != null ? `${fmt(preview.size_sqft)} sqft` : "—"}
              flagged={flags.has("size_sqft")}
            />
            <Field
              label="Last sale date"
              value={fmtDate(preview.last_sale_date)}
              flagged={flags.has("last_sale_date")}
            />
            <Field
              label="Last sale price"
              value={fmtCurrency(preview.last_sale_price)}
              flagged={flags.has("last_sale_price")}
            />
          </dl>

          {buildingSummary && (
            <div className="border-t pt-3">
              <p className="text-xs text-muted-foreground mb-1">Building</p>
              <p className="text-sm">{buildingSummary}</p>
            </div>
          )}

          {/* Custom fields */}
          {(extractDefs.length > 0 || manualDefs.length > 0) && (
            <div className="border-t pt-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom fields</p>
              {extractDefs.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                  {extractDefs.map(f => {
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
              )}
              {manualDefs.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {manualDefs.map(f => {
                    const slug = fieldSlug(f.field_name);
                    return (
                      <div key={f.id} className="space-y-1.5">
                        <Label htmlFor={`cf_${slug}`}>{f.field_name}</Label>
                        {f.field_type === "select" && f.select_options?.length ? (
                          <select
                            id={`cf_${slug}`}
                            value={manualValues[slug] ?? ""}
                            onChange={e => setManualValues(v => ({ ...v, [slug]: e.target.value }))}
                            disabled={saving}
                            className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background"
                          >
                            <option value="">— Select —</option>
                            {f.select_options.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <Input
                            id={`cf_${slug}`}
                            type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
                            value={manualValues[slug] ?? ""}
                            onChange={e => setManualValues(v => ({ ...v, [slug]: e.target.value }))}
                            disabled={saving}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      <div className="flex gap-3">
        <Button onClick={handleSaveClick} disabled={saving} className="flex-1">
          {saving ? (
            <>
              <Loader2 className="animate-spin" />
              Saving…
            </>
          ) : (
            "Save to database"
          )}
        </Button>
        <Button variant="outline" onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UploadPropertyPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview]         = useState<UploadPreview | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [mode, setMode]               = useState<"file" | "paste">("file");
  const [dragOver, setDragOver]       = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isPending, startTransition]  = useTransition();

  function buildFormData(file?: File, paste?: string) {
    const fd = new FormData();
    if (file)  fd.set("file", file);
    if (paste) fd.set("paste", paste);
    return fd;
  }

  function handleFileChange(file: File) {
    setSelectedFile(file);
    setError(null);
    startTransition(async () => {
      const result = await ingestUpload(buildFormData(file));
      if ("error" in result) setError(result.error);
      else setPreview(result.preview);
    });
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileChange(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileChange(file);
  }

  function handlePasteSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await ingestUpload(fd);
      if ("error" in result) setError(result.error);
      else setPreview(result.preview);
    });
  }

  function handleSave(mergedPreview: UploadPreview) {
    setError(null);
    startTransition(async () => {
      const result = await saveIngestedUpload(mergedPreview);
      if ("error" in result) setError(result.error);
      else router.push(`/properties/${result.id}`);
    });
  }

  function handleDiscard() {
    setPreview(null);
    setError(null);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Upload a property</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Any file format — PDF, spreadsheet, image, CSV — or paste property details directly.
          Claude extracts the fields; you review before saving.
        </p>
      </div>

      {!preview && (
        <>
          {/* Mode toggle */}
          <div className="flex gap-1 border border-border rounded-lg p-1 w-fit">
            <button
              onClick={() => { setMode("file"); setError(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mode === "file"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Upload className="size-3.5" />
              Upload file
            </button>
            <button
              onClick={() => { setMode("paste"); setError(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mode === "paste"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ClipboardPaste className="size-3.5" />
              Paste text
            </button>
          </div>

          {/* File upload */}
          {mode === "file" && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => !isPending && fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
                  isPending
                    ? "border-border bg-muted cursor-not-allowed"
                    : dragOver
                    ? "border-primary/60 bg-primary/5 cursor-copy"
                    : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/60 cursor-pointer"
                }`}
              >
                {isPending ? (
                  <>
                    <Loader2 className="size-8 text-muted-foreground animate-spin" />
                    <div>
                      <p className="font-medium text-sm">Extracting fields…</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        This usually takes 10–30 seconds
                      </p>
                    </div>
                  </>
                ) : selectedFile ? (
                  <>
                    {fileIcon(selectedFile.name)}
                    <div>
                      <p className="font-medium text-sm">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Click to choose a different file
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Upload className="size-8 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">Drop a file or click to browse</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        PDF · Excel (.xlsx) · CSV · Image (PNG, JPG, WebP) · Text
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">Max 32 MB</p>
                    </div>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED}
                  disabled={isPending}
                  className="hidden"
                  onChange={handleInputChange}
                />
              </div>

              {error && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}

          {/* Paste text */}
          {mode === "paste" && (
            <form onSubmit={handlePasteSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Property details</label>
                <textarea
                  name="paste"
                  rows={12}
                  required
                  disabled={isPending}
                  placeholder={`Paste any property information here — listing description, tax record, CoStar export row, notes, etc.\n\nExample:\n200 S Biscayne Blvd, Miami FL 33131\nOwner: Acme Holdings LLC\n45,000 SF office, built 1998\nLast sale: $12,500,000 (March 2022)`}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background resize-y placeholder:text-muted-foreground/60 disabled:opacity-60"
                />
                <p className="text-xs text-muted-foreground">
                  Include the address, owner name, and property type for best results.
                </p>
              </div>

              {error && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Extracting…
                  </>
                ) : (
                  <>
                    <ClipboardPaste />
                    Extract fields
                  </>
                )}
              </Button>
            </form>
          )}
        </>
      )}

      {preview && (
        <>
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <UploadPreviewCard
            preview={preview}
            onSave={handleSave}
            onDiscard={handleDiscard}
            saving={isPending}
          />
        </>
      )}
    </div>
  );
}
