"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MdpaSearchQuery } from "@/lib/owner-portfolio";
import {
  discoverMdpaPortfolio,
  discoverBcpaPortfolio,
  discoverPbcpaPortfolio,
  discoverMagisPortfolio,
  importAllMdpaPortfolioParcels,
  importAllBcpaPortfolioParcels,
  importAllPbcpaPortfolioParcels,
  importAllMagisPortfolioParcels,
  importMdpaPortfolioParcel,
  importBcpaPortfolioParcel,
  importPbcpaPortfolioParcel,
  importMagisPortfolioParcel,
  type MdpaPortfolioDiscovery,
  type BcpaPortfolioDiscovery,
  type PbcpaPortfolioDiscovery,
  type MagisPortfolioDiscovery,
} from "./discovery-actions";

type County = "miami-dade" | "broward" | "palm-beach" | "massachusetts";

type TaxRollParcel = {
  county: County;
  folio: string;
  strap: string;
  ownerName: string;
  address: string | null;
  city: string | null;
  buildingSqft: number | null;
  inCrm: boolean;
  crmPropertyId: string | null;
};

const COUNTY_LABEL: Record<County, string> = {
  "miami-dade": "Miami-Dade",
  broward: "Broward",
  "palm-beach": "Palm Beach",
  massachusetts: "Massachusetts",
};

const mdpaVerifyUrl = (folio: string) =>
  `https://www.miamidade.gov/Apps/PA/propertysearch/#/?strap=${folio.replace(/-/g, "")}`;

const bcpaVerifyUrl = (folio: string) =>
  `https://gisweb-adapters.bcpa.net/bcpawebmap_ex_new_web/bcpawebmap.aspx?FOLIO=${folio.replace(/-/g, "")}`;

const pbcpaVerifyUrl = (folio: string) =>
  `https://pbcpao.gov/Property/Details?parcelId=${folio.replace(/-/g, "")}`;

// MassGIS has no single, polished per-parcel "verify" page the way the three
// Florida county appraisers do (each town runs its own local assessor site,
// no one stable URL pattern) — this links the raw ArcGIS record query
// instead of guessing/fabricating a page that might not exist.
const magisVerifyUrl = (locId: string) =>
  `https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0/query?where=LOC_ID='${encodeURIComponent(locId)}'&outFields=*&f=json`;

function verifyUrlFor(county: County, strap: string): string {
  if (county === "miami-dade") return mdpaVerifyUrl(strap);
  if (county === "palm-beach") return pbcpaVerifyUrl(strap);
  if (county === "massachusetts") return magisVerifyUrl(strap);
  return bcpaVerifyUrl(strap);
}

function verifyLabelFor(county: County): string {
  if (county === "miami-dade") return "MDPA";
  if (county === "palm-beach") return "PBCPA";
  if (county === "massachusetts") return "MassGIS (raw record)";
  return "BCPA";
}

function mergeParcels(
  mdpa: MdpaPortfolioDiscovery | null,
  bcpa: BcpaPortfolioDiscovery | null,
  pbcpa: PbcpaPortfolioDiscovery | null,
  magis: MagisPortfolioDiscovery | null,
): TaxRollParcel[] {
  const parcels: TaxRollParcel[] = [];
  for (const p of mdpa?.parcels ?? []) {
    parcels.push({ county: "miami-dade", ...p });
  }
  for (const p of bcpa?.parcels ?? []) {
    parcels.push({ county: "broward", ...p });
  }
  for (const p of pbcpa?.parcels ?? []) {
    parcels.push({ county: "palm-beach", ...p });
  }
  for (const p of magis?.parcels ?? []) {
    parcels.push({ county: "massachusetts", ...p });
  }
  return parcels.sort((a, b) => (a.address ?? a.folio).localeCompare(b.address ?? b.folio));
}

