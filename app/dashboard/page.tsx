import { redirect } from "next/navigation";
import { Briefcase, Building2, Users, FileText, CheckSquare, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
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
} from "./actions";
import { BeaconCopilot } from "@/components/beacon-copilot";
import { NeedsAttentionToday } from "./needs-attention";
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
  StatCard,
  ExpiringLeasesPanel,
  SectionHeader,
  PriorityPills,
  CadencePanel,
  PortfolioPanel,
  DataHealthPanel,
  OwnershipChangedPanel,
} from "./dashboard-sections";
import { StaleTier1OwnersPanel } from "./stale-owner-panel";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function displayName(email: string) {
  const local = email.split("@")[0] ?? "";
  const first = local.split(/[._-]/)[0] ?? local;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: obSettings } = await supabase
    .from("user_settings")
    .select("onboarding_completed_at")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!obSettings?.onboarding_completed_at) redirect("/onboarding");

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
  ]);

  const overdueOutreach = enrichedItems.filter((c) => c.daysOverdue > 0).length;
  const dueTodayOutreach = enrichedItems.filter((c) => c.daysOverdue === 0).length;
  const attentionCount =
    overdueOutreach +
    dueTodayOutreach +
    followUpsDash.overdue.length +
    followUpsDash.today.length;

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

  const heroName = user.email
    ? `${greeting()}, ${displayName(user.email)}`
    : greeting();

  return (
    <div className="dashboard-page px-4 py-6 sm:px-6 sm:py-8 max-w-[80rem] mx-auto space-y-8">

      <DashboardHero
        name={heroName}
        date={today}
        briefing={briefing}
        portfolio={portfolio}
        cadence={cadence}
        search={<BeaconCopilot />}
      />

      <PriorityPills metrics={briefing} />

      <WeekMomentumBar momentum={momentum} />

      <SinceLastVisit />

      {/* Command center — do this now */}
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-6">
          <section className="space-y-3">
            <SectionHeader
              title="Needs attention today"
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
            <NeedsAttentionToday
              enrichedItems={enrichedItems}
              followUpsOverdue={followUpsDash.overdue}
              followUpsToday={followUpsDash.today}
            />
          </section>

          <section className="space-y-3">
            <SectionHeader
              title="Upcoming follow-ups"
              href="/follow-ups"
              hrefLabel="All follow-ups →"
            />
            <UpcomingFollowUpList items={upcomingFollowUps} />
          </section>
        </div>

        <div className="space-y-6">
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
              hrefLabel="CRM →"
            />
            <UnworkedOpportunitiesPanel items={unworked} />
          </section>

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

          {staleTier1Owners.length > 0 && (
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
      </div>

      <section className="space-y-3">
        <SectionHeader
          title="Lease expiration radar"
          badge={
            leaseRadar.urgentCount > 0 ? (
              <span className="rounded-full bg-red-500/15 text-red-700 dark:text-red-400 text-[10px] font-semibold px-2 py-0.5">
                {leaseRadar.urgentCount} urgent
              </span>
            ) : leaseRadar.counts.total > 0 ? (
              <span className="rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-semibold px-2 py-0.5">
                {leaseRadar.counts.total} in 12mo
              </span>
            ) : undefined
          }
          href="/lease-radar"
          hrefLabel="Full radar →"
        />
        <LeaseRadarView data={leaseRadar} compact />
      </section>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard href="/crm" icon={<Building2 className="size-4" />} label="Properties" value={stats.properties} />
        <StatCard href="/crm?tab=contacts" icon={<Users className="size-4" />} label="Contacts" value={stats.contacts} />
        <StatCard href="/crm?tab=leases" icon={<FileText className="size-4" />} label="Leases" value={stats.leases} />
        <StatCard href="/follow-ups" icon={<CheckSquare className="size-4" />} label="Follow-ups due" value={stats.followUpsDue} highlight={stats.followUpsDue > 0} />
        <StatCard href="/outreach" icon={<Zap className="size-4" />} label="Outreach overdue" value={overdueOutreach} highlight={overdueOutreach > 0} />
        <StatCard href="/deals" icon={<Briefcase className="size-4" />} label="Active pursuits" value={dealsDashboard.activeCount} />
      </div>

      <div className="grid xl:grid-cols-[1fr_300px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <section className="space-y-3">
            <SectionHeader title="Recent activity" href="/crm" hrefLabel="CRM →" />
            <ActivityTimeline activities={recentActivities} />
          </section>
          <CadencePanel cadence={cadence} />
        </div>

        <div className="space-y-4">
          <DealsDashboardPanel summary={dealsDashboard} />
          <ExpiringLeasesPanel items={leaseRadar.within3.slice(0, 6)} total={leaseRadar.counts.within3} />
          {ownershipChangedProperties.length > 0 && (
            <OwnershipChangedPanel items={ownershipChangedProperties} />
          )}
          <PortfolioPanel portfolio={portfolio} />
          <DataHealthPanel health={dataHealth} />
        </div>
      </div>

    </div>
  );
}
