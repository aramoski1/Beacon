import { redirect } from "next/navigation";
import { Building2, Users, FileText, CheckSquare, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDueContacts } from "@/app/outreach/actions";
import { getFollowUpsDashboard, getUpcomingFollowUps } from "@/app/follow-ups/actions";
import {
  getDashboardStats,
  getRecentActivities,
  getExpiringLeases,
  getPortfolioSnapshot,
  getDataHealth,
  getCadenceHealth,
  getBriefingMetrics,
  getUnworkedOpportunities,
  getColdTier1Contacts,
  getWeekMomentum,
} from "./actions";
import { DashboardSearch } from "./dashboard-search";
import { NeedsAttentionToday } from "./needs-attention";
import { UpcomingFollowUpList } from "./follow-up-list";
import { SinceLastVisit } from "./since-last-visit";
import { getLeaseRadarData } from "@/app/lease-radar/actions";
import { LeaseRadarView } from "@/app/lease-radar/lease-radar-view";
import {
  WeekMomentumBar,
  UnworkedOpportunitiesPanel,
  ColdTier1Panel,
} from "./dashboard-widgets";
import {
  DashboardHero,
  ActivityTimeline,
  StatCard,
  ExpiringLeasesPanel,
  SectionHeader,
  PriorityPills,
  QuickActionsPanel,
  CadencePanel,
  PortfolioPanel,
  DataHealthPanel,
} from "./dashboard-sections";

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

  const [
    dueContacts,
    stats,
    recentActivities,
    followUpsDash,
    upcomingFollowUps,
    expiringLeases,
    leaseRadar,
    portfolio,
    cadence,
    dataHealth,
    unworked,
    coldTier1,
    momentum,
  ] = await Promise.all([
    getDueContacts(),
    getDashboardStats(),
    getRecentActivities(),
    getFollowUpsDashboard(),
    getUpcomingFollowUps(8),
    getExpiringLeases(),
    getLeaseRadarData(),
    getPortfolioSnapshot(),
    getCadenceHealth(),
    getDataHealth(),
    getUnworkedOpportunities(6),
    getColdTier1Contacts(6),
    getWeekMomentum(),
  ]);

  const overdueOutreach = dueContacts.filter((c) => c.daysOverdue > 0).length;
  const dueTodayOutreach = dueContacts.filter((c) => c.daysOverdue === 0).length;
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
  );

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  const heroName = user.email
    ? `${greeting()}, ${displayName(user.email)}`
    : greeting();

  return (
    <div className="dashboard-page px-6 py-8 max-w-[80rem] mx-auto space-y-8">

      <DashboardHero
        name={heroName}
        date={today}
        briefing={briefing}
        portfolio={portfolio}
        cadence={cadence}
        search={<DashboardSearch />}
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
              dueContacts={dueContacts}
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

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatCard href="/crm" icon={<Building2 className="size-4" />} label="Properties" value={stats.properties} />
        <StatCard href="/crm?tab=contacts" icon={<Users className="size-4" />} label="Contacts" value={stats.contacts} />
        <StatCard href="/crm?tab=leases" icon={<FileText className="size-4" />} label="Leases" value={stats.leases} />
        <StatCard href="/follow-ups" icon={<CheckSquare className="size-4" />} label="Follow-ups due" value={stats.followUpsDue} highlight={stats.followUpsDue > 0} />
        <StatCard href="/outreach" icon={<Zap className="size-4" />} label="Outreach overdue" value={overdueOutreach} highlight={overdueOutreach > 0} />
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
          <QuickActionsPanel />
          <ExpiringLeasesPanel items={expiringLeases.items.slice(0, 6)} total={expiringLeases.total} />
          <PortfolioPanel portfolio={portfolio} />
          <DataHealthPanel health={dataHealth} />
        </div>
      </div>

    </div>
  );
}
