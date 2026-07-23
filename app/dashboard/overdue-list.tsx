"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Mail, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { generateDrafts, logOutreach, type DueContact } from "@/app/outreach/actions";
import { composeUrl, isWebCompose, readStoredProvider, readStoredUserEmail } from "@/lib/email-provider";
import { FollowUpNudge } from "@/components/follow-up-nudge";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tierCls(tier: number | null) {
  if (tier === 1) return "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400";
  if (tier === 2) return "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400";
  return "bg-muted text-muted-foreground";
}

function overdueBadgeCls(days: number) {
  if (days > 14) return "text-destructive font-semibold";
  if (days > 0)  return "text-yellow-600 dark:text-yellow-400 font-medium";
  return "text-muted-foreground";
}

function overdueLabel(days: number) {
  if (days > 0)  return `${days}d overdue`;
  if (days === 0) return "due today";
  return `due in ${Math.abs(days)}d`;
}

// ─── Per-contact draft state ──────────────────────────────────────────────────

type DraftState =
  | { tag: "idle" }
  | { tag: "generating" }
  | { tag: "ready"; subject: string; body: string }
  | { tag: "sending" }
  | { tag: "sent_nudge" }   // sent, now nudging for follow-up
  | { tag: "sent" }
  | { tag: "error"; message: string };

// ─── Main component ───────────────────────────────────────────────────────────

export function OverdueList({
  contacts,
  mode = "all",
  limit,
}: {
  contacts: DueContact[];
  /** attention = overdue + due today (for dashboard); all = includes due-soon collapsible */
  mode?: "all" | "attention";
  limit?: number;
}) {
  const [drafts, setDrafts] = useState<Map<string, DraftState>>(new Map());
  const [brokerContext, setBrokerContext] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("beacon_broker_context");
    if (saved) setBrokerContext(saved);
  }, []);

  function getState(id: string): DraftState {
    return drafts.get(id) ?? { tag: "idle" };
  }

  function setState(id: string, state: DraftState) {
    setDrafts((prev) => new Map(prev).set(id, state));
  }

  async function handleDraft(contact: DueContact) {
    setState(contact.id, { tag: "generating" });
    const res = await generateDrafts([contact.id], brokerContext);
    if (res.error || !res.drafts?.length) {
      setState(contact.id, { tag: "error", message: res.error ?? "No draft returned." });
      return;
    }
    const d = res.drafts[0];
    setState(contact.id, { tag: "ready", subject: d.subject, body: d.body });
  }

  async function handleSend(contact: DueContact, subject: string, body: string) {
    setState(contact.id, { tag: "sending" });
    const res = await logOutreach(contact.id, subject, body);
    if (res.error) {
      setState(contact.id, { tag: "error", message: res.error });
      return;
    }
    setState(contact.id, { tag: "sent_nudge" });
  }

  const overdue  = contacts.filter((c) => c.daysOverdue > 0);
  const dueToday = contacts.filter((c) => c.daysOverdue === 0);
  const dueSoon  = contacts.filter((c) => c.daysOverdue < 0);

  const attentionList = [...overdue, ...dueToday].slice(0, limit);
  const showAttention = mode === "attention";

  if (showAttention && attentionList.length === 0) {
    return null;
  }

  if (!showAttention && contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
        <div className="size-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
          <CheckCircle2 className="size-6 text-emerald-600" />
        </div>
        <p className="text-sm font-medium">All contacts on cadence</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          No overdue outreach — great time to prospect or review expiring leases.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {showAttention ? (
        attentionList.map((c) => (
          <ContactRow
            key={c.id}
            contact={c}
            state={getState(c.id)}
            onDraft={() => handleDraft(c)}
            onSend={(subject, body) => handleSend(c, subject, body)}
            onEditState={(s) => setState(c.id, s)}
          />
        ))
      ) : (
        <>
          {overdue.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              state={getState(c.id)}
              onDraft={() => handleDraft(c)}
              onSend={(subject, body) => handleSend(c, subject, body)}
              onEditState={(s) => setState(c.id, s)}
            />
          ))}
          {dueSoon.length > 0 && (
            <DueSoonGroup contacts={dueSoon} getState={getState} onDraft={handleDraft} onSend={handleSend} setContactState={setState} />
          )}
        </>
      )}
    </div>
  );
}

