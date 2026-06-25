"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import {
  LayoutDashboard, LayoutGrid, Users, Zap, BookOpen,
  CheckSquare, Building2, Link2, FileText, Upload, LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/login/actions";
import { BeaconBrand } from "@/components/beacon-logo";

// ─── Nav groups ───────────────────────────────────────────────────────────────

type NavEntry = {
  href: string;
  icon: React.ElementType;
  label: string;
  badge?: "followUps" | "outreach";
};

const WORKSPACE: NavEntry[] = [
  { href: "/dashboard",  icon: LayoutDashboard, label: "Dashboard" },
  { href: "/crm",        icon: LayoutGrid,      label: "CRM" },
  { href: "/contacts",   icon: Users,           label: "Contacts" },
  { href: "/follow-ups", icon: CheckSquare,     label: "Follow-ups",     badge: "followUps" },
  { href: "/outreach",   icon: Zap,             label: "Outreach",       badge: "outreach" },
  { href: "/abstracts",  icon: BookOpen,        label: "Lease abstracts" },
];

const ADD_DATA = [
  { href: "/properties/new",    icon: Building2, label: "Look up property" },
  { href: "/properties/url",    icon: Link2,     label: "Add from URL" },
  { href: "/properties/upload", icon: Upload,    label: "Upload property" },
  { href: "/abstracts/new",     icon: FileText,  label: "Abstract a lease" },
] as const;

// ─── Active-path logic ────────────────────────────────────────────────────────

function navActive(href: string, pathname: string): boolean {
  if (href === "/abstracts") {
    return pathname === "/abstracts" || (pathname.startsWith("/abstracts/") && pathname !== "/abstracts/new");
  }
  if (href === "/contacts") {
    return pathname === "/contacts" || pathname.startsWith("/contacts/");
  }
  if (href === "/crm") {
    return pathname === "/crm";
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

// ─── Nav group ────────────────────────────────────────────────────────────────

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 select-none">
        {label}
      </p>
      {children}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({
  user,
  overdueCount,
  followUpsDueCount,
}: {
  user: User | null;
  overdueCount: number;
  followUpsDueCount: number;
}) {
  const pathname = usePathname();

  return (
    <aside className="w-52 shrink-0 flex flex-col h-full border-r bg-card">
      {/* Logo */}
      <div className="px-4 py-3.5 border-b">
        <Link href="/dashboard" className="block rounded-md outline-none focus-visible:ring-2 ring-ring">
          <BeaconBrand />
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        <NavGroup label="Workspace">
          {WORKSPACE.map(({ href, icon, label, badge }) => {
            const active = navActive(href, pathname);
            const badgeCount =
              badge === "outreach" ? overdueCount :
              badge === "followUps" ? followUpsDueCount :
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
        </NavGroup>

        <NavGroup label="Add data">
          {ADD_DATA.map(({ href, icon, label }) => (
            <NavItem
              key={href}
              href={href}
              icon={icon}
              label={label}
              active={navActive(href, pathname)}
            />
          ))}
        </NavGroup>
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

  async function fetchCounts() {
    const supabase = createClient();
    const today = new Date().toISOString().slice(0, 10);

    const [{ data: contactsForBadge }, { count: fuCount }] = await Promise.all([
      supabase.from("contacts").select("contact_tier, last_contacted_at"),
      supabase
        .from("follow_ups")
        .select("*", { count: "exact", head: true })
        .eq("done", false)
        .lte("due_date", today),
    ]);

    const overdue =
      contactsForBadge?.filter((c) => {
        if (!c.contact_tier) return false;
        const threshold = ({ 1: 14, 2: 30, 3: 90 } as Record<number, number>)[c.contact_tier as 1 | 2 | 3] ?? 90;
        if (!c.last_contacted_at) return true;
        return Math.floor((Date.now() - new Date(c.last_contacted_at).getTime()) / 86_400_000) >= threshold;
      }).length ?? 0;

    setOverdueCount(overdue);
    setFollowUpsDueCount(fuCount ?? 0);
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
      else { setOverdueCount(0); setFollowUpsDueCount(0); }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hideSidebar = NO_SHELL.some((p) => pathname.startsWith(p));
  if (hideSidebar) return <>{children}</>;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={user} overdueCount={overdueCount} followUpsDueCount={followUpsDueCount} />
      <main className="flex-1 overflow-auto min-w-0 bg-background">
        {children}
      </main>
    </div>
  );
}
