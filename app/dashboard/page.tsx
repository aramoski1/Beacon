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
  getBriefingMetrics,
  getUnworkedOpportunities,
  getColdTier1Contacts,
  getWeekMomentum,
  getStaleTier1Owners,
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
  DashboardHero,
  ActivityTimeline,
  SectionHeader,
  PriorityPills,
  CadencePanel,
  PortfolioPanel,
  DataHealthPanel,
  OwnershipChangedPanel,
  ExpiringLeasesPanel,
} from "./dashboard-sections";
import { StaleTier1OwnersPanel } from "./stale-owner-panel";
import { signalPriorityScore } from "@/lib/action-item-signals";
import { aggregateLeaseExposure } from "@/lib/dashboard-kpis";
import { refineTodayDeskItems } from "@/lib/jev-today-desk";
import { buildTodayDeskItems } from "@/lib/today-desk";
import { daysUntilIso, nearestNoticeDeadline } from "@/lib/lease-export";
import { ownershipWatchEmptyCopy } from "@/lib/ownership-watch";
import { TodayDesk } from "./today-desk";
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

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

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

  const todayIso = new Date().toISOString().slice(0, 10);
  const past30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const ahead90 = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const ahead2y = new Date(Date.now() + 730 * 86_400_000).toISOString().slice(0, 10);

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
    staleTier1Owners,
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
    getUnworkedOpportunities(6),
    getColdTier1Contacts(6),
    getWeekMomentum(),
    getStaleTier1Owners(5),
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
    today: new Date().toISOString().slice(0, 10),
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

  const briefing = await getBriefingMetrics(
    overdueOutreach,
    dueTodayOutreach,
    followUpsDash.overdue.length,
    followUpsDash.today.length,
    leaseRadar.urgentCount,
    ownershipChangedProperties.length,
  );

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  const name = resolveGreetingName({
    displayName: obSettings?.display_name,
    brokerName: obSettings?.broker_name,
    senderName: obSettings?.sender_name,
    email: user.email,
  });
  const heroName = name ? `${greeting()}, ${name}` : greeting();

  const staleOwnersRequire = { stale_tier1_owners: staleTier1Owners.length > 0 } as const;

  return (
    <DashboardVisibilityProvider initialVisible={visible}>
    <div className="dashboard-page px-4 py-4 sm:px-6 sm:py-5 max-w-[80rem] mx-auto space-y-5">

      <div className="space-y-3">
        <DashboardHero
          name={heroName}
          date={today}
          briefing={briefing}
          attentionCount={attentionCount}
          portfolio={portfolio}
          cadence={cadence}
          search={<BeaconCopilot />}
          customize={<DashboardCustomize initialVisible={visible} />}
        />

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

      <IfAnyVisible ids={SIGNAL_MODULE_IDS}>
        <div className="dashboard-signal-row">
          <IfVisible id="priority_pills"><PriorityPills metrics={briefing} /></IfVisible>
          <IfVisible id="week_momentum"><WeekMomentumBar momentum={momentum} /></IfVisible>
          <IfVisible id="since_last_visit"><SinceLastVisit /></IfVisible>
        </div>
      </IfAnyVisible>

      {/* PRIMARY — do today */}
      <IfAnyVisible
        ids={PRIMARY_MODULE_IDS}
        require={staleOwnersRequire}
      >
        <div className="dashboard-module-grid dashboard-module-grid--primary">
          <IfAnyVisible ids={["today_desk", "upcoming_followups"]}>
            <div className="space-y-4">
              <IfVisible id="today_desk">
                <section className="space-y-2">
                  <SectionHeader
                    title="Do these today"
                    badge={
                      attentionCount > 0 ? (
                        <span className="rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold px-2 py-0.5">
                          {attentionCount}
                        </span>
                      ) : undefined
                    }
                    href="/outreach"
                    hrefLabel="Outreach →"
                  />
                  <TodayDesk items={rankedTodayDeskItems} />
                </section>
              </IfVisible>

              <IfVisible id="upcoming_followups">
                <section className="space-y-2">
                  <SectionHeader
                    title="Upcoming follow-ups"
                    href="/follow-ups"
                    hrefLabel="All tasks →"
                  />
                  <UpcomingFollowUpList items={upcomingFollowUps} />
                </section>
              </IfVisible>
            </div>
          </IfAnyVisible>

          <IfAnyVisible
            ids={["ready_to_pursue", "cold_tier1", "stale_tier1_owners"]}
            require={staleOwnersRequire}
          >
            <div className="space-y-4">
              <IfVisible id="ready_to_pursue">
                <section id="unworked" className="space-y-2 scroll-mt-8">
                  <SectionHeader
                    title="Ready to pursue"
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
                <section className="space-y-2">
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

              <IfVisible id="stale_tier1_owners" when={staleTier1Owners.length > 0}>
                <section className="space-y-2">
                  <SectionHeader
                    title="Tier-1 owners not contacted"
                    badge={
                      <span className="rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold px-2 py-0.5">
                        {staleTier1Owners.length}
                      </span>
                    }
                    href="/outreach"
                    hrefLabel="Outreach →"
                  />
                  <StaleTier1OwnersPanel items={staleTier1Owners} userEmail={user.email} />
                </section>
              </IfVisible>
            </div>
          </IfAnyVisible>
        </div>
      </IfAnyVisible>
      <IfNoneVisible ids={PRIMARY_MODULE_IDS} require={staleOwnersRequire}>
        <div className="rounded-lg border border-dashed px-4 py-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>Today&apos;s work sections are hidden.</span>
          <DashboardCustomize initialVisible={visible} variant="hint" />
        </div>
      </IfNoneVisible>

      {/* SECONDARY — each module is its own card so hiding one does not nest leftovers */}
      <IfAnyVisible ids={SECONDARY_MODULE_IDS}>
      <div className="dashboard-module-grid dashboard-module-grid--secondary">
        <IfVisible id="pipeline">
          <section className="space-y-2">
            <SectionHeader
              title="Pipeline"
              href="/deals"
              hrefLabel="All pursuits →"
            />
            <DealsDashboardPanel summary={dealsDashboard} />
          </section>
        </IfVisible>

        <IfVisible id="lease_exposure">
          <section className="space-y-2">
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
            <ExpiringLeasesPanel items={leaseRadar.within3.slice(0, 6)} total={leaseRadar.counts.within3} />
          </section>
        </IfVisible>

        <IfVisible id="book_owners">
          <section className="space-y-2">
            <SectionHeader title="Book & owners" href="/crm" hrefLabel="Workspace →" />
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
          <CadencePanel cadence={cadence} />
        </IfVisible>

        <IfVisible id="ops_health">
          <section className="space-y-2">
            <SectionHeader title="Ops & data health" href="/properties/audit" hrefLabel="Audit →" />
            <DataHealthPanel health={dataHealth} />
          </section>
        </IfVisible>

        <IfVisible id="recent_activity">
          <section className="space-y-2">
            <SectionHeader title="Recent activity" href="/crm" hrefLabel="Workspace →" />
            <ActivityTimeline activities={recentActivities} />
          </section>
        </IfVisible>
      </div>
      </IfAnyVisible>
    </div>
    </DashboardVisibilityProvider>
  );
}
