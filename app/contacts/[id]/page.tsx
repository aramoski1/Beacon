import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  Mail,
  Phone,
  Building2,
  User,
  Tag,
  Clock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";

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
  contact_tier: number | null;
  client_status: string | null;
  linked_properties: string[] | null;
  action_tags: string[] | null;
  size_category: string | null;
  geographic_category: string | null;
  ownership_type: string | null;
  last_contacted_at: string | null;
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
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateLong(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function tierLabel(tier: number | null) {
  if (tier === 1) return "Tier 1";
  if (tier === 2) return "Tier 2";
  if (tier === 3) return "Tier 3";
  return null;
}

function tierCls(tier: number | null) {
  if (tier === 1) return "bg-orange-100 text-orange-700";
  if (tier === 2) return "bg-blue-100 text-blue-700";
  if (tier === 3) return "bg-muted text-muted-foreground";
  return "bg-muted text-muted-foreground";
}

function statusCls(status: string | null) {
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) notFound();
  const c = data as Contact;

  // Fetch custom field definitions
  const { data: fdData } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("entity_type", "contact")
    .order("created_at", { ascending: true });
  const customDefs = (fdData ?? []) as FieldDefinition[];
  const customValues = c.custom_fields ?? {};

  // Fetch linked properties
  const linkedIds = c.linked_properties ?? [];
  let linkedProps: LinkedProperty[] = [];
  if (linkedIds.length > 0) {
    const { data: propsData } = await supabase
      .from("properties")
      .select("id, address, city, property_type, size_sqft")
      .in("id", linkedIds);
    linkedProps = (propsData ?? []) as LinkedProperty[];
  }

  const days = daysSince(c.last_contacted_at);
  const outreachHistory = [...(c.outreach_history ?? [])].reverse();
  const actionTags = c.action_tags ?? [];

  return (
    <main className="max-w-2xl mx-auto px-6 py-10 space-y-8">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {c.name ?? "Unknown contact"}
            </h1>
            {c.company && (
              <p className="mt-1 text-sm text-muted-foreground">{c.company}</p>
            )}
          </div>
          <Link
            href={`/outreach?contact=${c.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Start outreach →
          </Link>
        </div>

        {/* Badges row */}
        <div className="flex flex-wrap gap-2 items-center">
          {c.contact_tier != null && (
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                tierCls(c.contact_tier)
              )}
            >
              {tierLabel(c.contact_tier)}
            </span>
          )}
          {c.client_status && (
            <Badge variant={statusCls(c.client_status)} className="capitalize">
              {c.client_status}
            </Badge>
          )}
        </div>

        {/* Days since last contact */}
        <div className="text-sm font-medium">
          {days === null ? (
            <span className="text-muted-foreground">Never contacted</span>
          ) : days === 0 ? (
            <span className="text-green-700">Contacted today</span>
          ) : (
            <span className={cn(days > 30 ? "text-destructive" : "text-foreground")}>
              {days} {days === 1 ? "day" : "days"} since last contact
              {c.last_contacted_at && (
                <span className="text-muted-foreground font-normal">
                  {" "}({fmtDate(c.last_contacted_at)})
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Contact info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="size-4" />
            Contact info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {c.role && (
            <div className="text-sm">
              <span className="text-muted-foreground">Role: </span>
              <span className="font-medium">{c.role}</span>
            </div>
          )}
          {c.email && (
            <div className="flex items-center gap-2 text-sm">
              <Mail className="size-4 text-muted-foreground shrink-0" />
              <a
                href={`mailto:${c.email}`}
                className="font-medium hover:underline underline-offset-2 text-primary"
              >
                {c.email}
              </a>
            </div>
          )}
          {c.phone && (
            <div className="flex items-center gap-2 text-sm">
              <Phone className="size-4 text-muted-foreground shrink-0" />
              <a
                href={`tel:${c.phone}`}
                className="font-medium hover:underline underline-offset-2"
              >
                {c.phone}
              </a>
            </div>
          )}
          {!c.role && !c.email && !c.phone && (
            <p className="text-sm text-muted-foreground">No contact info on file.</p>
          )}
        </CardContent>
      </Card>

      {/* Broker notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="size-4" />
            Broker notes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
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
          </div>
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
          {!c.size_category && !c.geographic_category && !c.ownership_type && actionTags.length === 0 && (
            <p className="text-sm text-muted-foreground">No broker notes yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Custom fields */}
      {customDefs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Custom fields</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}

      {/* Linked properties */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="size-4" />
            Linked properties
          </CardTitle>
        </CardHeader>
        <CardContent>
          {linkedProps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No linked properties yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {linkedProps.map((p) => (
                <Link
                  key={p.id}
                  href={`/properties/${p.id}`}
                  className="rounded-lg border bg-muted/20 px-4 py-3 hover:bg-muted/50 transition-colors block"
                >
                  <p className="font-medium text-sm truncate">
                    {p.address ?? "Unknown address"}
                  </p>
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

      {/* Outreach history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="size-4" />
            Outreach history
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

function OutreachEntryItem({ entry }: { entry: OutreachEntry }) {
  return (
    <li className="border-l-2 border-border pl-4 space-y-1">
      <p className="text-xs text-muted-foreground">
        {new Date(entry.sent_at).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
        {entry.method && (
          <span className="ml-1.5 capitalize">· {entry.method}</span>
        )}
      </p>
      <p className="text-sm font-semibold">{entry.subject}</p>
      <p className="text-sm text-muted-foreground line-clamp-3">{entry.body}</p>
    </li>
  );
}
