import { notFound } from "next/navigation";
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
import { requireUser } from "@/lib/auth-require-user";
import { isSoloFirmForUser } from "@/lib/firms";
import { ShareWithFirmToggle } from "@/components/share-with-firm-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";
import { PropertyContactsSection, type LinkedContact } from "./contacts-section";
import { PropertyActivitySection, type ActivityContact, type PropertyFollowUpInput } from "./activity-section";
import { fetchActivitiesByProperty, type Activity } from "@/app/activities/actions";
import { EnrichPanel } from "./enrich-panel";
import { ZoningSection } from "./zoning-section";
import { IndustrialSection } from "./industrial-section";
import { industrialSpecValue } from "@/lib/industrial-extract";
import { ensureIndustrialFieldDefs, isCustomGroup } from "@/lib/industrial-fields";
import { RentNotebook } from "./rent-notebook";
import { listRentComps } from "./rent-notebook-actions";
import { lookupRentBand } from "@/lib/submarket-rent-bands";
import { OwnershipCheckPanel } from "./ownership-check-panel";
import { parseStoredOwnerContacts, resolvePropertyOwnerContacts, isEntityOwnerName, normalizeOwnerName, type StoredOwnerContact } from "@/lib/owner-contacts";
import { OwnerPortfolioLink } from "@/components/owner-portfolio-link";
import { OwnerContactCreateButton } from "./owner-contact-actions";
import { CreateDealDialog } from "@/app/deals/create-deal-dialog";
import { getUserSettings } from "@/app/settings/actions";
import { Suspense } from "react";
import { TaxRollCompsSection } from "./tax-roll-comps";
import { LeaseCompsSection } from "./lease-comps";
import { loadContactIdsForProperty } from "@/lib/contact-properties";
import { listDocuments } from "@/lib/documents";
import { DocumentsSection } from "@/components/documents-section";
import type { ZoningInfo } from "@/lib/zoning";

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
  owner_id: string;
  visibility: "private" | "team";
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
  owner_contact_name: string | null;
  owner_contact_address: string | null;
  owner_contacts: StoredOwnerContact[] | null;
  property_type: string | null;
  last_sale_date: string | null;
  last_sale_price: number | null;
  building_composition: BuildingComposition | null;
  source: string | null;
  source_url: string | null;
  ingested_at: string | null;
  created_at: string | null;
  confidence_flags: ConfidenceFlag[];
  custom_fields: Record<string, string | number | null> | null;
  field_sources: Record<string, string> | null;
  ownership_change_detected_at: string | null;
  ownership_change_data: {
    previous_owner: string | null;
    new_owner: string | null;
    previous_sale_date: string | null;
    new_sale_date: string | null;
  } | null;
  zoning_source: string | null;
  zoning_checked_at: string | null;
  zoning_data: ZoningInfo | null;
  zoning_geocoded: boolean | null;
  clear_height_ft: number | null;
  dock_doors: number | null;
  drive_in_doors: number | null;
  power_amps: number | null;
  power_phase: string | null;
  yard_acres: number | null;
  column_spacing: string | null;
  sprinkler_type: string | null;
  availability_status: string | null;
  asking_rent_psf: number | null;
  nnn_cam_psf: number | null;
  lease_structure: string | null;
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
  return isEntityOwnerName(name);
}

