"use client";

import { FormEvent, useTransition, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  MapPin,
  Building2,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ingestAddress,
  ingestChosenFolio,
  saveIngestedProperty,
  type FolioMatch,
  type PropertyPreview,
  type IngestResult,
} from "./actions";
import { createClient } from "@/lib/supabase/client";
import { fetchFieldDefs, fieldSlug, type FieldDefinition } from "@/lib/custom-fields";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null, style?: "currency") {
  if (n == null) return "—";
  if (style === "currency") return `$${n.toLocaleString("en-US")}`;
  return n.toLocaleString("en-US");
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Field sub-component ─────────────────────────────────────────────────────

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
        {flagged && (
          <AlertTriangle className="size-3 text-yellow-500 shrink-0" />
        )}
      </dd>
    </div>
  );
}

// ─── Preview card ─────────────────────────────────────────────────────────────

function PropertyPreviewCard({
  preview,
  onSave,
  onDiscard,
  saving,
}: {
  preview: PropertyPreview;
  onSave: (merged: PropertyPreview) => void;
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
    const merged: PropertyPreview = {
      ...preview,
      custom_fields: {
        ...(preview.custom_fields ?? {}),
        ...Object.fromEntries(
          manualDefs.map(f => {
            const slug = fieldSlug(f.field_name);
            const raw  = manualValues[slug] ?? "";
            const val  = raw === "" ? null : f.field_type === "number" ? Number(raw) : raw;
            return [slug, val];
          })
        ),
      },
    };
    onSave(merged);
  }

  const flagMap = new Map(preview.confidence_flags.map((f) => [f.field, f.reason]));

  // Separate "not found in source" (expected absence) from genuine uncertainty
  const notFoundFlags = preview.confidence_flags.filter(
    (f) => f.reason === "not found in source record"
  );
  const uncertainFlags = preview.confidence_flags.filter(
    (f) => f.reason !== "not found in source record"
  );

  const bc = preview.building_composition;
  const buildingSummary = [
    bc?.year_built ? `Built ${bc.year_built}` : null,
    bc?.stories != null ? `${bc.stories} stor${bc.stories === 1 ? "y" : "ies"}` : null,
    bc?.lot_size_sqft != null ? `${bc.lot_size_sqft.toLocaleString()} sqft lot` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // MDPA public property search — broker pastes folio to verify
  const mdpaSearchUrl =
    "https://www.miamidade.gov/Apps/PA/propertysearch/#/";

  return (
    <div className="space-y-4">
      {/* Source attribution */}
      <div className="rounded-lg border bg-muted/30 px-4 py-3 space-y-1">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="size-4 text-green-500 shrink-0" />
          <span>
            Structured from Miami-Dade Property Appraiser record.
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground pl-6 flex-wrap">
          <span>
            Folio:{" "}
            <span className="font-mono text-foreground">{preview.strap}</span>
          </span>
          <span>·</span>
          <a
            href={mdpaSearchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground transition-colors"
          >
            Verify on MDPA
            <ExternalLink className="size-3" />
          </a>
          <span className="text-muted-foreground/60">
            (search folio {preview.strap} on their site)
          </span>
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
              {preview.property_type && (
                <Badge variant="secondary" className="capitalize">
                  {preview.property_type}
                </Badge>
              )}
              <Badge variant="outline">Tax roll</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Uncertain / ambiguous fields — yellow */}
          {uncertainFlags.length > 0 && (
            <div className="rounded-md border border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-400">
              <div className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-3.5" />
                {uncertainFlags.length} field
                {uncertainFlags.length > 1 ? "s" : ""} flagged uncertain — verify before saving.
              </div>
              <ul className="mt-1.5 space-y-0.5 list-disc list-inside">
                {uncertainFlags.map((f, i) => (
                  <li key={i}>
                    <span className="font-mono">{f.field}</span> — {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Not-found fields — neutral info */}
          {notFoundFlags.length > 0 && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Info className="size-3.5 shrink-0" />
                {notFoundFlags.length} field
                {notFoundFlags.length > 1 ? "s" : ""} not found in the MDPA source record:{" "}
                {notFoundFlags.map((f) => f.field).join(", ")}.
              </div>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Field
              label="Owner"
              value={preview.owner_name ?? "—"}
              flagged={
                flagMap.has("owner_name") &&
                flagMap.get("owner_name") !== "not found in source record"
              }
            />
            <Field
              label="Ownership type"
              value={preview.ownership_type}
              flagged={
                flagMap.has("ownership_type") &&
                flagMap.get("ownership_type") !== "not found in source record"
              }
            />
            <Field
              label="Property type"
              value={preview.property_type}
              flagged={
                flagMap.has("property_type") &&
                flagMap.get("property_type") !== "not found in source record"
              }
            />
            <Field
              label="Building area"
              value={
                preview.size_sqft != null ? `${fmt(preview.size_sqft)} sqft` : "—"
              }
              flagged={
                flagMap.has("size_sqft") &&
                flagMap.get("size_sqft") !== "not found in source record"
              }
            />
            <Field
              label="Last sale date"
              value={fmtDate(preview.last_sale_date)}
              flagged={
                flagMap.has("last_sale_date") &&
                flagMap.get("last_sale_date") !== "not found in source record"
              }
            />
            <Field
              label="Last sale price"
              value={fmt(preview.last_sale_price, "currency")}
              flagged={
                flagMap.has("last_sale_price") &&
                flagMap.get("last_sale_price") !== "not found in source record"
              }
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
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Custom fields
              </p>
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

// ─── Step type ────────────────────────────────────────────────────────────────

type Step =
  | { name: "idle" }
  | { name: "candidates"; matches: FolioMatch[]; originalInput: string }
  | { name: "extracting"; match: FolioMatch }
  | { name: "preview"; preview: PropertyPreview };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewPropertyPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function applyIngestResult(result: IngestResult) {
    if ("error" in result) {
      setError(result.error);
    } else if ("matches" in result) {
      // Should not happen (ingestAddress always returns matches now), but safe to handle
      setStep({ name: "candidates", matches: result.matches, originalInput: "" });
    } else {
      setStep({ name: "preview", preview: result.preview });
    }
  }

  // Step 1 — broker submits an address
  function handleAddressSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const originalInput = (formData.get("address") as string) ?? "";
    startTransition(async () => {
      const result = await ingestAddress(formData);
      if ("matches" in result) {
        setStep({ name: "candidates", matches: result.matches, originalInput });
      } else {
        applyIngestResult(result);
      }
    });
  }

  // Step 1 → Step 2 — broker picks a folio from the candidate list
  function handleFolioConfirm(match: FolioMatch) {
    setError(null);
    setStep({ name: "extracting", match });
    startTransition(async () => {
      const fd = new FormData();
      fd.set("strap", match.strap);
      fd.set("siteAddress", match.address);
      const result = await ingestChosenFolio(fd);
      if ("error" in result) {
        // Return to candidates so they can pick again
        setStep(
          step.name === "candidates"
            ? step
            : { name: "candidates", matches: [match], originalInput: match.address }
        );
        setError(result.error);
      } else if ("preview" in result) {
        setStep({ name: "preview", preview: result.preview });
      }
    });
  }

  // Step 2 confirmed — save (preview card passes merged custom fields)
  function handleSave(mergedPreview: PropertyPreview) {
    setError(null);
    startTransition(async () => {
      const result = await saveIngestedProperty(mergedPreview);
      if ("error" in result) {
        setError(result.error);
      } else {
        router.push(`/properties/${result.id}`);
      }
    });
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Look up a property</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Miami-Dade County only. Beacon identifies the parcel by folio number, fetches
          the public tax record, and structures it — no guessing.
        </p>
      </div>

      {/* ── Step 1a: Address input ─────────────────────────────────────────── */}
      {step.name === "idle" && (
        <form onSubmit={handleAddressSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="address">Street address</Label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                id="address"
                name="address"
                type="text"
                placeholder="3401 N Miami Ave"
                autoComplete="off"
                required
                disabled={isPending}
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Street number + name only — skip city, state, and zip.
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
                Searching…
              </>
            ) : (
              <>
                <Building2 />
                Search Miami-Dade property records
              </>
            )}
          </Button>
        </form>
      )}

      {/* ── Step 1b: Candidate list — broker must pick the folio ────────────── */}
      {(step.name === "candidates" || step.name === "extracting") && (
        <div className="space-y-3">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">
              {step.name === "candidates"
                ? step.matches.length === 1
                  ? "1 parcel found"
                  : `${step.matches.length} parcels found`
                : "Fetching parcel record…"}
            </p>
            <p className="text-xs text-muted-foreground">
              {step.name === "candidates"
                ? "Confirm the correct folio before Beacon fetches the full record."
                : ""}
            </p>
          </div>

          {(step.name === "candidates" ? step.matches : [step.match]).map(
            (m) => {
              const isSelected =
                step.name === "extracting" && step.match.strap === m.strap;
              return (
                <button
                  key={m.strap}
                  onClick={() =>
                    step.name === "candidates" && handleFolioConfirm(m)
                  }
                  disabled={isPending}
                  className={`w-full rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50 ${
                    isSelected
                      ? "border-primary/50 bg-primary/5"
                      : "bg-background hover:bg-muted/60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm">{m.address}</p>
                    <div className="shrink-0 text-right">
                      <span className="text-xs font-mono text-muted-foreground">
                        {m.strap}
                      </span>
                      {isSelected && (
                        <div className="mt-1">
                          <Loader2 className="size-3.5 animate-spin text-primary ml-auto" />
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            }
          )}

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button
            variant="ghost"
            className="w-full"
            disabled={isPending}
            onClick={() => {
              setStep({ name: "idle" });
              setError(null);
            }}
          >
            <ArrowLeft className="size-3.5" />
            Search again
          </Button>
        </div>
      )}

      {/* ── Step 2: Extracted preview — broker reviews and saves ─────────────── */}
      {step.name === "preview" && (
        <>
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <PropertyPreviewCard
            preview={step.preview}
            onSave={handleSave}
            onDiscard={() => {
              setStep({ name: "idle" });
              setError(null);
            }}
            saving={isPending}
          />
        </>
      )}
    </div>
  );
}
