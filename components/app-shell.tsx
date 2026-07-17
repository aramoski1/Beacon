"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import {
  Briefcase, CalendarClock, Plus,
  LayoutDashboard, LayoutGrid, Zap,
  CheckSquare, Settings2, LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/login/actions";
import { BeaconBrand } from "@/components/beacon-logo";

// ─── Nav entries ──────────────────────────────────────────────────────────────

type NavEntry = {
  href: string;
  icon: React.ElementType;
  label: string;
  badge?: "followUps" | "outreach" | "leaseRadar";
};

const NAV: NavEntry[] = [
  { href: "/dashboard",       icon: LayoutDashboard, label: "Dashboard" },
  { href: "/crm",             icon: LayoutGrid,      label: "Workspace" },
  { href: "/deals",           icon: Briefcase,       label: "Deals" },
  { href: "/lease-radar",     icon: CalendarClock,   label: "Lease radar",  badge: "leaseRadar" },
  { href: "/follow-ups",      icon: CheckSquare,     label: "Follow-ups", badge: "followUps" },
  { href: "/outreach",        icon: Zap,             label: "Outreach",   badge: "outreach" },
  { href: "/settings",        icon: Settings2,       label: "Settings" },
];

// ─── Active-path logic ────────────────────────────────────────────────────────

function navActive(href: string, pathname: string): boolean {
  if (href === "/lease-radar") {
    return pathname === "/lease-radar";
  }
  if (href === "/crm") {
    return (
      pathname === "/crm" ||
      (pathname.startsWith("/properties/") && pathname !== "/properties/new") ||
      pathname.startsWith("/contacts/") ||
      (pathname.startsWith("/abstracts/") && pathname !== "/abstracts/new")
    );
  }
  if (href === "/settings") {
    return pathname.startsWith("/settings");
  }
  if (href === "/deals") {
    return pathname.startsWith("/deals");
  }
  return pathname === href;
}

const NO_SHELL = ["/login", "/auth/"];

// ─── Nav item ─────────────────────────────────────────────────────────────────

function NavItem({
  href, icon: Icon, label, active, badgeCount,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  badgeCount?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
        active
          ? "bg-primary/8 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground/70")} />
      <span className="flex-1 truncate">{label}</span>
      {badgeCount != null && badgeCount > 0 && (
        <span className="ml-auto tabular-nums text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full px-1.5 min-w-[1.125rem] text-center leading-5">
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </Link>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const NEW_MENU_ITEMS = [
  { href: "/properties/new", label: "Add property" },
  { href: "/contacts/new",   label: "Add contact" },
  { href: "/abstracts/new",  label: "Abstract lease" },
  { href: "/deals",          label: "New pursuit" },
];

function Sidebar({
  user,
  overdueCount,
  followUpsDueCount,
  leaseRadarUrgentCount,
}: {
  user: User | null;
  overdueCount: number;
  followUpsDueCount: number;
  leaseRadarUrgentCount: number;
}) {
  const pathname = usePathname();
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!newMenuOpen) return;
    function handler(e: MouseEvent) {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setNewMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [newMenuOpen]);

  return (
    <aside className="w-52 shrink-0 flex flex-col h-full border-r bg-card">
      {/* Logo */}
      <div className="px-4 py-3.5 border-b">
        <Link href="/dashboard" className="block rounded-md outline-none focus-visible:ring-2 ring-ring">
          <BeaconBrand />
        </Link>
      </div>

      {/* + New button */}
      <div className="relative px-2 pt-2 pb-1" ref={newMenuRef}>
        <button
          type="button"
          onClick={() => setNewMenuOpen((v) => !v)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="size-3.5" />
          New
        </button>
        {newMenuOpen && (
          <div className="absolute left-2 right-2 top-full mt-0.5 z-50 rounded-md border bg-card shadow-lg py-1">
            {NEW_MENU_ITEMS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setNewMenuOpen(false)}
                className="flex items-center px-3 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
              >
                {label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {NAV.map(({ href, icon, label, badge }) => {
          const active = navActive(href, pathname);
          const badgeCount =
            badge === "outreach" ? overdueCount :
            badge === "followUps" ? followUpsDueCount :
            badge === "leaseRadar" ? leaseRadarUrgentCount :
            undefined;
          return (
            <NavItem
              key={href}
              href={href}
              icon={icon}
              label={label}
              active={active}
              badgeCount={badgeCount}
            />
          );
        })}
      </nav>

      {/* User + sign out */}
      <div className="shrink-0 border-t px-2 py-2.5 space-y-0.5">
        {user?.email && (
          <p className="px-3 py-1 text-xs text-muted-foreground truncate" title={user.email}>
            {user.email}
          </p>
        )}
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <LogOut className="size-3.5 shrink-0 text-muted-foreground/70" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [overdueCount, setOverdueCount] = useState(0);
  const [followUpsDueCount, setFollowUpsDueCount] = useState(0);
  const [leaseRadarUrgentCount, setLeaseRadarUrgentCount] = useState(0);

  async function fetchCounts() {
    const supabase = createClient();
    const today = new Date().toISOString().slice(0, 10);

    const ninetyDays = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);

    const [{ data: contactsForBadge }, { count: fuCount }, { count: leaseUrgent }, { data: settingsData }] = await Promise.all([
      supabase.from("contacts").select("contact_tier, last_contacted_at"),
      supabase
        .from("follow_ups")
        .select("*", { count: "exact", head: true })
        .eq("done", false)
        .lte("due_date", today),
      supabase
        .from("lease_abstracts")
        .select("*", { count: "exact", head: true })
        .not("expiration_date", "is", null)
        .gte("expiration_date", today)
        .lte("expiration_date", ninetyDays),
      supabase
        .from("user_settings")
        .select("cadence_tier1_days, cadence_tier2_days, cadence_tier3_days")
        .maybeSingle(),
    ]);

    const cadence: Record<number, number> = {
      1: settingsData?.cadence_tier1_days ?? 14,
      2: settingsData?.cadence_tier2_days ?? 30,
      3: settingsData?.cadence_tier3_days ?? 90,
    };

    const overdue =
      contactsForBadge?.filter((c) => {
        if (!c.contact_tier) return false;
        const threshold = cadence[c.contact_tier as 1 | 2 | 3] ?? 90;
        if (!c.last_contacted_at) return true;
        return Math.floor((Date.now() - new Date(c.last_contacted_at).getTime()) / 86_400_000) >= threshold;
      }).length ?? 0;

    setOverdueCount(overdue);
    setFollowUpsDueCount(fuCount ?? 0);
    setLeaseRadarUrgentCount(leaseUrgent ?? 0);
  }

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      if (data.user) fetchCounts();
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchCounts();
      else { setOverdueCount(0); setFollowUpsDueCount(0); setLeaseRadarUrgentCount(0); }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hideSidebar = NO_SHELL.some((p) => pathname.startsWith(p));
  if (hideSidebar) return <>{children}</>;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={user} overdueCount={overdueCount} followUpsDueCount={followUpsDueCount} leaseRadarUrgentCount={leaseRadarUrgentCount} />
      <main className="flex-1 overflow-auto min-w-0 bg-background">
        {children}
      </main>
    </div>
  );
}
