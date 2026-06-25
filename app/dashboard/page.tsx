import { redirect } from "next/navigation";
import { Building2, Users, FileText, CheckSquare, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDueContacts } from "@/app/outreach/actions";
import { getFollowUpsDashboard } from "@/app/follow-ups/actions";
import {
  getDashboardStats,
  getRecentActivities,
  getExpiringLeases,
  getPortfolioSnapshot,
  getDataHealth,
  getCadenceHealth,
  getBriefingMetrics,
} from "./actions";
import { OverdueList } from "./overdue-list";
import { DashboardFollowUpList } from "./follow-up-list";
import { DashboardSearch } from "./dashboard-search";
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
    expiringLeases,
    portfolio,
    cadence,
    dataHealth,
  ] = await Promise.all([
    getDueContacts(),
    getDashboardStats(),
    getRecentActivities(),
    getFollowUpsDashboard(),
    getExpiringLeases(),
    getPortfolioSnapshot(),
    getCadenceHealth(),
    getDataHealth(),
  ]);

  const overdueOutreach = dueContacts.filter((c) => c.daysOverdue > 0).length;
  const dueTodayOutreach = dueContacts.filter((c) => c.daysOverdue === 0).length;

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

  const needsAttention =
    followUpsDash.overdue.length > 0 ||
    followUpsDash.today.length > 0 ||
    overdueOutreach > 0;

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

      {needsAttention && (
        <div className="space-y-6">
          {(followUpsDash.overdue.length > 0 || followUpsDash.today.length > 0) && (
            <section className="space-y-3">
              <SectionHeader
                title="Follow-ups"
                badge={
                  followUpsDash.overdue.length > 0 ? (
                    <span className="rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold px-2 py-0.5">
                      {followUpsDash.overdue.length} overdue
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted text-muted-foreground text-[10px] font-semibold px-2 py-0.5">
                      due today
                    </span>
                  )
                }
                href="/follow-ups"
                hrefLabel="All follow-ups →"
              />
              <DashboardFollowUpList
                initialOverdue={followUpsDash.overdue}
                initialToday={followUpsDash.today}
              />
            </section>
          )}

          {overdueOutreach > 0 && (
            <section className="space-y-3">
              <SectionHeader
                title="Outreach due"
                badge={
                  <span className="rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold px-2 py-0.5">
                    {overdueOutreach} overdue
                  </span>
                }
                href="/outreach"
                hrefLabel="Full outreach →"
              />
              <div className="rounded-xl border bg-card">
                <OverdueList contacts={dueContacts} />
              </div>
            </section>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatCard href="/crm"        icon={<Building2 className="size-4" />} label="Properties"       value={stats.properties} />
        <StatCard href="/contacts"   icon={<Users className="size-4" />}     label="Contacts"         value={stats.contacts} />
        <StatCard href="/abstracts"  icon={<FileText className="size-4" />}  label="Leases"           value={stats.leases} />
        <StatCard href="/follow-ups" icon={<CheckSquare className="size-4" />} label="Follow-ups due" value={stats.followUpsDue} highlight={stats.followUpsDue > 0} />
        <StatCard href="/outreach"   icon={<Zap className="size-4" />}       label="Outreach overdue" value={overdueOutreach}  highlight={overdueOutreach > 0} />
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
          <ExpiringLeasesPanel items={expiringLeases.items} total={expiringLeases.total} />
          <PortfolioPanel portfolio={portfolio} />
          <DataHealthPanel health={dataHealth} />
        </div>
      </div>

    </div>
  );
}
