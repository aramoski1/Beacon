"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, Users, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContactRow } from "./actions";
import { DEFAULT_CADENCE_TIER_DAYS, cadenceDaysForTier } from "@/lib/cadence";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function isOverdue(c: ContactRow, cadence: Record<number, number>): boolean {
  if (!c.contact_tier) return false;
  const threshold = cadenceDaysForTier(c.contact_tier, cadence) ?? 90;
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

const STAGE_LABELS: Record<string, string> = {
  prospect:    "Prospect",
  active:      "Active",
  client:      "Client",
  past_client: "Past client",
  dormant:     "Dormant",
};

function stageLabel(s: string | null): string | null {
  if (!s) return null;
  return STAGE_LABELS[s] ?? s;
}

function stageCls(s: string | null) {
  if (s === "active" || s === "client")
    return "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-400";
  if (s === "prospect")
    return "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400";
  if (s === "past_client")
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Effective stage: prefer relationship_stage, fall back to client_status for legacy rows
function effectiveStage(c: ContactRow): string | null {
  return c.relationship_stage || c.client_status || null;
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

const selCls =
  "border border-border rounded-md px-3 py-1.5 text-sm bg-background outline-none focus:ring-2 ring-ring";

function FilterBar({
  q, tier, stage,
  setQ, setTier, setStage,
}: {
  q: string; tier: string; stage: string;
  setQ: (v: string) => void;
  setTier: (v: string) => void;
  setStage: (v: string) => void;
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

      <select value={stage} onChange={(e) => setStage(e.target.value)} className={selCls}>
        <option value="">All stages</option>
        <option value="prospect">Prospect</option>
        <option value="active">Active</option>
        <option value="client">Client</option>
        <option value="past_client">Past client</option>
        <option value="dormant">Dormant</option>
      </select>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function ContactsView({
  contacts,
  cadenceDays = DEFAULT_CADENCE_TIER_DAYS,
}: {
  contacts: ContactRow[];
  cadenceDays?: Record<number, number>;
}) {
  const [q, setQ]       = useState("");
  const [tier, setTier] = useState("");
  const [stage, setStage] = useState("");

  const filtered = useMemo(() => {
    let list = contacts;
    if (q) {
      const lq = q.toLowerCase();
      list = list.filter(
        (c) =>
          (c.name ?? "").toLowerCase().includes(lq) ||
          (c.company ?? "").toLowerCase().includes(lq)
      );
    }
    if (tier)  list = list.filter((c) => String(c.contact_tier) === tier);
    if (stage) list = list.filter((c) => effectiveStage(c) === stage);
    return list;
  }, [contacts, q, tier, stage]);

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {contacts.length} total · {contacts.filter((c) => c.contact_tier != null).length} in cadence
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
        q={q} tier={tier} stage={stage}
        setQ={setQ} setTier={setTier} setStage={setStage}
      />

      {/* Table */}
      {filtered.length === 0 ? (
        contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <Users className="size-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium">No contacts yet</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Add contacts one by one or import a spreadsheet to get started fast.
              </p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Link
                href="/onboarding"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Import from spreadsheet
              </Link>
              <Link
                href="/contacts/new"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border hover:bg-muted/50 transition-colors"
              >
                <UserPlus className="size-3.5" />
                Add manually
              </Link>
            </div>
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
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Stage</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Properties</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Last contact</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Cadence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.map((c) => {
                const d = daysSince(c.last_contacted_at);
                const overdue = isOverdue(c, cadenceDays);
                const propCount = (c.linked_properties ?? []).length;
                const es = effectiveStage(c);

                return (
                  <tr key={c.id} className="hover:bg-muted/30 transition-colors">
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
                      {es ? (
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", stageCls(es))}>
                          {stageLabel(es)}
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
