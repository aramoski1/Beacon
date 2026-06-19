"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { LayoutGrid, Building2, Link2, FileText, LogOut, Zap, BookOpen, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/login/actions";

const NAV = [
  { href: "/crm",               icon: LayoutGrid, label: "CRM" },
  { href: "/outreach",          icon: Zap,        label: "Outreach" },
  { href: "/properties/new",    icon: Building2,  label: "Look up property" },
  { href: "/properties/url",    icon: Link2,      label: "Add from URL" },
  { href: "/properties/upload", icon: Upload,     label: "Upload property" },
  { href: "/abstracts",         icon: BookOpen,   label: "Lease abstracts" },
  { href: "/abstracts/new",     icon: FileText,   label: "Abstract a lease" },
];

// Returns true when this nav item should appear active for the current path.
// "/abstracts" matches /abstracts and /abstracts/[id] but NOT /abstracts/new.
// Everything else is an exact match.
function navActive(href: string, pathname: string): boolean {
  if (href === "/abstracts") {
    return (
      pathname === "/abstracts" ||
      (pathname.startsWith("/abstracts/") && pathname !== "/abstracts/new")
    );
  }
  return pathname === href;
}

// Paths that render full-screen without the shell (login, auth callback)
const NO_SHELL = ["/login", "/auth/"];

function Sidebar({ user, overdueCount }: { user: User | null; overdueCount: number }) {
  const pathname = usePathname();

  return (
    <aside className="w-52 shrink-0 flex flex-col h-full border-r bg-card">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-4 border-b">
        <div className="size-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm select-none">
          B
        </div>
        <span className="font-bold tracking-tight text-base">Beacon</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = navActive(href, pathname);
          const isOutreach = href === "/outreach";
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
              {isOutreach && overdueCount > 0 && (
                <span className="ml-auto text-xs bg-destructive text-destructive-foreground rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none">
                  {overdueCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User + sign out */}
      <div className="shrink-0 border-t px-3 py-3 space-y-0.5">
        {user?.email && (
          <p className="px-2 py-1 text-xs text-muted-foreground truncate" title={user.email}>
            {user.email}
          </p>
        )}
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <LogOut className="size-4 shrink-0" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [overdueCount, setOverdueCount] = useState(0);

  async function fetchOverdueCount() {
    const supabase = createClient();
    const { data: contactsForBadge } = await supabase
      .from("contacts")
      .select("contact_tier, last_contacted_at");
    const count =
      contactsForBadge?.filter((c) => {
        if (!c.contact_tier) return false;
        const threshold =
          ({ 1: 14, 2: 30, 3: 90 } as Record<number, number>)[
            c.contact_tier as 1 | 2 | 3
          ] ?? 90;
        if (!c.last_contacted_at) return true;
        return (
          Math.floor(
            (Date.now() - new Date(c.last_contacted_at).getTime()) / 86400000
          ) >= threshold
        );
      }).length ?? 0;
    setOverdueCount(count);
  }

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      if (data.user) fetchOverdueCount();
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchOverdueCount();
      else setOverdueCount(0);
    });
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hideSidebar = NO_SHELL.some((p) => pathname.startsWith(p));
  if (hideSidebar) return <>{children}</>;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={user} overdueCount={overdueCount} />
      <main className="flex-1 overflow-auto min-w-0">
        {children}
      </main>
    </div>
  );
}