// ─── Contact row ──────────────────────────────────────────────────────────────

function ContactRow({
  contact: c,
  state,
  onDraft,
  onSend,
  onEditState,
}: {
  contact: DueContact;
  state: DraftState;
  onDraft: () => void;
  onSend: (subject: string, body: string) => void;
  onEditState: (s: DraftState) => void;
}) {
  const primaryProp = c.resolvedProperties?.[0];

  return (
    <div className="rounded-lg border bg-card">
      {/* Contact header row */}
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
        <span className={cn("text-xs font-bold rounded px-1.5 py-0.5 shrink-0", tierCls(c.contact_tier))}>
          T{c.contact_tier}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/contacts/${c.id}`}
              className="text-sm font-semibold hover:underline underline-offset-2"
            >
              {c.name ?? "Unnamed"}
            </Link>
            {c.company && (
              <span className="text-xs text-muted-foreground">{c.company}</span>
            )}
            {primaryProp?.address && (
              <Link
                href={`/properties/${primaryProp.id}`}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
              >
                <ExternalLink className="size-3" />
                {primaryProp.address}
              </Link>
            )}
          </div>
        </div>

        <span className={cn("text-xs shrink-0", overdueBadgeCls(c.daysOverdue))}>
          {overdueLabel(c.daysOverdue)}
        </span>

        {state.tag === "idle" && (
          <Button size="sm" variant="outline" onClick={onDraft} className="shrink-0 flex items-center gap-1.5 h-7 text-xs">
            <Mail className="size-3.5" />
            Compose
          </Button>
        )}
        {state.tag === "generating" && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Loader2 className="size-3.5 animate-spin" />
            Drafting…
          </div>
        )}
        {(state.tag === "sent_nudge" || state.tag === "sent") && (
          <div className="flex items-center gap-1.5 text-xs text-green-600 shrink-0">
            <CheckCircle2 className="size-3.5" />
            Logged
          </div>
        )}
        {state.tag === "error" && (
          <div className="flex items-center gap-1.5 text-xs text-destructive shrink-0">
            <AlertTriangle className="size-3.5" />
            <button onClick={onDraft} className="underline underline-offset-2">Retry</button>
          </div>
        )}
      </div>

      {/* Inline draft panel */}
      {state.tag === "ready" && (
        <DraftPanel
          email={c.email}
          subject={state.subject}
          body={state.body}
          onSend={onSend}
          onDiscard={() => onEditState({ tag: "idle" })}
          sending={false}
        />
      )}
      {state.tag === "sending" && (
        <div className="border-t px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Logging outreach…
        </div>
      )}
      {state.tag === "sent_nudge" && (
        <div className="border-t px-4 py-3">
          <FollowUpNudge
            contactId={c.id}
            suggestedDays={c.cadenceDays}
            onDone={() => onEditState({ tag: "sent" })}
          />
        </div>
      )}
    </div>
  );
}

// ─── Draft panel ──────────────────────────────────────────────────────────────

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
  const [body, setBody]       = useState(initBody);

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

// ─── Due-soon collapsible group ───────────────────────────────────────────────

function DueSoonGroup({
  contacts,
  getState,
  onDraft,
  onSend,
  setContactState,
}: {
  contacts: DueContact[];
  getState: (id: string) => DraftState;
  onDraft: (c: DueContact) => void;
  onSend: (c: DueContact, subject: string, body: string) => void;
  setContactState: (id: string, s: DraftState) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        {contacts.length} contact{contacts.length !== 1 ? "s" : ""} due soon
      </button>
      {open && (
        <div className="space-y-1 mt-1">
          {contacts.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              state={getState(c.id)}
              onDraft={() => onDraft(c)}
              onSend={(s, b) => onSend(c, s, b)}
              onEditState={(s) => setContactState(c.id, s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