export function PortfolioTaxRollSection({
  queries,
}: {
  queries: MdpaSearchQuery[];
}) {
  const router = useRouter();
  const [mdpa, setMdpa] = useState<MdpaPortfolioDiscovery | null>(null);
  const [bcpa, setBcpa] = useState<BcpaPortfolioDiscovery | null>(null);
  const [pbcpa, setPbcpa] = useState<PbcpaPortfolioDiscovery | null>(null);
  const [magis, setMagis] = useState<MagisPortfolioDiscovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [importingStrap, setImportingStrap] = useState<string | null>(null);
  const [bulkPending, startBulk] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [otherCountyNotice, setOtherCountyNotice] = useState<string | null>(null);

  const runDiscovery = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOtherCountyNotice(null);

    const [mdpaSettled, bcpaSettled, pbcpaSettled, magisSettled] = await Promise.allSettled([
      discoverMdpaPortfolio(queries),
      discoverBcpaPortfolio(queries),
      discoverPbcpaPortfolio(queries),
      discoverMagisPortfolio(queries),
    ]);

    const mdpaResult = mdpaSettled.status === "fulfilled" ? mdpaSettled.value : null;
    const bcpaResult = bcpaSettled.status === "fulfilled" ? bcpaSettled.value : null;
    const pbcpaResult = pbcpaSettled.status === "fulfilled" ? pbcpaSettled.value : null;
    const magisResult = magisSettled.status === "fulfilled" ? magisSettled.value : null;

    setMdpa(mdpaResult);
    setBcpa(bcpaResult);
    setPbcpa(pbcpaResult);
    setMagis(magisResult);

    // Miami-Dade errors are surfaced as the primary error (this county has the
    // deepest/most reliable coverage); Broward/Palm Beach/Massachusetts
    // failures are shown as an honest notice so the section stays useful even
    // if one of those searches is limited.
    if (mdpaResult?.error) {
      setError(mdpaResult.error);
    } else if (mdpaSettled.status === "rejected") {
      setError(String(mdpaSettled.reason));
    }

    const limitedNotices: string[] = [];
    if (bcpaResult?.error) {
      limitedNotices.push(`Broward: ${bcpaResult.error}`);
    } else if (bcpaSettled.status === "rejected") {
      limitedNotices.push(`Broward: ${String(bcpaSettled.reason)}`);
    }
    if (pbcpaResult?.error) {
      limitedNotices.push(`Palm Beach: ${pbcpaResult.error}`);
    } else if (pbcpaSettled.status === "rejected") {
      limitedNotices.push(`Palm Beach: ${String(pbcpaSettled.reason)}`);
    }
    if (magisResult?.error) {
      limitedNotices.push(`Massachusetts: ${magisResult.error}`);
    } else if (magisSettled.status === "rejected") {
      limitedNotices.push(`Massachusetts: ${String(magisSettled.reason)}`);
    }
    if (limitedNotices.length > 0) {
      setOtherCountyNotice(`Tax roll search limited — ${limitedNotices.join(" · ")}`);
    }

    setLoading(false);
  }, [queries]);

  useEffect(() => {
    runDiscovery();
  }, [runDiscovery]);

  async function handleImportOne(county: County, strap: string, address: string | null, city: string | null) {
    setImportingStrap(strap);
    setError(null);
    const res =
      county === "miami-dade"
        ? await importMdpaPortfolioParcel(strap, address ?? strap, city)
        : county === "palm-beach"
        ? await importPbcpaPortfolioParcel(strap, address ?? strap, city)
        : county === "massachusetts"
        ? await importMagisPortfolioParcel(strap, address ?? strap, city)
        : await importBcpaPortfolioParcel(strap, address ?? strap, city);
    setImportingStrap(null);
    if ("error" in res && !("existingId" in res && res.existingId)) {
      setError(res.error);
      return;
    }
    await runDiscovery();
    router.refresh();
  }

  function handleImportAll() {
    const toImportMdpa = (mdpa?.parcels ?? [])
      .filter((p) => !p.inCrm)
      .map((p) => ({ strap: p.strap, address: p.address ?? p.strap, city: p.city }));
    const toImportBcpa = (bcpa?.parcels ?? [])
      .filter((p) => !p.inCrm)
      .map((p) => ({ strap: p.strap, address: p.address ?? p.strap, city: p.city }));
    const toImportPbcpa = (pbcpa?.parcels ?? [])
      .filter((p) => !p.inCrm)
      .map((p) => ({ strap: p.strap, address: p.address ?? p.strap, city: p.city }));
    const toImportMagis = (magis?.parcels ?? [])
      .filter((p) => !p.inCrm)
      .map((p) => ({ strap: p.strap, address: p.address ?? p.strap, city: p.city }));
    if (toImportMdpa.length === 0 && toImportBcpa.length === 0 && toImportPbcpa.length === 0 && toImportMagis.length === 0) return;

    startBulk(async () => {
      setError(null);
      const [mdpaRes, bcpaRes, pbcpaRes, magisRes] = await Promise.all([
        toImportMdpa.length > 0
          ? importAllMdpaPortfolioParcels(toImportMdpa)
          : Promise.resolve({ imported: [], skipped: 0, errors: [] as string[] }),
        toImportBcpa.length > 0
          ? importAllBcpaPortfolioParcels(toImportBcpa)
          : Promise.resolve({ imported: [], skipped: 0, errors: [] as string[] }),
        toImportPbcpa.length > 0
          ? importAllPbcpaPortfolioParcels(toImportPbcpa)
          : Promise.resolve({ imported: [], skipped: 0, errors: [] as string[] }),
        toImportMagis.length > 0
          ? importAllMagisPortfolioParcels(toImportMagis)
          : Promise.resolve({ imported: [], skipped: 0, errors: [] as string[] }),
      ]);
      const errors = [...mdpaRes.errors, ...bcpaRes.errors, ...pbcpaRes.errors, ...magisRes.errors];
      const importedCount = mdpaRes.imported.length + bcpaRes.imported.length + pbcpaRes.imported.length + magisRes.imported.length;
      const skipped = mdpaRes.skipped + bcpaRes.skipped + pbcpaRes.skipped + magisRes.skipped;
      if (errors.length > 0) {
        setError(`Imported ${importedCount}; ${skipped} skipped. ${errors[0]}`);
      }
      await runDiscovery();
      router.refresh();
    });
  }

  const parcels = mergeParcels(mdpa, bcpa, pbcpa, magis);
  const notInCrm = parcels.filter((p) => !p.inCrm);
  const totalOnTaxRoll = parcels.length;
  const inCrmCount = parcels.filter((p) => p.inCrm).length;
  const truncated = Boolean(mdpa?.truncated || bcpa?.truncated || pbcpa?.truncated || magis?.truncated);
  const hasAnyResult = Boolean(mdpa || bcpa || pbcpa || magis);

  const searchSummary = queries
    .map((q) => q.label ?? q.query)
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Search className="size-4 text-muted-foreground" />
            Tax roll portfolio
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            County-wide search (Miami-Dade + Broward + Palm Beach + Massachusetts):{" "}
            <span className="font-medium text-foreground">{searchSummary}</span>
            {" "}— all parcels owned under matching LLC / owner names on the tax roll.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => runDiscovery()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border hover:bg-muted/50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </button>
          {notInCrm.length > 0 && (
            <button
              type="button"
              onClick={handleImportAll}
              disabled={bulkPending || loading}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {bulkPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              Import all missing ({notInCrm.length})
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          {error}
        </p>
      )}

      {otherCountyNotice && (
        <p className="text-xs text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2">
          {otherCountyNotice}
        </p>
      )}

      {loading && !hasAnyResult && (
        <div className="rounded-xl border bg-card px-4 py-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Searching Miami-Dade, Broward, Palm Beach, and Massachusetts tax rolls…
        </div>
      )}

      {hasAnyResult && !loading && parcels.length === 0 && !error && (
        <p className="text-sm text-muted-foreground rounded-xl border bg-card px-4 py-8 text-center">
          No matching parcels on the Miami-Dade, Broward, Palm Beach, or Massachusetts tax rolls for this owner.
        </p>
      )}

      {parcels.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border bg-card px-2.5 py-1 tabular-nums">
              <span className="font-semibold">{totalOnTaxRoll}</span> on tax roll
            </span>
            <span className="rounded-full border bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 px-2.5 py-1 tabular-nums">
              <span className="font-semibold">{inCrmCount}</span> in workspace
            </span>
            <span className="rounded-full border bg-amber-500/10 text-amber-800 dark:text-amber-400 px-2.5 py-1 tabular-nums">
              <span className="font-semibold">{notInCrm.length}</span> not imported
            </span>
            {truncated && (
              <span className="text-muted-foreground self-center">
                Capped at 3,000 per source — portfolio may be larger.
              </span>
            )}
          </div>

          <div className="rounded-xl border bg-card overflow-hidden divide-y max-h-[28rem] overflow-y-auto">
            {parcels.map((p) => (
              <div
                key={`${p.county}-${p.folio}`}
                className={cn(
                  "flex items-center gap-3 px-4 py-3",
                  !p.inCrm && "bg-amber-500/[0.03]",
                )}
              >
                <div className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Building2 className="size-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {p.address ?? `Folio ${p.strap}`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
                    <MapPin className="size-3 shrink-0" />
                    {[COUNTY_LABEL[p.county], p.city, p.ownerName, p.strap].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {p.buildingSqft != null && (
                  <span className="text-xs tabular-nums text-muted-foreground shrink-0 hidden sm:block">
                    {p.buildingSqft.toLocaleString()} sf
                  </span>
                )}
                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={verifyUrlFor(p.county, p.strap)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-muted-foreground hover:text-foreground"
                    title={`Verify on ${verifyLabelFor(p.county)}`}
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                  {p.inCrm && p.crmPropertyId ? (
                    <Link
                      href={`/properties/${p.crmPropertyId}`}
                      className="text-xs font-medium px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 hover:bg-emerald-500/15"
                    >
                      In workspace
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleImportOne(p.county, p.strap, p.address, p.city)}
                      disabled={importingStrap === p.strap || bulkPending}
                      className="text-xs font-medium px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      {importingStrap === p.strap ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Download className="size-3" />
                      )}
                      Import
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
