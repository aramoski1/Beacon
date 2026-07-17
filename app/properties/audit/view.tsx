"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { deleteProperty } from "@/app/crm/actions";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ExternalLink,
  Loader2,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConfidenceFlag = { field: string; reason: string };

type Property = {
  id: string;
  address: string | null;
  city: string | null;
  owner_name: string | null;
  source: string | null;
  source_url: string | null;
  ingested_at: string | null;
  confidence_flags: ConfidenceFlag[];
};

type AuditReason =
  | { kind: "bad-address" }
  | { kind: "govt-owner"; matched: string }
  | { kind: "missing-core"; flags: ConfidenceFlag[] };

type FlaggedProperty = Property & { reasons: AuditReason[] };

// ─── Classification logic ─────────────────────────────────────────────────────

const GOVT_PATTERNS = [
  "MIAMI-DADE",
  "MIAMI DADE",
  "COUNTY OF MIAMI",
  "DADE COUNTY",
  "BOARD OF COUNTY",
  "SCHOOL BOARD",
  "HOUSING AUTHORITY",
  "PUBLIC HEALTH TRUST",
  "JACKSON HEALTH",
  "SOUTH FLORIDA WATER",
  "FDOT",
  "FLORIDA DEPT OF TRANSP",
  "MDTA",
];

const CORE_FIELDS = new Set(["address", "owner_name", "size_sqft"]);

function classify(p: Property): AuditReason[] {
  const reasons: AuditReason[] = [];

  if (p.address?.toUpperCase().startsWith("111 NW 1 ST")) {
    reasons.push({ kind: "bad-address" });
  }

  const ownerUp = (p.owner_name ?? "").toUpperCase();
  const matched = GOVT_PATTERNS.find((pat) => ownerUp.includes(pat));
  if (matched) {
    reasons.push({ kind: "govt-owner", matched: p.owner_name ?? matched });
  }

  const coreFlags = (p.confidence_flags ?? []).filter((f) =>
    CORE_FIELDS.has(f.field)
  );
  if (coreFlags.length > 0) {
    reasons.push({ kind: "missing-core", flags: coreFlags });
  }

  return reasons;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function folio(sourceUrl: string | null) {
  if (!sourceUrl?.startsWith("mdpa:")) return null;
  return sourceUrl.replace("mdpa:", "");
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function sourceLabel(source: string | null) {
  if (source === "tax_roll") return "Tax roll";
  if (source === "url") return "URL";
  if (source === "upload") return "Upload";
  return source ?? "Unknown";
}

// ─── Reason badges ────────────────────────────────────────────────────────────

function ReasonBadge({ reason }: { reason: AuditReason }) {
  if (reason.kind === "bad-address") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20 px-2.5 py-0.5 text-xs font-medium">
        <AlertTriangle className="size-3" />
        Bad address — &quot;111 NW 1 ST&quot; default
      </span>
    );
  }

  if (reason.kind === "govt-owner") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-800 border border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800/30 px-2.5 py-0.5 text-xs font-medium">
        <ShieldAlert className="size-3" />
        Govt owner — {reason.matched}
      </span>
    );
  }

  return (
    <>
      {reason.flags.map((f) => (
        <span
          key={f.field}
          className="inline-flex items-center gap-1 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300 dark:border-yellow-800/30 px-2.5 py-0.5 text-xs font-medium"
          title={f.reason}
        >
          <AlertTriangle className="size-3" />
          {f.field}: {f.reason.length > 60 ? f.reason.slice(0, 58) + "…" : f.reason}
        </span>
      ))}
    </>
  );
}

// ─── Property row ─────────────────────────────────────────────────────────────

