import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  Mail,
  MapPin,
  Phone,
  Building2,
  User,
  Tag,
  Clock,
  ArrowLeft,
  CalendarDays,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";
import { ContactActivitySection } from "./activity-section";
import { QuickActions } from "./quick-actions";
import { fetchActivitiesByContact, type Activity } from "@/app/activities/actions";
import { OwnerPortfolioLink } from "@/components/owner-portfolio-link";
import { RelationshipBriefingPanel } from "./relationship-briefing";

// ─── Types ────────────────────────────────────────────────────────────────────

type OutreachEntry = {
  sent_at: string;
  subject: string;
  body: string;
  method?: string;
};

type Contact = {
  id: string;
  name: string | null;
  company: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  mailing_address: string | null;
  contact_tier: number | null;
  client_status: string | null;
  contact_type: string | null;
  linked_properties: string[] | null;
  action_tags: string[] | null;
  size_category: string | null;
  geographic_category: string | null;
  ownership_type: string | null;
  last_contacted_at: string | null;
  next_action_due: string | null;
  outreach_history: OutreachEntry[] | null;
  custom_fields: Record<string, string | number | null> | null;
};

type LinkedProperty = {
  id: string;
  address: string | null;
  city: string | null;
  property_type: string | null;
  size_sqft: number | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

const CADENCE_DAYS: Record<number, number> = { 1: 14, 2: 30, 3: 90 };

function tierLabel(tier: number | null) {
  if (tier === 1) return "Tier 1";
  if (tier === 2) return "Tier 2";
  if (tier === 3) return "Tier 3";
  return null;
}

function tierCls(tier: number | null) {
  if (tier === 1) return "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400";
  if (tier === 2) return "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400";
  return "bg-muted text-muted-foreground";
}

function typeCls(t: string | null) {
  if (t === "owner")  return "bg-violet-100 text-violet-700";
  if (t === "tenant") return "bg-emerald-100 text-emerald-700";
  return "bg-muted text-muted-foreground";
}

function statusCls(status: string | null): "default" | "secondary" | "outline" {
  if (status === "active client") return "default";
  if (status === "past client") return "secondary";
  return "outline";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  if (error || !data) notFound();
  const c = data as Contact;

  const [{ data: fdData }, linkedPropsResult, activities, { data: contactFollowUps }] = await Promise.all([
    supabase
      .from("field_definitions")
      .select("*")
      .eq("entity_type", "contact")
      .order("created_at", { ascending: true }),
    c.linked_properties?.length
      ? supabase
          .from("properties")
          .select("id, address, city, property_type, size_sqft")
          .in("id", c.linked_properties)
      : Promise.resolve({ data: [] }),
    fetchActivitiesByContact(id),
    supabase
      .from("follow_ups")
      .select("id, description, due_date, done, property_id, properties(address)")
      .eq("contact_id", id)
      .eq("owner_id", user.id)
      .order("due_date", { ascending: true }),
  ]);

  const customDefs = (fdData ?? []) as FieldDefinition[];
  const customValues = c.custom_fields ?? {};
  const linkedProps = (linkedPropsResult.data ?? []) as LinkedProperty[];
  const outreachHistory = [...(c.outreach_history ?? [])].reverse();
  const actionTags = c.action_tags ?? [];

  const days = daysSince(c.last_contacted_at);
  const threshold = CADENCE_DAYS[c.contact_tier ?? 0] ?? null;
  const overdue = threshold !== null && (days === null || days > threshold);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      {/* Back link */}
      <Link
        href="/crm?tab=contacts"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        Contacts
      </Link>

      {/* Header */}
      <div className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {c.name ?? "Unknown contact"}
          </h1>
          {c.company && (
            <p className="mt-0.5 text-sm text-muted-foreground">{c.company}</p>
          )}
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-2 items-center">
          {c.contact_tier != null && (
            <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", tierCls(c.contact_tier))}>
              {tierLabel(c.contact_tier)}
            </span>
          )}
          {c.client_status && (
            <Badge variant={statusCls(c.client_status)} className="capitalize">
              {c.client_status}
            </Badge>
          )}
          {c.contact_type && (
            <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize", typeCls(c.contact_type))}>
              {c.contact_type}
            </span>
          )}
        </div>

        {/* Cadence status */}
        {c.contact_tier != null && (
          <div className="text-sm font-medium">
            {days === null ? (
              <span className="text-destructive">Never contacted</span>
            ) : days === 0 ? (
              <span className="text-green-700">Contacted today</span>
            ) : overdue ? (
              <span className="text-destructive">
                {days} {days === 1 ? "day" : "days"} since last contact — overdue
                {c.last_contacted_at && (
                  <span className="text-muted-foreground font-normal"> ({fmtDate(c.last_contacted_at)})</span>
                )}
              </span>
            ) : (
              <span className="text-foreground">
                {days} {days === 1 ? "day" : "days"} since last contact
                {c.last_contacted_at && (
                  <span className="text-muted-foreground font-normal"> ({fmtDate(c.last_contacted_at)})</span>
                )}
              </span>
            )}
          </div>
        )}

        {(c.linked_properties?.length ?? 0) > 0 && (
          <OwnerPortfolioLink contactId={id} className="text-sm" label="View owner portfolio →" />
        )}
      </div>

      {/* Next follow-up — prominent */}
      {c.next_action_due && (
        <NextFollowUpBanner date={c.next_action_due} />
      )}

      <RelationshipBriefingPanel contactId={id} />

      {/* Quick actions */}
      <QuickActions
        contactId={id}
        contactName={c.name}
        contactEmail={c.email}
        userEmail={user.email ?? null}
      />

      {/* Two-column: contact info + linked properties */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Contact info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <User className="size-4" />
              Contact info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {c.role && (
              <div className="text-sm">
                <span className="text-muted-foreground">Role: </span>
                <span className="font-medium">{c.role}</span>
              </div>
            )}
            {c.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="size-3.5 text-muted-foreground shrink-0" />
                <a href={`mailto:${c.email}`} className="font-medium hover:underline underline-offset-2 text-primary truncate">
                  {c.email}
                </a>
              </div>
            )}
            {c.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="size-3.5 text-muted-foreground shrink-0" />
                <a href={`tel:${c.phone}`} className="font-medium hover:underline underline-offset-2">
                  {c.phone}
                </a>
              </div>
            )}
            {c.mailing_address && (
              <div className="flex items-start gap-2 text-sm">
                <MapPin className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <span className="font-medium">{c.mailing_address}</span>
              </div>
            )}
            {!c.role && !c.email && !c.phone && !c.mailing_address && (
              <p className="text-sm text-muted-foreground">No contact info on file.</p>
            )}
          </CardContent>
        </Card>

        {/* Linked properties */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Building2 className="size-4" />
                Linked properties
              </span>
              <OwnerPortfolioLink contactId={id} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {linkedProps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No linked properties.</p>
            ) : (
              <div className="space-y-2">
                {linkedProps.map((p) => (
                  <Link
                    key={p.id}
                    href={`/properties/${p.id}`}
                    className="block rounded-lg border bg-muted/20 px-3 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <p className="font-medium text-sm truncate">{p.address ?? "Unknown address"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {[
                        p.city,
                        p.property_type,
                        p.size_sqft != null ? `${p.size_sqft.toLocaleString()} sf` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Broker notes + custom fields */}
      {(c.size_category || c.geographic_category || c.ownership_type || actionTags.length > 0 || customDefs.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Tag className="size-4" />
              Broker notes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(c.size_category || c.geographic_category || c.ownership_type) && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                {c.size_category && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Size category</dt>
                    <dd className="font-medium mt-0.5">{c.size_category}</dd>
                  </div>
                )}
                {c.geographic_category && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Geo category</dt>
                    <dd className="font-medium mt-0.5">{c.geographic_category}</dd>
                  </div>
                )}
                {c.ownership_type && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Ownership type</dt>
                    <dd className="font-medium mt-0.5">{c.ownership_type}</dd>
                  </div>
                )}
              </dl>
            )}
            {actionTags.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {actionTags.map((tag) => (
                    <span key={tag} className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {customDefs.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                {customDefs.map(f => {
                  const slug = fieldSlug(f.field_name);
                  const val  = customValues[slug];
                  return (
                    <div key={f.id} className="space-y-0.5">
                      <dt className="text-xs text-muted-foreground">{f.field_name}</dt>
                      <dd className="text-sm font-medium">{val != null ? String(val) : "—"}</dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </CardContent>
        </Card>
      )}

      {/* Follow-ups */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="size-4" />
            Follow-ups
            {contactFollowUps && contactFollowUps.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({contactFollowUps.length})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!contactFollowUps || contactFollowUps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No follow-ups.{" "}
              <Link href="/follow-ups" className="underline underline-offset-2 hover:text-foreground">
                Manage follow-ups →
              </Link>
            </p>
          ) : (
            <div className="space-y-2">
              {contactFollowUps.map((fu) => {
                const due = new Date(fu.due_date);
                const overdue = !fu.done && due < new Date();
                const propAddress = (fu.properties as { address: string | null }[] | null)?.[0]?.address ?? (fu.properties as unknown as { address: string | null } | null)?.address;
                return (
                  <div key={fu.id} className="flex items-start gap-3 rounded-lg border px-3 py-2">
                    <span className={`shrink-0 mt-0.5 size-3.5 rounded-sm border flex items-center justify-center ${fu.done ? "bg-primary border-primary" : "border-border"}`}>
                      {fu.done && <span className="text-primary-foreground text-[8px] font-bold">✓</span>}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm ${fu.done ? "line-through text-muted-foreground" : ""}`}>{fu.description}</span>
                      {propAddress && fu.property_id && (
                        <Link
                          href={`/properties/${fu.property_id}`}
                          className="block text-xs text-muted-foreground hover:text-foreground truncate mt-0.5"
                        >
                          @ {propAddress}
                        </Link>
                      )}
                    </div>
                    <span className={`shrink-0 text-xs whitespace-nowrap rounded-full px-2 py-0.5 ${overdue ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
                      {due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activity timeline */}
      <ContactActivitySection contactId={id} contactTier={c.contact_tier} initialActivities={activities as Activity[]} />

      {/* Outreach history */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="size-4" />
            Outreach history
            {outreachHistory.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({outreachHistory.length})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {outreachHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No outreach logged yet.</p>
          ) : (
            <ol className="space-y-4">
              {outreachHistory.map((entry, i) => (
                <OutreachEntryItem key={i} entry={entry} />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NextFollowUpBanner({ date }: { date: string }) {
  const d = new Date(date);
  const isOverdue = d < new Date();
  const label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div
      className={
        isOverdue
          ? "flex items-center gap-2.5 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3"
          : "flex items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
      }
    >
      <CalendarDays className={isOverdue ? "size-4 text-destructive shrink-0" : "size-4 text-primary shrink-0"} />
      <div className="flex-1 min-w-0">
        <p className={isOverdue ? "text-sm font-semibold text-destructive" : "text-sm font-semibold text-primary"}>
          {isOverdue ? "Follow-up overdue" : "Next follow-up"}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function OutreachEntryItem({ entry }: { entry: OutreachEntry }) {
  return (
    <li className="border-l-2 border-border pl-4 space-y-1">
      <p className="text-xs text-muted-foreground">
        {new Date(entry.sent_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        {entry.method && <span className="ml-1.5 capitalize">· {entry.method}</span>}
      </p>
      <p className="text-sm font-semibold">{entry.subject}</p>
      <p className="text-sm text-muted-foreground line-clamp-3">{entry.body}</p>
    </li>
  );
}
