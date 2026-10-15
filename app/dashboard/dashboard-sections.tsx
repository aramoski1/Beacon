import Link from "next/link";
import {
  AlertTriangle,
  Activity,
  Mail,
  Phone,
  MessageSquare,
  CalendarDays,
  PenLine,
  ArrowRight,
  MapPin,
  CheckCircle2,
} from "lucide-react";
import { GreetingHeading } from "./greeting-heading";
import { cn } from "@/lib/utils";
import { stripDemoLabel } from "@/lib/demo-display";
import type {
  CadenceHealth,
  DataHealth,
  PortfolioSnapshot,
  RecentActivity,
  OwnershipChangedProperty,
} from "./actions";
import type { LeaseRadarEntry } from "@/lib/lease-radar";
import { formatLeaseRate, leaseDisplayTitle } from "@/lib/lease-radar";
import { formatLocalDate } from "@/lib/dates";
import { fmtKpiSqft, type BriefingMetrics } from "@/lib/dashboard-kpis";

// ─── Hero ─────────────────────────────────────────────────────────────────────

/** Greeting + date in the command-center header. Hideable via Customize. */
export function CommandCenterHeading({ name, date }: { name: string | null; date: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
        Command center
      </p>
      <GreetingHeading name={name} />
      <p className="text-sm text-muted-foreground mt-0.5">{date}</p>
    </div>
  );
}

/**
 * Briefing line under the greeting. Book-wide signals (unworked, data issues,
 * cold Tier-1) used to fold into the same "today" headline even when they
 * were not in the Today desk — a broker would read "N items need you today"
 * then see "Nothing due" underneath. Those still surface in Ready to pursue
 * / data-issue pills, not as "today."
 */
export function dashboardPlaybookLine(opts: {
  attentionCount: number;
  briefing: BriefingMetrics;
  cadence: CadenceHealth;
}): string {
  const bookWideItems =
    opts.briefing.unworkedOpportunities + opts.briefing.dataIssues + opts.briefing.coldTier1;
  if (opts.attentionCount > 0) {
    return `${opts.attentionCount} item${opts.attentionCount !== 1 ? "s" : ""} need your attention today.`;
  }
  if (bookWideItems > 0) {
    return `Nothing due today — ${bookWideItems} item${bookWideItems !== 1 ? "s" : ""} elsewhere in your book could use a look.`;
  }
  if (opts.cadence.compliancePct >= 90) {
    return "Your book is in great shape — stay on cadence and keep building.";
  }
  return "No fires today. Good time to prospect or enrich your pipeline.";
}

// ─── Cadence panel ────────────────────────────────────────────────────────────

