"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ChevronRight,
  Loader2,
  Mail,
  User,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { generateDrafts, logOutreach } from "@/app/outreach/actions";
import { composeUrl, isWebCompose, readStoredProvider, readStoredUserEmail } from "@/lib/email-provider";
import {
  type LeaseRadarEntry,
  type LeaseRadarBucket,
  leaseLabel,
  fmtExpiry,
  rolloverHint,
  leaseOutreachContext,
  BUCKET_META,
} from "@/lib/lease-radar";

type DraftState =
  | { tag: "idle" }
  | { tag: "generating" }
  | { tag: "ready"; subject: string; body: string }
  | { tag: "sending" }
  | { tag: "sent" }
  | { tag: "error"; message: string };

function urgencyStyles(urgency: LeaseRadarEntry["urgency"]) {
  if (urgency === "critical") {
    return {
      badge: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
      row: "bg-red-500/[0.03]",
      days: "text-red-600 dark:text-red-400 font-bold",
    };
  }
  if (urgency === "high") {
    return {
      badge: "bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-500/25",
      row: "bg-amber-500/[0.03]",
      days: "text-amber-700 dark:text-amber-400 font-semibold",
    };
  }
  if (urgency === "medium") {
    return {
      badge: "bg-muted text-muted-foreground border-border",
      row: "",
      days: "text-muted-foreground font-medium",
    };
  }
  return {
    badge: "bg-muted/60 text-muted-foreground border-border",
    row: "",
    days: "text-muted-foreground",
  };
}

