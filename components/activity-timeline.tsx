"use client";

import Link from "next/link";
import { Phone, Mail, FileText, Users, StickyNote, CheckSquare, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityType } from "@/app/activities/actions";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ActivityEvent = {
  kind: "activity";
  id: string;
  type: ActivityType;
  date: string;
  notes: string | null;
  contact_name?: string | null;
};

export type FollowUpEvent = {
  kind: "followup";
  id: string;
  description: string;
  due_date: string;
  done: boolean;
  property_address?: string | null;
  property_id?: string | null;
};

export type OutreachEvent = {
  kind: "outreach";
  id: string;
  date: string;
  subject: string;
  body: string;
  method?: string | null;
};

export type TimelineEvent = ActivityEvent | FollowUpEvent | OutreachEvent;

// ─── Helpers ───────────────────────────────────────────────────────────────────

const ACTIVITY_ICON: Record<ActivityType, React.ReactNode> = {
  call:    <Phone className="size-3" />,
  email:   <Mail className="size-3" />,
  letter:  <FileText className="size-3" />,
  meeting: <Users className="size-3" />,
  note:    <StickyNote className="size-3" />,
};

const ACTIVITY_CLS: Record<ActivityType, string> = {
  call:    "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400",
  email:   "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-400",
  letter:  "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400",
  meeting: "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-400",
  note:    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

function eventDate(ev: TimelineEvent): number {
  if (ev.kind === "followup") return new Date(ev.due_date).getTime();
  return new Date(ev.date).getTime();
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function ActivityTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }

  const sorted = [...events].sort((a, b) => eventDate(b) - eventDate(a));
  const now = Date.now();

  return (
    <ol className="space-y-3">
      {sorted.map((ev, i) => {
        if (ev.kind === "activity") {
          return (
            <li key={`a-${ev.id}-${i}`} className="border-l-2 border-border pl-4 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                  ACTIVITY_CLS[ev.type],
                )}>
                  {ACTIVITY_ICON[ev.type]}
                  {ev.type}
                </span>
                <p className="text-xs text-muted-foreground">{fmtDate(ev.date)}</p>
                {ev.contact_name && (
                  <p className="text-xs text-muted-foreground">· {ev.contact_name}</p>
                )}
              </div>
              {ev.notes && <p className="text-sm text-muted-foreground">{ev.notes}</p>}
            </li>
          );
        }

        if (ev.kind === "followup") {
          const due = new Date(ev.due_date).getTime();
          const isOverdue = !ev.done && due < now;
          return (
            <li key={`f-${ev.id}-${i}`} className="border-l-2 border-border pl-4 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                  ev.done
                    ? "bg-muted text-muted-foreground"
                    : isOverdue
                    ? "bg-destructive/10 text-destructive"
                    : "bg-primary/10 text-primary",
                )}>
                  <CheckSquare className="size-3" />
                  {ev.done ? "Done" : isOverdue ? "Overdue" : "Due"}
                </span>
                <p className="text-xs text-muted-foreground">{fmtDate(ev.due_date)}</p>
              </div>
              <p className={cn("text-sm", ev.done && "line-through text-muted-foreground")}>
                {ev.description}
              </p>
              {ev.property_address && ev.property_id && (
                <Link
                  href={`/properties/${ev.property_id}`}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  @ {ev.property_address}
                </Link>
              )}
            </li>
          );
        }

        return (
          <li key={`o-${ev.id}-${i}`} className="border-l-2 border-border pl-4 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-400">
                <Send className="size-3" />
                Outreach{ev.method ? ` · ${ev.method}` : ""}
              </span>
              <p className="text-xs text-muted-foreground">{fmtDate(ev.date)}</p>
            </div>
            <p className="text-sm font-medium">{ev.subject}</p>
            <p className="text-sm text-muted-foreground line-clamp-3">{ev.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
