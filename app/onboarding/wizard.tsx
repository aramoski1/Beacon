"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, CheckCircle2, ArrowRight, Building2, Users, Loader2, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  autoSuggestMapping,
  PROPERTY_FIELDS,
  CONTACT_FIELDS,
  type Mapping,
  type ParsedFile,
  type ImportResult,
} from "@/lib/import-mapper";
import { parseImportFile, suggestImportMapping, runImport, completeOnboarding, fetchImportedPropertiesForEnrich } from "./actions";
import { BulkEnrichPanel, type BulkProperty } from "@/app/crm/bulk-enrich-panel";
import { planEnrichJobs, summarizeEnrichPlan } from "@/lib/enrich-queue";

type EntityType = "property" | "contact";
type Step = "welcome" | "upload" | "map" | "importing" | "done";

type State = {
  step: Step;
  entityType: EntityType;
  fileName: string;
  parsed: ParsedFile | null;
  mapping: Mapping;
  result: ImportResult | null;
};

const INIT: State = {
  step: "welcome",
  entityType: "property",
  fileName: "",
  parsed: null,
  mapping: {},
  result: null,
};

// ─── Progress dots ────────────────────────────────────────────────────────────

const STEPS: Step[] = ["upload", "map", "importing", "done"];

function ProgressDots({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <div className="flex items-center justify-center gap-2">
      {STEPS.slice(0, -1).map((s, i) => (
        <div
          key={s}
          className={cn(
            "rounded-full transition-all duration-200",
            i < idx ? "size-2 bg-primary" : i === idx ? "size-2.5 bg-primary" : "size-2 bg-muted"
          )}
        />
      ))}
    </div>
  );
}

// ─── Welcome step ─────────────────────────────────────────────────────────────

function WelcomeStep({
  onStart,
  onSkip,
}: {
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-8 py-10">
      <div className="size-20 rounded-2xl bg-primary/8 border flex items-center justify-center">
        <Building2 className="size-9 text-primary" />
      </div>
      <div className="space-y-2 max-w-sm">
        <h1 className="text-2xl font-semibold">Welcome to Beacon</h1>
        <p className="text-muted-foreground leading-relaxed">
          Let&apos;s import your book of business. Upload a spreadsheet of your properties
          or contacts and we&apos;ll map the columns and deduplicate records. After import you
          can queue Miami-Dade/Broward/Palm Beach + Sunbiz enrichment for those properties (rate-limited; skips
          parcels already linked to a county folio).
        </p>
      </div>
      <div className="flex flex-col items-center gap-3 w-full max-w-xs">
        <button
          type="button"
          onClick={onStart}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Import my data
          <ArrowRight className="size-4" />
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip — I&apos;ll add data manually
        </button>
        <Link
          href="/how-beacon-works?from=onboarding"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-muted-foreground/40"
        >
          How Beacon works
        </Link>
      </div>
    </div>
  );
}

// ─── Upload step ──────────────────────────────────────────────────────────────

