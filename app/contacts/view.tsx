"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, Users, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContactRow } from "./actions";

// ─── Constants ─────────────────────────────────────────────────────────────────

const CADENCE_DAYS: Record<number, number> = { 1: 14, 2: 30, 3: 90 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function isOverdue(c: ContactRow): boolean {
  if (!c.contact_tier) return false;
  const threshold = CADENCE_DAYS[c.contact_tier] ?? 90;
  const d = daysSince(c.last_contacted_at);
  if (d === null) return true;
  return d > threshold;
}

function tierCls(tier: number | null) {
  if (tier === 1) return "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400";
  if (tier === 2) return "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400";
  if (tier === 3) return "bg-muted text-muted-foreground";
  return "";
}

function typeCls(t: string | null) {
  if (t === "owner")  return "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-400";
  if (t === "tenant") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400";
  if (t === "other")  return "bg-muted text-muted-foreground";
  return "";
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

const selCls =
  "border border-border rounded-md px-3 py-1.5 text-sm bg-background outline-none focus:ring-2 ring-ring";

function FilterBar({
  q, tier, status, contactType,
  setQ, setTier, setStatus, setContactType,
}: {
  q: string; tier: string; status: string; contactType: string;
  setQ: (v: string) => void;
  setTier: (v: string) => void;
  setStatus: (v: string) => void;
  setContactType: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <div className="relative flex-1 min-w-48">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="search"
          placeholder="Search name or company…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full border border-border rounded-md pl-8 pr-3 py-1.5 text-sm bg-background outline-none focus:ring-2 ring-ring"
        />
      </div>

      <select value={tier} onChange={(e) => setTier(e.target.value)} className={selCls}>
        <option value="">All tiers</option>
        <option value="1">Tier 1</option>
        <option value="2">Tier 2</option>
        <option value="3">Tier 3</option>
      </select>

      <select value={status} onChange={(e) => setStatus(e.target.value)} className={selCls}>
        <option value="">All statuses</option>
        <option value="active client">Active client</option>
        <option value="past client">Past client</option>
        <option value="prospect">Prospect</option>
      </select>

      <select value={contactType} onChange={(e) => setContactType(e.target.value)} className={selCls}>
        <option value="">All types</option>
        <option value="owner">Owner</option>
        <option value="tenant">Tenant</option>
        <option value="other">Other</option>
      </select>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function ContactsView({ contacts }: { contacts: ContactRow[] }) {
  const [q, setQ]                   = useState("");
  const [tier, setTier]             = useState("");
  const [status, setStatus]         = useState("");
  const [contactType, setContactType] = useState("");

  const filtered = useMemo(() => {
    let list = contacts;
    if (q) {
      const lq = q.toLowerCase();
      list = list.filter(c =>
        (c.name ?? "").toLowerCase().includes(lq) ||
        (c.company ?? "").toLowerCase().includes(lq)
      );
    }
    if (tier)        list = list.filter(c => String(c.contact_tier) === tier);
    if (status)      list = list.filter(c => c.client_status === status);
    if (contactType) list = list.filter(c => c.contact_type === contactType);
    return list;
  }, [contacts, q, tier, status, contactType]);

  return (
    <main className="px-6 py-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {contacts.length} total · {contacts.filter(c => c.contact_tier != null).length} in cadence
          </p>
        </div>
        <Link
          href="/contacts/new"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
        >
          <UserPlus className="size-3.5" />
          New contact
        </Link>
      </div>

      {/* Filters */}
      <FilterBar
        q={q} tier={tier} status={status} contactType={contactType}
        setQ={setQ} setTier={setTier} setStatus={setStatus} setContactType={setContactType}
      />

      {/* Table */}
      {filtered.length === 0 ? (
        contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <Users className="size-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium">No contacts yet</p>
              <p className="text-sm text-muted-foreground mt-0.5">Add your first contact to start tracking relationships.</p>
            </div>
            <Link
              href="/contacts/new"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors mt-1"
            >
              <UserPlus className="size-3.5" />
              Add first contact
            </Link>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-6">No contacts match the current filters.</p>
        )
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Company</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Tier</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Type</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Properties</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Last contact</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Cadence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.map((c) => {
                const d = daysSince(c.last_contacted_at);
                const overdue = isOverdue(c);
                const propCount = (c.linked_properties ?? []).length;

                return (
                  <tr
                    key={c.id}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/contacts/${c.id}`}
                        className="font-medium hover:underline underline-offset-2 truncate block max-w-[180px]"
                      >
                        {c.name ?? "—"}
                      </Link>
                      {c.company && (
                        <p className="text-xs text-muted-foreground truncate sm:hidden">{c.company}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell truncate max-w-[160px] text-sm">
                      {c.company ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {c.contact_tier != null ? (
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tierCls(c.contact_tier))}>
                          T{c.contact_tier}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {c.contact_type ? (
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize", typeCls(c.contact_type))}>
                          {c.contact_type}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-sm text-muted-foreground tabular-nums">
                      {propCount > 0 ? propCount : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                      {fmtDate(c.last_contacted_at) ?? <span className="text-muted-foreground/40">Never</span>}
                    </td>
                    <td className="px-4 py-3">
                      {c.contact_tier == null ? (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      ) : d === null ? (
                        <span className="text-xs text-destructive font-medium">Never contacted</span>
                      ) : overdue ? (
                        <span className="text-xs text-destructive">{d}d overdue</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{d}d ago</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
