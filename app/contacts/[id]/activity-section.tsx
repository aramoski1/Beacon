"use client";

import { useState, useTransition } from "react";
import { Clock, Plus, X, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createActivity, type Activity, type ActivityType } from "@/app/activities/actions";
import { FollowUpNudge } from "@/components/follow-up-nudge";

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVITY_TYPES: { value: ActivityType; label: string }[] = [
  { value: "call",    label: "Call" },
  { value: "email",   label: "Email" },
  { value: "letter",  label: "Letter" },
  { value: "meeting", label: "Meeting" },
  { value: "note",    label: "Note" },
];

const TYPE_CLS: Record<ActivityType, string> = {
  call:    "bg-blue-100 text-blue-700",
  email:   "bg-violet-100 text-violet-700",
  letter:  "bg-amber-100 text-amber-700",
  meeting: "bg-green-100 text-green-700",
  note:    "bg-slate-100 text-slate-600",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

type Phase = "idle" | "logging" | "nudging";

export function ContactActivitySection({
  contactId,
  contactTier,
  initialActivities,
}: {
  contactId: string;
  contactTier?: number | null;
  initialActivities: Activity[];
}) {
  const [activities, setActivities] = useState<Activity[]>(initialActivities);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const todayLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);

  const cadenceDays = ({ 1: 14, 2: 30, 3: 90 } as Record<number, number>)[contactTier ?? 0] ?? 14;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const activity_type = fd.get("activity_type") as ActivityType;
    const rawDate = fd.get("activity_date") as string;
    const notes = (fd.get("notes") as string)?.trim() || null;
    const form = e.currentTarget;

    const activity_date = rawDate
      ? new Date(rawDate).toISOString()
      : new Date().toISOString();

    startTransition(async () => {
      const result = await createActivity({
        contact_id: contactId,
        activity_type,
        activity_date,
        notes,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setActivities((prev) => [
        {
          id: result.id!,
          contact_id: contactId,
          property_id: null,
          activity_type,
          activity_date,
          notes,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
      form.reset();
      setPhase("nudging");
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="size-4" />
          Activity
          {activities.length > 0 && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              ({activities.length})
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
        {phase === "nudging" && (
          <FollowUpNudge
            contactId={contactId}
            suggestedDays={cadenceDays}
            onDone={() => setPhase("idle")}
          />
        )}

        {/* Timeline */}
        {activities.length === 0 && phase === "idle" && (
          <p className="text-sm text-muted-foreground">No activities logged yet.</p>
        )}
        {activities.length > 0 && (
          <ol className="space-y-3">
            {activities.map((a) => (
              <li key={a.id} className="border-l-2 border-border pl-4 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                      TYPE_CLS[a.activity_type]
                    )}
                  >
                    {a.activity_type}
                  </span>
                  <p className="text-xs text-muted-foreground">{fmtDate(a.activity_date)}</p>
                </div>
                {a.notes && (
                  <p className="text-sm text-muted-foreground">{a.notes}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
