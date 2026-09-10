"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Search, Loader2, AlertTriangle, Target, CheckCircle2, Inbox, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  runLeadSearch,
  interpretLeadSearch,
  acceptLeads,
  type BuyBox,
  type AcceptLeadsResult,
  type IgnoredLeadTerm,
} from "./actions";
import { BuyBoxPicker, SaveBuyBoxAction } from "./buy-box-bar";
import {
  MARKET_LABELS,
  SUPPORTED_MARKETS,
  type LeadSearchCriteria,
  type LeadSearchResult,
  type LeadMatch,
  type SupportedMarket,
  type PropertyTypeFilter,
} from "@/lib/lead-finder";

// ─── Styling helpers ──────────────────────────────────────────────────────────

const inputCls = "w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background";
const labelCls = "block text-xs font-medium text-muted-foreground mb-1";

const PROPERTY_TYPE_OPTIONS: { value: PropertyTypeFilter; label: string }[] = [
  { value: "residential", label: "Residential" },
  { value: "multifamily", label: "Multifamily" },
  { value: "retail", label: "Retail" },
  { value: "office", label: "Office" },
  { value: "industrial", label: "Industrial" },
  { value: "land", label: "Land" },
];

// A single control for the two sale-recency criteria (soldWithinYears /
// heldAtLeastYears) — a broker picks one concept ("recently changed hands"
// or "long-held"), not both at once, so these fold into one dropdown rather
// than exposing raw min/max year inputs.
type SaleRecency = "" | "sold_1" | "sold_2" | "sold_5" | "held_5" | "held_10" | "held_20";

const SALE_RECENCY_OPTIONS: { value: SaleRecency; label: string }[] = [
  { value: "", label: "Any" },
  { value: "sold_1", label: "Sold in last 1 year — ownership recently changed" },
  { value: "sold_2", label: "Sold in last 2 years" },
  { value: "sold_5", label: "Sold in last 5 years" },
  { value: "held_5", label: "Held 5+ years — long-held" },
  { value: "held_10", label: "Held 10+ years" },
  { value: "held_20", label: "Held 20+ years" },
];

function saleRecencyToCriteria(v: SaleRecency): Pick<LeadSearchCriteria, "soldWithinYears" | "heldAtLeastYears"> {
  switch (v) {
    case "sold_1": return { soldWithinYears: 1 };
    case "sold_2": return { soldWithinYears: 2 };
    case "sold_5": return { soldWithinYears: 5 };
    case "held_5": return { heldAtLeastYears: 5 };
    case "held_10": return { heldAtLeastYears: 10 };
    case "held_20": return { heldAtLeastYears: 20 };
    default: return {};
  }
}

function criteriaToSaleRecency(c: LeadSearchCriteria): SaleRecency {
  if (c.soldWithinYears === 1) return "sold_1";
  if (c.soldWithinYears === 2) return "sold_2";
  if (c.soldWithinYears === 5) return "sold_5";
  if (c.heldAtLeastYears === 5) return "held_5";
  if (c.heldAtLeastYears === 10) return "held_10";
  if (c.heldAtLeastYears === 20) return "held_20";
  return "";
}

const LEASE_EXPIRY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any" },
  { value: "90", label: "Within 90 days" },
  { value: "180", label: "Within 6 months" },
  { value: "365", label: "Within 12 months" },
];

// ─── Form state shape ─────────────────────────────────────────────────────────

type FormState = {
  markets: Set<SupportedMarket>;
  cities: string;
  buildingSqftMin: string;
  buildingSqftMax: string;
  landSqftMin: string;
  landSqftMax: string;
  propertyType: PropertyTypeFilter | "";
  assessedValueMin: string;
  assessedValueMax: string;
  yearBuiltMin: string;
  yearBuiltMax: string;
  saleRecency: SaleRecency;
  ownerPortfolioMin: string;
  leaseExpiringWithinDays: string;
};

const SENTENCE_EXAMPLES = [
  "20-50k industrial in Hialeah",
  "industrial in Ft Lauderdale over 10k",
  "industrial in Boston held 10+ years",
];

const EMPTY_FORM: FormState = {
  markets: new Set(SUPPORTED_MARKETS),
  cities: "",
  buildingSqftMin: "",
  buildingSqftMax: "",
  landSqftMin: "",
  landSqftMax: "",
  propertyType: "",
  assessedValueMin: "",
  assessedValueMax: "",
  yearBuiltMin: "",
  yearBuiltMax: "",
  saleRecency: "",
  ownerPortfolioMin: "",
  leaseExpiringWithinDays: "",
};

