"use client";

import { useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowLeft, FileText, Check, X, Pencil, RotateCcw,
  ChevronRight, Quote, Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";
import { TenantSelector } from "./tenant-selector";
import {
  deriveConfidence, confidenceLevel, fieldLabel,
  type FieldCitation, type FieldReview, type FieldReviews, type ReviewStatus,
} from "./review-utils";
import { saveFieldReview, acceptAllFields } from "./actions";
import { ExportMenu } from "./export-menu";
import type { LeaseAbstractExport } from "@/lib/lease-export";

// ─── Lazy-load PDF viewer (browser only) ─────────────────────────────────────

const PdfViewer = dynamic(
  () => import("./pdf-viewer").then(m => ({ default: m.PdfViewer })),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground bg-neutral-200 dark:bg-neutral-800">
        <Loader2 className="size-4 animate-spin mr-2" />
        Loading PDF viewer…
      </div>
    ),
  },
);

// ─── Types ────────────────────────────────────────────────────────────────────

type Escalation = { description: string; rate: string; effective_date?: string };
type LeaseOption = { type: "renewal" | "termination" | "expansion"; description: string; notice_period?: string };
type KeyProvision = { provision: string; citation?: string };

type TenantContact = { id: string; name: string | null; email: string | null; phone: string | null; role: string | null; company: string | null };
type PropertyContact = Pick<TenantContact, "id" | "name" | "role" | "company">;

interface LeaseAbstract {
  id: string;
  source_document: string | null;
  execution_date: string | null;
  expiration_date: string | null;
  term: string | null;
  base_rate: number | null;
  escalations: Escalation[];
  options: LeaseOption[];
  key_provisions: KeyProvision[];
  field_citations: FieldCitation[];
  field_reviews: FieldReviews;
  custom_fields: Record<string, string | number | null> | null;
  tenant_contact_id: string | null;
  linked_property: string | null;
}

interface LeaseReviewViewProps {
  abstract: LeaseAbstract;
  pdfUrl: string | null;
  customDefs: FieldDefinition[];
  tenantContact: TenantContact | null;
  propertyContacts: PropertyContact[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function sourceFileName(path: string | null) {
  if (!path) return "Lease document";
  return path.split("/").pop() ?? path;
}

function optionVariant(type: string): "default" | "secondary" | "outline" {
  if (type === "renewal") return "default";
  if (type === "termination") return "secondary";
  return "outline";
}

// ─── Confidence dots ──────────────────────────────────────────────────────────

function ConfidenceDots({ score }: { score: number }) {
  const level = confidenceLevel(score);
  const filled = Math.max(1, Math.round(score * 5));
  return (
    <span className="inline-flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "size-1.5 rounded-full",
            i < filled
              ? level === "high" ? "bg-emerald-500" : level === "medium" ? "bg-amber-500" : "bg-red-400"
              : "bg-muted-foreground/20",
          )}
        />
      ))}
      <span className="text-[10px] text-muted-foreground ml-0.5 capitalize">{level}</span>
    </span>
  );
}

// ─── Field review row ─────────────────────────────────────────────────────────

interface FieldRowProps {
  fieldKey: string;
  label: string;
  displayValue: string;
  citation: FieldCitation | undefined;
  review: FieldReview;
  saving: boolean;
  editing: boolean;
  editValue: string;
  onAccept: () => void;
  onReject: () => void;
  onStartCorrect: () => void;
  onUndo: () => void;
  onSaveCorrection: (v: string) => void;
  onCancelCorrection: () => void;
  onEditValueChange: (v: string) => void;
  onCitationClick: (citation: FieldCitation) => void;
}

