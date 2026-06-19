import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText, Plus, CalendarDays, DollarSign, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";

type LeaseAbstract = {
  id: string;
  source_document: string | null;
  execution_date: string | null;
  expiration_date: string | null;
  term: string | null;
  base_rate: number | null;
  created_at: string;
};

function sourceFileName(path: string | null) {
  if (!path) return "Unnamed lease";
  return path.split("/").pop() ?? path;
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function leaseStatus(expiration: string | null): "active" | "expiring" | "expired" | "unknown" {
  if (!expiration) return "unknown";
  const exp = new Date(expiration).getTime();
  const now = Date.now();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  if (exp < now) return "expired";
  if (exp < now + ninetyDays) return "expiring";
  return "active";
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active:   { label: "Active",          cls: "bg-green-100 text-green-700" },
  expiring: { label: "Expiring soon",   cls: "bg-amber-100 text-amber-700" },
  expired:  { label: "Expired",         cls: "bg-muted text-muted-foreground" },
  unknown:  { label: "No expiry",       cls: "bg-muted text-muted-foreground" },
};

export default async function AbstractsListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: abstracts, error } = await supabase
    .from("lease_abstracts")
    .select("id, source_document, execution_date, expiration_date, term, base_rate, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <p className="text-sm text-destructive">
          Could not load abstracts: {error.message}
        </p>
      </div>
    );
  }

  const rows = (abstracts ?? []) as LeaseAbstract[];

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lease Abstracts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} saved {rows.length === 1 ? "abstract" : "abstracts"}
          </p>
        </div>
        <Link
          href="/abstracts/new"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="size-4" />
          New abstract
        </Link>
      </div>

      {/* Empty state */}
      {rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
          <FileText className="size-12 text-muted-foreground/30" />
          <div>
            <p className="font-medium">No abstracts yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Upload a lease PDF and Beacon will extract the key fields automatically.
            </p>
          </div>
          <Link
            href="/abstracts/new"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm hover:bg-muted/60 transition-colors"
          >
            <Plus className="size-4" />
            Abstract your first lease
          </Link>
        </div>
      )}

      {/* List */}
      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((a) => {
            const status = leaseStatus(a.expiration_date);
            const badge = STATUS_BADGE[status];
            return (
              <Link
                key={a.id}
                href={`/abstracts/${a.id}`}
                className="flex items-start gap-4 p-4 rounded-lg border bg-card hover:bg-muted/20 transition-colors group"
              >
                {/* Icon */}
                <div className="shrink-0 mt-0.5 size-9 rounded-md bg-muted flex items-center justify-center">
                  <FileText className="size-4 text-muted-foreground" />
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm truncate group-hover:underline underline-offset-2">
                      {sourceFileName(a.source_document)}
                    </p>
                    <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                    {(a.execution_date || a.expiration_date) && (
                      <span className="flex items-center gap-1">
                        <CalendarDays className="size-3" />
                        {fmtDate(a.execution_date) ?? "—"} → {fmtDate(a.expiration_date) ?? "—"}
                      </span>
                    )}
                    {a.term && (
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {a.term}
                      </span>
                    )}
                    {a.base_rate != null && (
                      <span className="flex items-center gap-1">
                        <DollarSign className="size-3" />
                        ${a.base_rate}/sqft
                      </span>
                    )}
                  </div>
                </div>

                {/* Added date */}
                <p className="shrink-0 text-xs text-muted-foreground mt-0.5 hidden sm:block">
                  {fmtDate(a.created_at)}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
