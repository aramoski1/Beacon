"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Clock, CalendarDays, PenLine, Loader2, X, Phone, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createActivity, type ActivityType } from "@/app/activities/actions";
import { createFollowUp } from "@/app/follow-ups/actions";
import { FollowUpNudge } from "@/components/follow-up-nudge";
import { ComposeOutreach } from "@/components/compose-outreach";
import { formatCallOutcomeNote, type CallOutcome } from "@/lib/activity-touch";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Panel = null | "email" | "activity" | "note" | "followup";
type SubPhase = "form" | "nudging";

// ─── Quick log form ────────────────────────────────────────────────────────────

const ACTIVITY_TYPES: { value: ActivityType; label: string }[] = [
  { value: "call",    label: "Call" },
  { value: "email",   label: "Email" },
  { value: "letter",  label: "Letter" },
  { value: "meeting", label: "Meeting" },
  { value: "note",    label: "Note" },
];

function QuickActivityForm({
  contactId,
  defaultType,
  onSuccess,
  onCancel,
}: {
  contactId: string;
  defaultType: ActivityType;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const todayLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const activity_type = fd.get("activity_type") as ActivityType;
    const rawDate = fd.get("activity_date") as string;
    const notes = (fd.get("notes") as string)?.trim() || null;
    const activity_date = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();

    startTransition(async () => {
      const result = await createActivity({ contact_id: contactId, activity_type, activity_date, notes });
      if (result.error) { setError(result.error); return; }
      onSuccess();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-muted/20 p-3 space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Type</label>
          <select
            name="activity_type"
            required
            disabled={isPending}
            defaultValue={defaultType}
            className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-background outline-none focus:ring-2 ring-ring"
          >
            {ACTIVITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Date</label>
          <input
            type="datetime-local"
            name="activity_date"
            defaultValue={todayLocal}
            disabled={isPending}
            className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-background outline-none focus:ring-2 ring-ring"
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
          <textarea
            name="notes"
            rows={2}
            disabled={isPending}
            placeholder="Add a note…"
            className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-background outline-none focus:ring-2 ring-ring resize-none"
          />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? <><Loader2 className="size-3.5 animate-spin" />Saving…</> : "Log"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Follow-up form ────────────────────────────────────────────────────────────

function FollowUpForm({
  contactId,
  onClose,
  onSuccess,
}: {
  contactId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const defaultDate = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const date = fd.get("date") as string;
    const description = (fd.get("description") as string)?.trim() || "Follow up";
    if (!date) return;

    startTransition(async () => {
      const result = await createFollowUp({ contact_id: contactId, due_date: date, description });
      if (result.error) { setError(result.error); return; }
      onSuccess();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-muted/20 p-3 space-y-3"
    >
      <div className="space-y-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Description</label>
          <input
            name="description"
            type="text"
            placeholder="Follow up"
            disabled={isPending}
            className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-background outline-none focus:ring-2 ring-ring"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Due date</label>
          <input
            type="date"
            name="date"
            defaultValue={defaultDate}
            required
            disabled={isPending}
            className="border border-border rounded-md px-3 py-1.5 text-sm bg-background outline-none focus:ring-2 ring-ring"
          />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? <><Loader2 className="size-3.5 animate-spin" />Saving…</> : "Set"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

const btnCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border bg-background hover:bg-muted/60 transition-colors";

export function QuickActions({
  contactId,
  contactName,
  contactEmail,
  userEmail,
}: {
  contactId: string;
  contactName: string | null;
  contactEmail: string | null;
  userEmail?: string | null;
}) {
  const [panel, setPanel]       = useState<Panel>(null);
  const [subPhase, setSubPhase] = useState<SubPhase>("form");
  const [quickPending, startQuick] = useTransition();
  const [quickError, setQuickError] = useState<string | null>(null);
  const router = useRouter();

  function openPanel(p: Panel) {
    setPanel(p);
    setSubPhase("form");
  }

  function handleActivitySuccess() {
    setSubPhase("nudging");
  }

  function handleNudgeDone() {
    setPanel(null);
    setSubPhase("form");
    router.refresh();
  }

  function handleFollowUpSuccess() {
    setPanel(null);
    setSubPhase("form");
    router.refresh();
  }

  function handleEmailSent() {
    router.refresh();
  }

  function handleEmailDone() {
    setPanel(null);
    setSubPhase("form");
    router.refresh();
  }

  function quickLog(
    activity_type: "call" | "meeting",
    notes: string,
  ) {
    setQuickError(null);
    startQuick(async () => {
      const result = await createActivity({
        contact_id: contactId,
        activity_type,
        notes,
      });
      if (result.error) {
        setQuickError(result.error);
        return;
      }
      setPanel("activity");
      setSubPhase("nudging");
      router.refresh();
    });
  }

  function logCall(outcome: CallOutcome) {
    quickLog("call", formatCallOutcomeNote(outcome));
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => openPanel(panel === "email" ? null : "email")}
          className={cn(btnCls, panel === "email" && "bg-muted/60")}
        >
          <Mail className="size-3.5 text-primary" />
          Email
        </button>
        <button
          type="button"
          disabled={quickPending}
          onClick={() => logCall("connected")}
          className={btnCls}
          title="Log call — connected (bumps cadence)"
        >
          {quickPending ? <Loader2 className="size-3.5 animate-spin" /> : <Phone className="size-3.5" />}
          Log call
        </button>
        <button
          type="button"
          disabled={quickPending}
          onClick={() => quickLog("meeting", "Tour / meeting logged")}
          className={btnCls}
          title="Log tour / meeting (bumps cadence)"
        >
          <MapPin className="size-3.5" />
          Log tour
        </button>
        <button
          onClick={() => openPanel(panel === "activity" ? null : "activity")}
          className={cn(btnCls, panel === "activity" && "bg-muted/60")}
        >
          <Clock className="size-3.5" />
          Log activity
        </button>
        <button
          onClick={() => openPanel(panel === "note" ? null : "note")}
          className={cn(btnCls, panel === "note" && "bg-muted/60")}
        >
          <PenLine className="size-3.5" />
          Add note
        </button>
        <button
          onClick={() => openPanel(panel === "followup" ? null : "followup")}
          className={cn(btnCls, panel === "followup" && "bg-muted/60")}
        >
          <CalendarDays className="size-3.5" />
          Set follow-up
        </button>
        {panel !== null && subPhase === "form" && (
          <button onClick={() => setPanel(null)} className="ml-auto text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {quickError && <p className="text-xs text-destructive">{quickError}</p>}
      <div className="flex flex-wrap gap-1.5">
        <span className="text-[10px] text-muted-foreground self-center">Call outcome:</span>
        {([
          ["connected", "Connected"],
          ["left_vm", "Left VM"],
          ["no_answer", "No answer"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            disabled={quickPending}
            onClick={() => logCall(value)}
            className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>

      {panel === "email" && (
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <ComposeOutreach
            contactId={contactId}
            contactName={contactName}
            contactEmail={contactEmail}
            userEmail={userEmail}
            onSent={handleEmailSent}
            onDone={handleEmailDone}
          />
        </div>
      )}

      {(panel === "activity" || panel === "note") && subPhase === "form" && (
        <QuickActivityForm
          contactId={contactId}
          defaultType={panel === "note" ? "note" : "call"}
          onSuccess={handleActivitySuccess}
          onCancel={() => setPanel(null)}
        />
      )}

      {(panel === "activity" || panel === "note") && subPhase === "nudging" && (
        <FollowUpNudge
          contactId={contactId}
          onDone={handleNudgeDone}
        />
      )}

      {panel === "followup" && (
        <FollowUpForm
          contactId={contactId}
          onClose={() => setPanel(null)}
          onSuccess={handleFollowUpSuccess}
        />
      )}
    </div>
  );
}
