"use client";

import { FormEvent, Suspense, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import {
  Loader2, MapPin, Building2, AlertTriangle, CheckCircle2, ExternalLink, Info,
  ArrowLeft, CheckSquare, Square, Users, Link2, ClipboardPaste, Upload,
  FileText, FileSpreadsheet, Image as ImageIcon, File,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  ingestAddress, ingestChosenFolio, saveIngestedProperty,
  type FolioMatch, type PropertyPreview, type IngestResult,
} from "./actions";
import {
  ingestUrl, ingestPastedContent, saveIngestedUrl,
  type UrlPreview, type UrlIngestResult,
} from "../url/actions";
import {
  ingestUpload, saveIngestedUpload, type UploadPreview,
} from "../upload/actions";
import type { SunbizPerson } from "@/lib/sunbiz-types";
import { createClient } from "@/lib/supabase/client";
import { fetchFieldDefs, fieldSlug, type FieldDefinition } from "@/lib/custom-fields";

// ─── Types ────────────────────────────────────────────────────────────────────

type Method = "address" | "url" | "upload";

type AddressStep =
  | { name: "idle" }
  | { name: "candidates"; matches: FolioMatch[]; originalInput: string }
  | { name: "extracting"; match: FolioMatch }
  | { name: "preview"; preview: PropertyPreview };

// ─── Shared helpers ───────────────────────────────────────────────────────────

const ACCEPTED = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.csv,.xlsx,.xls,.txt";

function fmtN(n: number | null, style?: "currency") {
  if (n == null) return "—";
  if (style === "currency") return `$${n.toLocaleString("en-US")}`;
  return n.toLocaleString("en-US");
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return <FileText className="size-5 text-red-500" />;
  if (["xlsx", "xls", "csv"].includes(ext ?? "")) return <FileSpreadsheet className="size-5 text-green-600" />;
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext ?? "")) return <ImageIcon className="size-5 text-blue-500" />;
  return <File className="size-5 text-muted-foreground" />;
}