function UploadStep({
  entityType,
  onEntityTypeChange,
  onFileParsed,
  onBack,
}: {
  entityType: EntityType;
  onEntityTypeChange: (t: EntityType) => void;
  onFileParsed: (fileName: string, parsed: ParsedFile, mapping: Mapping) => void;
  onBack: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isParsing, startParsing] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    startParsing(async () => {
      const result = await parseImportFile(fd);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const suggestedMapping = autoSuggestMapping(result.headers, entityType);
      const jevMapping = await suggestImportMapping({
        headers: result.headers,
        entityType,
        mapping: suggestedMapping,
      });
      onFileParsed(file.name, result, "error" in jevMapping ? suggestedMapping : jevMapping);
    });
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Upload your data</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload a CSV or Excel file. We&apos;ll auto-detect the columns.
        </p>
      </div>

      {/* Entity type selector */}
      <div className="grid grid-cols-2 gap-3">
        {(["property", "contact"] as EntityType[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onEntityTypeChange(type)}
            className={cn(
              "flex items-center gap-3 p-3.5 rounded-lg border text-sm font-medium transition-colors text-left",
              entityType === type
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground"
            )}
          >
            {type === "property" ? (
              <Building2 className="size-4 shrink-0" />
            ) : (
              <Users className="size-4 shrink-0" />
            )}
            <div>
              <div>{type === "property" ? "Properties" : "Contacts"}</div>
              <div className="text-xs font-normal mt-0.5 text-muted-foreground">
                {type === "property"
                  ? "Addresses, sizes, owners"
                  : "Names, emails, companies"}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !isParsing && fileRef.current?.click()}
        className={cn(
          "relative rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30",
          isParsing && "pointer-events-none opacity-60"
        )}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={handleInputChange}
        />
        {isParsing ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="size-8 text-muted-foreground animate-spin" />
            <p className="text-sm text-muted-foreground">Parsing file…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="size-8 text-muted-foreground/50" />
            <div>
              <p className="text-sm font-medium">Click to upload or drag and drop</p>
              <p className="text-xs text-muted-foreground mt-0.5">CSV, XLSX, or XLS</p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/8 border border-destructive/20 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back
        </button>
      </div>
    </div>
  );
}

// ─── Mapping step ─────────────────────────────────────────────────────────────

function MappingStep({
  entityType,
  parsed,
  fileName,
  mapping,
  onMappingChange,
  onConfirm,
  onBack,
}: {
  entityType: EntityType;
  parsed: ParsedFile;
  fileName: string;
  mapping: Mapping;
  onMappingChange: (m: Mapping) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const fields = entityType === "property" ? PROPERTY_FIELDS : CONTACT_FIELDS;

  // Reverse mapping: csvHeader → fieldKey
  const reverseMap: Record<string, string> = {};
  for (const [fk, hdr] of Object.entries(mapping)) {
    if (hdr) reverseMap[hdr] = fk;
  }

  function setHeaderField(csvHeader: string, fieldKey: string) {
    const next = { ...mapping };
    // Clear any existing assignment of this fieldKey
    for (const [k, v] of Object.entries(next)) {
      if (v === csvHeader) delete next[k];
    }
    if (fieldKey) next[fieldKey] = csvHeader;
    onMappingChange(next);
  }

  // First non-empty sample for a CSV column
  function sampleValue(col: string): string {
    for (const row of parsed.preview) {
      const idx = parsed.headers.indexOf(col);
      const v = row[idx];
      if (v && v.trim()) return v.trim();
    }
    return "";
  }

  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const hasRequiredField = Object.entries(fields).some(
    ([key, def]) => def.required && mapping[key]
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Map your columns</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          <span className="font-medium text-foreground">{fileName}</span>
          {" · "}
          {parsed.totalRows} row{parsed.totalRows !== 1 ? "s" : ""}
          {parsed.truncated && ` (first ${parsed.rows.length} will be imported)`}
          {" · "}
          {mappedCount} field{mappedCount !== 1 ? "s" : ""} mapped
        </p>
      </div>

      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b">
            <tr>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-1/3">
                CSV Column
              </th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-1/3">
                Sample
              </th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-1/3">
                Maps to
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {parsed.headers.map((hdr) => {
              const sample = sampleValue(hdr);
              const currentFieldKey = reverseMap[hdr] ?? "";
              return (
                <tr key={hdr} className="hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2 font-medium text-foreground truncate max-w-0 w-1/3">
                    <span className="truncate block" title={hdr}>{hdr}</span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-0 w-1/3">
                    <span className="truncate block text-xs" title={sample}>
                      {sample || <span className="text-muted-foreground/40 italic">empty</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2 w-1/3">
                    <select
                      value={currentFieldKey}
                      onChange={(e) => setHeaderField(hdr, e.target.value)}
                      className="w-full text-xs rounded-md border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">— Skip —</option>
                      {Object.entries(fields).map(([key, def]) => (
                        <option
                          key={key}
                          value={key}
                          disabled={Boolean(mapping[key]) && mapping[key] !== hdr}
                        >
                          {def.label}{def.required ? " *" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!hasRequiredField && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 dark:bg-amber-950/20 dark:border-amber-800/30 dark:text-amber-300">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span>
            Map the <strong>{entityType === "property" ? "Address *" : "Full Name *"}</strong> field to continue.
          </span>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!hasRequiredField}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Import {parsed.rows.length} row{parsed.rows.length !== 1 ? "s" : ""}
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Importing step ───────────────────────────────────────────────────────────

function ImportingStep() {
  return (
    <div className="flex flex-col items-center gap-6 py-12 text-center">
      <div className="size-16 rounded-2xl bg-primary/8 border flex items-center justify-center">
        <Loader2 className="size-7 text-primary animate-spin" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold">Importing…</h2>
        <p className="text-sm text-muted-foreground">
          Deduplicating records and saving to your workspace.
        </p>
      </div>
    </div>
  );
}

// ─── Done step ────────────────────────────────────────────────────────────────

function DoneStep({
  result,
  onImportMore,
  onGoToCRM,
  onEnrichProperties,
  enrichLoading,
  enrichError,
}: {
  result: ImportResult;
  onImportMore: () => void;
  onGoToCRM: () => void;
  onEnrichProperties: () => void;
  enrichLoading?: boolean;
  enrichError?: string | null;
}) {
  const total = result.propertiesImported + result.contactsImported;
  const hasErrors = result.errors.length > 0;

  return (
    <div className="flex flex-col items-center gap-8 py-8 text-center">
      <div className="size-16 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center dark:bg-emerald-950/20 dark:border-emerald-800/30">
        <CheckCircle2 className="size-8 text-emerald-600 dark:text-emerald-400" />
      </div>

      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold">Import complete</h2>
        <p className="text-sm text-muted-foreground">
          Your data is in Beacon. Enrichment is optional and does not block this step.
        </p>
      </div>

      <div className="w-full max-w-xs space-y-2.5 text-sm">
        {result.propertiesImported > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-muted/40 border">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" />
              <span>Properties imported</span>
            </div>
            <span className="font-semibold tabular-nums">{result.propertiesImported}</span>
          </div>
        )}
        {result.contactsImported > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-muted/40 border">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              <span>Contacts added</span>
            </div>
            <span className="font-semibold tabular-nums">{result.contactsImported}</span>
          </div>
        )}
        {result.skipped > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-muted/40 border">
            <div className="flex items-center gap-2">
              <X className="size-4 text-muted-foreground" />
              <span>Rows skipped</span>
            </div>
            <span className="font-semibold tabular-nums text-muted-foreground">
              {result.skipped}
            </span>
          </div>
        )}
        {total === 0 && (
          <p className="text-muted-foreground text-center py-2">
            No records were imported. Check that the required field is mapped correctly.
          </p>
        )}
      </div>

      {hasErrors && (
        <details className="w-full max-w-xs text-xs text-left">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {result.errors.length} row error{result.errors.length !== 1 ? "s" : ""}
          </summary>
          <ul className="mt-2 space-y-1 pl-3 border-l-2 border-muted text-muted-foreground">
            {result.errors.slice(0, 10).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {result.errors.length > 10 && (
              <li>…and {result.errors.length - 10} more</li>
            )}
          </ul>
        </details>
      )}

      {enrichError && (
        <p className="flex items-center gap-2 text-sm text-destructive max-w-xs">
          <AlertCircle className="size-4 shrink-0" />
          {enrichError}
        </p>
      )}

      <div className="flex flex-col items-center gap-3 w-full max-w-xs">
        {result.propertiesImported > 0 && (
          <button
            type="button"
            onClick={onEnrichProperties}
            disabled={enrichLoading}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {enrichLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Preparing enrich queue…
              </>
            ) : (
              <>
                Enrich imported properties
                <ArrowRight className="size-4" />
              </>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onGoToCRM}
          className={cn(
            "w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors",
            result.propertiesImported > 0
              ? "border border-border hover:bg-muted/40 text-foreground"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          Go to my workspace
          {result.propertiesImported === 0 && <ArrowRight className="size-4" />}
        </button>
        <button
          type="button"
          onClick={onImportMore}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Import another file
        </button>
        <Link
          href="/how-beacon-works?from=onboarding"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-muted-foreground/40"
        >
          How Beacon works
        </Link>
        {result.propertiesImported > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            Enrich queues Miami-Dade/Broward/Palm Beach address lookups and Sunbiz for entity owners.
            Already-linked folios are skipped. Progress and errors show in the panel —
            you can leave for CRM anytime.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

export function OnboardingWizard() {
  const router = useRouter();
  const [state, setState] = useState<State>(INIT);
  const [isCompleting, startCompleting] = useTransition();
  const [enrichProps, setEnrichProps] = useState<BulkProperty[] | null>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [enrichSummary, setEnrichSummary] = useState<string | null>(null);

  function goToCRM() {
    startCompleting(async () => {
      await completeOnboarding();
      router.push("/crm");
    });
  }

  function skipOnboarding() {
    startCompleting(async () => {
      await completeOnboarding();
      router.push("/crm");
    });
  }

  async function handleRunImport() {
    if (!state.parsed) return;
    setState((s) => ({ ...s, step: "importing" }));
    const result = await runImport({
      entityType: state.entityType,
      rows: state.parsed.rows,
      mapping: state.mapping,
    });
    if ("error" in result) {
      // Roll back to map step with an implicit error
      setState((s) => ({
        ...s,
        step: "map",
        result: {
          propertiesImported: 0,
          contactsImported: 0,
          skipped: 0,
          errors: [result.error],
        },
      }));
      return;
    }
    setState((s) => ({ ...s, step: "done", result }));
  }

  async function startEnrichQueue() {
    const ids = state.result?.importedPropertyIds ?? [];
    if (ids.length === 0) {
      setEnrichError("No imported property IDs to enrich.");
      return;
    }
    setEnrichLoading(true);
    setEnrichError(null);
    const res = await fetchImportedPropertiesForEnrich(ids);
    setEnrichLoading(false);
    if ("error" in res) {
      setEnrichError(res.error);
      return;
    }
    const extra = new Set(res.extraSunbizIds ?? []);
    const plans = planEnrichJobs(res.properties).map((plan) => {
      if (extra.has(plan.propertyId) && !plan.needsSunbiz) {
        return { ...plan, needsSunbiz: true, skipReason: undefined };
      }
      return plan;
    });
    const summary = summarizeEnrichPlan(plans);
    setEnrichSummary(
      `${summary.county} county · ${summary.sunbiz} Sunbiz · ${summary.skipped} skipped`,
    );
    const runnable = res.properties.filter((p) => {
      const plan = plans.find((j) => j.propertyId === p.id);
      return plan && !plan.skipReason;
    });
    if (runnable.length === 0) {
      setEnrichError(
        summary.skipped > 0
          ? "Nothing to enrich — imported properties are already county-linked or have no entity owner."
          : "Nothing to enrich.",
      );
      return;
    }
    setEnrichProps(runnable);
  }

  return (
    <div className="min-h-screen bg-background flex items-start justify-center pt-16 px-4 pb-16">
      <div className="w-full max-w-2xl">
        {/* Header — only shown for non-welcome steps */}
        {state.step !== "welcome" && (
          <div className="mb-6 text-center">
            <ProgressDots current={state.step} />
          </div>
        )}

        <div
          className={cn(
            "bg-card border rounded-2xl shadow-sm",
            state.step === "welcome" ? "p-10" : "p-8"
          )}
        >
          {state.step === "welcome" && (
            <WelcomeStep
              onStart={() => setState((s) => ({ ...s, step: "upload" }))}
              onSkip={skipOnboarding}
            />
          )}

          {state.step === "upload" && (
            <UploadStep
              entityType={state.entityType}
              onEntityTypeChange={(t) => setState((s) => ({ ...s, entityType: t }))}
              onFileParsed={(fileName, parsed, mapping) =>
                setState((s) => ({ ...s, step: "map", fileName, parsed, mapping }))
              }
              onBack={() => setState((s) => ({ ...s, step: "welcome" }))}
            />
          )}

          {state.step === "map" && state.parsed && (
            <MappingStep
              entityType={state.entityType}
              parsed={state.parsed}
              fileName={state.fileName}
              mapping={state.mapping}
              onMappingChange={(m) => setState((s) => ({ ...s, mapping: m }))}
              onConfirm={handleRunImport}
              onBack={() => setState((s) => ({ ...s, step: "upload" }))}
            />
          )}

          {state.step === "importing" && <ImportingStep />}

          {state.step === "done" && state.result && (
            <DoneStep
              result={state.result}
              enrichLoading={enrichLoading}
              enrichError={enrichError}
              onImportMore={() => {
                setEnrichProps(null);
                setEnrichError(null);
                setEnrichSummary(null);
                setState((s) => ({
                  ...s,
                  step: "upload",
                  parsed: null,
                  fileName: "",
                  mapping: {},
                  result: null,
                }));
              }}
              onGoToCRM={goToCRM}
              onEnrichProperties={startEnrichQueue}
            />
          )}
        </div>

        {enrichSummary && state.step === "done" && !enrichProps && (
          <p className="mt-3 text-center text-xs text-muted-foreground">{enrichSummary}</p>
        )}

        {enrichProps && (
          <BulkEnrichPanel
            properties={enrichProps}
            onClose={() => setEnrichProps(null)}
            onDone={() => setEnrichProps(null)}
          />
        )}

        {/* Skip link on non-welcome steps */}
        {state.step !== "welcome" && state.step !== "importing" && state.step !== "done" && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={skipOnboarding}
              disabled={isCompleting}
              className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            >
              Skip setup
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
