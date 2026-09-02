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
import { LeaseRadarView } from "@/app/lease-radar/lease-radar-view";
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
  BrokerKpiStrip,
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
import { buildTodayDeskItems } from "@/lib/today-desk";
import { ownershipWatchEmptyCopy } from "@/lib/ownership-watch";
import { TodayDesk } from "./today-desk";
import { OwnershipWatchBatchButton } from "./ownership-watch-batch";
import { DashboardCustomize } from "./customize-dashboard";
import { resolveVisible, type DashboardLayoutPrefs } from "@/lib/dashboard-layout";

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
    limit: 12,
  });

  const attentionCount = todayDeskItems.length;

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

  // Dashboard show/hide customization — group-level visibility so a whole
  // grid row/column is omitted (not left as an empty shell) when nothing in
  // it is visible. stale_tier1_owners keeps its original data-driven
  // condition (staleTier1Owners.length > 0) ANDed with the toggle, same as
  // before this feature existed.
  const primaryLeftVisible = visible.today_desk || visible.upcoming_followups;
  const primaryRightVisible =
    visible.ready_to_pursue ||
    visible.cold_tier1 ||
    (visible.stale_tier1_owners && staleTier1Owners.length > 0);
  const primaryAnyVisible = primaryLeftVisible || primaryRightVisible;

  const secondaryRow1Visible = visible.pipeline || visible.lease_exposure;
  const bookOwnersCadenceVisible = visible.book_owners || visible.cadence;
  const opsRecentVisible = visible.ops_health || visible.recent_activity;
  const secondaryRow2Visible = bookOwnersCadenceVisible || opsRecentVisible;

  return (
    <div className="dashboard-page px-4 py-6 sm:px-6 sm:py-8 max-w-[80rem] mx-auto space-y-8">

      <DashboardHero
        name={heroName}
        date={today}
        briefing={briefing}
        attentionCount={attentionCount}
        portfolio={portfolio}
        cadence={cadence}
        search={<BeaconCopilot />}
      />

      <div className="flex justify-end">
        <DashboardCustomize initialVisible={visible} />
      </div>

      <BrokerKpiStrip
        activePursuits={dealsDashboard.activeCount}
        estimatedCommission={dealsDashboard.estimatedCommissionTotal}
        leaseExposure={leaseExposure}
        tier1Overdue={tier1Overdue}
        ownershipChanges={ownershipChangedProperties.length}
        bookProperties={stats.properties}
        bookSqft={portfolio.totalSqft}
        visible={{
          kpi_pursuits: visible.kpi_pursuits,
          kpi_leases_90: visible.kpi_leases_90,
          kpi_tier1_overdue: visible.kpi_tier1_overdue,
          kpi_ownership: visible.kpi_ownership,
          kpi_book: visible.kpi_book,
        }}
      />

      {visible.priority_pills && <PriorityPills metrics={briefing} />}
      {visible.week_momentum && <WeekMomentumBar momentum={momentum} />}
      {visible.since_last_visit && <SinceLastVisit />}

      {/* PRIMARY — do today */}
      {primaryAnyVisible ? (
        <div className="grid lg:grid-cols-2 gap-6 items-start">
          {primaryLeftVisible && (
            <div className="space-y-6">
              {visible.today_desk && (
                <section className="space-y-3">
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
                  <TodayDesk items={todayDeskItems} />
                </section>
              )}

              {visible.upcoming_followups && (
                <section className="space-y-3">
                  <SectionHeader
                    title="Upcoming follow-ups"
                    href="/follow-ups"
                    hrefLabel="All tasks →"
                  />
                  <UpcomingFollowUpList items={upcomingFollowUps} />
                </section>
              )}
            </div>
          )}

          {primaryRightVisible && (
            <div className="space-y-6">
              {visible.ready_to_pursue && (
                <section id="unworked" className="space-y-3 scroll-mt-8">
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
              )}

              {visible.cold_tier1 && (
                <section className="space-y-3">
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
              )}

              {visible.stale_tier1_owners && staleTier1Owners.length > 0 && (
                <section className="space-y-3">
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
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed px-4 py-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>Primary sections are hidden.</span>
          <DashboardCustomize initialVisible={visible} variant="hint" />
        </div>
      )}

      {/* SECONDARY */}
      {secondaryRow1Visible && (
        <div className="grid xl:grid-cols-2 gap-6 items-start">
          {visible.pipeline && (
            <section className="space-y-3">
              <SectionHeader
                title="Pipeline"
                href="/deals"
                hrefLabel="All pursuits →"
              />
              <DealsDashboardPanel summary={dealsDashboard} />
            </section>
          )}

          {visible.lease_exposure && (
            <section className="space-y-3">
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
              <LeaseRadarView data={leaseRadar} compact />
              <ExpiringLeasesPanel items={leaseRadar.within3.slice(0, 6)} total={leaseRadar.counts.within3} />
            </section>
          )}
        </div>
      )}

      {secondaryRow2Visible && (
        <div className="grid xl:grid-cols-2 gap-6 items-start">
          {bookOwnersCadenceVisible && (
            <section className="space-y-3">
              {visible.book_owners && (
                <>
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
                </>
              )}
              {visible.cadence && <CadencePanel cadence={cadence} />}
            </section>
          )}

          {opsRecentVisible && (
            <section className="space-y-3">
              {visible.ops_health && (
                <>
                  <SectionHeader title="Ops & data health" href="/properties/audit" hrefLabel="Audit →" />
                  <DataHealthPanel health={dataHealth} />
                </>
              )}
              {visible.recent_activity && (
                <section className="space-y-3">
                  <SectionHeader title="Recent activity" href="/crm" hrefLabel="Workspace →" />
                  <ActivityTimeline activities={recentActivities} />
                </section>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
