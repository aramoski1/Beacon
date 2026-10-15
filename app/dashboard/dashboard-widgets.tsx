import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Building2,
  ChevronRight,
  Flame,
  Mail,
  UserPlus,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ColdTier1Contact,
  UnworkedOpportunity,
  WeekMomentum,
} from "./actions";
import type { LeaseRadarEntry } from "@/lib/lease-radar";
import { formatLeaseRate, leaseDisplayTitle } from "@/lib/lease-radar";
import { formatLocalDate } from "@/lib/dates";
import type { DealsDashboard } from "@/app/deals/actions";
import { STAGE_LABELS, STAGE_COLORS, isDealStale, daysInStage, fmtCommission, type Deal } from "@/lib/deals";

export function WeekMomentumBar({ momentum }: { momentum: WeekMomentum }) {
  const items = [
    { label: "Properties added", value: momentum.propertiesAdded, icon: Building2 },
    { label: "Contacts added", value: momentum.contactsAdded, icon: UserPlus },
    { label: "Touchpoints", value: momentum.touchpoints, icon: Sparkles },
    { label: "Emails logged", value: momentum.outreachSent, icon: Mail },
    { label: "Follow-ups done", value: momentum.followUpsCompleted, icon: TrendingUp },
  ].filter((i) => i.value > 0);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        No activity logged this week yet — ingest a property or send outreach to build momentum.
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
        <TrendingUp className="size-3.5" />
        This week&apos;s momentum
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="inline-flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs"
          >
            <Icon className="size-3.5 text-muted-foreground" />
            <span className="font-bold tabular-nums text-foreground">{value}</span>
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function UnworkedOpportunitiesPanel({ items }: { items: UnworkedOpportunity[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-4 py-4 text-center">
        <p className="text-sm text-muted-foreground">Every property with owner data has a linked contact.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden divide-y">
      {items.map((p) => (
        <Link
          key={p.id}
          href={`/properties/${p.id}`}
          className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group"
        >
          <div className="shrink-0 size-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Building2 className="size-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
              {p.address ?? "No address"}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {p.owner_contact_name ?? p.owner_name}
              <span className="mx-1">·</span>
              <span className="text-amber-600 dark:text-amber-400">No contact linked yet</span>
            </p>
          </div>
          <ArrowRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
        </Link>
      ))}
    </div>
  );
}

export function ColdTier1Panel({ items }: { items: ColdTier1Contact[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-4 py-4 text-center">
        <p className="text-sm text-muted-foreground">All Tier 1 relationships are on cadence.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden divide-y">
      {items.map((c) => (
        <div key={c.id} className="flex items-center gap-3 px-4 py-3">
          <div className="shrink-0 size-9 rounded-lg bg-orange-500/15 flex items-center justify-center">
            <Flame className="size-4 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="flex-1 min-w-0">
            <Link
              href={`/contacts/${c.id}`}
              className="text-sm font-medium hover:underline underline-offset-2"
            >
              {c.name ?? "Unnamed"}
            </Link>
            {c.company && (
              <p className="text-xs text-muted-foreground truncate">{c.company}</p>
            )}
            {c.property_address && c.property_id && (
              <Link
                href={`/properties/${c.property_id}`}
                className="text-xs text-muted-foreground hover:text-foreground truncate block"
              >
                {c.property_address}
              </Link>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs font-semibold text-destructive tabular-nums">
              {c.daysOverdue === 0 ? "due now" : `${c.daysOverdue}d cold`}
            </p>
            <Link
              href={`/contacts/${c.id}`}
              className="text-[10px] text-primary hover:underline underline-offset-2"
            >
              Reach out →
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function rolloverAction(days: number, hasProperty: boolean): string {
  if (days <= 30) return "Start renewal conversation";
  if (days <= 90) return hasProperty ? "Check comps / rent" : "Open lease";
  return "Add to rollover pipeline";
}

/** Full-width lease rollover queue with property context and suggested action. */
export function LeaseRolloverQueue({ items, total }: { items: LeaseRadarEntry[]; total: number }) {
  if (total === 0) {
    return (
      <div className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        No leases expiring in the next 90 days.
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="divide-y">
        {items.map((l) => (
          <div key={l.id} className="flex items-start gap-4 px-4 py-3 hover:bg-muted/20 transition-colors">
            <div className={cn(
              "shrink-0 size-10 rounded-lg flex items-center justify-center text-xs font-bold tabular-nums mt-0.5",
              l.daysUntilExpiry <= 30 ? "bg-red-500/15 text-red-600 dark:text-red-400" :
              l.daysUntilExpiry <= 60 ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" :
              "bg-muted text-muted-foreground",
            )}>
              {l.daysUntilExpiry}d
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  href={`/abstracts/${l.id}`}
                  className="text-sm font-medium hover:underline underline-offset-2"
                >
                  {leaseDisplayTitle(l)}
                </Link>
                {l.base_rate != null && (
                  <span className="text-xs text-muted-foreground">{formatLeaseRate(l.base_rate)}</span>
                )}
              </div>
              {l.property_address && l.property_id ? (
                <Link
                  href={`/properties/${l.property_id}`}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <Building2 className="size-3 shrink-0" />
                  {l.property_address}
                </Link>
              ) : (
                <p className="text-xs text-muted-foreground">No property linked</p>
              )}
              <p className="text-xs text-primary/80 flex items-center gap-1">
                <Target className="size-3 shrink-0" />
                {l.daysUntilExpiry > 30 && l.daysUntilExpiry <= 90 && l.property_id ? (
                  <Link
                    href={`/properties/${l.property_id}`}
                    className="hover:underline underline-offset-2"
                  >
                    Check comps / rent
                  </Link>
                ) : (
                  rolloverAction(l.daysUntilExpiry, !!l.property_id)
                )}
                <span className="text-muted-foreground">
                  · Exp {formatLocalDate(l.expiration_date)}
                </span>
              </p>
            </div>
            <Link
              href={`/abstracts/${l.id}`}
              className="shrink-0 text-xs text-primary hover:underline underline-offset-2 mt-1"
            >
              Open →
            </Link>
          </div>
        ))}
      </div>
      {total > items.length && (
        <div className="px-4 py-2 border-t bg-muted/20 text-center">
          <Link href="/crm?tab=leases" className="text-xs text-muted-foreground hover:text-foreground">
            +{total - items.length} more expiring in 90 days
          </Link>
        </div>
      )}
    </div>
  );
}

export function DealsDashboardPanel({ summary }: { summary: DealsDashboard }) {
  if (summary.activeCount === 0) {
    return (
      <div className="rounded-xl border bg-card px-4 py-4 text-center">
        <Briefcase className="size-7 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No active pursuits yet.</p>
        <Link
          href="/deals"
          className="text-xs text-primary hover:underline underline-offset-2 mt-1 inline-block"
        >
          Open deals →
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Briefcase className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Active pursuits
          </span>
          <span className="text-xs font-bold tabular-nums text-foreground bg-muted rounded-full px-2 py-0.5">
            {summary.activeCount}
          </span>
          {summary.estimatedCommissionTotal > 0 && (
            <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium tabular-nums">
              {fmtCommission(summary.estimatedCommissionTotal)} est.
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {summary.staleCount > 0 && (
            <span
              className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium"
              title="No stage change in 14+ days"
            >
              <AlertTriangle className="size-3" />
              {summary.staleCount} stale
            </span>
          )}
          <Link href="/deals" className="text-xs text-primary hover:underline underline-offset-2">
            View all
            <ChevronRight className="size-3 inline ml-0.5" />
          </Link>
        </div>
      </div>
      <div className="divide-y">
        {summary.recentActive.map((deal) => {
          const stale = isDealStale(deal);
          const days = daysInStage(deal);
          return (
            <div key={deal.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <Link
                    href="/deals"
                    className="text-sm font-medium truncate hover:underline underline-offset-2"
                  >
                    {deal.name}
                  </Link>
                  {stale && (
                    <span title="No stage change in 14+ days">
                      <AlertTriangle className="size-3 text-amber-500 shrink-0" aria-hidden="true" />
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium", STAGE_COLORS[deal.stage])}>
                    {STAGE_LABELS[deal.stage]}
                  </span>
                  {deal.contacts?.name && (
                    <span className="truncate">{deal.contacts.name}</span>
                  )}
                  {deal.properties?.address && (
                    <span className="truncate">{deal.properties.address}</span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right space-y-0.5">
                {deal.estimated_commission != null && (
                  <p className="text-xs font-semibold tabular-nums text-foreground">
                    {fmtCommission(deal.estimated_commission)}
                  </p>
                )}
                <p className={cn("text-[10px] tabular-nums", stale ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                  {days === 0 ? "today" : `${days}d`}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
