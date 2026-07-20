"use client";

import { useState, useTransition } from "react";
import { Clock, Plus, X, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createActivity, type Activity, type ActivityType } from "@/app/activities/actions";
import { FollowUpNudge } from "@/components/follow-up-nudge";
import {
  ActivityTimeline,
  type ActivityEvent,
  type FollowUpEvent,
  type TimelineEvent,
} from "@/components/activity-timeline";

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVITY_TYPES: { value: ActivityType; label: string }[] = [
  { value: "call",    label: "Call" },
  { value: "email",   label: "Email" },
  { value: "letter",  label: "Letter" },
  { value: "meeting", label: "Meeting" },
  { value: "note",    label: "Note" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivityContact = {
  id: string;
  name: string | null;
  contact_tier?: number | null;
};

export type PropertyFollowUpInput = {
  id: string;
  description: string;
  due_date: string;
  done: boolean;
};

type Phase = "idle" | "logging" | "nudging";

// ─── Component ────────────────────────────────────────────────────────────────

export function PropertyActivitySection({
  propertyId,
  linkedContacts,
  initialActivities,
  initialFollowUps = [],
}: {
  propertyId: string;
  linkedContacts: ActivityContact[];
  initialActivities: Activity[];
  initialFollowUps?: PropertyFollowUpInput[];
}) {
  const [activities, setActivities] = useState<Activity[]>(initialActivities);
  const [phase, setPhase] = useState<Phase>("idle");
  const [nudgeContactId, setNudgeContactId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const todayLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const contact_id = (fd.get("contact_id") as string) || null;
    const activity_type = fd.get("activity_type") as ActivityType;
    const rawDate = fd.get("activity_date") as string;
    const notes = (fd.get("notes") as string)?.trim() || null;
    const form = e.currentTarget;

    const activity_date = rawDate
      ? new Date(rawDate).toISOString()
      : new Date().toISOString();

    startTransition(async () => {
      const result = await createActivity({
        contact_id,
        property_id: propertyId,
        activity_type,
        activity_date,
        notes,
      });
      if (result.error) { setError(result.error); return; }
      setActivities((prev) => [
        {
          id: result.id!,
          contact_id,
          property_id: propertyId,
          activity_type,
          activity_date,
          notes,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
      form.reset();
      if (contact_id) {
        setNudgeContactId(contact_id);
        setPhase("nudging");
      } else {
        setPhase("idle");
      }
    });
  }

  const nudgeContact = linkedContacts.find((c) => c.id === nudgeContactId);
  const nudgeCadence = ({ 1: 14, 2: 30, 3: 90 } as Record<number, number>)[nudgeContact?.contact_tier ?? 0] ?? 14;

  // ─── Build unified timeline ─────────────────────────────────────────────────

  const actEvents: ActivityEvent[] = activities.map((a) => {
    const contact = a.contact_id ? linkedContacts.find((c) => c.id === a.contact_id) : null;
    return {
      kind: "activity",
      id: a.id,
      type: a.activity_type,
      date: a.activity_date,
      notes: a.notes,
      contact_name: contact?.name ?? null,
    };
  });

  const fuEvents: FollowUpEvent[] = initialFollowUps.map((fu) => ({
    kind: "followup",
    id: fu.id,
    description: fu.description,
    due_date: fu.due_date,
    done: fu.done,
  }));

  const allEvents: TimelineEvent[] = [...actEvents, ...fuEvents];
  const totalCount = allEvents.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="size-4" />
          Timeline
          {totalCount > 0 && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              ({totalCount})
            </span>
          )}
        </CardTitle>
        {phase !== "nudging" && (
          <button
            onClick={() => { setPhase(phase === "logging" ? "idle" : "logging"); setError(null); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {phase === "logging" ? (
              <><X className="size-3.5" />Cancel</>
            ) : (
              <><Plus className="size-3.5" />Log activity</>
            )}
          </button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Log form */}
        {phase === "logging" && (
          <form
            onSubmit={handleSubmit}
            className="rounded-lg border p-4 space-y-3 bg-muted/10"
          >
            <p className="text-sm font-medium">Log activity</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {linkedContacts.length > 0 && (
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">Contact (optional)</label>
                  <select
                    name="contact_id"
                    disabled={isPending}
                    defaultValue=""
                    className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background"
                  >
                    <option value="">— No contact (property only) —</option>
                    {linkedContacts.map((c) => (
                      <option key={c.id} value={c.id}>{c.name ?? "Unknown"}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <select
                  name="activity_type"
                  required
                  disabled={isPending}
                  defaultValue="call"
                  className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background"
                >
                  {ACTIVITY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Date & time</label>
                <input
                  type="datetime-local"
                  name="activity_date"
                  defaultValue={todayLocal}
                  disabled={isPending}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                <textarea
                  name="notes"
                  rows={2}
                  disabled={isPending}
                  placeholder="Add a note…"
                  className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background resize-none"
                />
              </div>
            </div>

            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={isPending} size="sm">
                {isPending ? (
                  <><Loader2 className="size-3.5 animate-spin" />Saving…</>
                ) : (
                  "Log"
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => { setPhase("idle"); setError(null); }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {/* Follow-up nudge */}
        {phase === "nudging" && nudgeContactId && (
          <FollowUpNudge
            contactId={nudgeContactId}
            propertyId={propertyId}
            suggestedDays={nudgeCadence}
            onDone={() => { setPhase("idle"); setNudgeContactId(null); }}
          />
        )}

        {/* Unified chronological timeline */}
        {allEvents.length > 0 && <ActivityTimeline events={allEvents} />}

        {allEvents.length === 0 && phase !== "logging" && (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