function numOrUndef(v: string): number | undefined {
  if (!v.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function formToCriteria(form: FormState): LeadSearchCriteria {
  const cities = form.cities
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  return {
    markets: [...form.markets],
    cities: cities.length > 0 ? cities : undefined,
    buildingSqftMin: numOrUndef(form.buildingSqftMin),
    buildingSqftMax: numOrUndef(form.buildingSqftMax),
    landSqftMin: numOrUndef(form.landSqftMin),
    landSqftMax: numOrUndef(form.landSqftMax),
    propertyType: form.propertyType || undefined,
    assessedValueMin: numOrUndef(form.assessedValueMin),
    assessedValueMax: numOrUndef(form.assessedValueMax),
    yearBuiltMin: numOrUndef(form.yearBuiltMin),
    yearBuiltMax: numOrUndef(form.yearBuiltMax),
    ownerPortfolioMin: numOrUndef(form.ownerPortfolioMin),
    leaseExpiringWithinDays: numOrUndef(form.leaseExpiringWithinDays),
    ...saleRecencyToCriteria(form.saleRecency),
  };
}

function criteriaToForm(criteria: LeadSearchCriteria): FormState {
  return {
    markets: new Set(criteria.markets),
    cities: (criteria.cities ?? []).join(", "),
    buildingSqftMin: criteria.buildingSqftMin?.toString() ?? "",
    buildingSqftMax: criteria.buildingSqftMax?.toString() ?? "",
    landSqftMin: criteria.landSqftMin?.toString() ?? "",
    landSqftMax: criteria.landSqftMax?.toString() ?? "",
    propertyType: criteria.propertyType ?? "",
    assessedValueMin: criteria.assessedValueMin?.toString() ?? "",
    assessedValueMax: criteria.assessedValueMax?.toString() ?? "",
    yearBuiltMin: criteria.yearBuiltMin?.toString() ?? "",
    yearBuiltMax: criteria.yearBuiltMax?.toString() ?? "",
    saleRecency: criteriaToSaleRecency(criteria),
    ownerPortfolioMin: criteria.ownerPortfolioMin?.toString() ?? "",
    leaseExpiringWithinDays: criteria.leaseExpiringWithinDays?.toString() ?? "",
  };
}

function fmtNum(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProspectView({ initialBuyBoxes }: { initialBuyBoxes: BuyBox[] }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [buyBoxes, setBuyBoxes] = useState<BuyBox[]>(initialBuyBoxes);
  const [activeBuyBoxId, setActiveBuyBoxId] = useState<string | null>(null);
  const [result, setResult] = useState<LeadSearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sentence, setSentence] = useState("");
  const [explanation, setExplanation] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<IgnoredLeadTerm[]>([]);
  const [isSearching, startSearch] = useTransition();
  const [isInterpreting, startInterpret] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAccepting, startAccepting] = useTransition();
  const [acceptResult, setAcceptResult] = useState<AcceptLeadsResult | null>(null);
  const isBusy = isSearching || isInterpreting;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setActiveBuyBoxId(null);
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleMarket(market: SupportedMarket) {
    setActiveBuyBoxId(null);
    setForm((prev) => {
      const next = new Set(prev.markets);
      if (next.has(market)) next.delete(market);
      else next.add(market);
      return { ...prev, markets: next };
    });
  }

  async function executeSearch(criteria: LeadSearchCriteria) {
    if (criteria.markets.length === 0) {
      setSearchError("Select at least one market to search.");
      setResult(null);
      return;
    }
    setSelected(new Set());
    setAcceptResult(null);
    const res = await runLeadSearch(criteria);
    if ("error" in res) {
      setSearchError(res.error);
      setResult(null);
    } else {
      setResult(res);
    }
  }

  function runSearch(criteriaOverride?: LeadSearchCriteria) {
    setSearchError(null);
    const criteria = criteriaOverride ?? formToCriteria(form);
    startSearch(async () => {
      await executeSearch(criteria);
    });
  }

  function runSentenceSearch(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setSearchError(null);
    setExplanation(null);
    setIgnored([]);
    startInterpret(async () => {
      const res = await interpretLeadSearch(trimmed);
      if ("error" in res) {
        setSearchError(res.error);
        setResult(null);
        return;
      }
      setActiveBuyBoxId(null);
      setForm(criteriaToForm(res.criteria));
      setExplanation(res.explanation);
      setIgnored(res.ignored);
      await executeSearch(res.criteria);
    });
  }

  function matchKey(m: LeadMatch): string {
    return `${m.market}:${m.folio}`;
  }

  function toggleSelected(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === matches.length ? new Set() : new Set(matches.map(matchKey))));
  }

  function handleAccept() {
    const toAccept = matches
      .filter((m) => selected.has(matchKey(m)))
      .map((m) => ({ market: m.market, folio: m.folio, address: m.address, city: m.city, ownerName: m.ownerName }));
    if (toAccept.length === 0) return;
    setAcceptResult(null);
    startAccepting(async () => {
      const res = await acceptLeads(toAccept);
      setAcceptResult(res);
      setSelected(new Set());
    });
  }

  function handleLoad(box: BuyBox) {
    setActiveBuyBoxId(box.id);
    setForm(criteriaToForm(box.criteria));
    setExplanation(null);
    setIgnored([]);
    runSearch(box.criteria);
  }

  const matches = result?.matches ?? [];
  const showPortfolioColumn = matches.some((m) => m.ownerPortfolioCount != null);
  const showLeaseColumn = matches.some((m) => m.leaseDaysUntilExpiry != null);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <header className="shrink-0 border-b px-4 py-3 sm:px-6 flex items-center gap-3">
        <Target className="size-4 text-muted-foreground" />
        <h1 className="text-xl font-semibold tracking-tight">Prospect</h1>
        <span className="text-xs text-muted-foreground">
          Search live parcel data across Miami-Dade, Broward, Palm Beach, and Massachusetts
        </span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 space-y-6">
          {/* ── Saved buy boxes ─────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 flex-wrap">
            <BuyBoxPicker
              buyBoxes={buyBoxes}
              activeBuyBoxId={activeBuyBoxId}
              onSelect={handleLoad}
              onDeleted={(id) => {
                setBuyBoxes((prev) => prev.filter((b) => b.id !== id));
                if (activeBuyBoxId === id) setActiveBuyBoxId(null);
              }}
            />
            <SaveBuyBoxAction
              criteria={formToCriteria(form)}
              onSaved={(box) => {
                setBuyBoxes((prev) => [box, ...prev]);
                setActiveBuyBoxId(box.id);
              }}
            />
          </div>

          {/* ── Sentence search ─────────────────────────────────────────────── */}
          <div className="space-y-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runSentenceSearch(sentence);
              }}
              className="relative"
            >
              {isBusy ? (
                <Loader2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground animate-spin" />
              ) : (
                <Sparkles className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              )}
              <input
                type="text"
                value={sentence}
                onChange={(e) => setSentence(e.target.value)}
                placeholder="Industrial 20-50k in Hialeah…"
                disabled={isBusy}
                className="w-full rounded-lg border border-border bg-background pl-9 pr-24 py-2.5 text-sm outline-none focus:ring-2 ring-ring placeholder:text-muted-foreground/60 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={isBusy || !sentence.trim()}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                <Search className="size-3.5" />
                Search
              </button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {SENTENCE_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setSentence(ex);
                    runSentenceSearch(ex);
                  }}
                  disabled={isBusy}
                  className={cn(
                    "rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground",
                    "hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40",
                  )}
                >
                  {ex}
                </button>
              ))}
            </div>
            {explanation && (
              <p className="text-xs text-muted-foreground">{explanation}</p>
            )}
            {ignored.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-1.5">
                {ignored.map((item) => (
                  <p key={item.term} className="text-xs text-amber-800 dark:text-amber-400 flex items-start gap-1.5">
                    <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                    <span>
                      <strong>{item.term}</strong> — {item.reason}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* ── Criteria form ───────────────────────────────────────────────── */}
          <div className="rounded-lg border bg-card p-5 space-y-5">
            <div>
              <p className={labelCls}>Markets</p>
              <div className="flex flex-wrap gap-3">
                {SUPPORTED_MARKETS.map((market) => (
                  <label key={market} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.markets.has(market)}
                      onChange={() => toggleMarket(market)}
                      className="size-4 rounded border-border accent-primary cursor-pointer"
                    />
                    {MARKET_LABELS[market]}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className={labelCls}>Building SF min</label>
                <input type="number" className={inputCls} value={form.buildingSqftMin}
                  onChange={(e) => update("buildingSqftMin", e.target.value)} placeholder="5,000" />
              </div>
              <div>
                <label className={labelCls}>Building SF max</label>
                <input type="number" className={inputCls} value={form.buildingSqftMax}
                  onChange={(e) => update("buildingSqftMax", e.target.value)} placeholder="20,000" />
              </div>
              <div>
                <label className={labelCls}>Land SF min</label>
                <input type="number" className={inputCls} value={form.landSqftMin}
                  onChange={(e) => update("landSqftMin", e.target.value)} placeholder="10,000" />
              </div>
              <div>
                <label className={labelCls}>Land SF max</label>
                <input type="number" className={inputCls} value={form.landSqftMax}
                  onChange={(e) => update("landSqftMax", e.target.value)} placeholder="50,000" />
              </div>
              <div>
                <label className={labelCls}>Assessed value min</label>
                <input type="number" className={inputCls} value={form.assessedValueMin}
                  onChange={(e) => update("assessedValueMin", e.target.value)} placeholder="$100,000" />
              </div>
              <div>
                <label className={labelCls}>Assessed value max</label>
                <input type="number" className={inputCls} value={form.assessedValueMax}
                  onChange={(e) => update("assessedValueMax", e.target.value)} placeholder="$1,000,000" />
              </div>
              <div>
                <label className={labelCls}>Year built min</label>
                <input type="number" className={inputCls} value={form.yearBuiltMin}
                  onChange={(e) => update("yearBuiltMin", e.target.value)} placeholder="1970" />
              </div>
              <div>
                <label className={labelCls}>Year built max</label>
                <input type="number" className={inputCls} value={form.yearBuiltMax}
                  onChange={(e) => update("yearBuiltMax", e.target.value)} placeholder="2010" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Property type</label>
                <select
                  className={inputCls}
                  value={form.propertyType}
                  onChange={(e) => update("propertyType", e.target.value as PropertyTypeFilter | "")}
                >
                  <option value="">Any</option>
                  {PROPERTY_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Cities (comma-separated)</label>
                <input type="text" className={inputCls} value={form.cities}
                  onChange={(e) => update("cities", e.target.value)} placeholder="Miami, Hialeah" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              <div>
                <label className={labelCls}>Last sale</label>
                <select
                  className={inputCls}
                  value={form.saleRecency}
                  onChange={(e) => update("saleRecency", e.target.value as SaleRecency)}
                >
                  {SALE_RECENCY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Owner owns at least (properties)</label>
                <input type="number" className={inputCls} value={form.ownerPortfolioMin}
                  onChange={(e) => update("ownerPortfolioMin", e.target.value)} placeholder="e.g. 3" />
              </div>
              <div>
                <label className={labelCls}>Lease expiring soon</label>
                <select
                  className={inputCls}
                  value={form.leaseExpiringWithinDays}
                  onChange={(e) => update("leaseExpiringWithinDays", e.target.value)}
                >
                  {LEASE_EXPIRY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Only flags matches already in your book with an abstracted lease.
                </p>
              </div>
            </div>

            {searchError && (
              <p className="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                {searchError}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => runSearch()}
                disabled={isBusy}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
              >
                {isBusy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                Search
              </button>
            </div>
          </div>

          {/* ── Caveats ──────────────────────────────────────────────────────── */}
          {result && result.caveats.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-1.5">
              {result.caveats.map((caveat, i) => (
                <p key={i} className="text-xs text-amber-800 dark:text-amber-400 flex items-start gap-1.5">
                  <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                  {caveat}
                </p>
              ))}
            </div>
          )}

          {/* ── Per-market outcomes ──────────────────────────────────────────── */}
          {result && (
            <div className="flex flex-wrap gap-2">
              {result.outcomes.map((outcome) => (
                <span
                  key={outcome.market}
                  className={cn(
                    "text-xs rounded-md border px-2.5 py-1",
                    outcome.kind === "ok" && "bg-muted/30",
                    outcome.kind === "too_many" && "border-amber-500/30 bg-amber-50/60 dark:bg-amber-950/20 text-amber-800 dark:text-amber-400",
                    outcome.kind === "error" && "border-destructive/30 bg-destructive/5 text-destructive",
                  )}
                >
                  <strong>{MARKET_LABELS[outcome.market]}:</strong>{" "}
                  {outcome.kind === "ok" && `${outcome.totalCount} match${outcome.totalCount === 1 ? "" : "es"}`}
                  {outcome.kind === "too_many" && `${outcome.count.toLocaleString()} matches — narrow your criteria`}
                  {outcome.kind === "error" && outcome.message}
                </span>
              ))}
            </div>
          )}

          {/* ── Accept result summary ───────────────────────────────────────────── */}
          {acceptResult && (
            <div
              className={cn(
                "rounded-lg border p-3 space-y-1",
                acceptResult.failed.length > 0
                  ? "border-amber-500/30 bg-amber-50/60 dark:bg-amber-950/20"
                  : "border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-950/20",
              )}
            >
              <p className="text-sm flex items-center gap-1.5">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                Enriched {acceptResult.enrichedIds.length}
                {acceptResult.skippedDuplicates > 0 && `, skipped ${acceptResult.skippedDuplicates} already in your book`}
                {acceptResult.failed.length > 0 && `, ${acceptResult.failed.length} failed`}
                {acceptResult.enrichedIds.length > 0 && (
                  <>
                    {" — "}
                    <Link href="/crm" className="underline underline-offset-2 hover:no-underline">
                      view in Workspace
                    </Link>
                  </>
                )}
              </p>
              {acceptResult.failed.map((f, i) => (
                <p key={i} className="text-xs text-destructive">
                  {MARKET_LABELS[f.market]} {f.folio}: {f.message}
                </p>
              ))}
            </div>
          )}

          {/* ── Results table ────────────────────────────────────────────────── */}
          {matches.length > 0 && (
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/20">
                <span className="text-xs text-muted-foreground">
                  {selected.size > 0 ? `${selected.size} selected` : `${matches.length} matches`}
                </span>
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={selected.size === 0 || isAccepting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-40"
                >
                  {isAccepting ? <Loader2 className="size-3.5 animate-spin" /> : <Inbox className="size-3.5" />}
                  Accept {selected.size > 0 ? selected.size : ""} to book
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <th className="w-8 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.size === matches.length && matches.length > 0}
                          onChange={toggleSelectAll}
                          className="size-4 rounded border-border accent-primary cursor-pointer"
                        />
                      </th>
                      <th className="text-left font-medium px-3 py-2">Address</th>
                      <th className="text-left font-medium px-3 py-2">Market</th>
                      <th className="text-right font-medium px-3 py-2">Building SF</th>
                      <th className="text-right font-medium px-3 py-2">Land SF</th>
                      <th className="text-left font-medium px-3 py-2">Use</th>
                      <th className="text-left font-medium px-3 py-2">Owner</th>
                      <th className="text-right font-medium px-3 py-2">Assessed value</th>
                      <th className="text-right font-medium px-3 py-2">Year built</th>
                      <th className="text-right font-medium px-3 py-2">Last sale</th>
                      {showPortfolioColumn && <th className="text-right font-medium px-3 py-2">Owner portfolio</th>}
                      {showLeaseColumn && <th className="text-right font-medium px-3 py-2">Lease expires</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((m: LeadMatch) => {
                      const key = matchKey(m);
                      return (
                        <tr key={key} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selected.has(key)}
                              onChange={() => toggleSelected(key)}
                              className="size-4 rounded border-border accent-primary cursor-pointer"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div>{m.address ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{m.city}</div>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground" title={m.source}>
                            {MARKET_LABELS[m.market]}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtNum(m.buildingSqft)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtNum(m.landSqft)}</td>
                          <td className="px-3 py-2 text-xs max-w-[200px] truncate" title={m.useDescription ?? undefined}>
                            {m.useDescription ?? m.useCode ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-xs max-w-[180px] truncate" title={m.ownerName ?? undefined}>
                            {m.ownerName ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(m.assessedValue)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{m.yearBuilt ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{m.lastSaleDate ?? "—"}</td>
                          {showPortfolioColumn && (
                            <td className="px-3 py-2 text-right tabular-nums">{m.ownerPortfolioCount ?? "—"}</td>
                          )}
                          {showLeaseColumn && (
                            <td className="px-3 py-2 text-right tabular-nums">
                              {m.leaseDaysUntilExpiry != null ? `${m.leaseDaysUntilExpiry}d` : "—"}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result && matches.length === 0 && result.outcomes.every((o) => o.kind === "ok") && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No matches. Try widening your criteria.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
