import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { getEnrichedActionItems } from "./enriched-action-items";
import { getFollowUpsDashboard, getUpcomingFollowUps } from "@/app/follow-ups/actions";
import {
  getDashboardStats,
  getRecentActivities,
  getPortfolioSnapshot,
  getDataHealth,
  getCadenceHealth,
  getUnworkedOpportunities,
  getColdTier1Contacts,
  getWeekMomentum,
  getOwnershipChangedProperties,
  getOwnershipWatchStats,
} from "./actions";
import { BeaconCopilot } from "@/components/beacon-copilot";
import { UpcomingFollowUpList } from "./follow-up-list";
import { SinceLastVisit } from "./since-last-visit";
import { getLeaseRadarData } from "@/app/lease-radar/actions";
import {
  WeekMomentumBar,
  UnworkedOpportunitiesPanel,
  ColdTier1Panel,
  DealsDashboardPanel,
} from "./dashboard-widgets";
import { getDealsDashboard } from "@/app/deals/actions";
import {
  CommandCenterHeading,
  dashboardPlaybookLine,
  ActivityTimeline,
  SectionHeader,
  PriorityPills,
  CadencePanel,
  PortfolioPanel,
  DataHealthPanel,
  OwnershipChangedPanel,
  ExpiringLeasesPanel,
} from "./dashboard-sections";
import { signalPriorityScore } from "@/lib/action-item-signals";
import { aggregateLeaseExposure, buildBriefingMetrics } from "@/lib/dashboard-kpis";
import { refineTodayDeskItems } from "@/lib/jev-today-desk";
import { buildTodayDeskItems } from "@/lib/today-desk";
import { daysUntilIso, nearestNoticeDeadline } from "@/lib/lease-export";
import { ownershipWatchEmptyCopy } from "@/lib/ownership-watch";
import { TodayDesk } from "./today-desk";
import { addCalendarDays, formatLocalDate, todayLocal } from "@/lib/dates";

export const metadata = { title: "Dashboard – Beacon" };
import { OwnershipWatchBatchButton } from "./ownership-watch-batch";
import { DashboardCustomize } from "./customize-dashboard";
import {
  DashboardVisibilityProvider,
  IfAnyVisible,
  IfNoneVisible,
  IfVisible,
  VisibleKpiStrip,
} from "./dashboard-visibility";
import {
  PRIMARY_MODULE_IDS,
  SECONDARY_MODULE_IDS,
  SIGNAL_MODULE_IDS,
  resolveVisible,
  type DashboardLayoutPrefs,
} from "@/lib/dashboard-layout";

