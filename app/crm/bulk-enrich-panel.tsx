"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Sparkles, X } from "lucide-react";
import { isEntityOwnerName } from "@/lib/owner-contacts";
import {
  initiateCountyEnhancement,
  previewCountyEnhancement,
  applyCountyEnhancement,
  lookupSunbiz,
  saveSunbizOwnerContacts,
  type EnhancementPreview,
} from "@/app/properties/[id]/actions";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BulkProperty = {
  id: string;
  address: string | null;
  source: string | null;
  source_url: string | null;
  owner_name: string | null;
};

type SunbizPerson = NonNullable<EnhancementPreview["sunbiz_result"]>["persons"][number];

type ItemResult =
  | { tag: "pending" }
  | { tag: "running"; step: string }
  | { tag: "done"; countyFields: number; sunbizPersons: number; countyNote?: string }
  | { tag: "ambiguous"; matchCount: number }
  | { tag: "error"; message: string };

// ── Component ─────────────────────────────────────────────────────────────────

export function BulkEnrichPanel({
  properties,
  onClose,
  onDone,
}: {
  properties: BulkProperty[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [results, setResults] = useState<Map<string, ItemResult>>(
    () => new Map(properties.map((p) => [p.id, { tag: "pending" }]))
  );
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  function setResult(id: string, result: ItemResult) {
    setResults((prev) => new Map(prev).set(id, result));
  }

  async function runEnrichment() {
    setRunning(true);

    for (const p of properties) {
      setResult(p.id, { tag: "running", step: "Initializing…" });

      const isMdpa = p.source_url?.startsWith("mdpa:") ?? false;
      const needsCounty = p.source !== "tax_roll" && !isMdpa;
      const isEntityOwner = isEntityOwnerName(p.owner_name);

      let countyFields = 0;
      let sunbizPersonsSaved = 0;
      let countyNote: string | undefined;

      // ── County ──────────────────────────────────────────────────────────────
      if (needsCounty) {
        setResult(p.id, { tag: "running", step: "Searching county records…" });
        const initRes = await initiateCountyEnhancement(p.id);

        if ("error" in initRes) {
          setResult(p.id, { tag: "error", message: initRes.error });
          continue;
        }

        const { matches } = initRes;

        if (matches.length === 0) {
          countyNote = "Not found in county records";
        } else if (matches.length > 1) {
          // Ambiguous — don't guess the folio, flag for manual review
          setResult(p.id, { tag: "ambiguous", matchCount: matches.length });
          continue;
        } else {
          // Exactly one match — safe to auto-apply
          setResult(p.id, { tag: "running", step: "Fetching county detail…" });
          const previewRes = await previewCountyEnhancement(p.id, matches[0].strap, matches[0].address);

          if ("error" in previewRes) {
            setResult(p.id, { tag: "error", message: previewRes.error });
            continue;
          }

          const { preview } = previewRes;
          const sunbizPersons = (preview.sunbiz_result?.persons ?? []) as SunbizPerson[];

          setResult(p.id, {
            tag: "running",
            step: preview.changes.length > 0
              ? `Applying ${preview.changes.length} field${preview.changes.length !== 1 ? "s" : ""}…`
              : "Applying county data…",
          });

          const applyRes = await applyCountyEnhancement(
            p.id,
            preview.strap,
            preview.mdpaData,
            sunbizPersons.length > 0 ? sunbizPersons : undefined,
          );

          if ("error" in applyRes) {
            setResult(p.id, { tag: "error", message: applyRes.error });
            continue;
          }

          countyFields = preview.changes.length;
          sunbizPersonsSaved = applyRes.owner_contacts_saved;
        }
      }

      // ── Sunbiz (standalone — entity owners where county didn't already run it) ──
      if (isEntityOwner && sunbizPersonsSaved === 0 && p.owner_name) {
        setResult(p.id, { tag: "running", step: "Searching Sunbiz…" });
        const sunbizRes = await lookupSunbiz(p.id);

        if (!("error" in sunbizRes) && sunbizRes.result && sunbizRes.result.persons.length > 0) {
          const persons = sunbizRes.result.persons as SunbizPerson[];
          setResult(p.id, {
            tag: "running",
            step: `Saving ${persons.length} Sunbiz owner${persons.length !== 1 ? "s" : ""}…`,
          });
          const saveRes = await saveSunbizOwnerContacts(p.id, persons);
          if (!("error" in saveRes)) {
            sunbizPersonsSaved = persons.length;
          }
        }
      }

      setResult(p.id, { tag: "done", countyFields, sunbizPersons: sunbizPersonsSaved, countyNote });

      // Rate-limit county/Sunbiz lookups across the queue
      await new Promise((r) => setTimeout(r, 400));
    }

    setRunning(false);
    setDone(true);
  }

  // ── Derived counts ──────────────────────────────────────────────────────────

  const allResults = properties.map((p) => results.get(p.id) ?? ({ tag: "pending" } as ItemResult));
  const pendingCount  = allResults.filter((r) => r.tag === "pending").length;
  const doneCount     = allResults.filter((r) => r.tag === "done").length;
  const ambigCount    = allResults.filter((r) => r.tag === "ambiguous").length;
  const errorCount    = allResults.filter((r) => r.tag === "error").length;
  const processedCount = properties.length - pendingCount;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={running ? undefined : onClose}
      />

      {/* Drawer */}
      <div className="relative w-full max-w-md bg-background border-l shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="shrink-0 border-b px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-sm flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              Enrich {properties.length} {properties.length === 1 ? "property" : "properties"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              County data · Sunbiz owners · auto-applied on unambiguous match
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={running}
            className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Progress banner */}
        {running && (
          <div className="shrink-0 px-5 py-2 border-b bg-primary/5 flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin text-primary shrink-0" />
            <span className="text-primary font-medium">
              {processedCount} / {properties.length} processed
            </span>
          </div>
        )}
        {done && (
          <div className="shrink-0 px-5 py-2 border-b bg-green-50 dark:bg-green-950/20 text-xs text-green-700 dark:text-green-400 flex items-center gap-2">
            <CheckCircle2 className="size-3.5 shrink-0" />
            <span>
              Complete — {doneCount} enriched
              {ambigCount > 0 && `, ${ambigCount} flagged for manual review`}
              {errorCount > 0 && `, ${errorCount} error${errorCount !== 1 ? "s" : ""}`}
            </span>
          </div>
        )}

        {/* Per-property list */}
        <div className="flex-1 overflow-y-auto divide-y">
          {properties.map((p) => {
            const result = results.get(p.id) ?? ({ tag: "pending" } as ItemResult);
            return (
              <div key={p.id} className="px-5 py-3 flex items-start gap-3">

                {/* Status icon */}
                <div className="shrink-0 mt-0.5 w-4">
                  {result.tag === "pending" && (
                    <span className="size-4 rounded-full border-2 border-muted-foreground/30 block" />
                  )}
                  {result.tag === "running" && (
                    <Loader2 className="size-4 animate-spin text-primary" />
                  )}
                  {result.tag === "done" && (
                    <CheckCircle2 className="size-4 text-green-600" />
                  )}
                  {result.tag === "ambiguous" && (
                    <AlertTriangle className="size-4 text-amber-500" />
                  )}
                  {result.tag === "error" && (
                    <AlertTriangle className="size-4 text-destructive" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium truncate">{p.address ?? "No address"}</p>
                    <Link
                      href={`/properties/${p.id}`}
                      target="_blank"
                      className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                    >
                      <ExternalLink className="size-3" />
                    </Link>
                  </div>

                  <div className="mt-0.5">
                    {result.tag === "pending" && (
                      <p className="text-xs text-muted-foreground/60">Queued</p>
                    )}
                    {result.tag === "running" && (
                      <p className="text-xs text-muted-foreground">{result.step}</p>
                    )}
                    {result.tag === "done" && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {result.countyFields > 0 && (
                          <span className="text-xs text-green-700 dark:text-green-500">
                            {result.countyFields} county field{result.countyFields !== 1 ? "s" : ""} updated
                          </span>
                        )}
                        {result.sunbizPersons > 0 && (
                          <span className="text-xs text-green-700 dark:text-green-500">
                            {result.sunbizPersons} Sunbiz owner{result.sunbizPersons !== 1 ? "s" : ""} saved
                          </span>
                        )}
                        {result.countyNote && (
                          <span className="text-xs text-muted-foreground">{result.countyNote}</span>
                        )}
                        {result.countyFields === 0 && result.sunbizPersons === 0 && !result.countyNote && (
                          <span className="text-xs text-muted-foreground">No new data found</span>
                        )}
                      </div>
                    )}
                    {result.tag === "ambiguous" && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        {result.matchCount} parcels found — open property to select the correct folio
                      </p>
                    )}
                    {result.tag === "error" && (
                      <p className="text-xs text-destructive">{result.message}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t px-5 py-3 flex gap-2">
          {!running && !done && (
            <button
              onClick={runEnrichment}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Sparkles className="size-3.5" />
              Start enrichment
            </button>
          )}
          {done && (
            <button
              onClick={onDone}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Done — refresh table
            </button>
          )}
          <button
            onClick={onClose}
            disabled={running}
            className={cn(
              "px-4 py-2 rounded-md border text-sm font-medium transition-colors",
              done ? "flex-1" : "",
              "hover:bg-muted/50 disabled:opacity-40",
            )}
          >
            {done ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
