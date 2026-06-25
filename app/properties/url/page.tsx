"use client";

import { FormEvent, useTransition, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Link2, AlertTriangle, CheckCircle2, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ingestUrl,
  ingestPastedContent,
  saveIngestedUrl,
  type UrlPreview,
  type UrlIngestResult,
} from "./actions";
import { createClient } from "@/lib/supabase/client";
import { fetchFieldDefs, fieldSlug, type FieldDefinition } from "@/lib/custom-fields";

// ─── Preview helpers ──────────────────────────────────────────────────────────

function fmt(n: number | null, style?: "currency") {
  if (n == null) return "—";
  if (style === "currency") return `$${n.toLocaleString("en-US")}`;
  return n.toLocaleString("en-US");
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function Field({ label, value, flagged }: { label: string; value: string; flagged?: boolean }) {
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

function UrlPreviewCard({
  preview,
  onSave,
  onDiscard,
  saving,
}: {
  preview: UrlPreview;
  onSave: (merged: UrlPreview) => void;
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
    const merged: UrlPreview = {
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
  const bc = preview.building_composition as Record<string, number | null> | null;
  const buildingSummary = [
    bc?.year_built ? `Built ${bc.year_built}` : null,
    bc?.stories != null ? `${bc.stories} stor${bc.stories === 1 ? "y" : "ies"}` : null,
    bc?.units != null ? `${bc.units} units` : null,
  ]
    .filter(Boolean)
    .join(" · ");

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
              {preview.property_type && (
                <Badge variant="secondary" className="capitalize">{preview.property_type}</Badge>
              )}
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
            <Field label="Owner" value={preview.owner_name ?? "—"} flagged={flags.has("owner_name")} />
            <Field label="Ownership type" value={preview.ownership_type} flagged={flags.has("ownership_type")} />
            <Field label="Property type" value={preview.property_type} flagged={flags.has("property_type")} />
            <Field label="Building area" value={preview.size_sqft != null ? `${fmt(preview.size_sqft)} sqft` : "—"} flagged={flags.has("size_sqft")} />
            <Field label="Last sale date" value={fmtDate(preview.last_sale_date)} flagged={flags.has("last_sale_date")} />
            <Field label="Last sale price" value={fmt(preview.last_sale_price, "currency")} flagged={flags.has("last_sale_price")} />
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

      <div className="flex gap-3">
        <Button onClick={handleSaveClick} disabled={saving} className="flex-1">
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

export default function UrlIngestPage() {
  const router = useRouter();
  const [preview, setPreview] = useState<UrlPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When a URL fetch is blocked, we drop into paste mode with this hint message
  const [blockHint, setBlockHint] = useState<string | null>(null);
  const [mode, setMode] = useState<"url" | "paste">("url");
  const [isPending, startTransition] = useTransition();

  function handleUrlSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBlockHint(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result: UrlIngestResult = await ingestUrl(formData);
      if ("error" in result) {
        if (result.error === "fetch_failed") {
          // Surface the block reason and drop into paste mode
          setBlockHint(result.detail ?? "Could not fetch the page.");
          setMode("paste");
        } else {
          setError(result.error);
        }
      } else {
        setPreview(result.preview);
      }
    });
  }

  function handlePasteSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result: UrlIngestResult = await ingestPastedContent(formData);
      if ("error" in result) {
        setError(result.error as string);
      } else {
        setPreview(result.preview);
      }
    });
  }

  function handleSave(mergedPreview: UrlPreview) {
    setError(null);
    startTransition(async () => {
      const result = await saveIngestedUrl(mergedPreview);
      if ("error" in result) setError(result.error);
      else router.push(`/properties/${result.id}`);
    });
  }

  function handleDiscard() {
    setPreview(null);
    setError(null);
    setBlockHint(null);
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Add property from URL</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a listing URL — LoopNet, Crexi, broker sites, Zillow, etc.
        </p>
      </div>

      {!preview && (
        <>
          {/* Mode toggle */}
          <div className="flex gap-1 border border-border rounded-lg p-1 w-fit">
            <button
              onClick={() => { setMode("url"); setError(null); setBlockHint(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mode === "url" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Link2 className="size-3.5" />
              URL
            </button>
            <button
              onClick={() => { setMode("paste"); setError(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mode === "paste" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ClipboardPaste className="size-3.5" />
              Paste text
            </button>
          </div>

          {/* Block hint — shown when URL was tried but blocked */}
          {blockHint && (
            <div className="rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-400">
              {blockHint}
            </div>
          )}

          {/* URL mode */}
          {mode === "url" && (
            <form onSubmit={handleUrlSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="url">Listing URL</Label>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    id="url"
                    name="url"
                    type="url"
                    placeholder="https://www.loopnet.com/listing/…"
                    autoComplete="off"
                    required
                    disabled={isPending}
                    className="pl-9"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  If the site blocks automated access, use the Paste text tab instead.
                </p>
              </div>

              {error && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? (
                  <><Loader2 className="animate-spin" />Fetching &amp; extracting…</>
                ) : (
                  <><Link2 />Import from URL</>
                )}
              </Button>
            </form>
          )}

          {/* Paste mode */}
          {mode === "paste" && (
            <form onSubmit={handlePasteSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="url-ref">Listing URL <span className="text-muted-foreground font-normal">(optional — for reference)</span></Label>
                <Input
                  id="url-ref"
                  name="url"
                  type="url"
                  placeholder="https://www.zillow.com/homedetails/…"
                  autoComplete="off"
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="content">Listing content</Label>
                <textarea
                  id="content"
                  name="content"
                  rows={12}
                  required
                  disabled={isPending}
                  placeholder={`Paste the listing text here — copy everything from the listing page: address, property details, owner info, sale history, building specs, etc.\n\nFrom Zillow: open the page, select all text (Ctrl+A), copy and paste here.\nFrom LoopNet/Crexi: same approach.`}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background resize-y placeholder:text-muted-foreground/60 disabled:opacity-60"
                />
                <p className="text-xs text-muted-foreground">
                  Claude will extract the structured property fields from whatever you paste.
                </p>
              </div>

              {error && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? (
                  <><Loader2 className="animate-spin" />Extracting…</>
                ) : (
                  <><ClipboardPaste />Extract from pasted text</>
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
          <UrlPreviewCard
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
