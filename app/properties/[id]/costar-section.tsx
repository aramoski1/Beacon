"use client";

import { useRef, useState } from "react";
import {
  Upload,
  Loader2,
  CheckSquare,
  Square,
  AlertTriangle,
  Building2,
  Globe,
  MapPin,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  parseCoStarFile,
  createCoStarContacts,
  type CoStarParseAction,
  type CoStarCreateAction,
} from "./actions";
import type { CoStarOwner, CoStarContact } from "@/lib/costar";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "results"; owner: CoStarOwner }
  | { tag: "saving" }
  | { tag: "saved"; count: number };

const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp,.csv,.txt";

// ─── Component ────────────────────────────────────────────────────────────────

export function CoStarSection({ propertyId }: { propertyId: string }) {
  const [phase, setPhase] = useState<Phase>({ tag: "idle" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleParse() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setPhase({ tag: "loading" });

    const fd = new FormData();
    fd.append("file", file);

    let res: CoStarParseAction;
    try {
      res = await parseCoStarFile(fd);
    } catch (e) {
      setPhase({ tag: "error", message: e instanceof Error ? e.message : String(e) });
      return;
    }

    if ("error" in res) {
      setPhase({ tag: "error", message: res.error });
      return;
    }
    if (res.owner.contacts.length === 0) {
      setPhase({
        tag: "error",
        message:
          "No contacts found in the file. Make sure this is a CoStar \"About the Owner\" export.",
      });
      return;
    }

    setSelected(new Set(res.owner.contacts.map((_, i) => i)));
    setPhase({ tag: "results", owner: res.owner });
  }

  async function handleSave() {
    if (phase.tag !== "results") return;
    const toCreate: CoStarContact[] = [...selected]
      .sort((a, b) => a - b)
      .map((i) => phase.owner.contacts[i]);

    setPhase({ tag: "saving" });
    let res: CoStarCreateAction;
    try {
      res = await createCoStarContacts(propertyId, toCreate, phase.owner.company_name);
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

  function toggleContact(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function reset() {
    setPhase({ tag: "idle" });
    setSelected(new Set());
    setFileName(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="size-4" />
          CoStar Owner Enrichment
        </CardTitle>
      </CardHeader>

      <CardContent>
        {/* Idle */}
        {phase.tag === "idle" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Upload a CoStar &ldquo;About the Owner&rdquo; export to extract contact information.
              Beacon only uses what&apos;s in the file — no CoStar login.
            </p>
            <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-0.5">
              <li>In CoStar, open the property or owner record.</li>
              <li>Export &ldquo;About the Owner&rdquo; (PDF, CSV, or screenshot).</li>
              <li>Upload that file here and click Parse.</li>
            </ol>
            <div className="flex items-center gap-3">
              <label className="flex-1 cursor-pointer">
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED}
                  className="sr-only"
                  onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
                />
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/40",
                    fileName
                      ? "border-primary/40 bg-primary/5 text-foreground"
                      : "border-dashed text-muted-foreground"
                  )}
                >
                  <Upload className="size-3.5 shrink-0" />
                  <span className="truncate">{fileName ?? "Choose file…"}</span>
                </div>
              </label>
              <Button size="sm" onClick={handleParse} disabled={!fileName} className="shrink-0">
                Parse
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              PDF · JPG · PNG · WebP · CSV · TXT — max 10 MB
            </p>
          </div>
        )}

        {/* Loading */}
        {phase.tag === "loading" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
            <Loader2 className="size-4 animate-spin shrink-0" />
            Parsing file and extracting owner contacts…
          </div>
        )}

        {/* Error */}
        {phase.tag === "error" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              {phase.message}
            </div>
            <Button size="sm" variant="outline" onClick={reset} className="flex items-center gap-1.5">
              <Upload className="size-3.5" />
              Try again
            </Button>
          </div>
        )}

        {/* Results + Saving */}
        {(phase.tag === "results" || phase.tag === "saving") && (
          <div className="space-y-4">
            {phase.tag === "results" && (
              <>
                {/* Company info card */}
                {(phase.owner.company_name ||
                  phase.owner.website ||
                  phase.owner.hq_address) && (
                  <div className="rounded-lg bg-muted/30 border px-3 py-2.5 space-y-1.5">
                    {phase.owner.company_name && (
                      <div className="flex items-center gap-2">
                        <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium">{phase.owner.company_name}</span>
                      </div>
                    )}
                    {phase.owner.hq_address && (
                      <div className="flex items-center gap-2">
                        <MapPin className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground">{phase.owner.hq_address}</span>
                      </div>
                    )}
                    {phase.owner.website && (
                      <div className="flex items-center gap-2">
                        <Globe className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground">{phase.owner.website}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Contacts checklist */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Select contacts to create — all tagged{" "}
                    <span className="font-mono normal-case">costar</span> and{" "}
                    <span className="font-mono normal-case">unverified</span>
                  </p>
                  <div className="space-y-1.5">
                    {phase.owner.contacts.map((contact, i) => (
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
                          onClick={() => toggleContact(i)}
                          className="shrink-0 mt-0.5 text-primary"
                          aria-label={selected.has(i) ? "Deselect" : "Select"}
                        >
                          {selected.has(i) ? (
                            <CheckSquare className="size-4" />
                          ) : (
                            <Square className="size-4 text-muted-foreground" />
                          )}
                        </button>
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm font-medium">{contact.name}</p>
                          {contact.title && (
                            <p className="text-xs text-muted-foreground">{contact.title}</p>
                          )}
                          {contact.email && (
                            <p className="text-xs text-muted-foreground">{contact.email}</p>
                          )}
                          {contact.phone && (
                            <p className="text-xs text-muted-foreground">{contact.phone}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={handleSave} disabled={selected.size === 0}>
                    Create {selected.size > 0 && selected.size}{" "}
                    {selected.size === 1 ? "contact" : "contacts"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={reset}>
                    Cancel
                  </Button>
                  <span className="ml-auto flex items-center text-xs text-muted-foreground">
                    Source: CoStar upload · no data invented
                  </span>
                </div>
              </>
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
                  <span className="font-mono">costar</span> and{" "}
                  <span className="font-mono">unverified</span>. Verify details before outreach.
                </>
              )}
            </p>
            <button
              onClick={reset}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Upload another file
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