function FieldRow({
  fieldKey, label, displayValue, citation, review, saving, editing,
  editValue, onAccept, onReject, onStartCorrect, onUndo, onSaveCorrection,
  onCancelCorrection, onEditValueChange, onCitationClick,
}: FieldRowProps) {
  const confidence = deriveConfidence(displayValue, citation);
  const status = review.status;
  const isReviewed = status !== "pending";

  return (
    <div
      className={cn(
        "rounded-lg border px-3.5 py-3 transition-colors",
        status === "accepted" && "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30",
        status === "rejected" && "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30 opacity-60",
        status === "corrected" && "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30",
        status === "pending" && "border-border bg-card",
      )}
    >
      {/* Row header: label + citation pill */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex-1">
          {label}
        </span>
        {citation && (
          <button
            onClick={() => onCitationClick(citation)}
            className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors rounded px-1.5 py-0.5 bg-primary/8 hover:bg-primary/15"
            title={`"${citation.text}"`}
          >
            <Quote className="size-2.5" />
            p.{citation.page}
            <ChevronRight className="size-2.5" />
          </button>
        )}
        {saving && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
      </div>

      {/* Value display */}
      {editing ? (
        <div className="flex items-center gap-2 mb-2">
          <input
            autoFocus
            className="flex-1 text-sm px-2 py-1 rounded border bg-background focus:outline-none focus:ring-1 ring-ring"
            value={editValue}
            onChange={e => onEditValueChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") onSaveCorrection(editValue);
              if (e.key === "Escape") onCancelCorrection();
            }}
          />
          <button
            onClick={() => onSaveCorrection(editValue)}
            className="text-xs px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors"
          >
            Save
          </button>
          <button
            onClick={onCancelCorrection}
            className="text-xs px-2 py-1 rounded border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="mb-2">
          <span
            className={cn(
              "text-sm font-medium",
              status === "rejected" && "line-through text-muted-foreground",
            )}
          >
            {status === "corrected" && review.correctedValue != null
              ? String(review.correctedValue)
              : displayValue}
          </span>
          {status === "corrected" && review.correctedValue != null && (
            <span className="ml-2 text-xs text-muted-foreground">
              (was: {displayValue})
            </span>
          )}
        </div>
      )}

      {/* Confidence + action row */}
      {!editing && (
        <div className="flex items-center gap-3">
          {!isReviewed && <ConfidenceDots score={confidence} />}

          <div className="ml-auto flex items-center gap-1.5">
            {isReviewed ? (
              <>
                <span
                  className={cn(
                    "text-xs font-medium",
                    status === "accepted" && "text-emerald-700 dark:text-emerald-400",
                    status === "rejected" && "text-red-600 dark:text-red-400",
                    status === "corrected" && "text-amber-700 dark:text-amber-400",
                  )}
                >
                  {status === "accepted" ? "Accepted" : status === "rejected" ? "Rejected" : "Corrected"}
                </span>
                <button
                  onClick={onUndo}
                  disabled={saving}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 disabled:opacity-40"
                  title="Undo"
                >
                  <RotateCcw className="size-3" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onAccept}
                  disabled={saving}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/50 transition-colors disabled:opacity-40"
                >
                  <Check className="size-3" />
                  Accept
                </button>
                <button
                  onClick={onReject}
                  disabled={saving}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/50 transition-colors disabled:opacity-40"
                >
                  <X className="size-3" />
                  Reject
                </button>
                <button
                  onClick={onStartCorrect}
                  disabled={saving}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/50 transition-colors disabled:opacity-40"
                >
                  <Pencil className="size-3" />
                  Correct
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function FieldSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-0.5">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// ─── Main review view ─────────────────────────────────────────────────────────

export function LeaseReviewView({
  abstract,
  pdfUrl,
  customDefs,
  tenantContact,
  propertyContacts,
}: LeaseReviewViewProps) {
  const [reviews, setReviews] = useState<FieldReviews>(abstract.field_reviews ?? {});
  const [targetPage, setTargetPage] = useState<number | null>(null);
  const [highlightText, setHighlightText] = useState<string | null>(null);
  const [savingFields, setSavingFields] = useState<Set<string>>(new Set());
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [acceptingAll, setAcceptingAll] = useState(false);

  const citationMap = useMemo(
    () => new Map<string, FieldCitation>(abstract.field_citations.map(c => [c.field, c])),
    [abstract.field_citations],
  );

  const getReview = useCallback(
    (key: string): FieldReview => reviews[key] ?? { status: "pending" },
    [reviews],
  );

  const handleCitationClick = useCallback((citation: FieldCitation) => {
    const page = parseInt(citation.page, 10);
    if (!isNaN(page)) setTargetPage(page);
    setHighlightText(citation.text);
  }, []);

  const doSaveReview = useCallback(
    async (key: string, status: ReviewStatus, correctedValue?: string | number | null) => {
      const prev = reviews[key];
      const next: FieldReview = {
        status,
        reviewedAt: new Date().toISOString(),
        ...(correctedValue !== undefined ? { correctedValue } : {}),
      };

      // Optimistic update
      if (status === "pending") {
        setReviews(r => { const { [key]: _, ...rest } = r; return rest; });
      } else {
        setReviews(r => ({ ...r, [key]: next }));
      }
      setSavingFields(s => new Set([...s, key]));

      try {
        const result = await saveFieldReview(abstract.id, key, status, correctedValue);
        if ("error" in result) {
          // Rollback
          setReviews(r => prev ? { ...r, [key]: prev } : (({ [key]: _, ...rest }) => rest)(r));
        }
      } finally {
        setSavingFields(s => { const n = new Set(s); n.delete(key); return n; });
      }
    },
    [abstract.id, reviews],
  );

  // Collect all reviewable field keys
  const allFieldKeys = useMemo(() => {
    const keys: string[] = [
      "execution_date", "expiration_date", "term", "base_rate",
      ...abstract.escalations.map((_, i) => `escalations[${i}]`),
      ...abstract.options.map((_, i) => `options[${i}]`),
      ...abstract.key_provisions.map((_, i) => `key_provisions[${i}]`),
      ...customDefs.map(f => fieldSlug(f.field_name)),
    ];
    return keys;
  }, [abstract, customDefs]);

  const reviewedCount = useMemo(
    () => allFieldKeys.filter(k => (reviews[k]?.status ?? "pending") !== "pending").length,
    [allFieldKeys, reviews],
  );

  const handleAcceptAll = useCallback(async () => {
    const pendingKeys = allFieldKeys.filter(k => (reviews[k]?.status ?? "pending") === "pending");
    if (pendingKeys.length === 0) return;

    const now = new Date().toISOString();
    const updates: FieldReviews = {};
    for (const k of pendingKeys) updates[k] = { status: "accepted", reviewedAt: now };

    setReviews(r => ({ ...r, ...updates }));
    setAcceptingAll(true);

    try {
      await acceptAllFields(abstract.id, pendingKeys);
    } finally {
      setAcceptingAll(false);
    }
  }, [abstract.id, allFieldKeys, reviews]);

  // ─── Scalar fields ─────────────────────────────────────────────────────────

  const scalarFields = [
    { key: "execution_date", label: "Execution date", value: formatDate(abstract.execution_date) },
    { key: "expiration_date", label: "Expiration date", value: formatDate(abstract.expiration_date) },
    { key: "term", label: "Term", value: abstract.term ?? "—" },
    {
      key: "base_rate",
      label: "Base rate",
      value: abstract.base_rate != null ? `$${abstract.base_rate.toLocaleString()}` : "—",
    },
  ];

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Header */}
      <div className="flex-none flex items-center gap-2 border-b bg-background px-4 py-2 min-h-11">
        <Link
          href="/crm?tab=leases"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft className="size-3.5" />
          Leases
        </Link>
        <span className="text-muted-foreground/40">·</span>
        <FileText className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate flex-1 min-w-0">
          {sourceFileName(abstract.source_document)}
        </span>

        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {reviewedCount}/{allFieldKeys.length} reviewed
        </span>
        <Badge variant="outline" className="shrink-0 text-[10px]">AI Abstracted</Badge>
        <ExportMenu abstract={abstract as unknown as LeaseAbstractExport} />
        <button
          onClick={handleAcceptAll}
          disabled={acceptingAll || reviewedCount === allFieldKeys.length}
          className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {acceptingAll && <Loader2 className="size-3 animate-spin" />}
          Accept all
        </button>
      </div>

      {/* Two-column body */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: PDF viewer */}
        <div className="w-1/2 border-r flex flex-col overflow-hidden">
          {pdfUrl ? (
            <PdfViewer
              url={pdfUrl}
              targetPage={targetPage}
              highlightText={highlightText}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground bg-neutral-100 dark:bg-neutral-900">
              <FileText className="size-8 opacity-30" />
              <p>No PDF source available</p>
            </div>
          )}
        </div>

        {/* Right: Review panel */}
        <div className="w-1/2 overflow-y-auto">
          <div className="p-5 space-y-6">

            {/* Core terms */}
            <FieldSection title="Core terms">
              {scalarFields.map(({ key, label, value }) => (
                <FieldRow
                  key={key}
                  fieldKey={key}
                  label={label}
                  displayValue={value}
                  citation={citationMap.get(key)}
                  review={getReview(key)}
                  saving={savingFields.has(key)}
                  editing={editingField === key}
                  editValue={editValue}
                  onAccept={() => doSaveReview(key, "accepted")}
                  onReject={() => doSaveReview(key, "rejected")}
                  onStartCorrect={() => { setEditingField(key); setEditValue(value === "—" ? "" : value); }}
                  onUndo={() => doSaveReview(key, "pending")}
                  onSaveCorrection={v => { doSaveReview(key, "corrected", v); setEditingField(null); }}
                  onCancelCorrection={() => setEditingField(null)}
                  onEditValueChange={setEditValue}
                  onCitationClick={handleCitationClick}
                />
              ))}
            </FieldSection>

            {/* Escalations */}
            {abstract.escalations.length > 0 && (
              <FieldSection title="Escalations">
                {abstract.escalations.map((e, i) => {
                  const key = `escalations[${i}]`;
                  const cit = citationMap.get(key) ?? (i === 0 ? citationMap.get("escalations") : undefined);
                  const display = `${e.description} — ${e.rate}${e.effective_date ? ` (eff. ${e.effective_date})` : ""}`;
                  return (
                    <FieldRow
                      key={key}
                      fieldKey={key}
                      label={fieldLabel(key)}
                      displayValue={display}
                      citation={cit}
                      review={getReview(key)}
                      saving={savingFields.has(key)}
                      editing={editingField === key}
                      editValue={editValue}
                      onAccept={() => doSaveReview(key, "accepted")}
                      onReject={() => doSaveReview(key, "rejected")}
                      onStartCorrect={() => { setEditingField(key); setEditValue(display); }}
                      onUndo={() => doSaveReview(key, "pending")}
                      onSaveCorrection={v => { doSaveReview(key, "corrected", v); setEditingField(null); }}
                      onCancelCorrection={() => setEditingField(null)}
                      onEditValueChange={setEditValue}
                      onCitationClick={handleCitationClick}
                    />
                  );
                })}
              </FieldSection>
            )}

            {/* Options */}
            {abstract.options.length > 0 && (
              <FieldSection title="Options">
                {abstract.options.map((o, i) => {
                  const key = `options[${i}]`;
                  const cit = citationMap.get(key) ?? (i === 0 ? citationMap.get("options") : undefined);
                  const display = `${o.type.charAt(0).toUpperCase()}${o.type.slice(1)}: ${o.description}${o.notice_period ? ` (notice: ${o.notice_period})` : ""}`;
                  return (
                    <FieldRow
                      key={key}
                      fieldKey={key}
                      label={fieldLabel(key)}
                      displayValue={display}
                      citation={cit}
                      review={getReview(key)}
                      saving={savingFields.has(key)}
                      editing={editingField === key}
                      editValue={editValue}
                      onAccept={() => doSaveReview(key, "accepted")}
                      onReject={() => doSaveReview(key, "rejected")}
                      onStartCorrect={() => { setEditingField(key); setEditValue(display); }}
                      onUndo={() => doSaveReview(key, "pending")}
                      onSaveCorrection={v => { doSaveReview(key, "corrected", v); setEditingField(null); }}
                      onCancelCorrection={() => setEditingField(null)}
                      onEditValueChange={setEditValue}
                      onCitationClick={handleCitationClick}
                    />
                  );
                })}
              </FieldSection>
            )}

            {/* Key provisions */}
            {abstract.key_provisions.length > 0 && (
              <FieldSection title="Key provisions">
                {abstract.key_provisions.map((kp, i) => {
                  const key = `key_provisions[${i}]`;
                  const cit = citationMap.get(key) ?? (i === 0 ? citationMap.get("key_provisions") : undefined);
                  return (
                    <FieldRow
                      key={key}
                      fieldKey={key}
                      label={`Provision ${i + 1}`}
                      displayValue={kp.provision + (kp.citation ? ` (§${kp.citation})` : "")}
                      citation={cit}
                      review={getReview(key)}
                      saving={savingFields.has(key)}
                      editing={editingField === key}
                      editValue={editValue}
                      onAccept={() => doSaveReview(key, "accepted")}
                      onReject={() => doSaveReview(key, "rejected")}
                      onStartCorrect={() => { setEditingField(key); setEditValue(kp.provision); }}
                      onUndo={() => doSaveReview(key, "pending")}
                      onSaveCorrection={v => { doSaveReview(key, "corrected", v); setEditingField(null); }}
                      onCancelCorrection={() => setEditingField(null)}
                      onEditValueChange={setEditValue}
                      onCitationClick={handleCitationClick}
                    />
                  );
                })}
              </FieldSection>
            )}

            {/* Custom fields */}
            {customDefs.length > 0 && (
              <FieldSection title="Custom fields">
                {customDefs.map(f => {
                  const slug = fieldSlug(f.field_name);
                  const raw = abstract.custom_fields?.[slug] ?? null;
                  const val = raw != null ? String(raw) : "—";
                  const cit = citationMap.get(slug) ?? citationMap.get(f.field_name);
                  return (
                    <FieldRow
                      key={slug}
                      fieldKey={slug}
                      label={f.field_name}
                      displayValue={val}
                      citation={cit}
                      review={getReview(slug)}
                      saving={savingFields.has(slug)}
                      editing={editingField === slug}
                      editValue={editValue}
                      onAccept={() => doSaveReview(slug, "accepted")}
                      onReject={() => doSaveReview(slug, "rejected")}
                      onStartCorrect={() => { setEditingField(slug); setEditValue(val === "—" ? "" : val); }}
                      onUndo={() => doSaveReview(slug, "pending")}
                      onSaveCorrection={v => { doSaveReview(slug, "corrected", v); setEditingField(null); }}
                      onCancelCorrection={() => setEditingField(null)}
                      onEditValueChange={setEditValue}
                      onCitationClick={handleCitationClick}
                    />
                  );
                })}
              </FieldSection>
            )}

            {/* Tenant section */}
            <Separator />
            <FieldSection title="Tenant">
              {tenantContact && (
                <div className="flex items-start gap-3 rounded-lg border bg-muted/20 px-4 py-3 mb-2">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <Link
                      href={`/contacts/${tenantContact.id}`}
                      className="text-sm font-medium hover:underline underline-offset-2"
                    >
                      {tenantContact.name ?? "Unnamed contact"}
                    </Link>
                    {(tenantContact.role || tenantContact.company) && (
                      <p className="text-xs text-muted-foreground">
                        {[tenantContact.role, tenantContact.company].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {tenantContact.email && (
                      <a href={`mailto:${tenantContact.email}`} className="text-xs text-primary hover:underline block">
                        {tenantContact.email}
                      </a>
                    )}
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  {tenantContact ? "Change tenant contact:" : "Link a tenant contact:"}
                </p>
                <TenantSelector
                  leaseId={abstract.id}
                  currentContactId={abstract.tenant_contact_id}
                  contacts={propertyContacts}
                />
              </div>
            </FieldSection>

            {/* Option type legend at bottom for context */}
            {abstract.options.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {(["renewal", "termination", "expansion"] as const).map(t => (
                  abstract.options.some(o => o.type === t) && (
                    <Badge key={t} variant={optionVariant(t)} className="text-[10px] capitalize">
                      {t}
                    </Badge>
                  )
                ))}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
