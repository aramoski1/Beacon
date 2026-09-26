"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComposeOutreach } from "@/components/compose-outreach";
import { createActivity } from "@/app/activities/actions";
import { formatCallOutcomeNote, type CallOutcome } from "@/lib/activity-touch";
import { contactTypeLabel } from "@/lib/contact-type";
import { pinWeeklyList, type WeeklyListState } from "./actions";
import { formatLocalDate, todayLocal } from "@/lib/dates";

const OUTCOMES: { id: CallOutcome; label: string }[] = [
  { id: "connected", label: "Connected" },
  { id: "left_vm", label: "Left VM" },
  { id: "no_answer", label: "No answer" },
];

function workedThisWeek(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);
  return d >= start;
}

export function WeekListView({ initial }: { initial: WeeklyListState }) {
  const router = useRouter();
  const [listId, setListId] = useState(initial.smartListId ?? "");
  const [target, setTarget] = useState(String(initial.target));
  const [composeId, setComposeId] = useState<string | null>(null);
  const [logId, setLogId] = useState<string | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function savePin() {
    setError(null);
    start(async () => {
      const res = await pinWeeklyList(listId || null, Number(target) || 25);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  async function logCall(contactId: string, outcome: CallOutcome) {
    setLogId(contactId);
    setOutcomeFor(null);
    const res = await createActivity({
      contact_id: contactId,
      activity_type: "call",
      notes: formatCallOutcomeNote(outcome),
    });
    setLogId(null);
    if (res.error) {
      window.alert(res.error);
      return;
    }
    router.refresh();
  }

  function outreachAll() {
    const ids = initial.contacts.map((c) => c.id);
    if (ids.length === 0) return;
    sessionStorage.setItem("beacon_outreach_selection", JSON.stringify(ids));
    router.push("/outreach");
  }

  const compose = initial.contacts.find((c) => c.id === composeId) ?? null;
  const doneCount = initial.contacts.filter((c) => workedThisWeek(c.last_contacted_at)).length;
  const pct = initial.contacts.length === 0 ? 0 : Math.round((doneCount / initial.contacts.length) * 100);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">This week&apos;s segment</p>
            <p className="text-sm mt-1">
              {doneCount} of {initial.contacts.length || initial.target} worked
              {initial.source === "smart-list" && initial.smartListName
                ? ` · ${initial.smartListName}`
                : " · cadence due this week"}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={initial.contacts.length === 0}
            onClick={outreachAll}
          >
            <Mail className="size-3.5" />
            Generate drafts ({initial.contacts.length})
          </Button>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm space-y-1">
            <span className="text-xs text-muted-foreground">Pinned smart list</span>
            <select
              value={listId}
              onChange={(e) => setListId(e.target.value)}
              className="block w-56 border border-border rounded-md px-2 py-1.5 text-sm bg-background"
            >
              <option value="">Cadence due (next 7 days)</option>
              {initial.lists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm space-y-1">
            <span className="text-xs text-muted-foreground">How many</span>
            <input
              type="number"
              min={5}
              max={100}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="block w-20 border border-border rounded-md px-2 py-1.5 text-sm bg-background"
            />
          </label>
          <Button type="button" size="sm" variant="outline" onClick={savePin} disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          Pin an Owners or Tenants smart list from Workspace, or work whoever is due on cadence.
          Log a call or generate merge drafts without leaving this list.
        </p>
      </div>

      {compose && (
        <ComposeOutreach
          contactId={compose.id}
          contactName={compose.name}
          contactEmail={compose.email}
          onDone={() => setComposeId(null)}
        />
      )}

      {initial.contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Nothing in this week&apos;s list yet. Open Workspace → Contacts → Owners book, save a smart list, then pin it here.
        </p>
      ) : (
        <ul className="rounded-xl border bg-card divide-y">
          {initial.contacts.map((c) => {
            const done = workedThisWeek(c.last_contacted_at);
            return (
              <li key={c.id} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/contacts/${c.id}`} className="text-sm font-medium hover:underline">
                      {c.name ?? "No name"}
                    </Link>
                    {done && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                        Done
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {contactTypeLabel(c.contact_type)}
                    {c.company ? ` · ${c.company}` : ""}
                    {c.occupancy.address ? ` · ${c.occupancy.address}` : ""}
                    {c.occupancy.expiry ? (() => {
                      const day = c.occupancy.expiry.slice(0, 10);
                      const today = todayLocal();
                      const label = formatLocalDate(day, { month: "short", day: "numeric" }) ?? day;
                      return day < today ? ` · expired ${label}` : ` · expires ${label}`;
                    })() : ""}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {c.phone && (
                    <a
                      href={`tel:${c.phone}`}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                      title="Call"
                    >
                      <Phone className="size-3.5" />
                    </a>
                  )}
                  <div className="relative">
                    <button
                      type="button"
                      title="Log call"
                      disabled={logId === c.id}
                      onClick={() => setOutcomeFor(outcomeFor === c.id ? null : c.id)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted text-xs"
                    >
                      {logId === c.id ? <Loader2 className="size-3.5 animate-spin" /> : "Log"}
                    </button>
                    {outcomeFor === c.id && (
                      <div className="absolute right-0 top-full z-10 mt-1 rounded-md border bg-card shadow-md py-1 min-w-[8rem]">
                        {OUTCOMES.map((o) => (
                          <button
                            key={o.id ?? "x"}
                            type="button"
                            onClick={() => void logCall(c.id, o.id)}
                            className="block w-full text-left px-3 py-1.5 text-xs hover:bg-muted"
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    title="Email"
                    onClick={() => setComposeId(c.id)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Mail className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
