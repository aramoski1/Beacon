"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  FileText,
  Layers,
  Mail,
  MapPin,
  Network,
  Ruler,
  Tag,
  TrendingUp,
  TriangleAlert,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fmtPortfolioSqft,
  leaseLabel,
  TIMELINE_KIND_META,
  type OwnerPortfolioData,
} from "@/lib/owner-portfolio";
import type { MdpaSearchQuery } from "@/lib/owner-portfolio";
import { buildPortfolioAttentionFlags } from "@/lib/portfolio-attention";
import { PortfolioTaxRollSection } from "./portfolio-tax-roll-section";
import { PortfolioBriefing } from "./portfolio-briefing";
import { ComposeOutreach } from "@/components/compose-outreach";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysUntil(iso: string): number {
  const exp = new Date(iso.includes("T") ? iso : iso + "T12:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((exp - today.getTime()) / 86_400_000);
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function OwnerPortfolioView({
  data,
  backHref,
  backLabel,
}: {
  data: OwnerPortfolioData;
  backHref: string;
  backLabel: string;
}) {
  const [composeOpen, setComposeOpen] = useState(false);

  const upcomingLeases = data.leases
    .filter((l) => l.expiration_date)
    .map((l) => ({ ...l, days: daysUntil(l.expiration_date!) }))
    .filter((l) => l.days >= 0 && l.days <= 365)
    .sort((a, b) => a.days - b.days);

  const primaryContact = data.contacts.find((c) => c.id === data.anchorContactId) ?? data.contacts[0];

  const recentSales = data.properties
    .filter((p) => p.last_sale_date && daysSince(p.last_sale_date) <= 730)
    .sort((a, b) => daysSince(a.last_sale_date!) - daysSince(b.last_sale_date!));

  const attention = buildPortfolioAttentionFlags({
    properties: data.properties,
    leases: data.leases,
    contacts: data.contacts,
  });

  // Only show ownership network when there are multiple entities or persons beyond the primary
  const showOwnershipNetwork = data.relatedEntities.length > 1 || data.relatedPersons.length > 0;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          {backLabel}
        </Link>

        <div className="mt-4 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Owner portfolio
            </p>
            <h1 className="text-xl font-semibold tracking-tight mt-1">{data.displayName}</h1>
            {data.subtitle && (
              <p className="text-sm text-muted-foreground mt-0.5">{data.subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {primaryContact && (
              <>
                <button
                  type="button"
                  onClick={() => setComposeOpen(true)}
                  className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Mail className="size-3.5" />
                  Compose outreach
                </button>
                <Link
                  href={`/contacts/${primaryContact.id}`}
                  className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-border bg-background hover:bg-muted/60 transition-colors"
                >
                  <User className="size-3.5" />
                  CRM contact
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {composeOpen && primaryContact && (
        <div className="rounded-xl border bg-card p-4">
          <ComposeOutreach
            contactId={primaryContact.id}
            contactName={primaryContact.name}
            contactEmail={primaryContact.email}
            onDone={() => setComposeOpen(false)}
          />
        </div>
      )}

      {attention.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] px-4 py-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-400 flex items-center gap-1.5">
            <TriangleAlert className="size-3.5" />
            Needs attention
          </p>
          <ul className="space-y-1.5">
            {attention.slice(0, 6).map((f, i) => (
              <li key={`${f.kind}-${i}`}>
                {f.href ? (
                  <Link
                    href={f.href}
                    className="text-sm hover:underline underline-offset-2 block"
                  >
                    <span className="font-medium">{f.title}</span>
                    {f.subtitle && (
                      <span className="text-muted-foreground"> — {f.subtitle}</span>
                    )}
                  </Link>
                ) : (
                  <p className="text-sm">
                    <span className="font-medium">{f.title}</span>
                    {f.subtitle && (
                      <span className="text-muted-foreground"> — {f.subtitle}</span>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatTile
          icon={<Building2 className="size-4" />}
          label="Properties"
          value={String(data.properties.length)}
        />
        <StatTile
          icon={<Ruler className="size-4" />}
          label="Total SF"
          value={data.totalSqft > 0 ? fmtPortfolioSqft(data.totalSqft) : "—"}
        />
        <StatTile
          icon={<FileText className="size-4" />}
          label="Leases tracked"
          value={String(data.leases.length)}
          highlight={upcomingLeases.some((l) => l.days <= 90)}
        />
      </div>

      {/* Portfolio intelligence — AI briefing */}
      <PortfolioBriefing data={data} />

      {upcomingLeases.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-400 flex items-center gap-1.5">
            <CalendarClock className="size-3.5" />
            Rollover pipeline
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {upcomingLeases.slice(0, 5).map((l) => (
              <Link
                key={l.id}
                href={`/abstracts/${l.id}`}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors",
                  l.days <= 90 && "border-red-500/30 bg-red-500/[0.04]",
                )}
              >
                <span className={cn("font-bold tabular-nums", l.days <= 90 && "text-red-600 dark:text-red-400")}>
                  {l.days}d
                </span>
                <span className="truncate max-w-[12rem]">{leaseLabel(l.source_document)}</span>
              </Link>
            ))}
            {upcomingLeases.length > 5 && (
              <span className="text-xs text-muted-foreground self-center">
                +{upcomingLeases.length - 5} more
              </span>
            )}
          </div>
        </div>
      )}

      {data.mdpaSearch && data.mdpaSearch.queries.length > 0 && (
        <PortfolioTaxRollSection queries={data.mdpaSearch.queries} />
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Layers className="size-4 text-muted-foreground" />
          In your workspace
          <span className="text-xs font-normal text-muted-foreground">({data.properties.length})</span>
        </h2>
        {data.properties.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-xl border bg-card px-4 py-8 text-center">
            No matching properties in your workspace yet — use the tax roll section above to import.
          </p>
        ) : (
          <div className="rounded-xl border bg-card overflow-hidden divide-y">
            {data.properties.map((p) => {
              const soldRecently = p.last_sale_date && daysSince(p.last_sale_date) <= 730;
              const ownerChanged = Boolean(p.ownership_change_detected_at);
              return (
                <Link
                  key={p.id}
                  href={`/properties/${p.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors group"
                >
                  <div className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Building2 className="size-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {p.address ?? "Unknown address"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
                      <MapPin className="size-3 shrink-0" />
                      {[p.city, p.submarket, p.property_type].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {ownerChanged && (
                      <span className="hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20">
                        Ownership change
                      </span>
                    )}
                    {soldRecently && (
                      <span className="hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                        <TrendingUp className="size-3" />
                        Sold {fmtDate(p.last_sale_date!)}
                      </span>
                    )}
                    {p.size_sqft != null && (
                      <span className="text-xs font-medium tabular-nums text-muted-foreground">
                        {p.size_sqft.toLocaleString()} sf
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Ownership network — entities and persons */}
      {showOwnershipNetwork && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Network className="size-4 text-muted-foreground" />
            Ownership network
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {data.relatedEntities.length > 0 && (
              <div className="rounded-xl border bg-card px-4 py-3 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Tag className="size-3" />
                  Entities / LLCs
                </p>
                <ul className="space-y-1.5">
                  {data.relatedEntities.slice(0, 8).map((e) => (
                    <li key={e.name} className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium truncate">{e.name}</span>
                      {e.propertyCount > 1 && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {e.propertyCount} props
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.relatedPersons.length > 0 && (
              <div className="rounded-xl border bg-card px-4 py-3 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <User className="size-3" />
                  Key persons
                </p>
                <ul className="space-y-1.5">
                  {data.relatedPersons.slice(0, 8).map((person) => (
                    <li key={person.name} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <span className="font-medium truncate block">{person.name}</span>
                        {person.title && (
                          <span className="text-xs text-muted-foreground truncate block">{person.title}</span>
                        )}
                      </div>
                      {person.propertyCount > 1 && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {person.propertyCount} props
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {data.contacts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <User className="size-4 text-muted-foreground" />
            Linked contacts
          </h2>
          <div className="flex flex-wrap gap-2">
            {data.contacts.map((c) => (
              <Link
                key={c.id}
                href={`/contacts/${c.id}`}
                className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors"
              >
                <span className="font-medium">{c.name ?? "Contact"}</span>
                {c.contact_tier != null && (
                  <span className="text-muted-foreground">T{c.contact_tier}</span>
                )}
                {c.last_contacted_at && (
                  <span className="text-muted-foreground">
                    · {fmtDate(c.last_contacted_at)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {recentSales.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="size-4 text-muted-foreground" />
            Recent sales
            <span className="text-xs font-normal text-muted-foreground">(within 2 years)</span>
          </h2>
          <div className="rounded-xl border bg-card overflow-hidden divide-y">
            {recentSales.map((p) => (
              <Link
                key={p.id}
                href={`/properties/${p.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                    {p.address ?? "Unknown address"}
                  </p>
                  {p.size_sqft != null && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.size_sqft.toLocaleString()} sf
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-medium">{fmtDate(p.last_sale_date!)}</p>
                  {p.last_sale_price != null && (
                    <p className="text-xs text-muted-foreground">
                      ${(p.last_sale_price / 1_000_000).toFixed(1)}M
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <CalendarClock className="size-4 text-muted-foreground" />
          Combined timeline
          <span className="text-xs font-normal text-muted-foreground">({data.timeline.length})</span>
        </h2>
        {data.timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-xl border bg-card px-4 py-8 text-center">
            No lease events or contact history yet — abstract leases and log outreach to build the picture.
          </p>
        ) : (
          <div className="rounded-xl border bg-card overflow-hidden">
            <ol className="divide-y">
              {data.timeline.map((event) => {
                const meta = TIMELINE_KIND_META[event.kind];
                const inner = (
                  <>
                    <div className="flex items-start gap-3">
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", meta.className)}>
                        {meta.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{event.title}</p>
                        {event.subtitle && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{event.subtitle}</p>
                        )}
                        {event.property_address && event.property_id && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <Building2 className="size-3" />
                            {event.property_address}
                          </p>
                        )}
                      </div>
                      <time className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {fmtDate(event.date)}
                      </time>
                    </div>
                  </>
                );

                return (
                  <li key={event.id} className="px-4 py-3">
                    {event.href ? (
                      <Link href={event.href} className="block hover:opacity-80 transition-opacity">
                        {inner}
                      </Link>
                    ) : inner}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </section>

      {primaryContact && (
        <div className="rounded-xl border bg-muted/20 px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-medium">Pitch the whole book</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.properties.length} properties · {data.totalSqft > 0 ? fmtPortfolioSqft(data.totalSqft) : "size unknown"}
            </p>
          </div>
          <Link
            href={`/outreach?contact=${primaryContact.id}`}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Mail className="size-3.5" />
            Start outreach
          </Link>
        </div>
      )}
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-xl border bg-card px-4 py-3",
      highlight && "border-amber-500/30 bg-amber-500/[0.03]",
    )}>
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}