export function CadencePanel({ cadence }: { cadence: CadenceHealth }) {
  if (cadence.tierBreakdown.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        No tiered contacts yet — assign Tier 1–3 in Workspace to track cadence.
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="p-3 space-y-2.5">
        <div className="flex items-center gap-3">
          <div className="relative size-14 shrink-0">
            <svg viewBox="0 0 36 36" className="size-14 -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted" />
              <circle
                cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3"
                strokeDasharray={`${cadence.compliancePct} 100`}
                className={cn(
                  cadence.compliancePct >= 85 ? "text-emerald-500" :
                  cadence.compliancePct >= 60 ? "text-amber-500" : "text-red-500"
                )}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold tabular-nums">
              {cadence.compliancePct}%
            </span>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p><span className="font-semibold text-foreground">{cadence.onTrack}</span> contacts on cadence</p>
            <p><span className="font-semibold text-destructive">{cadence.overdue}</span> overdue</p>
            {cadence.neverContacted > 0 && (
              <p><span className="font-semibold text-amber-600">{cadence.neverContacted}</span> never contacted</p>
            )}
          </div>
        </div>
        {cadence.tierBreakdown.map((t) => {
          const pct = t.total > 0 ? Math.round(((t.total - t.overdue) / t.total) * 100) : 100;
          const tierColor = t.tier === 1 ? "bg-orange-500" : t.tier === 2 ? "bg-blue-500" : "bg-muted-foreground";
          return (
            <div key={t.tier}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">{t.label}</span>
                <span className="font-medium tabular-nums">
                  {t.overdue > 0 ? (
                    <span className="text-destructive">{t.overdue} overdue</span>
                  ) : (
                    <span className="text-emerald-600 flex items-center gap-0.5"><CheckCircle2 className="size-3" /> clear</span>
                  )}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={cn("h-full rounded-full transition-all", tierColor)} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Expiring leases ──────────────────────────────────────────────────────────

function leaseExposurePreview(items: LeaseRadarEntry[], limit = 6) {
  const urgent = items.filter((l) => l.daysUntilExpiry <= 30);
  const watch = items.filter((l) => l.daysUntilExpiry > 30 && l.daysUntilExpiry <= 90);
  const urgentTake = urgent.slice(0, Math.min(4, limit));
  return [...urgentTake, ...watch.slice(0, limit - urgentTake.length)];
}

export function ExpiringLeasesPanel({ items, total }: { items: LeaseRadarEntry[]; total: number }) {
  if (total === 0) {
    return (
      <div className="rounded-xl border bg-card px-4 py-4 text-center text-sm text-muted-foreground">
        No leases expiring in the next 90 days.
      </div>
    );
  }

  const shown = leaseExposurePreview(items);

  return (
    <div className="rounded-xl border bg-card overflow-hidden divide-y">
      {shown.map((l) => {
        const showComps = l.daysUntilExpiry > 30 && l.daysUntilExpiry <= 90 && !!l.property_id;
        return (
          <div key={l.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 transition-colors group">
            <div className={cn(
              "shrink-0 size-9 rounded-lg flex items-center justify-center text-xs font-bold tabular-nums",
              l.daysUntilExpiry <= 30 ? "bg-red-500/15 text-red-600 dark:text-red-400" :
              l.daysUntilExpiry <= 60 ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" :
              "bg-muted text-muted-foreground"
            )}>
              {l.daysUntilExpiry}d
            </div>
            <div className="flex-1 min-w-0">
              <Link
                href={`/abstracts/${l.id}`}
                className="text-sm font-medium truncate block group-hover:text-primary transition-colors"
              >
                {leaseDisplayTitle(l)}
              </Link>
              <p className="text-xs text-muted-foreground truncate">
                {l.property_address ? <span>{l.property_address} · </span> : null}
                {l.base_rate != null && `${formatLeaseRate(l.base_rate)} · `}
                Exp {formatLocalDate(l.expiration_date)}
              </p>
              {showComps && (
                <Link
                  href={`/properties/${l.property_id}`}
                  className="text-[11px] text-primary hover:underline underline-offset-2"
                >
                  Check comps / rent
                </Link>
              )}
            </div>
            <ArrowRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </div>
        );
      })}
    </div>
  );
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

export function PortfolioPanel({ portfolio }: { portfolio: PortfolioSnapshot }) {
  const maxCount = Math.max(...portfolio.byType.map((t) => t.count), 1);

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="p-3 space-y-3">
        {portfolio.byType.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            Add properties to see your portfolio breakdown.
          </p>
        ) : (
          <div className="space-y-2">
            {portfolio.byType.map(({ type, count, sqft }) => (
              <div key={type}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="capitalize text-muted-foreground">{type}</span>
                  <span className="font-medium tabular-nums">{count} · {fmtKpiSqft(sqft)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/60 transition-all"
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        {portfolio.bySubmarket.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <MapPin className="size-3" /> Top submarkets
            </p>
            <div className="flex flex-wrap gap-1.5">
              {portfolio.bySubmarket.map(({ name, count }) => (
                <span key={name} className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium">
                  {name} <span className="text-muted-foreground">({count})</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {portfolio.recentProperties.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Recently ingested
            </p>
            <ul className="space-y-1">
              {portfolio.recentProperties.slice(0, 3).map((p) => (
                <li key={p.id}>
                  <Link href={`/properties/${p.id}`} className="flex items-center justify-between gap-2 text-xs hover:text-primary transition-colors group">
                    <span className="truncate font-medium">{p.address ?? "No address"}</span>
                    <span className="shrink-0 text-muted-foreground capitalize">{p.property_type ?? "—"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Data health ──────────────────────────────────────────────────────────────

export function DataHealthPanel({ health }: { health: DataHealth }) {
  if (health.totalProperties === 0 && health.ingestionErrors === 0) {
    return (
      <div className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        No properties in your book yet — import or add one to start tracking data health.
      </div>
    );
  }

  const cleanPct = health.totalProperties > 0
    ? Math.round(((health.totalProperties - health.flaggedProperties) / health.totalProperties) * 100)
    : 100;
  const issues = health.ingestionErrors + health.flaggedProperties;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="p-3 space-y-2.5">
        {health.totalProperties > 0 && (
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-3xl font-bold tabular-nums">{cleanPct}%</span>
              <span className="text-xs text-muted-foreground">{health.totalProperties} properties</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  cleanPct >= 95 ? "bg-emerald-500" :
                  cleanPct >= 80 ? "bg-amber-500" : "bg-destructive"
                )}
                style={{ width: `${cleanPct}%` }}
              />
            </div>
          </div>
        )}
        {issues === 0 ? (
          <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5" /> Book looks clean
          </p>
        ) : (
          <div className="space-y-2">
            {health.flaggedProperties > 0 && (
              <Link href="/properties/audit" className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs hover:bg-amber-500/10 transition-colors">
                <AlertTriangle className="size-3.5 text-amber-600 shrink-0" />
                <span className="flex-1">{health.flaggedProperties} flagged for audit</span>
                <ArrowRight className="size-3 shrink-0" />
              </Link>
            )}
            {health.ingestionErrors > 0 && (
              <Link href="/properties/errors" className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-xs hover:bg-yellow-500/10 transition-colors">
                <AlertTriangle className="size-3.5 text-yellow-600 shrink-0" />
                <span className="flex-1">{health.ingestionErrors} ingestion errors</span>
                <ArrowRight className="size-3 shrink-0" />
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Priority pills ───────────────────────────────────────────────────────────

export function PriorityPills({ metrics }: { metrics: BriefingMetrics }) {
  const items: { label: string; value: number; href: string; urgent?: boolean }[] = [];
  if (metrics.overdueOutreach > 0) items.push({ label: "outreach overdue", value: metrics.overdueOutreach, href: "/outreach", urgent: true });
  if (metrics.followUpsOverdue > 0) items.push({ label: "follow-ups overdue", value: metrics.followUpsOverdue, href: "/follow-ups", urgent: true });
  if (metrics.dueTodayOutreach > 0) items.push({ label: "outreach today", value: metrics.dueTodayOutreach, href: "/outreach" });
  if (metrics.followUpsToday > 0) items.push({ label: "follow-ups today", value: metrics.followUpsToday, href: "/follow-ups" });
  if (metrics.dataIssues > 0) items.push({ label: "data issues", value: metrics.dataIssues, href: "/properties/audit", urgent: true });

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
            item.urgent
              ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
              : "border-border bg-card hover:bg-muted/50"
          )}
        >
          <span className="font-bold tabular-nums">{item.value}</span>
          {item.label}
        </Link>
      ))}
    </div>
  );
}

// ─── Activity timeline ────────────────────────────────────────────────────────

const ACTIVITY_ICON: Record<string, React.ElementType> = {
  email: Mail, call: Phone, note: PenLine, meeting: CalendarDays, letter: MessageSquare,
};

const ACTIVITY_COLOR: Record<string, string> = {
  email:   "bg-muted text-muted-foreground",
  call:    "bg-muted text-muted-foreground",
  meeting: "bg-muted text-muted-foreground",
  note:    "bg-muted text-muted-foreground",
  letter:  "bg-muted text-muted-foreground",
};

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dayGroupLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ActivityTimeline({ activities }: { activities: RecentActivity[] }) {
  if (activities.length === 0) {
    return (
      <div className="rounded-xl border bg-card py-6 text-center">
        <Activity className="size-10 mx-auto mb-3 text-muted-foreground/30" />
        <p className="text-sm font-medium text-muted-foreground">No touchpoints logged yet</p>
        <p className="text-xs text-muted-foreground/70 mt-1">Outreach sends and contact activities appear here.</p>
      </div>
    );
  }

  const groups = new Map<string, RecentActivity[]>();
  for (const a of activities) {
    const label = dayGroupLabel(a.activity_date);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(a);
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {[...groups.entries()].map(([label, items]) => (
        <div key={label}>
          <div className="px-4 py-2 bg-muted/40 border-b text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {label}
          </div>
          <ul className="divide-y">
            {items.map((a) => {
              const Icon = ACTIVITY_ICON[a.activity_type] ?? PenLine;
              const color = ACTIVITY_COLOR[a.activity_type] ?? ACTIVITY_COLOR.note;
              return (
                <li key={a.id} className="flex items-start gap-2.5 px-3 py-2 hover:bg-muted/20 transition-colors">
                  <span className={cn("shrink-0 size-7 rounded-lg flex items-center justify-center mt-0.5", color)}>
                    <Icon className="size-3.5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {a.contact_name && (
                        <Link href={`/contacts/${a.contact_id}`} className="text-sm font-semibold hover:underline underline-offset-2">
                          {a.contact_name}
                        </Link>
                      )}
                      <span className="text-xs capitalize text-muted-foreground">{a.activity_type}</span>
                    </div>
                    {a.property_address && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {a.property_id ? (
                          <Link href={`/properties/${a.property_id}`} className="hover:text-foreground hover:underline underline-offset-2">
                            {a.property_address}
                          </Link>
                        ) : (
                          a.property_address
                        )}
                      </p>
                    )}
                    {a.notes && <p className="text-xs text-muted-foreground/80 mt-0.5 line-clamp-2">{stripDemoLabel(a.notes) ?? a.notes}</p>}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground whitespace-nowrap tabular-nums">
                    {fmtRelative(a.activity_date)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ─── Ownership changes ────────────────────────────────────────────────────────

export function OwnershipChangedPanel({
  items,
  emptyCopy,
}: {
  items: OwnershipChangedProperty[];
  emptyCopy?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        {emptyCopy ??
          "No open ownership-change signals. Enroll properties on watch and re-check — empty can mean not checked yet."}
      </div>
    );
  }
  const shown = items.slice(0, 4);
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="divide-y">
        {shown.map((p) => (
          <Link
            key={p.id}
            href={`/properties/${p.id}`}
            className="flex items-start gap-2.5 px-3 py-2 hover:bg-muted/30 transition-colors group"
          >
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                {p.address ?? "No address"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                <span className="line-through opacity-60">{p.previous_owner ?? "—"}</span>
                {" → "}
                <span className="font-medium text-foreground">{p.new_owner ?? "—"}</span>
              </p>
            </div>
            <ArrowRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 transition-opacity mt-0.5" />
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

export function SectionHeader({
  title,
  badge,
  href,
  hrefLabel,
  sub,
}: {
  title: string;
  badge?: React.ReactNode;
  href?: string;
  hrefLabel?: string;
  sub?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          {title}
          {badge}
        </h2>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {href && hrefLabel && (
        <Link href={href} className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
          {hrefLabel}
        </Link>
      )}
    </div>
  );
}
