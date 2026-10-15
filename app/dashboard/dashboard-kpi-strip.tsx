import Link from "next/link";
import { cn } from "@/lib/utils";
import { fmtKpiMoney, fmtKpiSqft, type LeaseExposureKpi } from "@/lib/dashboard-kpis";
import type { KpiModuleId } from "@/lib/dashboard-layout";

/** Top KPI strip — real DB numbers, deep-linked. `visible` controls which
 * cells render (dashboard show/hide customization, lib/dashboard-layout.ts);
 * renders nothing at all if every cell is hidden, so callers can render it
 * unconditionally.
 *
 * Lives in its own file so dashboard-visibility (client) does not pull the
 * rest of dashboard-sections into the client bundle. */
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

  const cols =
    cells.length >= 5
      ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-5"
      : cells.length === 4
        ? "grid-cols-2 xl:grid-cols-4"
        : cells.length === 3
          ? "grid-cols-1 sm:grid-cols-3"
          : cells.length === 2
            ? "grid-cols-2"
            : "grid-cols-1";

  return (
    <div className={cn("grid gap-2", cols)}>
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
