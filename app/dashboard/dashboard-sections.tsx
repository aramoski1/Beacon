import Link from "next/link";
import {
  ShieldAlert,
  AlertTriangle,
  CalendarClock,
  Activity,
  Mail,
  Phone,
  MessageSquare,
  CalendarDays,
  PenLine,
  ArrowRight,
  TrendingUp,
  MapPin,
  Target,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  BriefingMetrics,
  CadenceHealth,
  DataHealth,
  PortfolioSnapshot,
  RecentActivity,
  OwnershipChangedProperty,
} from "./actions";
import type { LeaseRadarEntry } from "@/lib/lease-radar";
import { fmtKpiMoney, fmtKpiSqft, type LeaseExposureKpi } from "@/lib/dashboard-kpis";
import type { KpiModuleId } from "@/lib/dashboard-layout";

// ─── Hero ─────────────────────────────────────────────────────────────────────

function HeroMetric({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3 min-w-[6.5rem]">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        "text-xl font-bold tabular-nums tracking-tight mt-0.5",
        highlight ? "text-destructive" : "text-foreground",
      )}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export function DashboardHero({
  name,
  date,
  briefing,
  attentionCount,
  portfolio,
  cadence,
  search,
}: {
  name: string;
  date: string;
  briefing: BriefingMetrics;
  /** Count of items actually in the "Do these today" queue below — keep this
   *  in sync with that queue so the headline never contradicts it. */
  attentionCount: number;
  portfolio: PortfolioSnapshot;
  cadence: CadenceHealth;
  search?: React.ReactNode;
}) {
  // Broader book-wide signals — unworked opportunities, data issues, cold
  // Tier-1 contacts — that briefing.actionItems used to fold into this same
  // "today" headline, even though none of them appear in the Today desk
  // queue below — a broker would read "N items need your attention today"
  // then see "Nothing due" right underneath it. Those signals are still
  // real and still worth surfacing, just not as "today" — they live in the
  // "ready to pursue" / "data issues" pills (PriorityPills) instead. Summed
  // directly from briefing's own sub-counts rather than derived by
  // subtracting attentionCount from actionItems, since the Today desk items
  // are capped at 12 and drawn from slightly different buckets than
  // actionItems' inputs — subtraction could go negative or double-count.
  const bookWideItems = briefing.unworkedOpportunities + briefing.dataIssues + briefing.coldTier1;

  const playbookLine =
    attentionCount > 0
      ? `${attentionCount} item${attentionCount !== 1 ? "s" : ""} need your attention today.`
      : bookWideItems > 0
        ? `Nothing due today — ${bookWideItems} item${bookWideItems !== 1 ? "s" : ""} elsewhere in your book could use a look.`
        : cadence.compliancePct >= 90
          ? "Your book is in great shape — stay on cadence and keep building."
          : "No fires today. Good time to prospect or enrich your pipeline.";

  return (
    <div className="dashboard-hero p-6 md:p-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
        <div className="space-y-4 min-w-0">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Command center
            </p>
            <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{date}</p>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">{playbookLine}</p>
          {search && (
            <div className="max-w-md pt-1 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Ask Beacon
              </p>
              {search}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Top KPI strip — real DB numbers, deep-linked. `visible` controls which
 * cells render (dashboard show/hide customization, lib/dashboard-layout.ts);
 * renders nothing at all if every cell is hidden, so callers can render it
 * unconditionally. */
export function BrokerKpiStrip({
  activePursuits,
  estimatedCommission,
  leaseExposure,
  tier1Overdue,
  ownershipChanges,
  bookProperties,
  bookSqft,
  visible,
}: {
  activePursuits: number;
  estimatedCommission: number;
  leaseExposure: LeaseExposureKpi;
  tier1Overdue: number;
  ownershipChanges: number;
  bookProperties: number;
  bookSqft: number;
  visible: Record<KpiModuleId, boolean>;
}) {
  const cells: Array<{
    id: KpiModuleId;
    label: string;
    value: string;
    sub?: string;
    href: string;
    highlight?: boolean;
  }> = [
    {
      id: "kpi_pursuits" as const,
      label: "Active pursuits",
      value: String(activePursuits),
      sub: estimatedCommission > 0 ? `${fmtKpiMoney(estimatedCommission)} est. fee` : "Pipeline",
      href: "/deals",
      highlight: activePursuits === 0,
    },
    {
      id: "kpi_leases_90" as const,
      label: "Leases ≤90d",
      value: String(leaseExposure.count90),
      sub: leaseExposure.sqft90 > 0 ? fmtKpiSqft(leaseExposure.sqft90) : "expiring",
      href: "/lease-radar",
      highlight: leaseExposure.count90 > 0,
    },
    {
      id: "kpi_tier1_overdue" as const,
      label: "Tier-1 overdue",
      value: String(tier1Overdue),
      sub: "vs your cadence",
      href: "/outreach",
      highlight: tier1Overdue > 0,
    },
    {
      id: "kpi_ownership" as const,
      label: "Ownership changes",
      value: String(ownershipChanges),
      sub: "open signals",
      href: "/crm?tab=properties",
      highlight: ownershipChanges > 0,
    },
    {
      id: "kpi_book" as const,
      label: "Book size",
      value: String(bookProperties),
      sub: bookSqft > 0 ? fmtKpiSqft(bookSqft) : "properties",
      href: "/crm",
    },
  ].filter((c) => visible[c.id]);

  if (cells.length === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
      {cells.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          className={cn(
            "rounded-xl border bg-card px-4 py-3 hover:bg-muted/30 transition-colors",
            c.highlight && "border-amber-500/40",
          )}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {c.label}
          </p>
          <p
            className={cn(
              "text-xl font-bold tabular-nums tracking-tight mt-0.5",
              c.highlight ? "text-amber-700 dark:text-amber-400" : "text-foreground",
            )}
          >
            {c.value}
          </p>
          {c.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{c.sub}</p>}
        </Link>
      ))}
    </div>
  );
}

function fmtSqft(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M SF`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toLocaleString()}k SF`;
  if (n === 0) return "—";
  return `${n.toLocaleString()} SF`;
}

function fmtMoney(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n.toLocaleString()}`;
}

// ─── Stat cards ───────────────────────────────────────────────────────────────

export function StatCard({
  href,
  icon,
  label,
  value,
  sub,
  highlight,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <Link href={href} className="group block h-full">
      <div className={cn(
        "h-full rounded-xl border bg-card px-4 py-4 transition-colors hover:bg-muted/30",
        highlight && value > 0 && "border-destructive/30 bg-destructive/[0.02]",
      )}>
        <div className="flex items-center gap-1.5 text-muted-foreground mb-2.5">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <p className={cn(
          "text-2xl font-bold tabular-nums tracking-tight",
          highlight && value > 0 ? "text-destructive" : "text-foreground",
        )}>
          {value.toLocaleString()}
        </p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
    </Link>
  );
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
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Relationship cadence
          </span>
        </div>
        <Link href="/outreach" className="text-xs text-primary hover:underline underline-offset-2">
          Outreach →
        </Link>
      </div>
      <div className="p-4 space-y-3">
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

function leaseLabel(path: string | null) {
  if (!path) return "Unnamed lease";
  const name = path.split("/").pop() ?? path;
  return name.length > 32 ? name.slice(0, 30) + "…" : name;
}

export function ExpiringLeasesPanel({ items, total }: { items: LeaseRadarEntry[]; total: number }) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <CalendarClock className="size-3.5 text-muted-foreground" />
          Rollover radar
          {total > 0 && (
            <span className="ml-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-bold px-1.5 py-0.5">
              {total}
            </span>
          )}
        </span>
        {total > 0 && (
          <Link href="/lease-radar" className="text-xs text-primary hover:underline underline-offset-2">Full radar</Link>
        )}
      </div>
      {total === 0 ? (
        <p className="px-4 py-6 text-xs text-muted-foreground text-center">
          No leases expiring in the next 90 days.
        </p>
      ) : (
        <div className="p-2 space-y-0.5">
          {items.map((l) => (
            <Link
              key={l.id}
              href={`/abstracts/${l.id}`}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors group"
            >
              <div className={cn(
                "shrink-0 size-9 rounded-lg flex items-center justify-center text-xs font-bold tabular-nums",
                l.daysUntilExpiry <= 30 ? "bg-red-500/15 text-red-600 dark:text-red-400" :
                l.daysUntilExpiry <= 60 ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" :
                "bg-muted text-muted-foreground"
              )}>
                {l.daysUntilExpiry}d
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                  {leaseLabel(l.source_document)}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {l.property_address ? (
                    <span>{l.property_address} · </span>
                  ) : null}
                  {l.base_rate != null && `$${l.base_rate}/sf · `}
                  Exp {new Date(l.expiration_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
              <ArrowRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

export function PortfolioPanel({ portfolio }: { portfolio: PortfolioSnapshot }) {
  const maxCount = Math.max(...portfolio.byType.map((t) => t.count), 1);

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <TrendingUp className="size-3.5 text-muted-foreground" />
          Book composition
        </span>
        <Link href="/crm" className="text-xs text-primary hover:underline underline-offset-2">Workspace →</Link>
      </div>
      <div className="p-4 space-y-4">
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
                  <span className="font-medium tabular-nums">{count} · {fmtSqft(sqft)}</span>
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
      <div className="px-4 py-3 border-b">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <ShieldAlert className="size-3.5" />
          Data integrity
        </span>
      </div>
      <div className="p-4 space-y-3">
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
  if (metrics.unworkedOpportunities > 0) items.push({ label: "ready to pursue", value: metrics.unworkedOpportunities, href: "/dashboard#unworked", urgent: true });
  if (metrics.coldTier1 > 0) items.push({ label: "Tier 1 going cold", value: metrics.coldTier1, href: "/outreach", urgent: true });
  if (metrics.expiringLeases > 0) items.push({ label: "lease expirations", value: metrics.expiringLeases, href: "/lease-radar", urgent: true });
  if (metrics.ownershipChanges > 0) items.push({ label: "ownership changes", value: metrics.ownershipChanges, href: "/crm", urgent: true });
  if (metrics.dataIssues > 0) items.push({ label: "data issues", value: metrics.dataIssues, href: "/properties/audit", urgent: true });
  if (metrics.activitiesThisWeek > 0) items.push({ label: "touchpoints this week", value: metrics.activitiesThisWeek, href: "/dashboard" });

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all hover:scale-[1.02]",
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
      <div className="rounded-xl border bg-card py-12 text-center">
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
                <li key={a.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
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
                    {a.notes && <p className="text-xs text-muted-foreground/80 mt-0.5 line-clamp-2">{a.notes}</p>}
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
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <AlertTriangle className="size-3.5 text-amber-600" />
          Ownership changes
          <span className="ml-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-bold px-1.5 py-0.5">
            {items.length}
          </span>
        </span>
      </div>
      <div className="divide-y">
        {items.map((p) => (
          <Link
            key={p.id}
            href={`/properties/${p.id}`}
            className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group"
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
}: {
  title: string;
  badge?: React.ReactNode;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
        {title}
        {badge}
      </h2>
      {href && hrefLabel && (
        <Link href={href} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          {hrefLabel}
        </Link>
      )}
    </div>
  );
}
