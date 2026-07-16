import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  Mail,
  MapPin,
  Phone,
  Building2,
  User,
  Tag,
  ArrowLeft,
  CalendarDays,
  Briefcase,
  FileText,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";
import { ContactActivitySection, type FollowUpInput, type OutreachEntry } from "./activity-section";
import { QuickActions } from "./quick-actions";
import { fetchActivitiesByContact, type Activity } from "@/app/activities/actions";
import { OwnerPortfolioLink } from "@/components/owner-portfolio-link";
import { RelationshipBriefingPanel } from "./relationship-briefing";

// ─── Types ────────────────────────────────────────────────────────────────────

type Contact = {
  id: string;
  name: string | null;
  company: string | null;
  // Identity
  role: string | null;           // legacy
  title_role: string | null;     // new
  email: string | null;
  phone: string | null;          // legacy
  phone_mobile: string | null;   // new
  phone_office: string | null;
  mailing_address: string | null;
  // Ownership
  ownership_role: string | null;
  asset_focus: string[] | null;
  submarket: string | null;
  portfolio_size: string | null;
  // Legacy broker notes
  size_category: string | null;
  geographic_category: string | null;
  ownership_type: string | null;
  // Relationship
  contact_tier: number | null;
  relationship_stage: string | null; // new
  client_status: string | null;      // legacy (kept for CRM view compat)
  lead_source: string | null;
  contact_type: string | null;
  // Activity
  last_contacted_at: string | null;
  next_action_due: string | null;
  outreach_history: OutreachEntry[] | null;
  // Notes & tags
  notes: string | null;
  action_tags: string[] | null;
  linked_properties: string[] | null;
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

function stageBadgeVariant(s: string | null): "default" | "secondary" | "outline" {
  if (s === "active" || s === "client") return "default";
  if (s === "past_client" || s === "dormant") return "secondary";
  return "outline";
}

// Effective stage: prefer new column, fall back to legacy client_status
function effectiveStage(c: Contact): string | null {
  return c.relationship_stage || c.client_status || null;
}

const OWNERSHIP_ROLE_LABELS: Record<string, string> = {
  managing_member:   "Managing Member",
  authorized_signer: "Authorized Signer",
  registered_agent:  "Registered Agent",
  principal:         "Principal",
  other:             "Other",
};

const LEAD_SOURCE_LABELS: Record<string, string> = {
  sunbiz:                "Sunbiz",
  referral:              "Referral",
  cold:                  "Cold",
  costar:                "CoStar",
  existing_relationship: "Existing relationship",
  other:                 "Other",
};

const ASSET_LABELS: Record<string, string> = {
  industrial:  "Industrial",
  office:      "Office",
  retail:      "Retail",
  multifamily: "Multifamily",
  land:        "Land",
  mixed_use:   "Mixed Use",
  other:       "Other",
};

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
  const actionTags = c.action_tags ?? [];
  const assetFocus = c.asset_focus ?? [];

  const days = daysSince(c.last_contacted_at);
  const threshold = CADENCE_DAYS[c.contact_tier ?? 0] ?? null;
  const overdue = threshold !== null && (days === null || days > threshold);

  const es = effectiveStage(c);
  const displayRole = c.title_role || c.role;
  const displayPhone = c.phone_mobile || c.phone;

  // Show CRE profile card if any field is populated
  const hasCreProfile =
    !!c.ownership_role ||
    assetFocus.length > 0 ||
    !!c.submarket ||
    !!c.geographic_category ||
    !!c.portfolio_size ||
    !!c.size_category ||
    !!c.ownership_type ||
    !!c.lead_source;

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
          {es && (
            <Badge variant={stageBadgeVariant(es)}>
              {stageLabel(es) ?? es}
            </Badge>
          )}
          {c.ownership_role && (
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-400">
              {OWNERSHIP_ROLE_LABELS[c.ownership_role] ?? c.ownership_role}
            </span>
          )}
          {c.contact_type && !c.ownership_role && (
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground capitalize">
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
          <OwnerPortfolioLink contactId={id} variant="button" label="Ownership portfolio" />
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
            {displayRole && (
              <div className="text-sm">
                <span className="text-muted-foreground">Title: </span>
                <span className="font-medium">{displayRole}</span>
              </div>
            )}
            {c.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="size-3.5 text-muted-foreground shrink-0" />
                <a
                  href={`mailto:${c.email}`}
                  className="font-medium hover:underline underline-offset-2 text-primary truncate"
                >
                  {c.email}
                </a>
              </div>
            )}
            {displayPhone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="size-3.5 text-muted-foreground shrink-0" />
                <a href={`tel:${displayPhone}`} className="font-medium hover:underline underline-offset-2">
                  {displayPhone}
                </a>
                <span className="text-xs text-muted-foreground">mobile</span>
              </div>
            )}
            {c.phone_office && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="size-3.5 text-muted-foreground shrink-0" />
                <a href={`tel:${c.phone_office}`} className="font-medium hover:underline underline-offset-2">
                  {c.phone_office}
                </a>
                <span className="text-xs text-muted-foreground">office</span>
              </div>
            )}
            {c.mailing_address && (
              <div className="flex items-start gap-2 text-sm">
                <MapPin className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <span className="font-medium">{c.mailing_address}</span>
              </div>
            )}
            {!displayRole && !c.email && !displayPhone && !c.phone_office && !c.mailing_address && (
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

      {/* CRE Profile */}
      {hasCreProfile && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Briefcase className="size-4" />
              CRE profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              {c.ownership_role && (
                <div>
                  <dt className="text-xs text-muted-foreground">Ownership role</dt>
                  <dd className="font-medium mt-0.5">
                    {OWNERSHIP_ROLE_LABELS[c.ownership_role] ?? c.ownership_role}
                  </dd>
                </div>
              )}
              {(c.submarket || c.geographic_category) && (
                <div>
                  <dt className="text-xs text-muted-foreground">Submarket</dt>
                  <dd className="font-medium mt-0.5">{c.submarket || c.geographic_category}</dd>
                </div>
              )}
              {c.portfolio_size && (
                <div>
                  <dt className="text-xs text-muted-foreground">Portfolio size</dt>
                  <dd className="font-medium mt-0.5">{c.portfolio_size}</dd>
                </div>
              )}
              {c.lead_source && (
                <div>
                  <dt className="text-xs text-muted-foreground">Lead source</dt>
                  <dd className="font-medium mt-0.5">
                    {LEAD_SOURCE_LABELS[c.lead_source] ?? c.lead_source}
                  </dd>
                </div>
              )}
              {c.size_category && (
                <div>
                  <dt className="text-xs text-muted-foreground">Size category</dt>
                  <dd className="font-medium mt-0.5">{c.size_category}</dd>
                </div>
              )}
              {c.ownership_type && (
                <div>
                  <dt className="text-xs text-muted-foreground">Ownership type</dt>
                  <dd className="font-medium mt-0.5">{c.ownership_type}</dd>
                </div>
              )}
            </dl>

            {assetFocus.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Asset focus</p>
                <div className="flex flex-wrap gap-1.5">
                  {assetFocus.map((a) => (
                    <span
                      key={a}
                      className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                    >
                      {ASSET_LABELS[a] ?? a}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      {c.notes && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="size-4" />
              Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{c.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Tags + custom fields */}
      {(actionTags.length > 0 || customDefs.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Tag className="size-4" />
              Tags &amp; custom fields
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {actionTags.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {actionTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {customDefs.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                {customDefs.map((f) => {
                  const slug = fieldSlug(f.field_name);
                  const val = customValues[slug];
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

      {/* Unified timeline: activities + follow-ups + outreach */}
      <ContactActivitySection
        contactId={id}
        contactTier={c.contact_tier}
        initialActivities={activities as Activity[]}
        initialFollowUps={(contactFollowUps ?? []).map((fu): FollowUpInput => ({
          id: fu.id,
          description: fu.description,
          due_date: fu.due_date,
          done: fu.done,
          property_id: fu.property_id ?? null,
          property_address:
            (fu.properties as { address: string | null }[] | null)?.[0]?.address ??
            (fu.properties as unknown as { address: string | null } | null)?.address ??
            null,
        }))}
        initialOutreach={(c.outreach_history ?? []) as OutreachEntry[]}
      />
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