function PreviewField({ label, value, flagged }: { label: string; value: string; flagged?: boolean }) {
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

function ManualCustomFields({
  defs, values, saving, onChange,
}: {
  defs: FieldDefinition[];
  values: Record<string, string>;
  saving: boolean;
  onChange: (slug: string, v: string) => void;
}) {
  if (defs.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {defs.map(f => {
        const slug = fieldSlug(f.field_name);
        return (
          <div key={f.id} className="space-y-1.5">
            <Label htmlFor={`cf_${slug}`}>{f.field_name}</Label>
            {f.field_type === "select" && f.select_options?.length ? (
              <select
                id={`cf_${slug}`}
                value={values[slug] ?? ""}
                onChange={e => onChange(slug, e.target.value)}
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
                value={values[slug] ?? ""}
                onChange={e => onChange(slug, e.target.value)}
                disabled={saving}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PreviewFields({ preview: p }: { preview: PropertyPreview | UrlPreview | UploadPreview }) {
  const [customDefs, setCustomDefs] = useState<FieldDefinition[]>([]);
  useEffect(() => {
    const supabase = createClient();
    fetchFieldDefs(supabase, "property").then(setCustomDefs);
  }, []);
  const extractDefs = customDefs.filter(f => f.fill_mode === "extract");
  if (extractDefs.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {extractDefs.map(f => {
        const slug = fieldSlug(f.field_name);
        const val = (p as Record<string, unknown>).custom_fields
          ? ((p as Record<string, unknown>).custom_fields as Record<string, unknown>)?.[slug]
          : undefined;
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
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {msg}
    </p>
  );
}

// ─── Address preview card ─────────────────────────────────────────────────────

function AddressPreviewCard({
  preview, saving, onSave, onDiscard,
}: {
  preview: PropertyPreview;
  saving: boolean;
  onSave: (merged: PropertyPreview, sunbiz: SunbizPerson[]) => void;
  onDiscard: () => void;
}) {
  const [manualDefs, setManualDefs] = useState<FieldDefinition[]>([]);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [selectedSunbiz, setSelectedSunbiz] = useState<Set<number>>(
    () => new Set(preview.sunbiz_result?.persons.map((_, i) => i) ?? [])
  );

  useEffect(() => {
    const supabase = createClient();
    fetchFieldDefs(supabase, "property").then(defs => setManualDefs(defs.filter(f => f.fill_mode === "manual")));
  }, []);

  const flagMap = new Map(preview.confidence_flags.map(f => [f.field, f.reason]));
  const notFoundFlags = preview.confidence_flags.filter(f => f.reason === "not found in source record");
  const uncertainFlags = preview.confidence_flags.filter(f => f.reason !== "not found in source record");
  const bc = preview.building_composition;
  const buildingSummary = [
    bc?.year_built ? `Built ${bc.year_built}` : null,
    bc?.stories != null ? `${bc.stories} stor${bc.stories === 1 ? "y" : "ies"}` : null,
    bc?.lot_size_sqft != null ? `${bc.lot_size_sqft.toLocaleString()} sqft lot` : null,
  ].filter(Boolean).join(" · ");

  function handleSave() {
    const sunbizPersons = (preview.sunbiz_result?.persons ?? []).filter((_, i) => selectedSunbiz.has(i));
    onSave({
      ...preview,
      custom_fields: {
        ...(preview.custom_fields ?? {}),
        ...Object.fromEntries(
          manualDefs.map(f => {
            const slug = fieldSlug(f.field_name);
            const raw = manualValues[slug] ?? "";
            return [slug, raw === "" ? null : f.field_type === "number" ? Number(raw) : raw];
          })
        ),
      },
    }, sunbizPersons);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 px-4 py-3 space-y-1">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="size-4 text-green-500 shrink-0" />
          {preview.county === "broward"
            ? "Structured from Broward County Property Appraiser record."
            : "Structured from Miami-Dade Property Appraiser record."}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground pl-6 flex-wrap">
          <span>Folio: <span className="font-mono text-foreground">{preview.strap}</span></span>
          {preview.county !== "broward" && (
            <>
              <span>·</span>
              <a href="https://www.miamidade.gov/Apps/PA/propertysearch/#/" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground">
                Verify on MDPA <ExternalLink className="size-3" />
              </a>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-lg">{preview.address}</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">{preview.city}</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {preview.property_type && <Badge variant="secondary" className="capitalize">{preview.property_type}</Badge>}
              <Badge variant="outline">Tax roll</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {uncertainFlags.length > 0 && (
            <div className="rounded-md border border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-400">
              <div className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-3.5" />
                {uncertainFlags.length} field{uncertainFlags.length > 1 ? "s" : ""} flagged uncertain — verify before saving.
              </div>
              <ul className="mt-1.5 space-y-0.5 list-disc list-inside">
                {uncertainFlags.map((f, i) => (
                  <li key={i}><span className="font-mono">{f.field}</span> — {f.reason}</li>
                ))}
              </ul>
            </div>
          )}
          {notFoundFlags.length > 0 && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Info className="size-3.5 shrink-0" />
                {notFoundFlags.length} field{notFoundFlags.length > 1 ? "s" : ""} not found in the MDPA source record:{" "}
                {notFoundFlags.map(f => f.field).join(", ")}.
              </div>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <PreviewField label="Owner" value={preview.owner_name ?? "—"} flagged={flagMap.has("owner_name") && flagMap.get("owner_name") !== "not found in source record"} />
            <PreviewField label="Ownership type" value={preview.ownership_type} flagged={flagMap.has("ownership_type") && flagMap.get("ownership_type") !== "not found in source record"} />
            <PreviewField label="Property type" value={preview.property_type} flagged={flagMap.has("property_type") && flagMap.get("property_type") !== "not found in source record"} />
            <PreviewField label="Building area" value={preview.size_sqft != null ? `${fmtN(preview.size_sqft)} sqft` : "—"} flagged={flagMap.has("size_sqft") && flagMap.get("size_sqft") !== "not found in source record"} />
            <PreviewField label="Last sale date" value={fmtDate(preview.last_sale_date)} flagged={flagMap.has("last_sale_date") && flagMap.get("last_sale_date") !== "not found in source record"} />
            <PreviewField label="Last sale price" value={fmtN(preview.last_sale_price, "currency")} flagged={flagMap.has("last_sale_price") && flagMap.get("last_sale_price") !== "not found in source record"} />
          </dl>
          {buildingSummary && (
            <div className="border-t pt-3">
              <p className="text-xs text-muted-foreground mb-1">Building</p>
              <p className="text-sm">{buildingSummary}</p>
            </div>
          )}
          {preview.sunbiz_error && !preview.sunbiz_result && (
            <div className="border-t pt-3">
              <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-400">
                <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                <span><span className="font-medium">Sunbiz auto-lookup: </span>{preview.sunbiz_error} You can still run it manually from the property detail page.</span>
              </div>
            </div>
          )}
          {preview.sunbiz_result && preview.sunbiz_result.persons.length > 0 && (
            <div className="border-t pt-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Users className="size-3.5" />
                Florida Sunbiz — {preview.sunbiz_result.entity_name}
                <span className="ml-1 font-normal normal-case text-muted-foreground/70">
                  · {preview.sunbiz_result.status.charAt(0).toUpperCase() + preview.sunbiz_result.status.slice(1).toLowerCase()}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Select persons to save on the property row. No contact records are created until you promote them from the property page.
              </p>
              <div className="space-y-1.5">
                {preview.sunbiz_result.persons.map((person, i) => (
                  <div key={i}
                    onClick={() => setSelectedSunbiz(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors cursor-pointer ${selectedSunbiz.has(i) ? "border-primary/40 bg-primary/5" : "hover:bg-muted/30"}`}
                  >
                    <span className="shrink-0 mt-0.5">
                      {selectedSunbiz.has(i) ? <CheckSquare className="size-4 text-primary" /> : <Square className="size-4 text-muted-foreground" />}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{person.name}</p>
                      <p className="text-xs text-muted-foreground">{person.title}{person.address ? ` · ${person.address}` : ""}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <PreviewFields preview={preview} />
          {manualDefs.length > 0 && (
            <div className="border-t pt-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom fields</p>
              <ManualCustomFields defs={manualDefs} values={manualValues} saving={saving}
                onChange={(slug, v) => setManualValues(prev => ({ ...prev, [slug]: v }))} />
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />
      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving} className="flex-1">
          {saving ? <><Loader2 className="animate-spin" />Saving…</> : "Save to database"}
        </Button>
        <Button variant="outline" onClick={onDiscard} disabled={saving}>Discard</Button>
      </div>
    </div>
  );
}

// ─── URL preview card ─────────────────────────────────────────────────────────

function UrlPreviewCard({
  preview, saving, onSave, onDiscard,
}: {
  preview: UrlPreview;
  saving: boolean;
  onSave: (merged: UrlPreview) => void;
  onDiscard: () => void;
}) {
  const [manualDefs, setManualDefs] = useState<FieldDefinition[]>([]);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const supabase = createClient();
    fetchFieldDefs(supabase, "property").then(defs => setManualDefs(defs.filter(f => f.fill_mode === "manual")));
  }, []);

  const flags = new Set(preview.confidence_flags.map(f => f.field));
  const bc = preview.building_composition as Record<string, number | null> | null;
  const buildingSummary = [
    bc?.year_built ? `Built ${bc.year_built}` : null,
    bc?.stories != null ? `${bc.stories} stor${bc.stories === 1 ? "y" : "ies"}` : null,
    bc?.units != null ? `${bc.units} units` : null,
  ].filter(Boolean).join(" · ");

  function handleSave() {
    onSave({
      ...preview,
      custom_fields: {
        ...(preview.custom_fields ?? {}),
        ...Object.fromEntries(
          manualDefs.map(f => {
            const slug = fieldSlug(f.field_name);
            const raw = manualValues[slug] ?? "";
            return [slug, raw === "" ? null : f.field_type === "number" ? Number(raw) : raw];
          })
        ),
      },
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 text-green-500 shrink-0" />
        Extracted — review before saving.
      </div>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-lg">
                {preview.address ?? <span className="text-muted-foreground italic">Address not found</span>}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                {[preview.city, preview.submarket].filter(Boolean).join(" · ") || "Unknown location"}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {preview.property_type && <Badge variant="secondary" className="capitalize">{preview.property_type}</Badge>}
              {preview.source_url && preview.source_url !== "manual" && (
                <a href={preview.source_url} target="_blank" rel="noopener noreferrer">
                  <Badge variant="outline" className="hover:bg-muted cursor-pointer">Listing URL ↗</Badge>
                </a>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {preview.confidence_flags.length > 0 && (
            <div className="rounded-md border border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-400">
              ⚠ {preview.confidence_flags.length} field{preview.confidence_flags.length > 1 ? "s" : ""} flagged low-confidence — verify after saving.
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <PreviewField label="Owner" value={preview.owner_name ?? "—"} flagged={flags.has("owner_name")} />
            <PreviewField label="Ownership type" value={preview.ownership_type} flagged={flags.has("ownership_type")} />
            <PreviewField label="Property type" value={preview.property_type} flagged={flags.has("property_type")} />
            <PreviewField label="Building area" value={preview.size_sqft != null ? `${fmtN(preview.size_sqft)} sqft` : "—"} flagged={flags.has("size_sqft")} />
            <PreviewField label="Last sale date" value={fmtDate(preview.last_sale_date)} flagged={flags.has("last_sale_date")} />
            <PreviewField label="Last sale price" value={fmtN(preview.last_sale_price, "currency")} flagged={flags.has("last_sale_price")} />
          </dl>
          {buildingSummary && (
            <div className="border-t pt-3">
              <p className="text-xs text-muted-foreground mb-1">Building</p>
              <p className="text-sm">{buildingSummary}</p>
            </div>
          )}
          <PreviewFields preview={preview} />
          {manualDefs.length > 0 && (
            <div className="border-t pt-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom fields</p>
              <ManualCustomFields defs={manualDefs} values={manualValues} saving={saving}
                onChange={(slug, v) => setManualValues(prev => ({ ...prev, [slug]: v }))} />
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving} className="flex-1">
          {saving ? <><Loader2 className="animate-spin" />Saving…</> : "Save to database"}
        </Button>
        <Button variant="outline" onClick={onDiscard} disabled={saving}>Discard</Button>
      </div>
    </div>
  );
}

// ─── Upload preview card ──────────────────────────────────────────────────────

function UploadPreviewCard({
  preview, saving, onSave, onDiscard,
}: {
  preview: UploadPreview;
  saving: boolean;
  onSave: (merged: UploadPreview) => void;
  onDiscard: () => void;
}) {
  const [manualDefs, setManualDefs] = useState<FieldDefinition[]>([]);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const supabase = createClient();
    fetchFieldDefs(supabase, "property").then(defs => setManualDefs(defs.filter(f => f.fill_mode === "manual")));
  }, []);

  const flags = new Set(preview.confidence_flags.map(f => f.field));
  const bc = preview.building_composition;
  const buildingSummary = [
    bc?.year_built ? `Built ${bc.year_built}` : null,
    bc?.stories != null ? `${bc.stories} stor${bc.stories === 1 ? "y" : "ies"}` : null,
    bc?.units != null ? `${bc.units} units` : null,
    bc?.lot_size_sqft != null ? `${fmtN(bc.lot_size_sqft)} sf lot` : null,
  ].filter(Boolean).join(" · ");

  function handleSave() {
    onSave({
      ...preview,
      custom_fields: {
        ...(preview.custom_fields ?? {}),
        ...Object.fromEntries(
          manualDefs.map(f => {
            const slug = fieldSlug(f.field_name);
            const raw = manualValues[slug] ?? "";
            return [slug, raw === "" ? null : f.field_type === "number" ? Number(raw) : raw];
          })
        ),
      },
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 text-green-500 shrink-0" />
        Extracted from <span className="font-medium text-foreground">{preview.fileName}</span> — review before saving.
      </div>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-lg">
                {preview.address ?? <span className="text-muted-foreground italic">Address not found</span>}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                {[preview.city, preview.submarket].filter(Boolean).join(" · ") || "Unknown location"}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {preview.property_type && <Badge variant="secondary" className="capitalize">{preview.property_type}</Badge>}
              <Badge variant="outline">{preview.sourceLabel}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {preview.confidence_flags.length > 0 && (
            <div className="rounded-md border border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-400">
              ⚠ {preview.confidence_flags.length} field{preview.confidence_flags.length > 1 ? "s" : ""} flagged low-confidence — verify after saving.
              <ul className="mt-1 space-y-0.5 list-disc list-inside">
                {preview.confidence_flags.map((f, i) => (
                  <li key={i}><span className="font-mono">{f.field}</span> — {f.reason}</li>
                ))}
              </ul>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <PreviewField label="Owner" value={preview.owner_name ?? "—"} flagged={flags.has("owner_name")} />
            <PreviewField label="Ownership type" value={preview.ownership_type} flagged={flags.has("ownership_type")} />
            <PreviewField label="Property type" value={preview.property_type} flagged={flags.has("property_type")} />
            <PreviewField label="Building area" value={preview.size_sqft != null ? `${fmtN(preview.size_sqft)} sqft` : "—"} flagged={flags.has("size_sqft")} />
            <PreviewField label="Last sale date" value={fmtDate(preview.last_sale_date)} flagged={flags.has("last_sale_date")} />
            <PreviewField label="Last sale price" value={fmtN(preview.last_sale_price, "currency")} flagged={flags.has("last_sale_price")} />
          </dl>
          {buildingSummary && (
            <div className="border-t pt-3">
              <p className="text-xs text-muted-foreground mb-1">Building</p>
              <p className="text-sm">{buildingSummary}</p>
            </div>
          )}
          <PreviewFields preview={preview} />
          {manualDefs.length > 0 && (
            <div className="border-t pt-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom fields</p>
              <ManualCustomFields defs={manualDefs} values={manualValues} saving={saving}
                onChange={(slug, v) => setManualValues(prev => ({ ...prev, [slug]: v }))} />
            </div>
          )}
        </CardContent>
      </Card>
      <Separator />
      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving} className="flex-1">
          {saving ? <><Loader2 className="animate-spin" />Saving…</> : "Save to database"}
        </Button>
        <Button variant="outline" onClick={onDiscard} disabled={saving}>Discard</Button>
      </div>
    </div>
  );
}

// ─── Method tabs ──────────────────────────────────────────────────────────────

const METHOD_TABS: { id: Method; icon: React.ElementType; label: string }[] = [
  { id: "address", icon: MapPin,  label: "Address lookup" },
  { id: "url",     icon: Link2,   label: "From URL" },
  { id: "upload",  icon: Upload,  label: "Upload file" },
];

// ─── Main inner component (needs useSearchParams → must be inside Suspense) ───

function AddPropertyInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initMethod = (["address", "url", "upload"] as Method[]).includes(
    searchParams.get("method") as Method
  )
    ? (searchParams.get("method") as Method)
    : "address";

  const [method, setMethod] = useState<Method>(initMethod);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // ── Address flow state ────────────────────────────────────────────────────
  const [addrStep, setAddrStep] = useState<AddressStep>({ name: "idle" });

  // ── URL flow state ────────────────────────────────────────────────────────
  const [urlMode, setUrlMode] = useState<"url" | "paste">("url");
  const [urlBlockHint, setUrlBlockHint] = useState<string | null>(null);

  // ── Upload flow state ─────────────────────────────────────────────────────
  const [uploadMode, setUploadMode] = useState<"file" | "paste">("file");
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Preview state (set by any method) ────────────────────────────────────
  const [preview, setPreview] = useState<
    | { type: "address"; data: PropertyPreview }
    | { type: "url"; data: UrlPreview }
    | { type: "upload"; data: UploadPreview }
    | null
  >(null);

  function switchMethod(m: Method) {
    if (m === method) return;
    setMethod(m);
    setError(null);
    setAddrStep({ name: "idle" });
    setUrlBlockHint(null);
  }

  function clearPreview() {
    setPreview(null);
    setError(null);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Address handlers ──────────────────────────────────────────────────────
  function handleAddressSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const originalInput = (formData.get("address") as string) ?? "";
    startTransition(async () => {
      const result = await ingestAddress(formData);
      if ("matches" in result) {
        setAddrStep({ name: "candidates", matches: result.matches, originalInput });
      } else if ("error" in result) {
        setError(result.error);
      } else {
        setPreview({ type: "address", data: result.preview });
      }
    });
  }

  function handleFolioConfirm(match: FolioMatch) {
    setError(null);
    const prevStep = addrStep;
    setAddrStep({ name: "extracting", match });
    startTransition(async () => {
      const fd = new FormData();
      fd.set("strap", match.strap);
      fd.set("siteAddress", match.address);
      fd.set("county", match.county);
      const result = await ingestChosenFolio(fd);
      if ("error" in result) {
        setAddrStep(
          prevStep.name === "candidates"
            ? prevStep
            : { name: "candidates", matches: [match], originalInput: match.address }
        );
        setError(result.error);
      } else if ("preview" in result) {
        setPreview({ type: "address", data: result.preview });
      }
    });
  }

  function handleAddressSave(mergedPreview: PropertyPreview, sunbiz: SunbizPerson[]) {
    setError(null);
    startTransition(async () => {
      const result = await saveIngestedProperty(mergedPreview, sunbiz);
      if ("error" in result) setError(result.error);
      else router.push(`/properties/${result.id}`);
    });
  }

  // ── URL handlers ──────────────────────────────────────────────────────────
  function handleUrlSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setUrlBlockHint(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result: UrlIngestResult = await ingestUrl(formData);
      if ("error" in result) {
        if (result.error === "fetch_failed") {
          setUrlBlockHint(result.detail ?? "Could not fetch the page.");
          setUrlMode("paste");
        } else {
          setError(result.error);
        }
      } else {
        setPreview({ type: "url", data: result.preview });
      }
    });
  }

  function handlePasteUrlSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result: UrlIngestResult = await ingestPastedContent(formData);
      if ("error" in result) setError(result.error as string);
      else setPreview({ type: "url", data: result.preview });
    });
  }

  function handleUrlSave(mergedPreview: UrlPreview) {
    setError(null);
    startTransition(async () => {
      const result = await saveIngestedUrl(mergedPreview);
      if ("error" in result) setError(result.error);
      else router.push(`/properties/${result.id}`);
    });
  }

  // ── Upload handlers ───────────────────────────────────────────────────────
  function handleFileChange(file: File) {
    setSelectedFile(file);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const result = await ingestUpload(fd);
      if ("error" in result) setError(result.error);
      else setPreview({ type: "upload", data: result.preview });
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileChange(file);
  }

  function handlePasteUploadSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await ingestUpload(fd);
      if ("error" in result) setError(result.error);
      else setPreview({ type: "upload", data: result.preview });
    });
  }

  function handleUploadSave(mergedPreview: UploadPreview) {
    setError(null);
    startTransition(async () => {
      const result = await saveIngestedUpload(mergedPreview);
      if ("error" in result) setError(result.error);
      else router.push(`/properties/${result.id}`);
    });
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6 sm:px-6 sm:py-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Add property</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Look up by address, import from a listing URL, or upload a file.
        </p>
      </div>

      {/* Method tabs — hidden while a preview is showing */}
      {!preview && (
        <div className="flex gap-1 border border-border rounded-lg p-1 w-fit">
          {METHOD_TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => switchMethod(id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                method === id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── ADDRESS METHOD ──────────────────────────────────────────────────── */}
      {!preview && method === "address" && (
        <>
          {addrStep.name === "idle" && (
            <form onSubmit={handleAddressSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="address">Street address</Label>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input id="address" name="address" type="text" placeholder="3401 N Miami Ave"
                    autoComplete="off" required disabled={isPending} className="pl-9" />
                </div>
                <p className="text-xs text-muted-foreground">Miami-Dade: street number + name only. Broward: include city (e.g. "200 W Broward Blvd, Fort Lauderdale").</p>
              </div>
              {error && <ErrorBox msg={error} />}
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending
                  ? <><Loader2 className="animate-spin" />Searching…</>
                  : <><Building2 />Search property records</>}
              </Button>
            </form>
          )}

          {(addrStep.name === "candidates" || addrStep.name === "extracting") && (
            <div className="space-y-3">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold">
                  {addrStep.name === "candidates"
                    ? addrStep.matches.length === 1 ? "1 parcel found" : `${addrStep.matches.length} parcels found`
                    : "Fetching parcel record…"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {addrStep.name === "candidates" ? "Confirm the correct folio before Beacon fetches the full record." : ""}
                </p>
              </div>
              {(addrStep.name === "candidates" ? addrStep.matches : [addrStep.match]).map(m => {
                const isSelected = addrStep.name === "extracting" && addrStep.match.strap === m.strap;
                return (
                  <button key={m.strap}
                    onClick={() => addrStep.name === "candidates" && handleFolioConfirm(m)}
                    disabled={isPending}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50 ${
                      isSelected ? "border-primary/50 bg-primary/5" : "bg-background hover:bg-muted/60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm">{m.address}</p>
                      <div className="shrink-0 text-right">
                        <span className="text-xs font-mono text-muted-foreground">{m.strap}</span>
                        {isSelected && <div className="mt-1"><Loader2 className="size-3.5 animate-spin text-primary ml-auto" /></div>}
                      </div>
                    </div>
                  </button>
                );
              })}
              {error && <ErrorBox msg={error} />}
              <Button variant="ghost" className="w-full" disabled={isPending}
                onClick={() => { setAddrStep({ name: "idle" }); setError(null); }}>
                <ArrowLeft className="size-3.5" />Search again
              </Button>
            </div>
          )}
        </>
      )}

      {/* ── URL METHOD ─────────────────────────────────────────────────────── */}
      {!preview && method === "url" && (
        <>
          <div className="flex gap-1 border border-border rounded-lg p-1 w-fit">
            <button
              onClick={() => { setUrlMode("url"); setError(null); setUrlBlockHint(null); }}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                urlMode === "url" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Link2 className="size-3.5" />URL
            </button>
            <button
              onClick={() => { setUrlMode("paste"); setError(null); }}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                urlMode === "paste" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <ClipboardPaste className="size-3.5" />Paste text
            </button>
          </div>

          {urlBlockHint && (
            <div className="rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-400">
              {urlBlockHint}
            </div>
          )}

          {urlMode === "url" && (
            <form onSubmit={handleUrlSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="url">Listing URL</Label>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input id="url" name="url" type="url" placeholder="https://www.loopnet.com/listing/…"
                    autoComplete="off" required disabled={isPending} className="pl-9" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Some sites may take up to a minute. If blocked, use Paste text instead.
                </p>
              </div>
              {error && <ErrorBox msg={error} />}
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? <><Loader2 className="animate-spin" />Fetching page…</> : <><Link2 />Import from URL</>}
              </Button>
            </form>
          )}

          {urlMode === "paste" && (
            <form onSubmit={handlePasteUrlSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="url-ref">Listing URL <span className="text-muted-foreground font-normal">(optional — for reference)</span></Label>
                <Input id="url-ref" name="url" type="url" placeholder="https://www.zillow.com/homedetails/…"
                  autoComplete="off" disabled={isPending} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="content">Listing content</Label>
                <textarea id="content" name="content" rows={12} required disabled={isPending}
                  placeholder={`Paste the listing text here — copy everything from the listing page: address, property details, owner info, sale history, building specs, etc.\n\nFrom Zillow: open the page, select all text (Ctrl+A), copy and paste here.\nFrom LoopNet/Crexi: same approach.`}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background resize-y placeholder:text-muted-foreground/60 disabled:opacity-60"
                />
                <p className="text-xs text-muted-foreground">Claude will extract the structured property fields from whatever you paste.</p>
              </div>
              {error && <ErrorBox msg={error} />}
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? <><Loader2 className="animate-spin" />Extracting…</> : <><ClipboardPaste />Extract from pasted text</>}
              </Button>
            </form>
          )}
        </>
      )}

      {/* ── UPLOAD METHOD ──────────────────────────────────────────────────── */}
      {!preview && method === "upload" && (
        <>
          <div className="flex gap-1 border border-border rounded-lg p-1 w-fit">
            <button
              onClick={() => { setUploadMode("file"); setError(null); }}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                uploadMode === "file" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Upload className="size-3.5" />Upload file
            </button>
            <button
              onClick={() => { setUploadMode("paste"); setError(null); }}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                uploadMode === "paste" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <ClipboardPaste className="size-3.5" />Paste text
            </button>
          </div>

          {uploadMode === "file" && (
            <div className="space-y-4">
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => !isPending && fileInputRef.current?.click()}
                className={cn(
                  "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-12 text-center transition-colors",
                  isPending ? "border-border bg-muted cursor-not-allowed"
                    : dragOver ? "border-primary/60 bg-primary/5 cursor-copy"
                    : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/60 cursor-pointer"
                )}
              >
                {isPending ? (
                  <>
                    <Loader2 className="size-8 text-muted-foreground animate-spin" />
                    <div>
                      <p className="font-medium text-sm">Extracting fields…</p>
                      <p className="text-xs text-muted-foreground mt-0.5">This usually takes 10–30 seconds</p>
                    </div>
                  </>
                ) : selectedFile ? (
                  <>
                    {fileIcon(selectedFile.name)}
                    <div>
                      <p className="font-medium text-sm">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Click to choose a different file</p>
                    </div>
                  </>
                ) : (
                  <>
                    <Upload className="size-8 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">Drop a file or click to browse</p>
                      <p className="text-xs text-muted-foreground mt-1">PDF · Excel (.xlsx) · CSV · Image (PNG, JPG, WebP) · Text</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        CoStar exports work here — Beacon extracts property (and related) fields from the file.
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">Max 32 MB</p>
                    </div>
                  </>
                )}
                <input ref={fileInputRef} type="file" accept={ACCEPTED} disabled={isPending}
                  className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChange(f); }} />
              </div>
              {error && <ErrorBox msg={error} />}
            </div>
          )}

          {uploadMode === "paste" && (
            <form onSubmit={handlePasteUploadSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Property details</label>
                <textarea name="paste" rows={12} required disabled={isPending}
                  placeholder={`Paste any property information here — listing description, tax record, CoStar export row, notes, etc.\n\nExample:\n200 S Biscayne Blvd, Miami FL 33131\nOwner: Acme Holdings LLC\n45,000 SF office, built 1998\nLast sale: $12,500,000 (March 2022)`}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background resize-y placeholder:text-muted-foreground/60 disabled:opacity-60"
                />
                <p className="text-xs text-muted-foreground">Include the address, owner name, and property type for best results.</p>
              </div>
              {error && <ErrorBox msg={error} />}
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? <><Loader2 className="animate-spin" />Extracting…</> : <><ClipboardPaste />Extract fields</>}
              </Button>
            </form>
          )}
        </>
      )}

      {/* ── PREVIEWS ───────────────────────────────────────────────────────── */}
      {preview && (
        <>
          {error && <ErrorBox msg={error} />}
          {preview.type === "address" && (
            <AddressPreviewCard
              preview={preview.data}
              saving={isPending}
              onSave={handleAddressSave}
              onDiscard={clearPreview}
            />
          )}
          {preview.type === "url" && (
            <UrlPreviewCard
              preview={preview.data}
              saving={isPending}
              onSave={handleUrlSave}
              onDiscard={clearPreview}
            />
          )}
          {preview.type === "upload" && (
            <UploadPreviewCard
              preview={preview.data}
              saving={isPending}
              onSave={handleUploadSave}
              onDiscard={clearPreview}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Page export (Suspense required for useSearchParams) ─────────────────────

export default function AddPropertyPage() {
  return (
    <Suspense>
      <AddPropertyInner />
    </Suspense>
  );
}
