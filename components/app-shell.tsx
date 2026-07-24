"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import {
  Briefcase, CalendarClock, Plus,
  LayoutDashboard, LayoutGrid, Zap,
  CheckSquare, Settings2, LogOut, Menu, X,
  ShieldAlert, AlertCircle, MapPinned,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_CADENCE_TIER_DAYS } from "@/lib/cadence";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/login/actions";
import { BeaconBrand } from "@/components/beacon-logo";
import { LS_USER_EMAIL } from "@/lib/email-provider";

// ─── Nav entries ──────────────────────────────────────────────────────────────

type NavEntry = {
  href: string;
  icon: React.ElementType;
  label: string;
  badge?: "outreach" | "leaseRadar";
};

const NAV: NavEntry[] = [
  { href: "/dashboard",       icon: LayoutDashboard, label: "Dashboard" },
  { href: "/crm",             icon: LayoutGrid,      label: "Workspace" },
  { href: "/deals",           icon: Briefcase,       label: "Deals" },
  { href: "/lease-radar",     icon: CalendarClock,   label: "Lease radar",  badge: "leaseRadar" },
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
      pathname.startsWith("/owner-portfolio/") ||
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

const NO_SHELL = ["/login", "/auth/", "/onboarding"];

// ─── Nav item ─────────────────────────────────────────────────────────────────

function NavItem({
  href, icon: Icon, label, active, badgeCount, onClick,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  badgeCount?: number;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
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

// ─── Sidebar contents (shared between desktop + mobile drawer) ────────────────

const NEW_MENU_ITEMS = [
  { href: "/properties/new", label: "Add property" },
  { href: "/contacts/new",   label: "Add contact" },
  { href: "/abstracts/new",  label: "Abstract lease" },
  { href: "/deals?new=1",    label: "New pursuit" },
];

function Sidebar({
  user,
  overdueCount,
  followUpsDueCount,
  leaseRadarUrgentCount,
  mobileOpen,
  onClose,
}: {
  user: User | null;
  overdueCount: number;
  followUpsDueCount: number;
  leaseRadarUrgentCount: number;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);

  // Close mobile nav on route change
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      prevPathRef.current = pathname;
      onClose();
    }
  }, [pathname, onClose]);

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
    <aside
      className={cn(
        // Shared
        "flex flex-col bg-card border-r h-full",
        // Mobile: fixed drawer that slides in/out
        "fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-200 ease-in-out",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        // Desktop: static in flow, always visible, narrower
        "lg:static lg:translate-x-0 lg:z-auto lg:w-52 lg:shrink-0",
      )}
    >
      {/* Logo */}
      <div className="px-4 py-3.5 border-b flex items-center justify-between">
        <Link href="/dashboard" className="block rounded-md outline-none focus-visible:ring-2 ring-ring" onClick={onClose}>
          <BeaconBrand />
        </Link>
        {/* Close button — mobile only */}
        <button
          type="button"
          onClick={onClose}
          className="lg:hidden text-muted-foreground hover:text-foreground transition-colors p-0.5"
          aria-label="Close navigation"
        >
          <X className="size-4" />
        </button>
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
                onClick={() => { setNewMenuOpen(false); onClose(); }}
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
              onClick={onClose}
            />
          );
        })}

        <div className="pt-3 mt-2 border-t space-y-0.5">
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Advanced
          </p>
          <Link
            href="/book-map"
            onClick={onClose}
            className={cn(
              "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs transition-colors",
              pathname.startsWith("/book-map")
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <MapPinned className="size-3.5 shrink-0 text-muted-foreground/70" />
            Book map
          </Link>
          <Link
            href="/follow-ups"
            onClick={onClose}
            className={cn(
              "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs transition-colors",
              pathname.startsWith("/follow-ups")
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <CheckSquare className="size-3.5 shrink-0 text-muted-foreground/70" />
            <span className="flex-1">All tasks</span>
            {followUpsDueCount > 0 && (
              <span className="tabular-nums text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full px-1.5 min-w-[1.125rem] text-center leading-5">
                {followUpsDueCount > 99 ? "99+" : followUpsDueCount}
              </span>
            )}
          </Link>
          <Link
            href="/properties/audit"
            onClick={onClose}
            className={cn(
              "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs transition-colors",
              pathname.startsWith("/properties/audit")
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <ShieldAlert className="size-3.5 shrink-0 text-muted-foreground/70" />
            Data audit
          </Link>
          <Link
            href="/properties/errors"
            onClick={onClose}
            className={cn(
              "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs transition-colors",
              pathname.startsWith("/properties/errors")
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <AlertCircle className="size-3.5 shrink-0 text-muted-foreground/70" />
            Ingestion errors
          </Link>
        </div>
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
      1: settingsData?.cadence_tier1_days ?? DEFAULT_CADENCE_TIER_DAYS[1],
      2: settingsData?.cadence_tier2_days ?? DEFAULT_CADENCE_TIER_DAYS[2],
      3: settingsData?.cadence_tier3_days ?? DEFAULT_CADENCE_TIER_DAYS[3],
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
      if (data.user?.email) localStorage.setItem(LS_USER_EMAIL, data.user.email);
      if (data.user) fetchCounts();
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
      if (session?.user?.email) localStorage.setItem(LS_USER_EMAIL, session.user.email);
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
      {/* Mobile top bar — hidden on desktop */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-30 flex h-14 items-center justify-between border-b bg-card px-4">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </button>
        <BeaconBrand />
        <div className="w-5" aria-hidden />
      </div>

      {/* Mobile backdrop — only rendered when drawer is open */}
      {mobileNavOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}

      <Sidebar
        user={user}
        overdueCount={overdueCount}
        followUpsDueCount={followUpsDueCount}
        leaseRadarUrgentCount={leaseRadarUrgentCount}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      {/* pt-14 on mobile pushes content below the fixed top bar; lg resets it */}
      <main className="flex-1 overflow-auto min-w-0 bg-background pt-14 lg:pt-0">
        {children}
      </main>
    </div>
  );
}
