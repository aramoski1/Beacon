"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  Mail,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { generateDrafts, logOutreach } from "@/app/outreach/actions";
import { FollowUpNudge } from "@/components/follow-up-nudge";
import type {
  EnrichedActionItem,
  ActionSignal,
  LeaseExpiringSignal,
} from "@/lib/action-item-signals";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tierCls(tier: number | null) {
  if (tier === 1)
    return "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400";
  if (tier === 2)
    return "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400";
  return "bg-muted text-muted-foreground";
}

function overdueCls(days: number) {
  if (days > 14) return "text-destructive font-semibold";
  if (days > 0) return "text-yellow-600 dark:text-yellow-400 font-medium";
  return "text-muted-foreground";
}

function overdueLabel(days: number) {
  if (days > 0) return `${days}d overdue`;
  if (days === 0) return "due today";
  return `due in ${Math.abs(days)}d`;
}

// ─── Signal chips ─────────────────────────────────────────────────────────────

function SignalChips({ signals }: { signals: ActionSignal[] }) {
  const leases = signals.filter(
    (s): s is LeaseExpiringSignal => s.kind === "lease_expiring"
  );
  const hasOwnerChange = signals.some((s) => s.kind === "ownership_changed");

  if (leases.length === 0 && !hasOwnerChange) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {leases.slice(0, 1).map((l) => {
        const cls =
          l.daysUntilExpiry <= 30
            ? "bg-red-500/10 text-red-700 dark:text-red-400"
            : l.daysUntilExpiry <= 90
            ? "bg-orange-500/10 text-orange-700 dark:text-orange-400"
            : "bg-amber-500/10 text-amber-700 dark:text-amber-400";
        return (
          <span
            key={l.leaseId}
            className={cn(
              "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium",
              cls
            )}
          >
            <Clock className="size-2.5" />
            Lease {l.daysUntilExpiry}d
          </span>
        );
      })}
      {hasOwnerChange && (
        <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-500/10 text-violet-700 dark:text-violet-400">
          <Building2 className="size-2.5" />
          Owner changed
        </span>
      )}
    </div>
  );
}

// ─── Draft state ──────────────────────────────────────────────────────────────

type DraftState =
  | { tag: "idle" }
  | { tag: "generating" }
  | { tag: "ready"; subject: string; body: string }
  | { tag: "sending" }
  | { tag: "sent_nudge" }
  | { tag: "sent" }
  | { tag: "error"; message: string };

// ─── Main component ───────────────────────────────────────────────────────────

export function EnrichedContactList({
  items,
  limit = 8,
}: {
  items: EnrichedActionItem[];
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

  async function handleDraft(item: EnrichedActionItem) {
    setState(item.id, { tag: "generating" });
    const combined = [
      brokerContext,
      item.composeContext
        ? `Context for this outreach:\n${item.composeContext}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const res = await generateDrafts([item.id], combined);
    if (res.error || !res.drafts?.length) {
      setState(item.id, {
        tag: "error",
        message: res.error ?? "No draft returned.",
      });
      return;
    }
    const d = res.drafts[0];
    setState(item.id, { tag: "ready", subject: d.subject, body: d.body });
  }

  async function handleSend(
    itemId: string,
    subject: string,
    body: string
  ) {
    setState(itemId, { tag: "sending" });
    const res = await logOutreach(itemId, subject, body);
    if (res.error) {
      setState(itemId, { tag: "error", message: res.error });
      return;
    }
    setState(itemId, { tag: "sent_nudge" });
  }

  const attentionItems = items.filter((i) => i.daysOverdue >= 0).slice(0, limit);

  if (attentionItems.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {attentionItems.map((item) => {
        const state = getState(item.id);
        return (
          <EnrichedRow
            key={item.id}
            item={item}
            state={state}
            onDraft={() => handleDraft(item)}
            onSend={(subject, body) => handleSend(item.id, subject, body)}
            onEditState={(s) => setState(item.id, s)}
          />
        );
      })}
    </div>
  );
}

// ─── Enriched contact row ─────────────────────────────────────────────────────

function EnrichedRow({
  item,
  state,
  onDraft,
  onSend,
  onEditState,
}: {
  item: EnrichedActionItem;
  state: DraftState;
  onDraft: () => void;
  onSend: (subject: string, body: string) => void;
  onEditState: (s: DraftState) => void;
}) {
  // Strip "Name — " prefix from whyNow for the sub-line (name shown as link above)
  const dashIdx = item.whyNow.indexOf(" — ");
  const reasonText =
    dashIdx >= 0 ? item.whyNow.slice(dashIdx + 3) : item.whyNow;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-start gap-3 px-4 py-3">
        <span
          className={cn(
            "text-xs font-bold rounded px-1.5 py-0.5 shrink-0 mt-0.5",
            tierCls(item.contact_tier)
          )}
        >
          T{item.contact_tier}
        </span>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/contacts/${item.id}`}
              className="text-sm font-semibold hover:underline underline-offset-2"
            >
              {item.name ?? "Unnamed"}
            </Link>
            {item.company && (
              <span className="text-xs text-muted-foreground truncate">
                {item.company}
              </span>
            )}
          </div>
          {reasonText && (
            <p className="text-xs text-muted-foreground leading-snug">
              {reasonText}
            </p>
          )}
          <SignalChips signals={item.signals} />
        </div>

        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <span className={cn("text-xs", overdueCls(item.daysOverdue))}>
            {overdueLabel(item.daysOverdue)}
          </span>

          {state.tag === "idle" && (
            <Button
              size="sm"
              variant="outline"
              onClick={onDraft}
              className="h-7 text-xs px-2.5 flex items-center gap-1.5"
            >
              <Mail className="size-3.5" />
              Compose
            </Button>
          )}
          {state.tag === "generating" && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Drafting…
            </div>
          )}
          {(state.tag === "sent_nudge" || state.tag === "sent") && (
            <div className="flex items-center gap-1.5 text-xs text-green-600">
              <CheckCircle2 className="size-3.5" />
              Logged
            </div>
          )}
          {state.tag === "error" && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="size-3.5" />
              <button
                onClick={onDraft}
                className="underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>

      {state.tag === "ready" && (
        <DraftPanel
          email={item.email}
          subject={state.subject}
          body={state.body}
          onSend={onSend}
          onDiscard={() => onEditState({ tag: "idle" })}
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
            contactId={item.id}
            suggestedDays={
              ({ 1: 14, 2: 30, 3: 90 } as Record<number, number>)[
                item.contact_tier ?? 0
              ] ?? 14
            }
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
}: {
  email: string | null;
  subject: string;
  body: string;
  onSend: (subject: string, body: string) => void;
  onDiscard: () => void;
}) {
  const [subject, setSubject] = useState(initSubject);
  const [body, setBody] = useState(initBody);

  const mailtoHref = `mailto:${email ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

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
        {email ? (
          <a
            href={mailtoHref}
            onClick={() => onSend(subject, body)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Mail className="size-3.5" />
            Open in email · log send
          </a>
        ) : (
          <Button size="sm" onClick={() => onSend(subject, body)}>
            Mark as sent
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={onDiscard}
          className="text-xs"
        >
          Discard
        </Button>
      </div>
    </div>
  );
}
