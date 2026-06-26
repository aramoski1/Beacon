import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getLeaseRadarData } from "./actions";
import { LeaseRadarView } from "./lease-radar-view";

export default async function LeaseRadarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const data = await getLeaseRadarData();

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto space-y-8">
      <div>
        <Link
          href="/dashboard"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Dashboard
        </Link>
        <div className="mt-4 flex items-start gap-3">
          <div className="size-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
            <CalendarClock className="size-5 text-amber-700 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Rollover intelligence
            </p>
            <h1 className="text-xl font-semibold tracking-tight">Lease expiration radar</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl leading-relaxed">
              Tenants planning a move often decide months before a listing hits the market.
              Reach out while you still have an edge.
            </p>
          </div>
        </div>
      </div>

      {data.urgentCount > 0 && (
        <div className="rounded-xl border-2 border-red-500/40 bg-red-500/[0.06] px-5 py-4">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">
            {data.urgentCount} lease{data.urgentCount !== 1 ? "s" : ""} expiring within 90 days
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            These tenants are your highest-priority outreach — start conversations before competitors see the signal.
          </p>
        </div>
      )}

      <LeaseRadarView data={data} />
    </div>
  );
}
