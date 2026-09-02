import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Briefcase, Building2, CalendarDays, DollarSign, FileText, User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { isSoloFirmForUser } from "@/lib/firms";
import { ShareWithFirmToggle } from "@/components/share-with-firm-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  STAGE_LABELS, STAGE_COLORS, DEAL_TYPE_LABELS,
  isDealStale, daysInStage, fmtCommission,
  type Deal, type DealStage,
} from "@/lib/deals";
import { type FieldDefinition } from "@/lib/custom-fields";
import { fetchActivitiesByDeal, type Activity } from "@/app/activities/actions";
import { listDocuments } from "@/lib/documents";
import { DocumentsSection } from "@/components/documents-section";
import { DealActions } from "./deal-actions";
import { DealActivitySection, type DealFollowUpInput } from "./deal-activity-section";
import { DealCustomFields } from "./deal-custom-fields";

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function DealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const user = await requireUser(supabase);

  // No .eq("owner_id", user.id) on the deal itself — RLS alone governs
  // visibility so a teammate can open a firm-shared deal (Beacon_Team_
  // Multitenancy_Plan.md §7). field_definitions is intentionally
  // unfiltered by owner too: it's firm-wide by default (resolved decision
  // #5), so a teammate should see the whole firm's custom-field schema,
  // not just fields they personally authored.
  const { data, error } = await supabase
    .from("deals")
    .select("*, contacts(id, name, company, email, phone), properties(id, address, city)")
    .eq("id", id)
    .single();

  if (error || !data) notFound();
  const deal = data as Deal & {
    contacts: { id: string; name: string | null; company: string | null; email: string | null; phone: string | null } | null;
    properties: { id: string; address: string | null; city: string | null } | null;
  };

  const [{ data: fdData }, activities, { data: followUps }, dealDocuments, isSoloFirm] = await Promise.all([
    supabase
      .from("field_definitions")
      .select("*")
      .eq("entity_type", "deal")
      .order("created_at", { ascending: true }),
    fetchActivitiesByDeal(id),
    supabase
      .from("follow_ups")
      .select("id, description, due_date, done")
      .eq("deal_id", id)
      .order("due_date", { ascending: true }),
    listDocuments(supabase, user.id, "deal", id),
    isSoloFirmForUser(supabase, user.id),
  ]);

  const customDefs = (fdData ?? []) as FieldDefinition[];
  const stale = isDealStale(deal);
  const days = daysInStage(deal);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      <Link
        href="/deals"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        Deals
      </Link>

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{deal.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{DEAL_TYPE_LABELS[deal.deal_type]}</p>
          </div>
          <DealActions deal={deal} />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <span
            className={cn(
              "text-[10px] font-semibold uppercase tracking-wide border rounded-full px-2 py-0.5",
              STAGE_COLORS[deal.stage as DealStage],
            )}
          >
            {STAGE_LABELS[deal.stage as DealStage]}
          </span>
          <ShareWithFirmToggle
            table="deals"
            id={deal.id}
            ownerId={deal.owner_id}
            currentUserId={user.id}
            initialVisibility={deal.visibility}
            isSoloFirm={isSoloFirm}
          />
          {stale && (
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400">
              Stale — {days}d in stage
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Briefcase className="size-4" />
              Deal info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <div className="flex items-center gap-2 text-sm">
              <DollarSign className="size-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium">
                {deal.estimated_commission != null ? fmtCommission(deal.estimated_commission) : "No commission set"}
              </span>
            </div>
            {deal.expected_close_date && (
              <div className="flex items-center gap-2 text-sm">
                <CalendarDays className="size-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium">Expected close: {fmtDate(deal.expected_close_date)}</span>
              </div>
            )}
            {deal.next_action && (
              <div className="text-sm">
                <span className="text-muted-foreground">Next action: </span>
                <span className="font-medium">{deal.next_action}</span>
                {deal.next_action_due && (
                  <span className="text-muted-foreground"> ({fmtDate(deal.next_action_due)})</span>
                )}
              </div>
            )}
            {deal.notes && (
              <div className="flex items-start gap-2 text-sm pt-1">
                <FileText className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <span className="whitespace-pre-wrap">{deal.notes}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <User className="size-4" />
              Linked to
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {deal.contacts && (
              <Link
                href={`/contacts/${deal.contacts.id}`}
                className="flex items-center gap-2 text-sm hover:underline underline-offset-2"
              >
                <User className="size-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium">{deal.contacts.name}</span>
                {deal.contacts.company && (
                  <span className="text-muted-foreground">· {deal.contacts.company}</span>
                )}
              </Link>
            )}
            {deal.properties && (
              <Link
                href={`/properties/${deal.properties.id}`}
                className="flex items-center gap-2 text-sm hover:underline underline-offset-2"
              >
                <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium">
                  {deal.properties.address}
                  {deal.properties.city && `, ${deal.properties.city}`}
                </span>
              </Link>
            )}
            {!deal.contacts && !deal.properties && (
              <p className="text-sm text-muted-foreground">No contact or property linked.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <DealCustomFields dealId={id} fieldDefs={customDefs} initialValues={deal.custom_fields} />

      <DocumentsSection entityType="deal" entityId={id} initialDocuments={dealDocuments} />

      <DealActivitySection
        dealId={id}
        contactId={deal.contact_id}
        propertyId={deal.property_id}
        initialActivities={activities as Activity[]}
        initialFollowUps={(followUps ?? []) as DealFollowUpInput[]}
      />
    </main>
  );
}