function PropertyRow({
  p,
  deletingId,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  p: FlaggedProperty;
  deletingId: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
}) {
  const isDeleting = deletingId === p.id;
  const folioNum = folio(p.source_url);

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 space-y-3 transition-colors",
        isDeleting && "border-destructive/40 bg-destructive/5"
      )}
    >
      {/* Top row: address + delete control */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/properties/${p.id}`}
              className="font-semibold text-base hover:underline underline-offset-2 truncate"
            >
              {p.address ?? <span className="italic text-muted-foreground">No address</span>}
            </Link>
            <Link
              href={`/properties/${p.id}`}
              className="shrink-0 text-muted-foreground hover:text-primary"
              title="Open property detail"
            >
              <ExternalLink className="size-3.5" />
            </Link>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {p.city ?? "—"}
          </p>
        </div>

        {isDeleting ? (
          <span className="flex items-center gap-1.5 text-sm text-destructive shrink-0">
            <button
              onClick={() => onDeleteConfirm(p.id)}
              className="font-semibold hover:underline underline-offset-2"
            >
              Confirm delete
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              onClick={onDeleteCancel}
              className="text-muted-foreground hover:text-foreground"
              title="Cancel"
            >
              <X className="size-4" />
            </button>
          </span>
        ) : (
          <button
            onClick={() => onDeleteRequest(p.id)}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 transition-colors"
            title="Delete this property"
          >
            <Trash2 className="size-3.5" />
            Delete
          </button>
        )}
      </div>

      {/* Meta row: owner, source, date */}
      <dl className="grid grid-cols-3 gap-x-4 gap-y-1 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground uppercase tracking-wide">Owner</dt>
          <dd className="font-medium truncate">{p.owner_name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground uppercase tracking-wide">Source</dt>
          <dd>
            <span className="font-medium">{sourceLabel(p.source)}</span>
            {folioNum && (
              <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                {folioNum}
              </span>
            )}
            {p.source === "url" && p.source_url && (
              <a
                href={p.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1.5 inline-flex items-center text-muted-foreground hover:text-foreground"
                title={p.source_url}
              >
                <ExternalLink className="size-3" />
              </a>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground uppercase tracking-wide">Ingested</dt>
          <dd className="text-muted-foreground">{fmtDate(p.ingested_at)}</dd>
        </div>
      </dl>

      {/* Reason badges */}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {p.reasons.map((r, i) => (
          <ReasonBadge key={i} reason={r} />
        ))}
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function AuditView() {
  const [flagged, setFlagged] = useState<FlaggedProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("properties")
      .select("id, address, city, owner_name, source, source_url, ingested_at, confidence_flags")
      .order("ingested_at", { ascending: false });

    const rows = (data ?? []) as Property[];
    const results: FlaggedProperty[] = rows
      .map((p) => ({ ...p, reasons: classify(p) }))
      .filter((p) => p.reasons.length > 0);

    setFlagged(results);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDeleteConfirm = useCallback(
    (id: string) => {
      setFlagged((prev) => prev.filter((p) => p.id !== id));
      setDeletingId(null);
      setDeleteError(null);
      startTransition(async () => {
        const result = await deleteProperty(id);
        if (result.error) {
          setDeleteError(result.error);
          load(); // reload to restore the row
        }
      });
    },
    [load]
  );

  const countByKind = {
    "bad-address": flagged.filter((p) =>
      p.reasons.some((r) => r.kind === "bad-address")
    ).length,
    "govt-owner": flagged.filter((p) =>
      p.reasons.some((r) => r.kind === "govt-owner")
    ).length,
    "missing-core": flagged.filter((p) =>
      p.reasons.some((r) => r.kind === "missing-core")
    ).length,
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 space-y-8">
      {/* Header */}
      <div>
        <Link
          href="/crm"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          ← CRM
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Data audit</h1>
        <p className="mt-1.5 text-sm text-muted-foreground max-w-prose">
          Properties flagged for review based on three bad-data patterns left by
          the old broken address endpoint. Review each record and delete if it
          should not be in your CRM.
        </p>
      </div>

      {/* Legend */}
      <div className="rounded-lg border bg-muted/20 p-4 space-y-2 text-sm">
        <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-3">
          Why a record is flagged
        </p>
        <div className="flex items-start gap-2">
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20 px-2 py-0.5 text-xs font-medium">
            <AlertTriangle className="size-3" /> Bad address
          </span>
          <span className="text-muted-foreground">
            Address is <span className="font-mono text-foreground">&quot;111 NW 1 ST&quot;</span> — the
            Miami-Dade Government Center placeholder returned by the broken
            PA proxy for every lookup.
          </span>
        </div>
        <div className="flex items-start gap-2">
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-800 border border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 px-2 py-0.5 text-xs font-medium">
            <ShieldAlert className="size-3" /> Govt owner
          </span>
          <span className="text-muted-foreground">
            <code className="text-foreground">owner_name</code> matches a
            Miami-Dade County government entity you likely didn&apos;t intend to track.
          </span>
        </div>
        <div className="flex items-start gap-2">
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300 px-2 py-0.5 text-xs font-medium">
            <AlertTriangle className="size-3" /> Missing core
          </span>
          <span className="text-muted-foreground">
            <code className="text-foreground">confidence_flags</code> shows
            that address, owner name, or size was never found in the source
            record — the extracted data may be unreliable.
          </span>
        </div>
      </div>

      {/* Delete error */}
      {deleteError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" />
          Delete failed: {deleteError}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">Scanning properties…</span>
        </div>
      ) : flagged.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <CheckCircle2 className="size-10 text-green-500" />
          <p className="font-medium">No bad records found</p>
          <p className="text-sm text-muted-foreground">
            All properties passed the audit checks.
          </p>
          <Link
            href="/crm"
            className="text-sm text-primary underline underline-offset-2"
          >
            Back to CRM
          </Link>
        </div>
      ) : (
        <>
          {/* Count summary */}
          <div className="flex items-center gap-4 text-sm flex-wrap">
            <span className="font-semibold">
              {flagged.length} record{flagged.length !== 1 ? "s" : ""} flagged
            </span>
            {countByKind["bad-address"] > 0 && (
              <span className="text-muted-foreground">
                {countByKind["bad-address"]} bad address
              </span>
            )}
            {countByKind["govt-owner"] > 0 && (
              <span className="text-muted-foreground">
                {countByKind["govt-owner"]} govt owner
              </span>
            )}
            {countByKind["missing-core"] > 0 && (
              <span className="text-muted-foreground">
                {countByKind["missing-core"]} missing core fields
              </span>
            )}
          </div>

          {/* Record list */}
          <div className="space-y-3">
            {flagged.map((p) => (
              <PropertyRow
                key={p.id}
                p={p}
                deletingId={deletingId}
                onDeleteRequest={setDeletingId}
                onDeleteConfirm={handleDeleteConfirm}
                onDeleteCancel={() => setDeletingId(null)}
              />
            ))}
          </div>

          <p className="text-xs text-muted-foreground pt-2">
            Deleting a property also removes any contacts linked only to that
            property via <code>linked_properties</code>. Lease abstracts linked
            to the property will have their <code>linked_property</code> set to
            null.
          </p>
        </>
      )}

      {/* Footer with DB count as sanity reference */}
      {!loading && (
        <div className="pt-4 border-t flex items-center justify-between text-xs text-muted-foreground">
          <span>
            <Building2 className="size-3 inline mr-1" />
            {flagged.length} flagged of your total properties
          </span>
          <Link href="/crm" className="hover:text-foreground transition-colors">
            Back to CRM →
          </Link>
        </div>
      )}
    </div>
  );
}