function folio(sourceUrl: string | null) {
  if (!sourceUrl?.startsWith("mdpa:")) return null;
  return sourceUrl.replace("mdpa:", "");
}
// County-agnostic strap/folio extraction (MDPA, BCPA, PBCPA, or MassGIS) —
// used for re-running county enhancement directly, since folio() above is
// Miami-Dade-only.
function countyStrap(sourceUrl: string | null): string | null {
  if (sourceUrl?.startsWith("mdpa:")) return sourceUrl.replace("mdpa:", "");
  if (sourceUrl?.startsWith("bcpa:")) return sourceUrl.replace("bcpa:", "");
  if (sourceUrl?.startsWith("pbcpa:")) return sourceUrl.replace("pbcpa:", "");
  if (sourceUrl?.startsWith("magis:")) return sourceUrl.replace("magis:", "");
  return null;
}
function sourceLabel(source: string | null, sourceUrl?: string | null) {
  if (source === "tax_roll") {
    if (sourceUrl?.startsWith("bcpa:")) return "Tax roll · BCPA";
    if (sourceUrl?.startsWith("pbcpa:")) return "Tax roll · PBCPA";
    if (sourceUrl?.startsWith("magis:")) return "Tax roll · MassGIS";
    return "Tax roll · MDPA";
  }
  if (source === "url") return "Listing URL";
  if (source === "upload") return "Uploaded file";
  if (source === "forward") return "Email forward";
  return source ?? "Unknown";
}
function isCountySourceUrl(sUrl: string | null): boolean {
  return !!sUrl && (sUrl.startsWith("mdpa:") || sUrl.startsWith("bcpa:") || sUrl.startsWith("pbcpa:") || sUrl.startsWith("magis:"));
}
function listingUrl(source: string | null, sUrl: string | null) {
  if (source === "url" && sUrl && !isCountySourceUrl(sUrl)) return sUrl;
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
  const user = await requireUser(supabase);

  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) notFound();
  const p = data as Property;
  const rentComps = await listRentComps(id);
  const rentBand = lookupRentBand(p.submarket);

  const linkedContactIds = await loadContactIdsForProperty(supabase, user.id, id);

  await ensureIndustrialFieldDefs(supabase, user.id);

  const [{ data: fdData }, { data: linkedContactsData }, propertyActivities, { data: linkedLeases }, { data: propFollowUps }, userSettings, propertyDocuments, isSoloFirm] = await Promise.all([
    supabase
      .from("field_definitions")
      .select("*")
      .eq("entity_type", "property")
      .order("created_at", { ascending: true }),
    linkedContactIds.length > 0
      ? supabase
          .from("contacts")
          .select("id, name, email, phone, mailing_address, company, role, contact_tier, next_action_due, action_tags, contact_type")
          .in("id", linkedContactIds)
          .eq("owner_id", user.id)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as LinkedContact[] }),
    fetchActivitiesByProperty(id),
    supabase
      .from("lease_abstracts")
      .select("id, source_document, expiration_date, execution_date, base_rate, term")
      .eq("linked_property", id)
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("follow_ups")
      .select("id, description, due_date, done")
      .eq("property_id", id)
      .eq("owner_id", user.id)
      .order("due_date", { ascending: true }),
    getUserSettings(),
    listDocuments(supabase, user.id, "property", id),
    isSoloFirmForUser(supabase, user.id),
  ]);
  const allPropertyDefs = (fdData ?? []) as FieldDefinition[];
  const customDefs = allPropertyDefs.filter(isCustomGroup);
  const industrialDefs = allPropertyDefs.filter((d) => !isCustomGroup(d));
  const customValues = p.custom_fields ?? {};
  const industrialValues: Record<string, string | number | null> = {};
  for (const def of industrialDefs) {
    industrialValues[fieldSlug(def.field_name)] = industrialSpecValue(def, customValues, {
      clear_height_ft: p.clear_height_ft ?? null,
      dock_doors: p.dock_doors ?? null,
      drive_in_doors: p.drive_in_doors ?? null,
      power_amps: p.power_amps ?? null,
      power_phase: p.power_phase ?? null,
      yard_acres: p.yard_acres ?? null,
      column_spacing: p.column_spacing ?? null,
      sprinkler_type: p.sprinkler_type ?? null,
      availability_status: p.availability_status ?? null,
      asking_rent_psf: p.asking_rent_psf ?? null,
      nnn_cam_psf: p.nnn_cam_psf ?? null,
      lease_structure: p.lease_structure ?? null,
    });
  }
  const linkedContacts = (linkedContactsData ?? []) as LinkedContact[];
  const storedOwnerContacts = parseStoredOwnerContacts(p.owner_contacts);
  const displayOwnerContacts = resolvePropertyOwnerContacts(
    p.owner_contacts,
    p.owner_name,
    p.owner_mailing_address,
    { owner_contact_name: p.owner_contact_name, owner_contact_address: p.owner_contact_address },
  );
  const ownerIsEntity = isEntityName(p.owner_name);
  const linkedContactNameSet = new Set(
    linkedContacts.map((c) => normalizeOwnerName(c.name ?? "")).filter(Boolean)
  );
  const activityContacts: ActivityContact[] = linkedContacts.map((c) => ({
    id: c.id,
    name: c.name,
    contact_tier: c.contact_tier,
  }));

  const folioNumber = folio(p.source_url);
  const isMdpaSource = !!(folioNumber || p.source === "tax_roll");

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

  // Per-field provenance: prefer the explicit field_sources tag (set by county,
  // document, URL, or pasted enhancement); fall back to the whole-record
  // isMdpaSource inference for rows written before field_sources existed.
  function fieldSourceFor(key: string): FieldSource | undefined {
    const tagged = p.field_sources?.[key] as FieldSource | undefined;
    return tagged ?? (isMdpaSource ? "county" : undefined);
  }

  // ── Data sources card: per-source enrichment status, derived entirely from
  // field_sources / owner_contacts / linked-contact action_tags — no new tracking.

  const existingFolio = countyStrap(p.source_url);

  const countyDone = isMdpaSource;
  const countyFieldCount = Object.values(p.field_sources ?? {}).filter((v) => v === "county").length;
  const countyDetail = countyDone
    ? [
        p.ingested_at ? fmtDate(p.ingested_at) : null,
        countyFieldCount > 0 ? `${countyFieldCount} field${countyFieldCount !== 1 ? "s" : ""}` : null,
      ].filter(Boolean).join(" · ") || "Enriched"
    : "Not yet enriched";

  const sunbizDone = storedOwnerContacts.length > 0;
  const sunbizDetail = sunbizDone
    ? `${storedOwnerContacts.length} contact${storedOwnerContacts.length !== 1 ? "s" : ""} on file`
    : !p.owner_name
    ? "Needs an owner first"
    : isEntityName(p.owner_name)
    ? "Not yet run"
    : "Not applicable";

  const DOC_KIND_LABEL: Record<string, string> = { document: "document", url: "URL", pasted: "pasted text" };
  const docFieldEntries = Object.entries(p.field_sources ?? {}).filter(
    ([, v]) => v === "document" || v === "url" || v === "pasted"
  );
  const docDone = docFieldEntries.length > 0;
  const docKinds = [...new Set(docFieldEntries.map(([, v]) => DOC_KIND_LABEL[v] ?? v))];
  const docDetail = docDone
    ? `${docFieldEntries.length} field${docFieldEntries.length !== 1 ? "s" : ""} from ${docKinds.join("/")}`
    : "Not yet run";

  const costarContactCount = linkedContacts.filter((c) => c.action_tags?.includes("costar")).length;
  const costarDone = costarContactCount > 0;
  const costarDetail = costarDone
    ? `${costarContactCount} contact${costarContactCount !== 1 ? "s" : ""} imported`
    : userSettings.costar_enabled
    ? "Not yet run"
    : "Disabled";

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      {/* Back link */}
      <Link
        href="/crm"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        ← Workspace
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
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
          <ShareWithFirmToggle
            table="properties"
            id={p.id}
            ownerId={p.owner_id}
            currentUserId={user.id}
            initialVisibility={p.visibility}
            isSoloFirm={isSoloFirm}
          />
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
                {sourceLabel(p.source, p.source_url)} ↗
              </Badge>
            </a>
          ) : (
            <Badge variant="outline">{sourceLabel(p.source, p.source_url)}</Badge>
          )}
          <Link
            href="/properties/new"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="size-3" />
            Re-ingest
          </Link>
          <CreateDealDialog
            propertyId={id}
            propertyAddress={[p.address, p.city].filter(Boolean).join(", ") || undefined}
            trigger={
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="size-3 shrink-0">+</span>
                New pursuit
              </button>
            }
          />
          {p.owner_name && (
            <OwnerPortfolioLink
              propertyId={id}
              variant="button"
              label="Owner portfolio"
              className="h-8 text-xs"
            />
          )}
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
          <span className="font-medium">{sourceLabel(p.source, p.source_url)}</span>
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

      {/* Ownership change alert — shown when a re-check found a different owner or sale */}
      {p.ownership_change_detected_at && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Ownership change detected</AlertTitle>
          <AlertDescription className="space-y-1">
            {p.ownership_change_data?.previous_owner !== p.ownership_change_data?.new_owner && (
              <p>
                <span className="font-medium">Owner:</span>{" "}
                <span className="line-through text-destructive/70">{p.ownership_change_data?.previous_owner ?? "—"}</span>
                {" → "}
                <span className="font-semibold">{p.ownership_change_data?.new_owner ?? "—"}</span>
              </p>
            )}
            {p.ownership_change_data?.previous_sale_date !== p.ownership_change_data?.new_sale_date && (
              <p>
                <span className="font-medium">Last sale:</span>{" "}
                <span className="line-through text-destructive/70">{p.ownership_change_data?.previous_sale_date ?? "—"}</span>
                {" → "}
                <span className="font-semibold">{p.ownership_change_data?.new_sale_date ?? "—"}</span>
              </p>
            )}
            <p className="text-xs opacity-70 mt-1">
              Detected {new Date(p.ownership_change_detected_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
              Re-enrich below to update the record.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Re-check ownership against the county (only for county-enhanced properties with a folio/strap) */}
      {existingFolio && (
        <OwnershipCheckPanel
          propertyId={id}
          watchEnrolled={!!(p as { ownership_watch_enrolled_at?: string | null }).ownership_watch_enrolled_at}
          lastCheckedAt={(p as { ownership_last_checked_at?: string | null }).ownership_last_checked_at ?? null}
        />
      )}

      {/* Data sources — where this property's data came from and what's been enriched */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Data sources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Added via {sourceLabel(p.source, p.source_url)}
            {p.created_at && ` · ${fmtDate(p.created_at)}`}
          </p>
          <div className="divide-y rounded-lg border">
            <DataSourceRow label="County records" done={countyDone} detail={countyDetail} href="#enrich-county" />
            <DataSourceRow label="Owner lookup (Sunbiz)" done={sunbizDone} detail={sunbizDetail} href="#enrich-sunbiz" />
            <DataSourceRow label="Document or URL" done={docDone} detail={docDetail} href="#enrich-document" />
            <DataSourceRow label="CoStar export" done={costarDone} detail={costarDetail} href="#enrich-costar" />
          </div>
        </CardContent>
      </Card>

      {/* Zoning — runs automatically as part of county enrichment / adding a property */}
      <ZoningSection
        propertyId={id}
        needsCountyEnhancement={p.source !== "tax_roll" && !existingFolio}
        initialZoning={
          p.zoning_data
            ? { zone: p.zoning_data, source: p.zoning_source ?? "", geocoded: !!p.zoning_geocoded }
            : null
        }
      />

      <IndustrialSection
        propertyId={id}
        defs={industrialDefs}
        values={industrialValues}
      />

      {/* Enrich property — county records, Sunbiz owner discovery, document/URL, CoStar export */}
      <EnrichPanel
        propertyId={id}
        address={p.address}
        ownerName={p.owner_name}
        isEntityOwner={ownerIsEntity}
        needsCountyEnhancement={p.source !== "tax_roll" && !existingFolio}
        hasCountyFolio={!!existingFolio}
        existingFolio={existingFolio}
        countyEnrichedAt={isMdpaSource ? p.ingested_at : null}
        initialOwnerContacts={storedOwnerContacts}
        costarEnabled={userSettings.costar_enabled}
        supportsEntityLookup={!p.source_url?.startsWith("magis:")}
      />

      <Suspense
        fallback={
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Tax-roll comps</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Loading nearby tax-roll sales…</p>
            </CardContent>
          </Card>
        }
      >
        <TaxRollCompsSection sourceUrl={p.source_url} address={p.address} />
      </Suspense>

      <Suspense
        fallback={
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Lease comps</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Loading lease comps from your abstracts…</p>
            </CardContent>
          </Card>
        }
      >
        <LeaseCompsSection propertyId={id} />
      </Suspense>

      <RentNotebook
        propertyId={id}
        submarket={p.submarket}
        band={rentBand}
        initialComps={rentComps}
      />

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
              source={fieldSourceFor("owner_name")}
              action={p.owner_name ? (
                <OwnerPortfolioLink
                  propertyId={id}
                  label="Portfolio →"
                  className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md border border-primary/30 bg-primary/5 hover:bg-primary/10"
                />
              ) : undefined}
            />
            {displayOwnerContacts.length > 0 && displayOwnerContacts.map((oc, i) => (
              <Field
                key={i}
                icon={<User className="size-4" />}
                label={
                  storedOwnerContacts.length > 0
                    ? (displayOwnerContacts.length > 1 ? `Owner contact ${i + 1} (Sunbiz)` : "Owner contact (Sunbiz)")
                    : (displayOwnerContacts.length > 1 ? `Owner contact ${i + 1}` : "Owner contact")
                }
                value={[oc.name, oc.title, oc.address].filter(Boolean).join(" · ")}
                source={storedOwnerContacts.length > 0 ? "sunbiz" : undefined}
                action={
                  <>
                    <OwnerPortfolioLink
                      propertyId={id}
                      personIndex={i}
                      label="Portfolio →"
                      className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md border border-primary/30 bg-primary/5 hover:bg-primary/10"
                    />
                    <OwnerContactCreateButton
                      propertyId={id}
                      propertyLabel={p.address}
                      contactName={oc.name}
                      mode={ownerIsEntity ? { kind: "sunbiz", personIndex: i } : { kind: "mdpa" }}
                      alreadyLinked={linkedContactNameSet.has(normalizeOwnerName(oc.name))}
                    />
                  </>
                }
              />
            ))}
            <Field
              icon={<Building2 className="size-4" />}
              label="Ownership type"
              value={p.ownership_type ?? "—"}
              flagReason={flagMap.get("ownership_type")}
              source={fieldSourceFor("ownership_type")}
            />
            <Field
              icon={<Building2 className="size-4" />}
              label="Property type"
              value={p.property_type ?? "—"}
              flagReason={flagMap.get("property_type")}
              source={fieldSourceFor("property_type")}
            />
            <Field
              icon={<Ruler className="size-4" />}
              label="Building SF"
              value={p.size_sqft != null ? `${fmt(p.size_sqft)} sqft` : "—"}
              flagReason={flagMap.get("size_sqft")}
              source={fieldSourceFor("size_sqft")}
            />
            <Field
              icon={<Ruler className="size-4" />}
              label="Land SF"
              value={p.land_sqft != null ? `${fmt(p.land_sqft)} sqft` : "—"}
              source={fieldSourceFor("land_sqft")}
            />
            {p.asset_description && (
              <Field
                icon={<Building2 className="size-4" />}
                label="Asset description"
                value={p.asset_description}
                source={fieldSourceFor("asset_description")}
              />
            )}
            <Field
              icon={<Calendar className="size-4" />}
              label="Last sale date"
              value={fmtDate(p.last_sale_date)}
              flagReason={flagMap.get("last_sale_date")}
              source={fieldSourceFor("last_sale_date")}
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
              source={fieldSourceFor("last_sale_price")}
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
                const reason = flagMap.get(`custom_fields.${slug}`) ?? flagMap.get(slug);
                const source = fieldSourceFor(`custom_fields.${slug}`);
                return (
                  <div key={f.id} className="space-y-0.5">
                    <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                      {f.field_name}
                      {source && <SourceTag source={source} />}
                    </dt>
                    <dd className="text-sm font-medium">
                      {val != null ? (
                        String(val)
                      ) : (
                        <span className="text-xs italic text-muted-foreground/40 font-normal">
                          {reason ?? "not found in county tax roll — upload a flyer or OM to populate"}
                        </span>
                      )}
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
        propertyLabel={p.address}
        initialContacts={linkedContacts}
        cadenceSettings={userSettings}
      />

      {/* Linked leases */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="size-4" />
            Leases
            {linkedLeases && linkedLeases.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({linkedLeases.length})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!linkedLeases || linkedLeases.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No leases linked.{" "}
              <Link href="/abstracts/new" className="underline underline-offset-2 hover:text-foreground">
                Abstract a lease →
              </Link>
            </p>
          ) : (
            <div className="space-y-2">
              {linkedLeases.map((la) => {
                const exp = la.expiration_date ? new Date(la.expiration_date).getTime() : null;
                const now = Date.now();
                const status = !exp ? "unknown" : exp < now ? "expired" : exp < now + 90 * 86_400_000 ? "expiring" : "active";
                const statusCls = status === "active" ? "bg-green-100 text-green-700" : status === "expiring" ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground";
                const statusLabel = status === "active" ? "Active" : status === "expiring" ? "Expiring soon" : status === "expired" ? "Expired" : "No expiry";
                const fileName = la.source_document ? (la.source_document.split("/").pop() ?? la.source_document) : "Unnamed lease";
                return (
                  <Link
                    key={la.id}
                    href={`/abstracts/${la.id}`}
                    className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <span className={`shrink-0 text-xs font-medium rounded-full px-2 py-0.5 ${statusCls}`}>{statusLabel}</span>
                    <span className="flex-1 text-sm font-medium truncate">{fileName}</span>
                    {la.expiration_date && (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        Exp. {new Date(la.expiration_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    )}
                    {la.base_rate != null && (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">${la.base_rate}/sf</span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Media and documents */}
      <DocumentsSection entityType="property" entityId={id} initialDocuments={propertyDocuments} />

      {/* Unified timeline: activities + follow-ups */}
      <PropertyActivitySection
        propertyId={id}
        linkedContacts={activityContacts}
        initialActivities={propertyActivities as Activity[]}
        initialFollowUps={(propFollowUps ?? []) as PropertyFollowUpInput[]}
        cadenceSettings={userSettings}
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
                source={fieldSourceFor("building_composition.year_built")}
              />
              <SmallField
                label="Lot size"
                value={bc.lot_size_sqft != null ? `${fmt(bc.lot_size_sqft)} sqft` : "—"}
                flagReason={bcFlagReason("lot_size_sqft")}
                source={fieldSourceFor("building_composition.lot_size_sqft")}
              />
              <SmallField
                label="Stories"
                value={bc.stories != null ? String(bc.stories) : "—"}
                flagReason={bcFlagReason("stories")}
                source={fieldSourceFor("building_composition.stories")}
              />
              <SmallField
                label="Units"
                value={bc.units != null ? String(bc.units) : "—"}
                flagReason={bcFlagReason("units")}
                source={fieldSourceFor("building_composition.units")}
              />
              {bc.assessed_value != null && (
                <SmallField
                  label="Assessed value"
                  value={fmt(bc.assessed_value, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                  flagReason={bcFlagReason("assessed_value")}
                  source={fieldSourceFor("building_composition.assessed_value")}
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

// Compact per-source enrichment status row — links into the Enrich panel below,
// which opens itself and scrolls into view when it sees a matching #enrich-* hash.
function DataSourceRow({
  label,
  done,
  detail,
  href,
}: {
  label: string;
  done: boolean;
  detail: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/30 transition-colors"
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className={cn("size-1.5 rounded-full shrink-0", done ? "bg-green-500" : "bg-muted-foreground/30")} />
        <span className="font-medium truncate">{label}</span>
      </span>
      <span className="text-xs text-muted-foreground shrink-0">{detail}</span>
    </a>
  );
}

type FieldSource = "county" | "sunbiz" | "costar" | "manual" | "document" | "url" | "pasted";

const SOURCE_TAG_LABELS: Record<FieldSource, string> = {
  county: "County",
  sunbiz: "Sunbiz",
  costar: "CoStar",
  manual: "Manual",
  document: "Document",
  url: "URL",
  pasted: "Pasted",
};

function SourceTag({ source }: { source: FieldSource }) {
  const label = SOURCE_TAG_LABELS[source] ?? "Manual";
  return (
    <span className="inline-flex items-center rounded border border-muted-foreground/25 px-1 py-px text-[9px] font-medium normal-case tracking-normal text-muted-foreground/60">
      {label}
    </span>
  );
}

function Field({
  icon,
  label,
  value,
  flagReason,
  action,
  source,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  flagReason?: string;
  action?: React.ReactNode;
  source?: FieldSource;
}) {
  const isNotFound = flagReason === "not found in source record";
  const isUncertain = !!flagReason && !isNotFound;

  return (
    <div className="space-y-1">
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
        {source && <SourceTag source={source} />}
      </dt>
      <dd className={cn("text-sm font-medium flex items-center gap-2 flex-wrap", isUncertain && "text-yellow-700 dark:text-yellow-300")}>
        {isNotFound && value === "—" ? (
          <span className="text-xs italic text-muted-foreground/40 font-normal">not in source</span>
        ) : (
          <span className="min-w-0">{value}</span>
        )}
        {action}
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
  source,
}: {
  label: string;
  value: string;
  flagReason?: string;
  source?: FieldSource;
}) {
  const isNotFound = flagReason === "not found in source record";
  const isUncertain = !!flagReason && !isNotFound;

  return (
    <div className="space-y-0.5">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {source && <SourceTag source={source} />}
      </dt>
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