function titleCasePart(part: string) {
  if (!part) return "";
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

/** Prefer Settings → display name; fall back to a readable email local-part. */
function displayNameFromEmail(email: string) {
  const local = (email.split("@")[0] ?? "").replace(/\+/g, " ");
  const parts = local.split(/[._\s-]+/).filter(Boolean);
  if (parts.length >= 2) return parts.map(titleCasePart).join(" ");
  return titleCasePart(parts[0] ?? local);
}

function resolveGreetingName(opts: {
  displayName?: string | null;
  brokerName?: string | null;
  senderName?: string | null;
  email?: string | null;
}) {
  const fromSettings =
    opts.displayName?.trim() ||
    opts.brokerName?.trim() ||
    opts.senderName?.trim();
  if (fromSettings) return fromSettings;
  if (opts.email) return displayNameFromEmail(opts.email);
  return null;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: obSettings } = await supabase
    .from("user_settings")
    .select("onboarding_completed_at, display_name, broker_name, sender_name, dashboard_layout")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!obSettings?.onboarding_completed_at) redirect("/onboarding");

  // Show/hide dashboard customization — null/missing prefs resolve to
  // everything visible, so an account that's never touched Customize looks
  // identical to today's fixed layout.
  const visible = resolveVisible(obSettings.dashboard_layout as DashboardLayoutPrefs | null);

  const todayIso = todayLocal();
  const past30 = addCalendarDays(todayIso, -30);
  const ahead90 = addCalendarDays(todayIso, 90);
  const ahead2y = addCalendarDays(todayIso, 730);

  const [
    enrichedItems,
    stats,
    recentActivities,
    followUpsDash,
    upcomingFollowUps,
    leaseRadar,
    portfolio,
    cadence,
    dataHealth,
    unworked,
    coldTier1,
    momentum,
    ownershipChangedProperties,
    dealsDashboard,
    ownershipWatchStats,
    exchange1031Res,
    noticeLeaseRes,
  ] = await Promise.all([
    getEnrichedActionItems(),
    getDashboardStats(),
    getRecentActivities(),
    getFollowUpsDashboard(),
    getUpcomingFollowUps(8),
    getLeaseRadarData(),
    getPortfolioSnapshot(),
    getCadenceHealth(),
    getDataHealth(),
    getUnworkedOpportunities(8),
    getColdTier1Contacts(6),
    getWeekMomentum(),
    getOwnershipChangedProperties(),
    getDealsDashboard(),
    getOwnershipWatchStats(),
    supabase
      .from("contacts")
      .select("id, name, exchange_1031_deadline")
      .eq("owner_id", user.id)
      .not("exchange_1031_deadline", "is", null)
      .gte("exchange_1031_deadline", past30)
      .lte("exchange_1031_deadline", ahead90),
    supabase
      .from("lease_abstracts")
      .select("id, expiration_date, options, linked_property, properties(id, address)")
      .eq("owner_id", user.id)
      .not("expiration_date", "is", null)
      .gte("expiration_date", todayIso)
      .lte("expiration_date", ahead2y),
  ]);

  // Lease SF for ≤90/180d — join property size when linked
  const leasePropIds = [
    ...new Set(
      [...leaseRadar.within3, ...leaseRadar.within6]
        .map((e) => e.property_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const sqftByProp = new Map<string, number>();
  if (leasePropIds.length > 0) {
    const { data: props } = await supabase
      .from("properties")
      .select("id, size_sqft")
      .eq("owner_id", user.id)
      .in("id", leasePropIds);
    for (const p of props ?? []) {
      if (p.size_sqft != null) sqftByProp.set(p.id, Number(p.size_sqft));
    }
  }
  const leaseExposure = aggregateLeaseExposure(
    [...leaseRadar.within3, ...leaseRadar.within6, ...leaseRadar.within12].map((e) => ({
      daysUntilExpiry: e.daysUntilExpiry,
      sizeSqft: e.property_id ? (sqftByProp.get(e.property_id) ?? null) : null,
    })),
  );

  const overdueOutreach = enrichedItems.filter((c) => c.daysOverdue > 0).length;
  const dueTodayOutreach = enrichedItems.filter((c) => c.daysOverdue === 0).length;
  const tier1Overdue = enrichedItems.filter(
    (c) => c.contact_tier === 1 && c.daysOverdue > 0,
  ).length;

  const todayDeskItems = buildTodayDeskItems({
    today: todayIso,
    outreach: enrichedItems.map((c) => ({
      id: c.id,
      name: c.name,
      whyNow: c.whyNow,
      daysOverdue: c.daysOverdue,
      priorityScore: signalPriorityScore(c.signals),
    })),
    followUps: [...followUpsDash.overdue, ...followUpsDash.today].map((f) => ({
      id: f.id,
      description: f.description,
      due_date: f.due_date,
      contact_name: f.contact_name,
      property_address: f.property_address,
    })),
    deals: (dealsDashboard.activeDeals ?? dealsDashboard.recentActive).map((d) => ({
      id: d.id,
      name: d.name,
      next_action: d.next_action,
      next_action_due: d.next_action_due,
      contact_name: d.contacts?.name ?? null,
      property_address: d.properties?.address ?? null,
    })),
    ownership: ownershipChangedProperties.map((o) => ({
      id: o.id,
      address: o.address,
      previous_owner: o.previous_owner,
      new_owner: o.new_owner,
    })),
    leases: leaseRadar.within3.map((e) => ({
      id: e.id,
      property_address: e.property_address,
      daysUntilExpiry: e.daysUntilExpiry,
      property_id: e.property_id,
    })),
    optionNotices: (noticeLeaseRes.data ?? []).flatMap((row) => {
      const notice = nearestNoticeDeadline(row.expiration_date, row.options, todayIso);
      if (!notice || notice.daysUntil > 90 || notice.daysUntil < -30) return [];
      const prop = row.properties as unknown as { id: string; address: string | null } | null;
      return [{
        id: row.id,
        property_address: prop?.address ?? null,
        daysUntil: notice.daysUntil,
        label: notice.label,
        href: `/abstracts/${row.id}`,
        dueDate: notice.date,
      }];
    }),
    exchange1031: (exchange1031Res.data ?? []).flatMap((c) => {
      if (!c.exchange_1031_deadline) return [];
      return [{
        id: c.id,
        name: c.name,
        daysUntil: daysUntilIso(c.exchange_1031_deadline, todayIso),
        deadline: c.exchange_1031_deadline,
      }];
    }),
    limit: 12,
  });
  const rankedTodayDeskItems = await refineTodayDeskItems(todayDeskItems);

  const attentionCount = rankedTodayDeskItems.length;

  const briefing = buildBriefingMetrics({
    overdueOutreach,
    dueTodayOutreach,
    followUpsOverdue: followUpsDash.overdue.length,
    followUpsToday: followUpsDash.today.length,
    expiringLeases: leaseRadar.urgentCount,
    ownershipChanges: ownershipChangedProperties.length,
    activitiesThisWeek: momentum.touchpoints,
    dataIssues: dataHealth.ingestionErrors + dataHealth.flaggedProperties,
    unworkedOpportunities: unworked.length,
    coldTier1: coldTier1.length,
  });

  const today =
    formatLocalDate(todayIso, { weekday: "long", month: "long", day: "numeric" }) ?? todayIso;

  const name = resolveGreetingName({
    displayName: obSettings?.display_name,
    brokerName: obSettings?.broker_name,
    senderName: obSettings?.sender_name,
    email: user.email,
  });

  const playbookLine = dashboardPlaybookLine({
    attentionCount,
    briefing,
    cadence,
  });

  return (
    <DashboardVisibilityProvider initialVisible={visible}>
    <div className="dashboard-page px-4 py-4 sm:px-6 sm:py-5 max-w-[80rem] mx-auto">

      <div className="space-y-3">
        <div className="dashboard-hero px-5 py-4 md:px-6 md:py-5">
          <div className="space-y-3 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <IfVisible id="command_center">
                <CommandCenterHeading name={name} date={today} />
              </IfVisible>
              <div className="shrink-0 ml-auto">
                <DashboardCustomize initialVisible={visible} />
              </div>
            </div>
            <IfVisible id="command_center">
              <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
                {playbookLine}
              </p>
            </IfVisible>
            <IfVisible id="ask_beacon">
              <div className="max-w-2xl min-w-0 pt-1 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Ask Beacon
                </p>
                <BeaconCopilot />
              </div>
            </IfVisible>
          </div>
        </div>

        <VisibleKpiStrip
          activePursuits={dealsDashboard.activeCount}
          estimatedCommission={dealsDashboard.estimatedCommissionTotal}
          leaseExposure={leaseExposure}
          tier1Overdue={tier1Overdue}
          ownershipChanges={ownershipChangedProperties.length}
          bookProperties={stats.properties}
          bookSqft={portfolio.totalSqft}
        />
      </div>

      <div className="mt-3 space-y-2">
      <IfAnyVisible ids={SIGNAL_MODULE_IDS}>
        <div className="dashboard-signal-row">
          <IfVisible id="priority_pills"><PriorityPills metrics={briefing} /></IfVisible>
          <IfVisible id="week_momentum"><WeekMomentumBar momentum={momentum} /></IfVisible>
          <IfVisible id="since_last_visit"><SinceLastVisit /></IfVisible>
        </div>
      </IfAnyVisible>

      {/* PRIMARY — today packed full-width, then a tight row of side modules */}
      <IfAnyVisible ids={PRIMARY_MODULE_IDS}>
        <div className="space-y-2">
          <IfVisible id="today_desk">
            <section className="space-y-1.5">
              <SectionHeader
                title="Do these today"
                badge={
                  attentionCount > 0 ? (
                    <span className="rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold px-2 py-0.5">
                      {attentionCount}
                    </span>
                  ) : undefined
                }
              />
              <TodayDesk items={rankedTodayDeskItems} />
            </section>
          </IfVisible>

          <IfAnyVisible ids={["upcoming_followups", "ready_to_pursue", "cold_tier1"]}>
            <div className="dashboard-module-grid dashboard-module-grid--primary">
              <IfVisible id="upcoming_followups">
                <section className="space-y-1.5 min-w-0">
                  <SectionHeader
                    title="Upcoming follow-ups"
                    href="/follow-ups"
                    hrefLabel="All tasks →"
                  />
                  <UpcomingFollowUpList items={upcomingFollowUps} />
                </section>
              </IfVisible>

              <IfVisible id="ready_to_pursue">
                <section id="unworked" className="space-y-1.5 min-w-0 scroll-mt-8">
                  <SectionHeader
                    title="Ready to pursue"
                    sub="Owner on file, no CRM owner contact"
                    badge={
                      unworked.length > 0 ? (
                        <span className="rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-semibold px-2 py-0.5">
                          {unworked.length}
                        </span>
                      ) : undefined
                    }
                    href="/crm"
                    hrefLabel="Workspace →"
                  />
                  <UnworkedOpportunitiesPanel items={unworked} />
                </section>
              </IfVisible>

              <IfVisible id="cold_tier1">
                <section className="space-y-1.5 min-w-0">
                  <SectionHeader
                    title="Tier 1 going cold"
                    badge={
                      coldTier1.length > 0 ? (
                        <span className="rounded-full bg-orange-500/15 text-orange-700 dark:text-orange-400 text-[10px] font-semibold px-2 py-0.5">
                          {coldTier1.length}
                        </span>
                      ) : undefined
                    }
                    href="/outreach"
                    hrefLabel="Outreach →"
                  />
                  <ColdTier1Panel items={coldTier1} />
                </section>
              </IfVisible>
            </div>
          </IfAnyVisible>
        </div>
      </IfAnyVisible>
      <IfNoneVisible ids={PRIMARY_MODULE_IDS}>
        <div className="rounded-lg border border-dashed px-4 py-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>Today&apos;s work sections are hidden.</span>
          <DashboardCustomize initialVisible={visible} variant="hint" />
        </div>
      </IfNoneVisible>

      {/* SECONDARY — each module is its own card so hiding one does not nest leftovers */}
      <IfAnyVisible ids={SECONDARY_MODULE_IDS}>
      <div className="dashboard-module-grid dashboard-module-grid--secondary">
        <IfVisible id="pipeline">
          <section className="space-y-1.5 min-w-0">
            <SectionHeader
              title="Pipeline"
              badge={
                dealsDashboard.staleCount > 0 ? (
                  <span className="rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-semibold px-2 py-0.5">
                    {dealsDashboard.staleCount} stale
                  </span>
                ) : undefined
              }
              href="/deals"
              hrefLabel="All pursuits →"
            />
            <DealsDashboardPanel summary={dealsDashboard} />
          </section>
        </IfVisible>

        <IfVisible id="lease_exposure">
          <section className="space-y-1.5 min-w-0">
            <SectionHeader
              title="Lease exposure"
              badge={
                leaseRadar.urgentCount > 0 ? (
                  <span className="rounded-full bg-red-500/15 text-red-700 dark:text-red-400 text-[10px] font-semibold px-2 py-0.5">
                    {leaseRadar.urgentCount} ≤90d
                  </span>
                ) : undefined
              }
              href="/lease-radar"
              hrefLabel="Full radar →"
            />
            <ExpiringLeasesPanel items={leaseRadar.within3} total={leaseRadar.counts.within3} />
          </section>
        </IfVisible>

        <IfVisible id="book_owners">
          <section className="space-y-1.5 min-w-0">
            <SectionHeader title="Book composition" href="/crm" hrefLabel="Workspace →" />
            <PortfolioPanel portfolio={portfolio} />
            <div className="space-y-2">
              <OwnershipWatchBatchButton />
              <OwnershipChangedPanel
                items={ownershipChangedProperties}
                emptyCopy={ownershipWatchEmptyCopy({
                  openSignals: ownershipChangedProperties.length,
                  enrolledCount: ownershipWatchStats.enrolledCount,
                  everChecked: ownershipWatchStats.everChecked,
                })}
              />
            </div>
          </section>
        </IfVisible>

        <IfVisible id="cadence">
          <section className="space-y-1.5 min-w-0">
            <SectionHeader title="Relationship cadence" href="/outreach" hrefLabel="Outreach →" />
            <CadencePanel cadence={cadence} />
          </section>
        </IfVisible>

        <IfVisible id="ops_health">
          <section className="space-y-1.5 min-w-0">
            <SectionHeader title="Ops & data health" href="/properties/audit" hrefLabel="Audit →" />
            <DataHealthPanel health={dataHealth} />
          </section>
        </IfVisible>

        <IfVisible id="recent_activity">
          <section className="space-y-1.5 min-w-0">
            <SectionHeader title="Recent activity" href="/crm" hrefLabel="Workspace →" />
            <ActivityTimeline activities={recentActivities} />
          </section>
        </IfVisible>
      </div>
      </IfAnyVisible>
      </div>
    </div>
    </DashboardVisibilityProvider>
  );
}
