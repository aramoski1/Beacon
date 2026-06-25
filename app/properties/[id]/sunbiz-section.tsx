"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Search, CheckSquare, Square, AlertTriangle, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  lookupSunbiz,
  createSunbizContacts,
  type SunbizLookupAction,
} from "./actions";
import type { SunbizResult, SunbizPerson } from "@/lib/sunbiz";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "results"; result: SunbizResult; matches_found: number }
  | { tag: "saving" }
  | { tag: "saved"; count: number };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  ACTIVE:           "bg-green-100 text-green-700",
  INACTIVE:         "bg-slate-100 text-slate-600",
  DISSOLVED:        "bg-red-100 text-red-700",
  REVOKED:          "bg-red-100 text-red-700",
  "ADMIN DISSOLVED": "bg-red-100 text-red-700",
  "ADMIN REVOKED":   "bg-red-100 text-red-700",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function SunbizSection({
  propertyId,
  ownerName,
}: {
  propertyId: string;
  ownerName: string;
}) {
  const [phase, setPhase] = useState<Phase>({ tag: "idle" });
  const [selected, setSelected] = useState<Set<number>>(new Set());

  async function handleLookup() {
    setPhase({ tag: "loading" });
    let res: SunbizLookupAction;
    try {
      res = await lookupSunbiz(propertyId);
    } catch (e) {
      setPhase({ tag: "error", message: e instanceof Error ? e.message : String(e) });
      return;
    }

    if ("error" in res) {
      setPhase({ tag: "error", message: res.error });
      return;
    }
    if (!res.result) {
      setPhase({
        tag: "error",
        message: `No entity found on Sunbiz matching "${ownerName}". The name may be abbreviated, misspelled, or registered under a different entity type.`,
      });
      return;
    }

    // Auto-select all persons by default
    const allIdx = new Set(res.result.persons.map((_, i) => i));
    setSelected(allIdx);
    setPhase({ tag: "results", result: res.result, matches_found: res.matches_found });
  }

  async function handleSave() {
    if (phase.tag !== "results") return;
    const toCreate: SunbizPerson[] = [...selected]
      .sort((a, b) => a - b)
      .map((i) => phase.result.persons[i]);

    setPhase({ tag: "saving" });
    let res;
    try {
      res = await createSunbizContacts(propertyId, toCreate);
    } catch (e) {
      setPhase({ tag: "error", message: e instanceof Error ? e.message : String(e) });
      return;
    }

    if ("error" in res) {
      setPhase({ tag: "error", message: res.error });
      return;
    }
    setPhase({ tag: "saved", count: res.created });
  }

  function togglePerson(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="size-4" />
          Florida Sunbiz
        </CardTitle>
      </CardHeader>

      <CardContent>
        {/* Idle */}
        {phase.tag === "idle" && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Look up <span className="font-medium">{ownerName}</span> in Florida public records to find the registered agent and authorized persons.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={handleLookup}
              className="shrink-0 flex items-center gap-1.5"
            >
              <Search className="size-3.5" />
              Look up
            </Button>
          </div>
        )}

        {/* Loading */}
        {phase.tag === "loading" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
            <Loader2 className="size-4 animate-spin shrink-0" />
            Searching Sunbiz and extracting persons…
          </div>
        )}

        {/* Error */}
        {phase.tag === "error" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              {phase.message}
            </div>
            <Button size="sm" variant="outline" onClick={handleLookup} className="flex items-center gap-1.5">
              <Search className="size-3.5" />
              Try again
            </Button>
          </div>
        )}

        {/* Results */}
        {(phase.tag === "results" || phase.tag === "saving") && (
          <div className="space-y-4">
            {/* Entity header */}
            {phase.tag === "results" && (
              <div className="flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold">{phase.result.entity_name}</p>
                    <span className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                      STATUS_CLS[phase.result.status] ?? "bg-muted text-muted-foreground"
                    )}>
                      {phase.result.status}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      #{phase.result.document_number}
                    </span>
                  </div>

                  <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                    {phase.result.principal_address && (
                      <p>Principal: {phase.result.principal_address}</p>
                    )}
                    {phase.result.mailing_address &&
                      phase.result.mailing_address !== phase.result.principal_address && (
                        <p>Mailing: {phase.result.mailing_address}</p>
                      )}
                  </div>
                </div>
                <a
                  href={phase.result.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 flex items-center gap-1 text-xs text-primary underline underline-offset-2 hover:opacity-80 whitespace-nowrap"
                >
                  View on Sunbiz
                  <ExternalLink className="size-3" />
                </a>
              </div>
            )}

            {/* Warning for non-active */}
            {phase.tag === "results" && phase.result.status !== "ACTIVE" && (
              <div className="flex items-center gap-2 rounded-md border border-amber-300/50 bg-amber-50/80 px-3 py-2 text-xs text-amber-700">
                <AlertTriangle className="size-3.5 shrink-0" />
                This entity is {phase.result.status.toLowerCase()} — verify before relying on this data.
              </div>
            )}

            {/* Persons checklist */}
            {phase.tag === "results" && phase.result.persons.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Select contacts to create — all tagged <span className="font-mono normal-case">sunbiz</span> and <span className="font-mono normal-case">unverified</span>
                </p>
                <div className="space-y-1.5">
                  {phase.result.persons.map((person, i) => (
                    <label
                      key={i}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors",
                        selected.has(i)
                          ? "border-primary/40 bg-primary/5"
                          : "hover:bg-muted/30"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => togglePerson(i)}
                        className="shrink-0 mt-0.5 text-primary"
                        aria-label={selected.has(i) ? "Deselect" : "Select"}
                      >
                        {selected.has(i)
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

            {phase.tag === "results" && phase.result.persons.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Sunbiz record found but no persons are listed.
              </p>
            )}

            {/* Actions */}
            {phase.tag === "results" && (
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={selected.size === 0}
                >
                  Create {selected.size === 0 ? "" : selected.size}{" "}
                  {selected.size === 1 ? "contact" : "contacts"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPhase({ tag: "idle" })}
                >
                  Cancel
                </Button>
                <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                  <ExternalLink className="size-3" />
                  Source: Florida Division of Corporations public records
                </span>
              </div>
            )}

            {/* Saving spinner */}
            {phase.tag === "saving" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Creating contacts…
              </div>
            )}
          </div>
        )}

        {/* Saved */}
        {phase.tag === "saved" && (
          <div className="space-y-2">
            <p className="text-sm text-foreground">
              {phase.count === 0
                ? "No contacts were created."
                : `${phase.count} ${phase.count === 1 ? "contact" : "contacts"} created and linked to this property, tagged `}
              {phase.count > 0 && (
                <>
                  <span className="font-mono">sunbiz</span> and <span className="font-mono">unverified</span>. Verify details before outreach.
                </>
              )}
            </p>
            <button
              onClick={() => { setPhase({ tag: "idle" }); setSelected(new Set()); }}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Look up again
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
