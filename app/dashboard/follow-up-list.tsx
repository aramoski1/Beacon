import Link from "next/link";
import { Building2, User, CalendarDays } from "lucide-react";
import type { FollowUpRow } from "@/app/follow-ups/actions";
import { formatLocalDate, todayLocal } from "@/lib/dates";
import { stripDemoLabel } from "@/lib/demo-display";

function fmtUpcomingDate(iso: string) {
  const today = todayLocal();
  const due = iso.slice(0, 10);
  const diff = Math.round(
    (new Date(`${due}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000,
  );
  if (diff === 1) return "tomorrow";
  if (diff <= 7) return formatLocalDate(iso, { weekday: "short" }) ?? iso;
  return formatLocalDate(iso, { month: "short", day: "numeric" }) ?? iso;
}

export function UpcomingFollowUpList({ items }: { items: FollowUpRow[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No upcoming follow-ups — overdue and due-today tasks are in Do these today.
      </p>
    );
  }

  return (
    <div className="rounded-xl border overflow-hidden divide-y">
      {items.map((row) => (
        <div key={row.id} className="flex items-start gap-2.5 px-3 py-2 hover:bg-muted/20 transition-colors">
          <CalendarDays className="size-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <Link
              href={row.contact_id ? `/contacts/${row.contact_id}` : "/follow-ups"}
              className="text-sm font-medium hover:underline underline-offset-2"
            >
              {stripDemoLabel(row.description) ?? row.description}
            </Link>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              {row.contact_name && row.contact_id && (
                <Link
                  href={`/contacts/${row.contact_id}`}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <User className="size-3" />
                  {row.contact_name}
                </Link>
              )}
              {row.property_address && row.property_id && (
                <Link
                  href={`/properties/${row.property_id}`}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground truncate"
                >
                  <Building2 className="size-3 shrink-0" />
                  <span className="truncate">{row.property_address}</span>
                </Link>
              )}
            </div>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
            {fmtUpcomingDate(row.due_date)}
          </span>
        </div>
      ))}
    </div>
  );
}