function DraftPanel({
  email,
  subject: initSubject,
  body: initBody,
  onSend,
  onDiscard,
  sending,
}: {
  email: string | null;
  subject: string;
  body: string;
  onSend: (subject: string, body: string) => void;
  onDiscard: () => void;
  sending: boolean;
}) {
  const [subject, setSubject] = useState(initSubject);
  const [body, setBody] = useState(initBody);
  const composeHref = composeUrl(
    email,
    subject,
    body,
    readStoredUserEmail(),
    readStoredProvider()
  );

  return (
    <div className="border-t px-4 py-3 space-y-2 bg-muted/20">
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="w-full text-sm font-medium bg-transparent border-0 border-b border-border/50 pb-1 focus:outline-none focus:border-primary"
        placeholder="Subject"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        className="w-full text-sm bg-transparent resize-none focus:outline-none leading-relaxed"
        placeholder="Email body"
      />
      <div className="flex gap-2 pt-1 flex-wrap">
        {email && composeHref ? (
          <a
            href={composeHref}
            target={isWebCompose(composeHref) ? "_blank" : undefined}
            rel={isWebCompose(composeHref) ? "noopener noreferrer" : undefined}
            onClick={() => onSend(subject, body)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Mail className="size-3.5" />
            Open in email · log send
          </a>
        ) : (
          <Button size="sm" onClick={() => onSend(subject, body)} disabled={sending}>
            Mark as sent
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDiscard} disabled={sending} className="text-xs">
          Discard
        </Button>
      </div>
    </div>
  );
}

function LeaseRadarRow({ entry }: { entry: LeaseRadarEntry }) {
  const [draft, setDraft] = useState<DraftState>({ tag: "idle" });
  const [brokerContext, setBrokerContext] = useState("");
  const styles = urgencyStyles(entry.urgency);
  const contact = entry.owner_contact;

  useEffect(() => {
    const saved = localStorage.getItem("beacon_broker_context");
    if (saved) setBrokerContext(saved);
  }, []);

  async function handleCompose() {
    if (!contact?.id) return;
    setDraft({ tag: "generating" });
    const context = [brokerContext, leaseOutreachContext(entry)].filter(Boolean).join("\n\n");
    const res = await generateDrafts([contact.id], context, "check-in");
    if (res.error || !res.drafts?.length) {
      setDraft({ tag: "error", message: res.error ?? "No draft returned." });
      return;
    }
    const d = res.drafts[0];
    setDraft({ tag: "ready", subject: d.subject, body: d.body });
  }

  async function handleSend(subject: string, body: string) {
    if (!contact?.id) return;
    setDraft({ tag: "sending" });
    const res = await logOutreach(contact.id, subject, body);
    if (res.error) {
      setDraft({ tag: "error", message: res.error });
      return;
    }
    setDraft({ tag: "sent" });
  }

  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", styles.row)}>
      <div className="flex items-start gap-3 px-4 py-3 flex-wrap">
        <div className={cn(
          "shrink-0 flex flex-col items-center justify-center size-11 rounded-lg border text-center",
          styles.badge,
        )}>
          <span className={cn("text-sm tabular-nums leading-none", styles.days)}>{entry.daysUntilExpiry}</span>
          <span className="text-[9px] uppercase tracking-wide opacity-70">days</span>
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            {entry.urgency === "critical" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">
                <AlertTriangle className="size-3" />
                Urgent
              </span>
            )}
            <Link
              href={`/abstracts/${entry.id}`}
              className="text-sm font-semibold hover:underline underline-offset-2"
            >
              {leaseLabel(entry.source_document)}
            </Link>
            {entry.base_rate != null && (
              <span className="text-xs text-muted-foreground">${entry.base_rate}/sf</span>
            )}
          </div>

          {entry.property_address && entry.property_id ? (
            <Link
              href={`/properties/${entry.property_id}`}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 w-fit"
            >
              <Building2 className="size-3 shrink-0" />
              {entry.property_address}
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">No property linked</p>
          )}

          {contact ? (
            <Link
              href={`/contacts/${contact.id}`}
              className="text-xs flex items-center gap-1 w-fit hover:underline underline-offset-2"
            >
              <User className="size-3 text-muted-foreground" />
              <span className="font-medium">{contact.name ?? "Contact"}</span>
              {contact.company && (
                <span className="text-muted-foreground">· {contact.company}</span>
              )}
            </Link>
          ) : entry.property_owner_name ? (
            <p className="text-xs text-muted-foreground">
              Owner: {entry.property_owner_name}
              <span className="text-amber-600 dark:text-amber-400 ml-1">· No CRM contact linked</span>
            </p>
          ) : null}

          <p className="text-[11px] text-muted-foreground">
            Expires {fmtExpiry(entry.expiration_date)} · {rolloverHint(entry.daysUntilExpiry)}
          </p>
        </div>

        <div className="shrink-0 flex flex-col items-end gap-1.5">
          {draft.tag === "sent" ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircle2 className="size-3.5" />
              Logged
            </span>
          ) : contact?.id ? (
            <>
              {draft.tag === "idle" && (
                <Button size="sm" variant="default" className="h-8 text-xs gap-1.5" onClick={handleCompose}>
                  <Mail className="size-3.5" />
                  Start outreach
                </Button>
              )}
              {draft.tag === "generating" && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Drafting…
                </span>
              )}
              {draft.tag === "error" && (
                <button type="button" onClick={handleCompose} className="text-xs text-destructive underline">
                  Retry
                </button>
              )}
            </>
          ) : entry.property_id ? (
            <Link
              href={`/properties/${entry.property_id}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline underline-offset-2"
            >
              Add contact
              <ChevronRight className="size-3" />
            </Link>
          ) : null}
        </div>
      </div>

      {draft.tag === "ready" && (
        <DraftPanel
          email={contact?.email ?? null}
          subject={draft.subject}
          body={draft.body}
          onSend={handleSend}
          onDiscard={() => setDraft({ tag: "idle" })}
          sending={false}
        />
      )}
      {draft.tag === "sending" && (
        <div className="border-t px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Logging outreach…
        </div>
      )}
    </div>
  );
}

function BucketSection({
  bucket,
  entries,
}: {
  bucket: LeaseRadarBucket;
  entries: LeaseRadarEntry[];
}) {
  const meta = BUCKET_META[bucket];
  const isUrgent = bucket === "3mo";

  if (entries.length === 0) return null;

  return (
    <section id={`bucket-${bucket}`} className="scroll-mt-8 space-y-3">
      <div className={cn(
        "flex items-center justify-between gap-3 rounded-lg px-4 py-3 border",
        isUrgent ? "border-red-500/30 bg-red-500/[0.04]" : "border-border bg-muted/20",
      )}>
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            {isUrgent && <AlertTriangle className="size-4 text-red-600 dark:text-red-400" />}
            {meta.label}
            <span className="rounded-full bg-background border px-2 py-0.5 text-[10px] font-bold tabular-nums">
              {entries.length}
            </span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{meta.sub}</p>
        </div>
      </div>
      <div className="space-y-2">
        {entries.map((e) => (
          <LeaseRadarRow key={e.id} entry={e} />
        ))}
      </div>
    </section>
  );
}

export function LeaseRadarView({
  data,
  compact,
}: {
  data: import("@/lib/lease-radar").LeaseRadarData;
  compact?: boolean;
}) {
  if (data.counts.total === 0) {
    return (
      <div className="rounded-xl border bg-card px-4 py-10 text-center">
        <CalendarClock className="size-10 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-sm font-medium">No lease expirations in the next 12 months</p>
        <p className="text-xs text-muted-foreground mt-1">
          Abstract a lease to start tracking rollover signals.
        </p>
        <Link
          href="/abstracts/new"
          className="inline-block mt-4 text-xs text-primary hover:underline underline-offset-2"
        >
          Abstract a lease →
        </Link>
      </div>
    );
  }

  if (compact) {
    const preview = [...data.within3, ...data.within6].slice(0, 6);
    return (
      <div className="space-y-2">
        {data.urgentCount > 0 && (
          <div className="rounded-lg border border-red-500/25 bg-red-500/[0.05] px-4 py-2.5 flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-red-700 dark:text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 shrink-0" />
              {data.urgentCount} lease{data.urgentCount !== 1 ? "s" : ""} expiring within 90 days
            </p>
            <Link href="/lease-radar" className="text-xs font-medium text-primary hover:underline shrink-0">
              Full radar →
            </Link>
          </div>
        )}
        <div className="space-y-2">
          {preview.map((e) => (
            <LeaseRadarRow key={e.id} entry={e} />
          ))}
        </div>
        {data.counts.total > preview.length && (
          <div className="text-center pt-1">
            <Link href="/lease-radar" className="text-xs text-muted-foreground hover:text-foreground">
              View all {data.counts.total} expirations →
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-3 gap-3">
        {(["3mo", "6mo", "12mo"] as LeaseRadarBucket[]).map((b) => {
          const count = b === "3mo" ? data.counts.within3 : b === "6mo" ? data.counts.within6 : data.counts.within12;
          const meta = BUCKET_META[b];
          return (
            <a
              key={b}
              href={meta.href}
              className={cn(
                "rounded-xl border px-4 py-3 transition-colors hover:bg-muted/30",
                b === "3mo" && count > 0 && "border-red-500/30 bg-red-500/[0.03]",
              )}
            >
              <p className="text-2xl font-bold tabular-nums">{count}</p>
              <p className="text-xs font-medium mt-0.5">{meta.label}</p>
            </a>
          );
        })}
      </div>

      <BucketSection bucket="3mo" entries={data.within3} />
      <BucketSection bucket="6mo" entries={data.within6} />
      <BucketSection bucket="12mo" entries={data.within12} />
    </div>
  );
}
