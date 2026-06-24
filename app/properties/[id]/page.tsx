import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  User,
  Ruler,
  Calendar,
  DollarSign,
  MapPin,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Info,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";
import { PropertyContactsSection, type LinkedContact } from "./contacts-section";
import { PropertyActivitySection, type ActivityContact } from "./activity-section";
import { fetchActivitiesByProperty, type Activity } from "@/app/activities/actions";
import { SunbizSection } from "./sunbiz-section";
import { CoStarSection } from "./costar-section";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConfidenceFlag = { field: string; reason: string };
type BuildingComposition = {
  year_built: number | null;
  lot_size_sqft: number | null;
  stories: number | null;
  units: number | null;
  dor_code: string | null;
  dor_description: string | null;
  legal_description: string | null;
  assessed_value: number | null;
};
type Property = {
  id: string;
  address: string | null;
  city: string | null;
  submarket: string | null;
  owner_name: string | null;
  ownership_type: string | null;
  size_sqft: number | null;
  land_sqft: number | null;
  asset_description: string | null;
  prospect_number: number | null;
  owner_mailing_address: string | null;
  property_type: string | null;
  last_sale_date: string | null;
  last_sale_price: number | null;
  building_composition: BuildingComposition | null;
  source: string | null;
  source_url: string | null;
  ingested_at: string | null;
  confidence_flags: ConfidenceFlag[];
  custom_fields: Record<string, string | number | null> | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null, opts?: Intl.NumberFormatOptions) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", opts);
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
// Returns true when an owner name looks like a Florida-registered corporate entity
function isEntityName(name: string | null): boolean {
  if (!name) return false;
  return /\b(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\b/i.test(name);
}

function folio(sourceUrl: string | null) {
  if (!sourceUrl?.startsWith("mdpa:")) return null;
  return sourceUrl.replace("mdpa:", "");
}
function sourceLabel(source: string | null) {
  if (source === "tax_roll") return "Tax roll · MDPA";
  if (source === "url") return "Listing URL";
  if (source === "upload") return "Uploaded file";
  if (source === "forward") return "Email forward";
  return source ?? "Unknown";
}
function listingUrl(source: string | null, sUrl: string | null) {
  if (source === "url" && sUrl && !sUrl.startsWith("mdpa:")) return sUrl;
  return null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function PropertyPage({
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
    .from("properties")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) notFound();
  const p = data as Property;

  const [{ data: fdData }, { data: linkedContactsData }, propertyActivities] = await Promise.all([
    supabase
      .from("field_definitions")
      .select("*")
      .eq("entity_type", "property")
      .order("created_at", { ascending: true }),
    supabase
      .from("contacts")
      .select("id, name, email, phone, mailing_address, company, role, contact_tier")
      .contains("linked_properties", [id])
      .order("created_at", { ascending: true }),
    fetchActivitiesByProperty(id),
  ]);
  const customDefs = (fdData ?? []) as FieldDefinition[];
  const customValues = p.custom_fields ?? {};
  const linkedContacts = (linkedContactsData ?? []) as LinkedContact[];
  const activityContacts: ActivityContact[] = linkedContacts.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const folioNumber = folio(p.source_url);

  // flagMap: field name → reason string (covers both uncertain and not-found)
  const flagMap = new Map((p.confidence_flags ?? []).map((f) => [f.field, f.reason]));

  const notFoundFlags = (p.confidence_flags ?? []).filter(
    (f) => f.reason === "not found in source record"
  );
  const uncertainFlags = (p.confidence_flags ?? []).filter(
    (f) => f.reason !== "not found in source record"
  );
  const bc = p.building_composition;

  // Helper: look up flag reason for a building_composition sub-field,
  // trying both "building_composition.key" and bare "key".
  function bcFlagReason(key: string): string | undefined {
    return flagMap.get(`building_composition.${key}`) ?? flagMap.get(key);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {p.address ?? "Unknown address"}
          </h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1 flex-wrap">
            <MapPin className="size-3.5 shrink-0" />
            {[p.city, p.submarket].filter(Boolean).join(" · ") || "Unknown location"}
            {p.prospect_number != null && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="font-mono text-xs">#{p.prospect_number}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {p.property_type && (
            <Badge variant="secondary" className="capitalize">
              {p.property_type}
            </Badge>
          )}
          {listingUrl(p.source, p.source_url) ? (
            <a
              href={listingUrl(p.source, p.source_url)!}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Badge variant="outline" className="hover:bg-muted transition-colors cursor-pointer">
                {sourceLabel(p.source)} ↗
              </Badge>
            </a>
          ) : (
            <Badge variant="outline">{sourceLabel(p.source)}</Badge>
          )}
          <Link
            href="/properties/new"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="size-3" />
            Re-ingest
          </Link>
        </div>
      </div>

      {/* Source + folio verification strip */}
      {folioNumber ? (
        <div className="rounded-lg border bg-muted/30 px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
          <span className="text-muted-foreground text-xs uppercase tracking-wide font-medium">Source</span>
          <span className="font-medium">Miami-Dade Property Appraiser</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Folio</span>
          <span className="font-mono text-foreground font-semibold">{folioNumber}</span>
          <a
            href={`https://www.miamidade.gov/Apps/PA/propertysearch/#/?strap=${folioNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2 hover:opacity-80 transition-opacity ml-auto"
          >
            Verify on MDPA ↗
            <ExternalLink className="size-3" />
          </a>
        </div>
      ) : listingUrl(p.source, p.source_url) ? (
        <div className="rounded-lg border bg-muted/30 px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
          <span className="text-muted-foreground text-xs uppercase tracking-wide font-medium">Source</span>
          <span className="font-medium">{sourceLabel(p.source)}</span>
          <a
            href={listingUrl(p.source, p.source_url)!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2 hover:opacity-80 transition-opacity ml-auto font-mono break-all"
          >
            {listingUrl(p.source, p.source_url)}
            <ExternalLink className="size-3 shrink-0" />
          </a>
        </div>
      ) : null}

      {/* Uncertain / ambiguous fields — yellow */}
      {uncertainFlags.length > 0 && (
        <Alert variant="default" className="border-yellow-500/40 bg-yellow-500/5">
          <AlertTriangle className="size-4 text-yellow-600" />
          <AlertTitle className="text-yellow-700 dark:text-yellow-400">
            {uncertainFlags.length} field
            {uncertainFlags.length > 1 ? "s" : ""} flagged uncertain — verify before use
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-1.5 space-y-1">
              {uncertainFlags.map((f, i) => (
                <li key={i} className="text-sm">
                  <span className="font-mono font-medium">{f.field}</span>
                  <span className="text-muted-foreground"> — {f.reason}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Not-found fields — neutral info */}
      {notFoundFlags.length > 0 && (
        <Alert variant="default" className="border-border bg-muted/20">
          <Info className="size-4 text-muted-foreground" />
          <AlertTitle className="text-muted-foreground">
            {notFoundFlags.length} field
            {notFoundFlags.length > 1 ? "s" : ""} not present in the source record
          </AlertTitle>
          <AlertDescription className="text-muted-foreground">
            {notFoundFlags.map((f) => (
              <span key={f.field} className="font-mono">{f.field}</span>
            )).reduce<React.ReactNode[]>((acc, el, i) => i === 0 ? [el] : [...acc, ", ", el], [])}
            {" "}— shown as <span className="italic">not in source</span> below.
          </AlertDescription>
        </Alert>
      )}

      {/* Core fields */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Property details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3">
            <Field
              icon={<User className="size-4" />}
              label="Owner"
              value={p.owner_name ?? "—"}
              flagReason={flagMap.get("owner_name")}
            />
            <Field
              icon={<Building2 className="size-4" />}
              label="Ownership type"
              value={p.ownership_type ?? "—"}
              flagReason={flagMap.get("ownership_type")}
            />
            <Field
              icon={<Building2 className="size-4" />}
              label="Property type"
              value={p.property_type ?? "—"}
              flagReason={flagMap.get("property_type")}
            />
            <Field
              icon={<Ruler className="size-4" />}
              label="Building SF"
              value={p.size_sqft != null ? `${fmt(p.size_sqft)} sqft` : "—"}
              flagReason={flagMap.get("size_sqft")}
            />
            <Field
              icon={<Ruler className="size-4" />}
              label="Land SF"
              value={p.land_sqft != null ? `${fmt(p.land_sqft)} sqft` : "—"}
            />
            {p.asset_description && (
              <Field
                icon={<Building2 className="size-4" />}
                label="Asset description"
                value={p.asset_description}
              />
            )}
            <Field
              icon={<Calendar className="size-4" />}
              label="Last sale date"
              value={fmtDate(p.last_sale_date)}
              flagReason={flagMap.get("last_sale_date")}
            />
            <Field
              icon={<DollarSign className="size-4" />}
              label="Last sale price"
              value={
                p.last_sale_price != null
                  ? fmt(p.last_sale_price, {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    })
                  : "—"
              }
              flagReason={flagMap.get("last_sale_price")}
            />
          </dl>
        </CardContent>
      </Card>

      {/* Custom fields */}
      {customDefs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Custom fields</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
              {customDefs.map(f => {
                const slug = fieldSlug(f.field_name);
                const val  = customValues[slug];
                return (
                  <div key={f.id} className="space-y-0.5">
                    <dt className="text-xs text-muted-foreground">{f.field_name}</dt>
                    <dd className="text-sm font-medium">
                      {val != null ? String(val) : <span className="text-xs italic text-muted-foreground/40 font-normal">not in source</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Contacts */}
      <PropertyContactsSection
        propertyId={id}
        initialContacts={linkedContacts}
        ownerName={p.owner_name}
        ownerMailingAddress={p.owner_mailing_address}
        isMdpa={!!folioNumber}
      />

      {/* Sunbiz public records lookup — shown only for entity-named owners */}
      {isEntityName(p.owner_name) && p.owner_name && (
        <SunbizSection propertyId={id} ownerName={p.owner_name} />
      )}

      {/* CoStar owner enrichment via file upload */}
      <CoStarSection propertyId={id} />

      {/* Activity timeline */}
      <PropertyActivitySection
        propertyId={id}
        linkedContacts={activityContacts}
        initialActivities={propertyActivities as Activity[]}
      />

      {/* Building composition */}
      {bc && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Building composition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
              <SmallField
                label="Year built"
                value={bc.year_built ? String(bc.year_built) : "—"}
                flagReason={bcFlagReason("year_built")}
              />
              <SmallField
                label="Lot size"
                value={bc.lot_size_sqft != null ? `${fmt(bc.lot_size_sqft)} sqft` : "—"}
                flagReason={bcFlagReason("lot_size_sqft")}
              />
              <SmallField
                label="Stories"
                value={bc.stories != null ? String(bc.stories) : "—"}
                flagReason={bcFlagReason("stories")}
              />
              <SmallField
                label="Units"
                value={bc.units != null ? String(bc.units) : "—"}
                flagReason={bcFlagReason("units")}
              />
              {bc.assessed_value != null && (
                <SmallField
                  label="Assessed value"
                  value={fmt(bc.assessed_value, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                  flagReason={bcFlagReason("assessed_value")}
                />
              )}
            </dl>

            {(bc.dor_code || bc.dor_description) && (
              <>
                <Separator />
                <div className="text-sm">
                  <span className="text-muted-foreground">DOR code: </span>
                  <span className="font-mono">{bc.dor_code}</span>
                  {bc.dor_description && (
                    <span className="text-muted-foreground"> — {bc.dor_description}</span>
                  )}
                </div>
              </>
            )}

            {bc.legal_description && (
              <>
                <Separator />
                <div className="text-xs text-muted-foreground font-mono leading-relaxed">
                  {bc.legal_description}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({
  icon,
  label,
  value,
  flagReason,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  flagReason?: string;
}) {
  const isNotFound = flagReason === "not found in source record";
  const isUncertain = !!flagReason && !isNotFound;

  return (
    <div className="space-y-1">
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className={cn("text-sm font-medium flex items-center gap-1.5", isUncertain && "text-yellow-700 dark:text-yellow-300")}>
        {isNotFound && value === "—" ? (
          <span className="text-xs italic text-muted-foreground/40 font-normal">not in source</span>
        ) : (
          value
        )}
        {isUncertain && (
          <AlertTriangle className="size-3.5 text-yellow-500 shrink-0" />
        )}
      </dd>
      {isUncertain && (
        <p className="text-xs text-yellow-600 dark:text-yellow-500 leading-snug">
          {flagReason}
        </p>
      )}
    </div>
  );
}

function SmallField({
  label,
  value,
  flagReason,
}: {
  label: string;
  value: string;
  flagReason?: string;
}) {
  const isNotFound = flagReason === "not found in source record";
  const isUncertain = !!flagReason && !isNotFound;

  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium flex items-center gap-1">
        {isNotFound && value === "—" ? (
          <span className="text-xs italic text-muted-foreground/40 font-normal">not in source</span>
        ) : (
          value
        )}
        {isUncertain && (
          <span title={flagReason}>
            <AlertTriangle className="size-3 text-yellow-500 shrink-0" />
          </span>
        )}
      </dd>
    </div>
  );
}
