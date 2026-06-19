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
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";

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

  // Fetch custom field definitions for display
  const { data: fdData } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("entity_type", "property")
    .order("created_at", { ascending: true });
  const customDefs = (fdData ?? []) as FieldDefinition[];
  const customValues = p.custom_fields ?? {};

  const folioNumber = folio(p.source_url);
  const flaggedFields = new Set((p.confidence_flags ?? []).map((f) => f.field));
  const notFoundFlags = (p.confidence_flags ?? []).filter(
    (f) => f.reason === "not found in source record"
  );
  const uncertainFlags = (p.confidence_flags ?? []).filter(
    (f) => f.reason !== "not found in source record"
  );
  const bc = p.building_composition;

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

      {/* Source + folio verification strip (tax roll records only) */}
      {folioNumber && (
        <div className="rounded-lg border bg-muted/30 px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
          <span className="text-muted-foreground">Source:</span>
          <span className="font-medium">Miami-Dade Property Appraiser</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">Folio:</span>
          <span className="font-mono text-foreground">{folioNumber}</span>
          <a
            href="https://www.miamidade.gov/Apps/PA/propertysearch/#/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors ml-auto"
          >
            Verify on MDPA
            <ExternalLink className="size-3" />
          </a>
        </div>
      )}

      {/* Uncertain / ambiguous fields — yellow */}
      {uncertainFlags.length > 0 && (
        <Alert variant="default" className="border-yellow-500/40 bg-yellow-500/5">
          <AlertTriangle className="size-4 text-yellow-600" />
          <AlertTitle className="text-yellow-700 dark:text-yellow-400">
            {uncertainFlags.length} field
            {uncertainFlags.length > 1 ? "s" : ""} flagged uncertain — verify
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
            {notFoundFlags.length > 1 ? "s" : ""} not in source record
          </AlertTitle>
          <AlertDescription className="text-muted-foreground">
            {notFoundFlags.map((f) => f.field).join(", ")} — not present in the MDPA
            record for this parcel.
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
              flagged={flaggedFields.has("owner_name")}
            />
            <Field
              icon={<Building2 className="size-4" />}
              label="Ownership type"
              value={p.ownership_type ?? "—"}
              flagged={flaggedFields.has("ownership_type")}
            />
            <Field
              icon={<Building2 className="size-4" />}
              label="Property type"
              value={p.property_type ?? "—"}
              flagged={flaggedFields.has("property_type")}
            />
            <Field
              icon={<Ruler className="size-4" />}
              label="Building area"
              value={p.size_sqft != null ? `${fmt(p.size_sqft)} sqft` : "—"}
              flagged={flaggedFields.has("size_sqft")}
            />
            <Field
              icon={<Calendar className="size-4" />}
              label="Last sale date"
              value={fmtDate(p.last_sale_date)}
              flagged={flaggedFields.has("last_sale_date")}
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
              flagged={flaggedFields.has("last_sale_price")}
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
                      {val != null ? String(val) : "—"}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Building composition */}
      {bc && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Building composition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
              <SmallField label="Year built" value={bc.year_built ? String(bc.year_built) : "—"} />
              <SmallField
                label="Lot size"
                value={bc.lot_size_sqft != null ? `${fmt(bc.lot_size_sqft)} sqft` : "—"}
              />
              <SmallField label="Stories" value={bc.stories != null ? String(bc.stories) : "—"} />
              <SmallField label="Units" value={bc.units != null ? String(bc.units) : "—"} />
              {bc.assessed_value != null && (
                <SmallField
                  label="Assessed value"
                  value={fmt(bc.assessed_value, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
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
  flagged,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  flagged?: boolean;
}) {
  return (
    <div className="space-y-1">
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="flex items-center gap-1.5 text-sm font-medium">
        {value}
        {flagged && (
          <span title="Low confidence — verify this field">
            <AlertTriangle className="size-3.5 text-yellow-500" />
          </span>
        )}
      </dd>
    </div>
  );
}

function SmallField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
