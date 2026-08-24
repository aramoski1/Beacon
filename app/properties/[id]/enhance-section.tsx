"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  MapPin,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Square,
  Building2,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { manualSunbizSearchUrl } from "@/lib/sunbiz-url";
import {
  initiateCountyEnhancement,
  previewCountyEnhancement,
  applyCountyEnhancement,
  type EnhancementPreview,
} from "./actions";

const COUNTY_SOURCE_LABEL: Record<string, string> = {
  broward: "BCPA",
  "palm-beach": "PBCPA",
  "miami-dade": "MDPA",
  massachusetts: "MassGIS",
};

// ─── Phase machine ────────────────────────────────────────────────────────────

type Phase =
  | { tag: "idle" }
  | { tag: "searching" }
  | { tag: "error"; message: string }
  | { tag: "pick_folio"; matches: { strap: string; address: string }[] }
  | { tag: "loading_preview"; strap: string; siteAddress: string }
  | { tag: "previewing"; preview: EnhancementPreview }
  | { tag: "saving" }
  | { tag: "done"; changesCount: number; ownerContactsSaved: number };

// ─── Shared inner component ───────────────────────────────────────────────────
// Exported so the CRM dialog can reuse it without re-implementing the flow.

export function CountyEnhanceContent({
  propertyId,
  onDone,
}: {
  propertyId: string;
  onDone?: (changesCount: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ tag: "idle" });
  const [, startTransition] = useTransition();
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [selectedPersons, setSelectedPersons] = useState<Set<number>>(new Set());
  const router = useRouter();

  async function loadPreview(strap: string, siteAddress: string) {
    const res = await previewCountyEnhancement(propertyId, strap, siteAddress);
    if ("error" in res) {
      setPhase({ tag: "error", message: res.error });
      return;
    }
    const persons = res.preview.sunbiz_result?.persons ?? [];
    setSelectedPersons(new Set(persons.map((_, i) => i)));
    setPhase({ tag: "previewing", preview: res.preview });
  }

  function handleStart() {
    setPhase({ tag: "searching" });
    startTransition(async () => {
      const res = await initiateCountyEnhancement(propertyId);
      if ("error" in res) {
        setPhase({ tag: "error", message: res.error });
        return;
      }
      const { matches } = res;
      if (matches.length === 1) {
        setPhase({ tag: "loading_preview", strap: matches[0].strap, siteAddress: matches[0].address });
        await loadPreview(matches[0].strap, matches[0].address);
      } else {
        setPhase({ tag: "pick_folio", matches });
      }
    });
  }

  function handlePickFolio(strap: string, siteAddress: string) {
    setPhase({ tag: "loading_preview", strap, siteAddress });
    startTransition(async () => {
      await loadPreview(strap, siteAddress);
    });
  }

  function togglePerson(idx: number) {
    setSelectedPersons((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function handleApply(preview: EnhancementPreview) {
    const persons = preview.sunbiz_result?.persons ?? [];
    const sunbizPersons = [...selectedPersons]
      .sort((a, b) => a - b)
      .map((i) => persons[i])
      .filter(Boolean);

    setPhase({ tag: "saving" });
    startTransition(async () => {
      const res = await applyCountyEnhancement(propertyId, preview.strap, preview.mdpaData, sunbizPersons);
      if ("error" in res) {
        setPhase({ tag: "error", message: res.error });
        return;
      }
      const count = preview.changes.length;
      setPhase({ tag: "done", changesCount: count, ownerContactsSaved: res.owner_contacts_saved });
      onDone?.(count);
      router.refresh();
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (phase.tag === "idle") {
    return (
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Look up this property on the county property appraiser&rsquo;s records to fill in
          authoritative owner, sale, and building data.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={handleStart}
          className="shrink-0 flex items-center gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50"
        >
          <MapPin className="size-3.5" />
          Enhance
        </Button>
      </div>
    );
  }

  if (phase.tag === "searching" || phase.tag === "loading_preview" || phase.tag === "saving") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
        <Loader2 className="size-4 animate-spin shrink-0" />
        {phase.tag === "searching" && "Searching county records…"}
        {phase.tag === "loading_preview" && "Fetching county detail, extracting fields, and searching Sunbiz…"}
        {phase.tag === "saving" && "Saving county data…"}
      </div>
    );
  }

  if (phase.tag === "error") {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          {phase.message}
        </div>
        <Button size="sm" variant="outline" onClick={() => setPhase({ tag: "idle" })}>
          Back
        </Button>
      </div>
    );
  }

  if (phase.tag === "pick_folio") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Multiple parcels found at this address. Select the one that matches this property:
        </p>
        <div className="space-y-1.5">
          {phase.matches.map((m) => (
            <button
              key={m.strap}
              onClick={() => handlePickFolio(m.strap, m.address)}
              className="w-full text-left flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm hover:bg-muted/40 transition-colors"
            >
              <span className="font-medium">{m.address}</span>
              <span className="font-mono text-xs text-muted-foreground shrink-0">{m.strap}</span>
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setPhase({ tag: "idle" })}>
          Cancel
        </Button>
      </div>
    );
  }

  if (phase.tag === "previewing") {
    const { preview } = phase;
    const sunbizPersons = preview.sunbiz_result?.persons ?? [];

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{preview.strap}</span>
          <span>·</span>
          <span>{preview.siteAddress}</span>
        </div>

        {/* Field diff table */}
        {preview.changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            County data matches all existing values — nothing would change.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {preview.changes.length} field{preview.changes.length !== 1 ? "s" : ""} will change
            </p>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-1/4">Field</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[37.5%]">Current</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[37.5%]">
                      County ({COUNTY_SOURCE_LABEL[preview.county]})
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.changes.map((entry, i) => (
                    <tr key={entry.field} className={cn("border-b last:border-0", i % 2 === 0 ? "" : "bg-muted/10")}>
                      <td className="px-3 py-2 text-muted-foreground">{entry.label}</td>
                      <td className="px-3 py-2 text-red-700/80 line-through decoration-red-300/60 italic">
                        {entry.before ?? <span className="not-italic text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-3 py-2 font-medium text-green-700">
                        {entry.after ?? <span className="font-normal text-muted-foreground/40">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Unchanged fields toggle */}
        {preview.unchanged.length > 0 && (
          <button
            onClick={() => setShowUnchanged((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showUnchanged ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {showUnchanged ? "Hide" : "Show"} {preview.unchanged.length} unchanged field
            {preview.unchanged.length !== 1 ? "s" : ""}
          </button>
        )}

        {showUnchanged && preview.unchanged.length > 0 && (
          <div className="rounded-lg border overflow-hidden opacity-60">
            <table className="w-full text-xs">
              <tbody>
                {preview.unchanged.map((entry, i) => (
                  <tr key={entry.field} className={cn("border-b last:border-0", i % 2 === 0 ? "" : "bg-muted/10")}>
                    <td className="px-3 py-2 text-muted-foreground w-1/4">{entry.label}</td>
                    <td className="px-3 py-2" colSpan={2}>{entry.before ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Sunbiz persons checklist */}
        {preview.sunbiz_result && sunbizPersons.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Building2 className="size-3.5" />
                Florida Sunbiz — {preview.sunbiz_result.entity_name}
              </p>
              <a
                href={preview.sunbiz_result.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary underline underline-offset-2 hover:opacity-80 flex items-center gap-0.5"
              >
                View ↗
                <ExternalLink className="size-3" />
              </a>
            </div>
            <p className="text-xs text-muted-foreground">
              Select persons to save on the property row — no CRM contacts created until you promote them
            </p>
            <div className="space-y-1.5">
              {sunbizPersons.map((person, i) => (
                <label
                  key={i}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors",
                    selectedPersons.has(i) ? "border-primary/40 bg-primary/5" : "hover:bg-muted/30",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => togglePerson(i)}
                    className="shrink-0 mt-0.5 text-primary"
                    aria-label={selectedPersons.has(i) ? "Deselect" : "Select"}
                  >
                    {selectedPersons.has(i)
                      ? <CheckSquare className="size-4" />
                      : <Square className="size-4 text-muted-foreground" />}
                  </button>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{person.name}</p>
                    <p className="text-xs text-muted-foreground">{person.title}</p>
                    {person.address && (
                      <p className="text-xs text-muted-foreground mt-0.5">{person.address}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {preview.sunbiz_error && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <AlertTriangle className="size-3.5 text-yellow-500 shrink-0" />
            Sunbiz: {preview.sunbiz_error}
            {preview.mdpaData.owner_name && (
              <a
                href={manualSunbizSearchUrl(preview.mdpaData.owner_name)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary/80 inline-flex items-center gap-0.5"
              >
                Search Sunbiz yourself <ExternalLink className="size-3" />
              </a>
            )}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            onClick={() => handleApply(preview)}
            disabled={preview.changes.length === 0 && selectedPersons.size === 0}
            className="flex items-center gap-1.5"
          >
            <ArrowRight className="size-3.5" />
            {preview.changes.length === 0 && selectedPersons.size === 0
              ? "Nothing to apply"
              : [
                  preview.changes.length > 0 && `Apply ${preview.changes.length} change${preview.changes.length !== 1 ? "s" : ""}`,
                  selectedPersons.size > 0 && `save ${selectedPersons.size} Sunbiz owner${selectedPersons.size !== 1 ? "s" : ""}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPhase({ tag: "idle" })}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (phase.tag === "done") {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="size-4 text-green-600 shrink-0" />
          <span>
            {phase.changesCount === 0
              ? "County data matched existing values — no changes made."
              : `${phase.changesCount} field${phase.changesCount !== 1 ? "s" : ""} updated with authoritative county data.`}
          </span>
        </div>
        {phase.ownerContactsSaved > 0 && (
          <p className="text-xs text-muted-foreground pl-6">
            {phase.ownerContactsSaved} Sunbiz {phase.ownerContactsSaved === 1 ? "person" : "persons"} saved on the property row.
          </p>
        )}
        <p className="text-xs text-muted-foreground pl-6">Refreshing page…</p>
      </div>
    );
  }

  return null;
}

// ─── Detail-page section ──────────────────────────────────────────────────────

export function EnhanceSection({ propertyId }: { propertyId: string }) {
  return (
    <Card className="border-blue-200/60 bg-blue-50/20 dark:border-blue-900/40 dark:bg-blue-950/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="size-4 text-blue-600" />
          Enhance with county data
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CountyEnhanceContent propertyId={propertyId} />
      </CardContent>
    </Card>
  );
}
