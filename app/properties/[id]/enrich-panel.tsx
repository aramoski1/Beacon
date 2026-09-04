"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  MapPin,
  Search,
  Sparkles,
  Square,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OwnerPortfolioLink } from "@/components/owner-portfolio-link";
import type { StoredOwnerContact } from "@/lib/owner-contacts";
import { manualSunbizSearchUrl } from "@/lib/sunbiz-url";
import type { CoStarOwner, CoStarContact } from "@/lib/costar";
import {
  initiateCountyEnhancement,
  previewCountyEnhancement,
  applyCountyEnhancement,
  lookupSunbiz,
  saveSunbizOwnerContacts,
  createContactFromSunbizOwner,
  createOwnerContact,
  parseCoStarFile,
  createCoStarContacts,
  previewDocumentEnhancement,
  applyDocumentEnhancement,
  previewListingDiscover,
  applyListingDiscover,
  finalizeListingDiscoverIfNeeded,
  getListingDiscoverJobStatuses,
  type EnhancementPreview,
  type SunbizLookupAction,
  type DocumentEnhancementPreview,
  type ListingDiscoverPreview,
  type ListingDiscoverFieldHit,
} from "./actions";

const COUNTY_SOURCE_LABEL: Record<string, string> = {
  broward: "BCPA",
  "palm-beach": "PBCPA",
  "miami-dade": "MDPA",
  massachusetts: "MassGIS",
};

// ── Types derived from action return types ────────────────────────────────────

type SunbizResult = NonNullable<EnhancementPreview["sunbiz_result"]>;
type SunbizPerson = SunbizResult["persons"][number];
type DocumentDiffEntry = DocumentEnhancementPreview["changes"][number];

// ── County phase ──────────────────────────────────────────────────────────────

type CountyPhase =
  | { tag: "idle" }
  | { tag: "searching" }
  | { tag: "error"; message: string }
  | { tag: "pick_folio"; matches: { strap: string; address: string }[] }
  | { tag: "loading_preview" }
  | { tag: "previewing"; preview: EnhancementPreview }
  | { tag: "saving" }
  | { tag: "done"; changesCount: number; ownerContactsSaved: number };

// ── Sunbiz phase ──────────────────────────────────────────────────────────────

type SunbizPhase =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "results"; result: SunbizResult; matches_found: number }
  | { tag: "saving" }
  | { tag: "saved"; count: number };

const SUNBIZ_STATUS_CLS: Record<string, string> = {
  ACTIVE:            "bg-green-100 text-green-700",
  INACTIVE:          "bg-slate-100 text-slate-600",
  DISSOLVED:         "bg-red-100 text-red-700",
  REVOKED:           "bg-red-100 text-red-700",
  "ADMIN DISSOLVED": "bg-red-100 text-red-700",
  "ADMIN REVOKED":   "bg-red-100 text-red-700",
};

// ── CoStar phase ──────────────────────────────────────────────────────────────

type CoStarPhase =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "results"; owner: CoStarOwner }
  | { tag: "saving" }
  | { tag: "saved"; count: number };

const COSTAR_ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp,.csv,.txt";

// ── Document-enhancement phase ────────────────────────────────────────────────

type DocMode = "file" | "paste" | "url";

type DocPhase =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "previewing"; preview: DocumentEnhancementPreview }
  | { tag: "saving" }
  | { tag: "done"; fieldsApplied: number; sourceKind: DocumentEnhancementPreview["sourceKind"] };

const DOC_ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp,.txt";

type ListingPhase =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "previewing"; preview: ListingDiscoverPreview }
  | { tag: "saving" }
  | { tag: "done"; fieldsApplied: number; fields?: ListingDiscoverFieldHit[]; url?: string | null };

// Human-readable noun for "Enriched from ___" status copy.
function docSourceNoun(kind: DocumentEnhancementPreview["sourceKind"]): string {
  return kind === "document" ? "document" : kind === "url" ? "URL" : "pasted text";
}

// ── Reusable sub-elements ─────────────────────────────────────────────────────

function SubHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
      <Icon className="size-3.5" />
      {title}
    </p>
  );
}

function ErrorBox({
  message, onBack, backLabel = "Back", extra,
}: {
  message: string;
  onBack: () => void;
  backLabel?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p>{message}</p>
          {extra}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onBack}>{backLabel}</Button>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
      <Loader2 className="size-4 animate-spin shrink-0" />
      {label}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function EnrichPanel({
  propertyId,
  address,
  ownerName,
  isEntityOwner,
  needsCountyEnhancement,
  hasCountyFolio,
  existingFolio,
  countyEnrichedAt,
  initialOwnerContacts,
  costarEnabled,
  supportsEntityLookup,
}: {
  propertyId: string;
  address: string | null;
  ownerName: string | null;
  isEntityOwner: boolean;
  needsCountyEnhancement: boolean;
  hasCountyFolio: boolean;
  existingFolio: string | null;
  countyEnrichedAt: string | null;
  initialOwnerContacts: StoredOwnerContact[];
  costarEnabled: boolean;
  /** Sunbiz is Florida's Division of Corporations registry — it has no
   * Massachusetts data. False for a magis:-sourced property so the panel
   * says so honestly instead of offering a lookup guaranteed to be wrong
   * or empty. See lib/magis.ts's file header and lookupSunbiz's server-side
   * guard in app/properties/[id]/actions.ts (the actual enforcement point —
   * this prop only controls what the UI offers). */
  supportsEntityLookup: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pendingHashRef = useRef<string | null>(null);

  // County
  const [county, setCounty] = useState<CountyPhase>({ tag: "idle" });
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [countyPersonSel, setCountyPersonSel] = useState<Set<number>>(new Set());

  // Sunbiz (standalone)
  const [sunbiz, setSunbiz] = useState<SunbizPhase>({ tag: "idle" });
  const [sunbizPersonSel, setSunbizPersonSel] = useState<Set<number>>(new Set());

  // Owner contacts — local copy updated by enrichment steps
  const [ownerContacts, setOwnerContacts] = useState<StoredOwnerContact[]>(initialOwnerContacts);
  const [creatingSunbizIdx, setCreatingSunbizIdx] = useState<number | null>(null);
  const [promotedIndices, setPromotedIndices] = useState<Set<number>>(new Set());
  const [ownerCreated, setOwnerCreated] = useState(false);
  const [ownerContactError, setOwnerContactError] = useState<string | null>(null);

  // CoStar
  const [costarOpen, setCostarOpen] = useState(false);
  const [costar, setCostar] = useState<CoStarPhase>({ tag: "idle" });
  const [costarSel, setCostarSel] = useState<Set<number>>(new Set());
  const [fileName, setFileName] = useState<string | null>(null);
  const [costarBook, setCostarBook] = useState<"owner" | "tenant">("owner");
  const fileRef = useRef<HTMLInputElement>(null);

  // Document enhancement
  const [docOpen, setDocOpen] = useState(false);
  const [docMode, setDocMode] = useState<DocMode>("file");
  const [doc, setDoc] = useState<DocPhase>({ tag: "idle" });
  const [docFileName, setDocFileName] = useState<string | null>(null);
  const [docPasteText, setDocPasteText] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [docConflictSel, setDocConflictSel] = useState<Set<string>>(new Set());
  const docFileRef = useRef<HTMLInputElement>(null);

  // Listing discover
  const [listing, setListing] = useState<ListingPhase>({ tag: "idle" });
  const [listingSel, setListingSel] = useState<Set<string>>(new Set());
  const listingAutoStarted = useRef(false);
  const listingTagRef = useRef<ListingPhase["tag"]>("idle");
  const listingJobWatched = useRef(false);
  listingTagRef.current = listing.tag;

  // ── Deep-link from the Data sources card (#enrich-county / -sunbiz / -document / -costar / -listing) ──

  useEffect(() => {
    function applyHash() {
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash.startsWith("enrich-")) return;
      pendingHashRef.current = hash;
      setOpen(true);
      if (hash === "enrich-costar") setCostarOpen(true);
      if (hash === "enrich-document") setDocOpen(true);
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  useEffect(() => {
    if (pendingHashRef.current && open) {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      pendingHashRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function pollListingJob() {
      if (listingTagRef.current === "previewing" || listingTagRef.current === "saving") return;
      const [status] = await getListingDiscoverJobStatuses([propertyId]);
      if (cancelled || !status) return;

      if (status.status === "queued" || status.status === "running") {
        listingJobWatched.current = true;
        setListing({ tag: "loading" });
        await fetch("/api/jobs/process", { method: "POST" });
        timer = setTimeout(pollListingJob, 2500);
        return;
      }

      if (status.status === "failed") {
        setListing({ tag: "error", message: status.error ?? "Listing search failed." });
        return;
      }

      if (status.status !== "done") return;

      const needsFinalize = status.applied === 0 && !!status.preview?.candidates.length;
      const finalized = needsFinalize
        ? await finalizeListingDiscoverIfNeeded(propertyId)
        : status;
      if (cancelled) return;
      const done = finalized ?? status;
      if (done.applied > 0 || done.fields.length > 0 || listingJobWatched.current) {
        setListing({
          tag: "done",
          fieldsApplied: done.applied,
          fields: done.fields,
          url: done.url,
        });
      }
      if (listingJobWatched.current || (needsFinalize && done.applied > 0)) {
        router.refresh();
      }
    }

    pollListingJob();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [propertyId, router]);

  // ── County handlers ─────────────────────────────────────────────────────────

  async function countyDoPreview(strap: string, siteAddress: string) {
    setCounty({ tag: "loading_preview" });
    const res = await previewCountyEnhancement(propertyId, strap, siteAddress);
    if ("error" in res) { setCounty({ tag: "error", message: res.error }); return; }
    const persons = res.preview.sunbiz_result?.persons ?? [];
    setCountyPersonSel(new Set(persons.map((_, i) => i)));
    setCounty({ tag: "previewing", preview: res.preview });
  }

  function handleCountyStart() {
    setCounty({ tag: "searching" });
    startTransition(async () => {
      const res = await initiateCountyEnhancement(propertyId);
      if ("error" in res) { setCounty({ tag: "error", message: res.error }); return; }
      const { matches } = res;
      if (matches.length === 1) {
        await countyDoPreview(matches[0].strap, matches[0].address);
      } else {
        setCounty({ tag: "pick_folio", matches });
      }
    });
  }

  function handleCountyApply(preview: EnhancementPreview) {
    const persons = preview.sunbiz_result?.persons ?? [];
    const sunbizPersons = [...countyPersonSel]
      .sort((a, b) => a - b)
      .map((i) => persons[i])
      .filter((p): p is SunbizPerson => p != null);

    setCounty({ tag: "saving" });
    startTransition(async () => {
      const res = await applyCountyEnhancement(propertyId, preview.strap, preview.mdpaData, sunbizPersons);
      if ("error" in res) { setCounty({ tag: "error", message: res.error }); return; }
      setCounty({ tag: "done", changesCount: preview.changes.length, ownerContactsSaved: res.owner_contacts_saved });
      // Zoning ran automatically as part of this enrichment too (see
      // app/properties/[id]/zoning-section.tsx) — router.refresh() below
      // picks up the persisted result.
      // Update owner contacts locally so the promote section shows immediately
      if (sunbizPersons.length > 0) {
        setOwnerContacts(sunbizPersons.map((p) => ({ name: p.name, title: p.title ?? "", address: p.address ?? null })));
      } else if (!isEntityOwner && preview.mdpaData.owner_name) {
        setOwnerContacts([{ name: preview.mdpaData.owner_name!, title: "", address: preview.mdpaData.owner_mailing_address ?? null }]);
      }
      router.refresh();
    });
  }

  // ── Sunbiz handlers ─────────────────────────────────────────────────────────

  function handleSunbizLookup() {
    setSunbiz({ tag: "loading" });
    startTransition(async () => {
      const res: SunbizLookupAction = await lookupSunbiz(propertyId);
      if ("error" in res) { setSunbiz({ tag: "error", message: res.error }); return; }
      if (!res.result) {
        setSunbiz({ tag: "error", message: `No entity found on Sunbiz matching "${ownerName}". The name may be abbreviated or registered differently.` });
        return;
      }
      setSunbizPersonSel(new Set(res.result.persons.map((_, i) => i)));
      setSunbiz({ tag: "results", result: res.result, matches_found: res.matches_found });
    });
  }

  function handleSunbizSave() {
    if (sunbiz.tag !== "results") return;
    const result = sunbiz.result;
    const toSave = [...sunbizPersonSel]
      .sort((a, b) => a - b)
      .map((i) => result.persons[i])
      .filter((p): p is SunbizPerson => p != null);
    if (!toSave.length) return;

    setSunbiz({ tag: "saving" });
    startTransition(async () => {
      const res = await saveSunbizOwnerContacts(propertyId, toSave);
      if ("error" in res) { setSunbiz({ tag: "error", message: res.error }); return; }
      setSunbiz({ tag: "saved", count: toSave.length });
      setOwnerContacts(toSave.map((p) => ({ name: p.name, title: p.title ?? "", address: p.address ?? null })));
      router.refresh();
    });
  }

  // ── Owner contact handlers ───────────────────────────────────────────────────

  function handleOwnerCreate() {
    setOwnerContactError(null);
    startTransition(async () => {
      const result = await createOwnerContact(propertyId);
      if (result.error) { setOwnerContactError(result.error); return; }
      setOwnerCreated(true);
      router.refresh();
    });
  }

  function handleSunbizContactCreate(personIndex: number) {
    setCreatingSunbizIdx(personIndex);
    setOwnerContactError(null);
    startTransition(async () => {
      const result = await createContactFromSunbizOwner(propertyId, personIndex);
      setCreatingSunbizIdx(null);
      if (result.error) { setOwnerContactError(result.error); return; }
      setPromotedIndices((prev) => new Set(prev).add(personIndex));
      router.refresh();
    });
  }

  // ── CoStar handlers ──────────────────────────────────────────────────────────

  function handleCoStarParse() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setCostar({ tag: "loading" });
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await parseCoStarFile(fd);
      if ("error" in res) { setCostar({ tag: "error", message: res.error }); return; }
      if (!res.owner.contacts.length) {
        setCostar({ tag: "error", message: "No contacts found. Make sure this is a CoStar owner or tenant export." });
        return;
      }
      setCostarSel(new Set(res.owner.contacts.map((_, i) => i)));
      setCostar({ tag: "results", owner: res.owner });
    });
  }

  function handleCoStarSave() {
    if (costar.tag !== "results") return;
    const owner = costar.owner;
    const toCreate: CoStarContact[] = [...costarSel]
      .sort((a, b) => a - b)
      .map((i) => owner.contacts[i])
      .filter((c): c is CoStarContact => c != null);
    setCostar({ tag: "saving" });
    startTransition(async () => {
      const res = await createCoStarContacts(propertyId, toCreate, owner.company_name, costarBook);
      if ("error" in res) { setCostar({ tag: "error", message: res.error }); return; }
      setCostar({ tag: "saved", count: res.created });
      router.refresh();
    });
  }

  function resetCoStar() {
    setCostar({ tag: "idle" });
    setCostarSel(new Set());
    setFileName(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  // ── Document enhancement handlers ───────────────────────────────────────────

  function handleDocPreview() {
    const fd = new FormData();
    if (docMode === "file") {
      const file = docFileRef.current?.files?.[0];
      if (!file) return;
      fd.append("file", file);
    } else if (docMode === "paste") {
      if (docPasteText.trim().length < 50) return;
      fd.append("text", docPasteText);
    } else {
      if (!docUrl.trim()) return;
      fd.append("url", docUrl.trim());
    }

    setDoc({ tag: "loading" });
    startTransition(async () => {
      const res = await previewDocumentEnhancement(propertyId, fd);
      if ("error" in res) { setDoc({ tag: "error", message: res.error }); return; }
      setDocConflictSel(new Set());
      setDoc({ tag: "previewing", preview: res.preview });
    });
  }

  function handleDocApply(preview: DocumentEnhancementPreview) {
    setDoc({ tag: "saving" });
    startTransition(async () => {
      const res = await applyDocumentEnhancement(
        propertyId,
        preview.extracted,
        [...docConflictSel],
        preview.sourceKind,
        preview.sourceDetail,
      );
      if ("error" in res) { setDoc({ tag: "error", message: res.error }); return; }
      setDoc({ tag: "done", fieldsApplied: res.fieldsApplied, sourceKind: preview.sourceKind });
      router.refresh();
    });
  }

  function resetDoc() {
    setDoc({ tag: "idle" });
    setDocConflictSel(new Set());
    setDocFileName(null);
    setDocPasteText("");
    setDocUrl("");
    if (docFileRef.current) docFileRef.current.value = "";
  }

  function handleListingPreview() {
    setListing({ tag: "loading" });
    startTransition(async () => {
      const res = await previewListingDiscover(propertyId);
      if ("error" in res) { setListing({ tag: "error", message: res.error }); return; }
      setListingSel(new Set(res.preview.candidates.map((c) => c.field)));
      setListing({ tag: "previewing", preview: res.preview });
    });
  }

  useEffect(() => {
    if (!open || listingAutoStarted.current || !address) return;
    if (typeof window === "undefined") return;
    if (window.location.hash.replace(/^#/, "") !== "enrich-listing") return;
    listingAutoStarted.current = true;
    handleListingPreview();
    // Run once when the panel opens from #enrich-listing (industrial CTA).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, address]);

  function handleListingApply(preview: ListingDiscoverPreview) {
    setListing({ tag: "saving" });
    startTransition(async () => {
      const res = await applyListingDiscover(propertyId, [...listingSel], preview);
      if ("error" in res) { setListing({ tag: "error", message: res.error }); return; }
      setListing({
        tag: "done",
        fieldsApplied: res.fieldsApplied,
        fields: preview.candidates
          .filter((c) => listingSel.has(c.field))
          .map((c) => ({ label: c.label, value: c.value })),
        url: preview.url,
      });
      router.refresh();
    });
  }

  function resetListing() {
    setListing({ tag: "idle" });
    setListingSel(new Set());
  }

  // ── Collapsed trigger ────────────────────────────────────────────────────────

  if (!open) {
    const sources = [
      needsCountyEnhancement && "County records",
      isEntityOwner && supportsEntityLookup && "Owner lookup (Sunbiz)",
      "Listing specs",
      costarEnabled && "CoStar export",
    ].filter(Boolean) as string[];

    const done: string[] = [];
    if (!needsCountyEnhancement && hasCountyFolio) done.push("County records ✓");
    if (ownerContacts.length > 0) done.push(`${ownerContacts.length} owner${ownerContacts.length !== 1 ? "s" : ""} saved`);
    if (listing.tag === "done" && listing.fieldsApplied > 0) {
      done.push(`${listing.fieldsApplied} listing spec${listing.fieldsApplied !== 1 ? "s" : ""} filled`);
    }

    return (
      <div ref={panelRef} className="space-y-2">
        {listing.tag === "loading" && (
          <div className="rounded-xl border bg-card px-5 py-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin shrink-0 text-primary" />
            Searching listing pages for industrial specs and custom fields…
          </div>
        )}
        {listing.tag === "done" && listing.fields && listing.fields.length > 0 && (
          <div className="rounded-xl border bg-card px-5 py-3 space-y-1.5">
            <p className="text-xs font-medium text-green-700 dark:text-green-500">
              Filled from listing page
            </p>
            <ul className="space-y-0.5">
              {listing.fields.map((field) => (
                <li key={field.label} className="text-sm">
                  <span className="text-muted-foreground">{field.label}</span>
                  {" "}
                  <span className="font-medium">{field.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="rounded-xl border bg-card px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Enrich property</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {done.length > 0 ? done.join(" · ") : sources.join(" · ")}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="shrink-0">
            Enrich →
          </Button>
        </div>
      </div>
    );
  }

  // ── Open panel ───────────────────────────────────────────────────────────────

  return (
    <div ref={panelRef}>
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="size-4" />
            Enrich property
          </CardTitle>
          <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="size-4" />
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-7">

        {/* ── Step 1: County records ───────────────────────────────────── */}
        <section className="space-y-3">
          <SubHeader icon={MapPin} title="County records" />

          {county.tag === "idle" && (
            needsCountyEnhancement ? (
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  Look up this property on the county property appraiser&apos;s records to fill in owner, sale, and building data.
                </p>
                <Button
                  size="sm" variant="outline" onClick={handleCountyStart}
                  className="shrink-0 border-blue-300 text-blue-700 hover:bg-blue-50"
                >
                  <MapPin className="size-3.5 mr-1.5" /> Run
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  Enriched from county records
                  {countyEnrichedAt && ` · Last enriched ${new Date(countyEnrichedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`}
                </p>
                {existingFolio && address ? (
                  <Button
                    size="sm" variant="outline"
                    onClick={() => startTransition(async () => { await countyDoPreview(existingFolio, address); })}
                    className="shrink-0"
                  >
                    <MapPin className="size-3.5 mr-1.5" /> Re-run
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground shrink-0">Re-run unavailable — no folio on record</span>
                )}
              </div>
            )
          )}

            {(county.tag === "searching" || county.tag === "loading_preview" || county.tag === "saving") && (
              <Spinner label={
                county.tag === "searching" ? "Searching county records…" :
                county.tag === "loading_preview" ? "Fetching county detail, extracting fields, searching Sunbiz…" :
                "Saving county data…"
              } />
            )}

            {county.tag === "error" && (
              <ErrorBox message={county.message} onBack={() => setCounty({ tag: "idle" })} />
            )}

            {county.tag === "pick_folio" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Multiple parcels found. Select the one that matches:</p>
                <div className="space-y-1.5">
                  {county.matches.map((m) => (
                    <button
                      key={m.strap}
                      onClick={() => startTransition(async () => { await countyDoPreview(m.strap, m.address); })}
                      className="w-full text-left flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm hover:bg-muted/40 transition-colors"
                    >
                      <span className="font-medium">{m.address}</span>
                      <span className="font-mono text-xs text-muted-foreground shrink-0">{m.strap}</span>
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setCounty({ tag: "idle" })}>Cancel</Button>
              </div>
            )}

            {county.tag === "previewing" && (() => {
              const { preview } = county;
              const sunbizPersons = preview.sunbiz_result?.persons ?? [];
              return (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{preview.strap}</span>
                    <span>·</span>
                    <span>{preview.siteAddress}</span>
                  </div>

                  {preview.changes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">County data matches all existing values — nothing would change.</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {preview.changes.length} field{preview.changes.length !== 1 ? "s" : ""} will change
                      </p>
                      <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b bg-muted/30">
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-1/4">Field</th>
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[37.5%]">Current</th>
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[37.5%]">
                                County ({COUNTY_SOURCE_LABEL[preview.county]})
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.changes.map((entry, i) => (
                              <tr key={entry.field} className={cn("border-b last:border-0", i % 2 !== 0 && "bg-muted/10")}>
                                <td className="px-3 py-2 text-muted-foreground">{entry.label}</td>
                                <td className="px-3 py-2 text-red-700/80 line-through decoration-red-300/60 italic">
                                  {entry.before ?? <span className="not-italic text-muted-foreground/40">—</span>}
                                </td>
                                <td className="px-3 py-2 font-medium text-green-700">
                                  {entry.after ?? <span className="font-normal text-muted-foreground/40">—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {preview.unchanged.length > 0 && (
                    <button
                      onClick={() => setShowUnchanged((v) => !v)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showUnchanged ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                      {showUnchanged ? "Hide" : "Show"} {preview.unchanged.length} unchanged field{preview.unchanged.length !== 1 ? "s" : ""}
                    </button>
                  )}
                  {showUnchanged && preview.unchanged.length > 0 && (
                    <div className="rounded-lg border overflow-hidden opacity-60">
                      <table className="w-full text-xs">
                        <tbody>
                          {preview.unchanged.map((entry, i) => (
                            <tr key={entry.field} className={cn("border-b last:border-0", i % 2 !== 0 && "bg-muted/10")}>
                              <td className="px-3 py-2 text-muted-foreground w-1/4">{entry.label}</td>
                              <td className="px-3 py-2" colSpan={2}>{entry.before ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {preview.sunbiz_result && sunbizPersons.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                          <Building2 className="size-3.5" />
                          Sunbiz — {preview.sunbiz_result.entity_name}
                        </p>
                        <a
                          href={preview.sunbiz_result.source_url}
                          target="_blank" rel="noopener noreferrer"
                          className="text-xs text-primary underline underline-offset-2 flex items-center gap-0.5"
                        >
                          View ↗ <ExternalLink className="size-3" />
                        </a>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Select persons to save — no CRM contacts created until you promote them below
                      </p>
                      <div className="space-y-1.5">
                        {sunbizPersons.map((person, i) => (
                          <label
                            key={i}
                            className={cn(
                              "flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors",
                              countyPersonSel.has(i) ? "border-primary/40 bg-primary/5" : "hover:bg-muted/30",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => setCountyPersonSel((prev) => {
                                const next = new Set(prev);
                                next.has(i) ? next.delete(i) : next.add(i);
                                return next;
                              })}
                              className="shrink-0 mt-0.5 text-primary"
                            >
                              {countyPersonSel.has(i) ? <CheckSquare className="size-4" /> : <Square className="size-4 text-muted-foreground" />}
                            </button>
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{person.name}</p>
                              <p className="text-xs text-muted-foreground">{person.title}</p>
                              {person.address && <p className="text-xs text-muted-foreground mt-0.5">{person.address}</p>}
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {preview.sunbiz_error && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                      <AlertTriangle className="size-3.5 text-yellow-500 shrink-0" />
                      Sunbiz: {preview.sunbiz_error}
                      {preview.mdpaData.owner_name && (
                        <a
                          href={manualSunbizSearchUrl(preview.mdpaData.owner_name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline underline-offset-2 hover:text-primary/80 inline-flex items-center gap-0.5"
                        >
                          Search Sunbiz yourself <ExternalLink className="size-3" />
                        </a>
                      )}
                    </p>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => handleCountyApply(preview)}
                      disabled={preview.changes.length === 0 && countyPersonSel.size === 0}
                    >
                      <ArrowRight className="size-3.5 mr-1.5" />
                      {preview.changes.length === 0 && countyPersonSel.size === 0
                        ? "Nothing to apply"
                        : [
                            preview.changes.length > 0 && `Apply ${preview.changes.length} field${preview.changes.length !== 1 ? "s" : ""}`,
                            countyPersonSel.size > 0 && `save ${countyPersonSel.size} Sunbiz owner${countyPersonSel.size !== 1 ? "s" : ""}`,
                          ].filter(Boolean).join(" · ")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCounty({ tag: "idle" })}>Cancel</Button>
                  </div>
                </div>
              );
            })()}

            {county.tag === "done" && (
              <div className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-green-600" />
                <div>
                  <span className="text-green-700">
                    {county.changesCount === 0
                      ? "County records matched existing values — no changes made."
                      : `Enriched from county records — ${county.changesCount} field${county.changesCount !== 1 ? "s" : ""} updated.`}
                  </span>
                  {county.ownerContactsSaved > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {county.ownerContactsSaved} Sunbiz {county.ownerContactsSaved === 1 ? "person" : "persons"} saved — promote below.
                    </p>
                  )}
                </div>
              </div>
            )}
        </section>

        {/* ── Step 2: Owner lookup (Sunbiz) ────────────────────────────── */}
        <section className="space-y-3">
            <SubHeader icon={Building2} title="Owner lookup (Sunbiz)" />

            {/* Persons already on file */}
            {ownerContacts.length > 0 && sunbiz.tag !== "results" && sunbiz.tag !== "saving" && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Persons on file:</p>
                {ownerContacts.map((oc, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{oc.name}</p>
                      {oc.title && <p className="text-xs text-muted-foreground">{oc.title}</p>}
                      {oc.address && <p className="text-xs text-muted-foreground mt-0.5 truncate">{oc.address}</p>}
                    </div>
                    <OwnerPortfolioLink
                      propertyId={propertyId}
                      personIndex={i}
                      label="Portfolio →"
                      className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-md border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
                    />
                  </div>
                ))}
              </div>
            )}

            {sunbiz.tag === "idle" && (
              !ownerName ? (
                <p className="text-sm text-muted-foreground">Run county records above to discover the owner first.</p>
              ) : !isEntityOwner ? (
                <p className="text-sm text-muted-foreground">
                  Not applicable — {ownerName} doesn&apos;t look like a registered entity, so there&apos;s nothing to look up on Sunbiz.
                </p>
              ) : !supportsEntityLookup ? (
                <p className="text-sm text-muted-foreground">
                  Not available yet — Sunbiz only covers Florida-registered entities, and this property is sourced from Massachusetts (MassGIS).
                </p>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm text-muted-foreground">
                    {ownerContacts.length > 0
                      ? `Re-run Sunbiz lookup for ${ownerName}.`
                      : `Look up "${ownerName}" in Florida public records.`}
                  </p>
                  <Button size="sm" variant="outline" onClick={handleSunbizLookup} className="shrink-0 flex items-center gap-1.5">
                    <Search className="size-3.5" /> Look up
                  </Button>
                </div>
              )
            )}

            {sunbiz.tag === "loading" && <Spinner label="Searching Sunbiz and extracting persons…" />}

            {sunbiz.tag === "error" && (
              <ErrorBox
                message={sunbiz.message}
                onBack={() => setSunbiz({ tag: "idle" })}
                backLabel="Try again"
                extra={ownerName && (
                  <a
                    href={manualSunbizSearchUrl(ownerName)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-xs font-medium underline underline-offset-2 hover:text-destructive/80"
                  >
                    Search Sunbiz yourself <ExternalLink className="size-3" />
                  </a>
                )}
              />
            )}

            {(sunbiz.tag === "results" || sunbiz.tag === "saving") && (
              <div className="space-y-4">
                {sunbiz.tag === "results" && (
                  <>
                    <div className="flex items-start gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold">{sunbiz.result.entity_name}</p>
                          <span className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                            SUNBIZ_STATUS_CLS[sunbiz.result.status] ?? "bg-muted text-muted-foreground",
                          )}>
                            {sunbiz.result.status}
                          </span>
                        </div>
                      </div>
                      <a
                        href={sunbiz.result.source_url}
                        target="_blank" rel="noopener noreferrer"
                        className="shrink-0 flex items-center gap-1 text-xs text-primary underline underline-offset-2"
                      >
                        View on Sunbiz <ExternalLink className="size-3" />
                      </a>
                    </div>

                    {sunbiz.result.persons.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          Select persons to save — no CRM contacts created until you promote them
                        </p>
                        <div className="space-y-1.5">
                          {sunbiz.result.persons.map((person, i) => (
                            <label
                              key={i}
                              className={cn(
                                "flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors",
                                sunbizPersonSel.has(i) ? "border-primary/40 bg-primary/5" : "hover:bg-muted/30",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => setSunbizPersonSel((prev) => {
                                  const next = new Set(prev);
                                  next.has(i) ? next.delete(i) : next.add(i);
                                  return next;
                                })}
                                className="shrink-0 mt-0.5 text-primary"
                              >
                                {sunbizPersonSel.has(i) ? <CheckSquare className="size-4" /> : <Square className="size-4 text-muted-foreground" />}
                              </button>
                              <div className="min-w-0">
                                <p className="text-sm font-medium">{person.name}</p>
                                <p className="text-xs text-muted-foreground">{person.title}</p>
                                {person.address && <p className="text-xs text-muted-foreground mt-0.5">{person.address}</p>}
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <Button size="sm" onClick={handleSunbizSave} disabled={sunbizPersonSel.size === 0}>
                        Save {sunbizPersonSel.size > 0 ? sunbizPersonSel.size : ""} to property
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSunbiz({ tag: "idle" })}>Cancel</Button>
                    </div>
                  </>
                )}
                {sunbiz.tag === "saving" && <Spinner label="Saving to property…" />}
              </div>
            )}

            {sunbiz.tag === "saved" && (
              <div className="space-y-1">
                <p className="text-sm flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-green-600 shrink-0" />
                  {sunbiz.count} {sunbiz.count === 1 ? "person" : "persons"} saved to the property row — promote below.
                </p>
                <button
                  onClick={() => { setSunbiz({ tag: "idle" }); setSunbizPersonSel(new Set()); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Look up again
                </button>
              </div>
            )}
        </section>

        {/* ── Step 3: Promote owner contacts to CRM ───────────────────── */}
        <section className="space-y-3">
          <SubHeader icon={UserPlus} title="Owner contacts" />

          {/* Individual (non-entity) county owner */}
          {hasCountyFolio && ownerName && !isEntityOwner && !ownerCreated && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Owner from county records</p>
                <p className="text-sm font-medium mt-0.5 truncate">{ownerName}</p>
              </div>
              <button
                onClick={handleOwnerCreate}
                className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <UserPlus className="size-3.5" /> Create contact
              </button>
            </div>
          )}
          {hasCountyFolio && ownerName && !isEntityOwner && ownerCreated && (
            <p className="text-xs text-muted-foreground italic">
              Owner contact created — tagged <span className="font-mono">mdpa_mailing</span> and <span className="font-mono">unverified</span>.
            </p>
          )}

          {/* Entity owner — promote each Sunbiz person */}
          {isEntityOwner && ownerContacts.length > 0 && (
            <div className="space-y-1.5">
              {ownerContacts.map((oc, i) => {
                const isPromoted = promotedIndices.has(i);
                return (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Sunbiz owner{ownerContacts.length > 1 ? ` ${i + 1}` : ""}
                      </p>
                      <p className="text-sm font-medium mt-0.5 truncate">{oc.name}</p>
                      {(oc.title || oc.address) && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {[oc.title, oc.address].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      <OwnerPortfolioLink
                        propertyId={propertyId}
                        personIndex={i}
                        label="Portfolio →"
                        className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-md border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
                      />
                      {isPromoted ? (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <CheckCircle2 className="size-3.5" /> In CRM
                        </span>
                      ) : (
                        <button
                          onClick={() => handleSunbizContactCreate(i)}
                          disabled={creatingSunbizIdx === i}
                          className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          {creatingSunbizIdx === i
                            ? <><Loader2 className="size-3.5 animate-spin" />Creating…</>
                            : <><UserPlus className="size-3.5" />Create contact</>}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {ownerContactError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="size-3 shrink-0" /> {ownerContactError}
            </p>
          )}

          {!hasCountyFolio && !isEntityOwner && ownerContacts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {needsCountyEnhancement
                ? "Run county data above to discover the owner."
                : "No owner contacts found. Upload a CoStar file below or add a contact manually."}
            </p>
          )}
          {isEntityOwner && ownerContacts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {!supportsEntityLookup
                ? "Entity/owner lookup isn't available for Massachusetts yet — Sunbiz only covers Florida-registered entities."
                : needsCountyEnhancement
                ? "Run county data above — it will auto-search Sunbiz for entity owners."
                : "Run the Sunbiz lookup above to find registered agents and authorized persons."}
            </p>
          )}
        </section>

        {/* ── Listing specs (search public pages, fill empty only) ──────── */}
        <section id="enrich-listing" className="space-y-3">
          <SubHeader icon={Search} title="Listing specs" />

          {listing.tag === "idle" && (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Search public listing pages for empty industrial specs and extract custom fields.
                County and broker-entered values stay locked.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleListingPreview}
                disabled={!address}
                className="shrink-0"
              >
                <Search className="size-3.5 mr-1.5" />
                Find listing specs
              </Button>
            </div>
          )}

          {listing.tag === "loading" && <Spinner label="Searching public listing pages…" />}
          {listing.tag === "saving" && <Spinner label="Saving empty fields…" />}

          {listing.tag === "error" && (
            <ErrorBox message={listing.message} onBack={resetListing} backLabel="Try again" />
          )}

          {listing.tag === "previewing" && (() => {
            const { preview } = listing;
            return (
              <div className="space-y-3">
                {preview.url && (
                  <p className="text-xs text-muted-foreground truncate">
                    Matched{" "}
                    <a href={preview.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      {preview.url}
                    </a>
                  </p>
                )}
                {preview.note && (
                  <p className="text-sm text-muted-foreground">{preview.note}</p>
                )}
                {preview.candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing new to fill. Empty stays empty unless a cited page states the spec.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {preview.candidates.length} empty field{preview.candidates.length !== 1 ? "s" : ""} with a citation — not saved yet
                    </p>
                    {preview.candidates.map((entry) => (
                      <label
                        key={entry.field}
                        className={cn(
                          "flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors",
                          listingSel.has(entry.field) ? "border-primary/40 bg-primary/5" : "hover:bg-muted/30",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setListingSel((prev) => {
                            const next = new Set(prev);
                            next.has(entry.field) ? next.delete(entry.field) : next.add(entry.field);
                            return next;
                          })}
                          className="shrink-0 mt-0.5 text-primary"
                        >
                          {listingSel.has(entry.field) ? <CheckSquare className="size-4" /> : <Square className="size-4 text-muted-foreground" />}
                        </button>
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="font-medium">
                            {entry.label}{" "}
                            <span className="text-green-700">{entry.value}</span>
                          </p>
                          <p className="text-xs text-muted-foreground italic mt-0.5">
                            “{entry.citation.excerpt}”
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => handleListingApply(preview)}
                    disabled={listingSel.size === 0}
                  >
                    <ArrowRight className="size-3.5 mr-1.5" />
                    {listingSel.size === 0
                      ? "Nothing to apply"
                      : `Fill ${listingSel.size} empty field${listingSel.size !== 1 ? "s" : ""}`}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={resetListing}>Cancel</Button>
                </div>
              </div>
            );
          })()}

          {listing.tag === "done" && (
            <div className="space-y-2">
              <p className="text-sm flex items-center gap-2">
                <CheckCircle2 className="size-4 text-green-600 shrink-0" />
                Filled {listing.fieldsApplied} empty spec{listing.fieldsApplied !== 1 ? "s" : ""} from a cited listing page.
              </p>
              {listing.fields && listing.fields.length > 0 && (
                <ul className="space-y-0.5 pl-6">
                  {listing.fields.map((field) => (
                    <li key={field.label} className="text-sm">
                      <span className="text-muted-foreground">{field.label}</span>
                      {" "}
                      <span className="font-medium text-green-700 dark:text-green-500">{field.value}</span>
                    </li>
                  ))}
                </ul>
              )}
              {listing.url && (
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noreferrer"
                  className="pl-6 text-xs text-primary underline underline-offset-2"
                >
                  Listing page
                </a>
              )}
              <button
                onClick={resetListing}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                Search again
              </button>
            </div>
          )}
        </section>

        {/* ── Document or URL (collapsible) ─────────────────────────────── */}
        <section>
          <button
            onClick={() => setDocOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
          >
            {docOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            <FileText className="size-3.5" />
            Document or URL
          </button>

          {docOpen && (
            <div className="mt-3 space-y-3">
              {doc.tag === "idle" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Upload a flyer or OM, paste listing text, or enter a listing URL to fill in
                    property fields and custom fields (e.g. clear height, dock doors) that county
                    records don&apos;t have.
                  </p>

                  <div className="flex gap-1.5">
                    {(["file", "paste", "url"] as DocMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setDocMode(m)}
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                          docMode === m ? "border-primary/40 bg-primary/5 text-foreground" : "text-muted-foreground hover:bg-muted/40",
                        )}
                      >
                        {m === "file" ? "Upload file" : m === "paste" ? "Paste text" : "Listing URL"}
                      </button>
                    ))}
                  </div>

                  {docMode === "file" && (
                    <div className="flex items-center gap-3">
                      <label className="flex-1 cursor-pointer">
                        <input
                          ref={docFileRef}
                          type="file"
                          accept={DOC_ACCEPTED}
                          className="sr-only"
                          onChange={(e) => setDocFileName(e.target.files?.[0]?.name ?? null)}
                        />
                        <div className={cn(
                          "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/40",
                          docFileName ? "border-primary/40 bg-primary/5 text-foreground" : "border-dashed text-muted-foreground",
                        )}>
                          <Upload className="size-3.5 shrink-0" />
                          <span className="truncate">{docFileName ?? "Choose file…"}</span>
                        </div>
                      </label>
                      <Button size="sm" onClick={handleDocPreview} disabled={!docFileName} className="shrink-0">Preview</Button>
                    </div>
                  )}

                  {docMode === "paste" && (
                    <div className="space-y-2">
                      <textarea
                        value={docPasteText}
                        onChange={(e) => setDocPasteText(e.target.value)}
                        rows={5}
                        placeholder="Paste listing text, flyer copy, or OM excerpt…"
                        className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background"
                      />
                      <Button size="sm" onClick={handleDocPreview} disabled={docPasteText.trim().length < 50}>Preview</Button>
                    </div>
                  )}

                  {docMode === "url" && (
                    <div className="flex items-center gap-2">
                      <input
                        value={docUrl}
                        onChange={(e) => setDocUrl(e.target.value)}
                        placeholder="https://…"
                        className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background"
                      />
                      <Button size="sm" onClick={handleDocPreview} disabled={!docUrl.trim()} className="shrink-0">Preview</Button>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">PDF · JPG · PNG · WebP · TXT — max 10 MB</p>
                </>
              )}

              {doc.tag === "loading" && <Spinner label="Extracting fields…" />}

              {doc.tag === "error" && (
                <ErrorBox message={doc.message} onBack={resetDoc} backLabel="Try again" />
              )}

              {doc.tag === "previewing" && (() => {
                const { preview } = doc;
                const sourceLabel = preview.sourceKind === "document" ? "Document" : preview.sourceKind === "url" ? "Listing URL" : "Pasted text";
                return (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium">{sourceLabel}</span>
                      {preview.sourceDetail && (
                        <>
                          <span>·</span>
                          <span className="truncate">{preview.sourceDetail}</span>
                        </>
                      )}
                    </div>

                    {preview.changes.length === 0 && preview.conflicts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nothing new found in this source — no changes.</p>
                    ) : (
                      <>
                        {preview.changes.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              {preview.changes.length} field{preview.changes.length !== 1 ? "s" : ""} will fill or update
                            </p>
                            <div className="rounded-lg border overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b bg-muted/30">
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-1/4">Field</th>
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[37.5%]">Current</th>
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[37.5%]">{sourceLabel}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {preview.changes.map((entry: DocumentDiffEntry, i: number) => (
                                    <tr key={entry.field} className={cn("border-b last:border-0", i % 2 !== 0 && "bg-muted/10")}>
                                      <td className="px-3 py-2 text-muted-foreground">{entry.label}</td>
                                      <td className="px-3 py-2 text-red-700/80 line-through decoration-red-300/60 italic">
                                        {entry.before ?? <span className="not-italic text-muted-foreground/40">—</span>}
                                      </td>
                                      <td className="px-3 py-2 font-medium text-green-700">
                                        {entry.after ?? <span className="font-normal text-muted-foreground/40">—</span>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {preview.conflicts.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400 uppercase tracking-wide flex items-center gap-1.5">
                              <AlertTriangle className="size-3.5" />
                              {preview.conflicts.length} conflict{preview.conflicts.length !== 1 ? "s" : ""} — existing data differs
                            </p>
                            <p className="text-xs text-muted-foreground">
                              These fields already have a value on record (owner, sale date/price, or
                              building/land SF). Check any you want this source to overwrite — nothing
                              here is applied unless you select it.
                            </p>
                            <div className="space-y-1.5">
                              {preview.conflicts.map((entry: DocumentDiffEntry) => (
                                <label
                                  key={entry.field}
                                  className={cn(
                                    "flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors",
                                    docConflictSel.has(entry.field) ? "border-primary/40 bg-primary/5" : "hover:bg-muted/30",
                                  )}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setDocConflictSel((prev) => {
                                      const next = new Set(prev);
                                      next.has(entry.field) ? next.delete(entry.field) : next.add(entry.field);
                                      return next;
                                    })}
                                    className="shrink-0 mt-0.5 text-primary"
                                  >
                                    {docConflictSel.has(entry.field) ? <CheckSquare className="size-4" /> : <Square className="size-4 text-muted-foreground" />}
                                  </button>
                                  <div className="min-w-0 flex-1 text-sm">
                                    <p className="font-medium">{entry.label}</p>
                                    <p className="text-xs text-muted-foreground">
                                      <span className="line-through decoration-red-300/60">{entry.before}</span>
                                      {" → "}
                                      <span className="text-green-700 font-medium">{entry.after}</span>
                                    </p>
                                  </div>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => handleDocApply(preview)}
                        disabled={preview.changes.length === 0 && docConflictSel.size === 0}
                      >
                        <ArrowRight className="size-3.5 mr-1.5" />
                        {preview.changes.length === 0 && docConflictSel.size === 0
                          ? "Nothing to apply"
                          : `Apply ${preview.changes.length + docConflictSel.size} field${(preview.changes.length + docConflictSel.size) !== 1 ? "s" : ""}`}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={resetDoc}>Cancel</Button>
                    </div>
                  </div>
                );
              })()}

              {doc.tag === "saving" && <Spinner label="Saving…" />}

              {doc.tag === "done" && (
                <div className="space-y-1">
                  <p className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-green-600 shrink-0" />
                    {doc.fieldsApplied === 0
                      ? "No changes made."
                      : `Enriched from ${docSourceNoun(doc.sourceKind)} — ${doc.fieldsApplied} field${doc.fieldsApplied !== 1 ? "s" : ""} updated.`}
                  </p>
                  <button
                    onClick={resetDoc}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    Enrich from another source
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── CoStar export (collapsible) ───────────────────────────────── */}
        <section>
          <button
            onClick={() => costarEnabled && setCostarOpen((v) => !v)}
            disabled={!costarEnabled}
            className={cn(
              "flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
              costarEnabled ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/50 cursor-default",
            )}
          >
            {costarOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            <FileText className="size-3.5" />
            CoStar export
            {!costarEnabled && <span className="normal-case font-normal">(disabled)</span>}
          </button>

          {!costarEnabled && (
            <p className="mt-2 text-sm text-muted-foreground">
              CoStar export is disabled for your account.{" "}
              <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
                Enable it in Settings →
              </Link>
            </p>
          )}

          {costarEnabled && costarOpen && (
            <div className="mt-3 space-y-3">
              {costar.tag === "idle" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Upload a CoStar owner or tenant export to add contacts to this property.
                    Beacon only uses what&apos;s in the file — no CoStar login.
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-xs text-muted-foreground">Book</span>
                    <select
                      value={costarBook}
                      onChange={(e) => setCostarBook(e.target.value as "owner" | "tenant")}
                      className="border border-border rounded-md px-2 py-1 text-sm bg-background"
                    >
                      <option value="owner">Owners</option>
                      <option value="tenant">Tenants</option>
                    </select>
                  </label>
                  <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-0.5">
                    <li>In CoStar, open the property record.</li>
                    <li>Export About the Owner or a tenant roster (PDF, CSV, or screenshot).</li>
                    <li>Upload that file here and click Parse.</li>
                  </ol>
                  <p className="text-xs text-muted-foreground">
                    To create a new property from a CoStar export, use{" "}
                    <a href="/properties/new?method=upload" className="underline underline-offset-2 hover:text-foreground">
                      Add property → Upload file
                    </a>
                    {" "}instead.
                  </p>
                  <div className="flex items-center gap-3">
                    <label className="flex-1 cursor-pointer">
                      <input
                        ref={fileRef}
                        type="file"
                        accept={COSTAR_ACCEPTED}
                        className="sr-only"
                        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
                      />
                      <div className={cn(
                        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/40",
                        fileName ? "border-primary/40 bg-primary/5 text-foreground" : "border-dashed text-muted-foreground",
                      )}>
                        <Upload className="size-3.5 shrink-0" />
                        <span className="truncate">{fileName ?? "Choose file…"}</span>
                      </div>
                    </label>
                    <Button size="sm" onClick={handleCoStarParse} disabled={!fileName} className="shrink-0">Parse</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">PDF · JPG · PNG · WebP · CSV · TXT — max 10 MB</p>
                </>
              )}

              {costar.tag === "loading" && <Spinner label="Parsing file and extracting owner contacts…" />}

              {costar.tag === "error" && (
                <ErrorBox message={costar.message} onBack={resetCoStar} backLabel="Try again" />
              )}

              {(costar.tag === "results" || costar.tag === "saving") && (
                <div className="space-y-4">
                  {costar.tag === "results" && (
                    <>
                      {(costar.owner.company_name || costar.owner.website || costar.owner.hq_address) && (
                        <div className="rounded-lg bg-muted/30 border px-3 py-2.5 space-y-1.5">
                          {costar.owner.company_name && (
                            <div className="flex items-center gap-2">
                              <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                              <span className="text-sm font-medium">{costar.owner.company_name}</span>
                            </div>
                          )}
                          {costar.owner.hq_address && (
                            <div className="flex items-center gap-2">
                              <MapPin className="size-3.5 text-muted-foreground shrink-0" />
                              <span className="text-xs text-muted-foreground">{costar.owner.hq_address}</span>
                            </div>
                          )}
                          {costar.owner.website && (
                            <div className="flex items-center gap-2">
                              <Globe className="size-3.5 text-muted-foreground shrink-0" />
                              <span className="text-xs text-muted-foreground">{costar.owner.website}</span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          Select contacts to create — tagged{" "}
                          <span className="font-mono normal-case">costar</span> and{" "}
                          <span className="font-mono normal-case">unverified</span>
                        </p>
                        <div className="space-y-1.5">
                          {costar.owner.contacts.map((contact, i) => (
                            <label
                              key={i}
                              className={cn(
                                "flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors",
                                costarSel.has(i) ? "border-primary/40 bg-primary/5" : "hover:bg-muted/30",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => setCostarSel((prev) => {
                                  const next = new Set(prev);
                                  next.has(i) ? next.delete(i) : next.add(i);
                                  return next;
                                })}
                                className="shrink-0 mt-0.5 text-primary"
                              >
                                {costarSel.has(i) ? <CheckSquare className="size-4" /> : <Square className="size-4 text-muted-foreground" />}
                              </button>
                              <div className="min-w-0 space-y-0.5">
                                <p className="text-sm font-medium">{contact.name}</p>
                                {contact.title && <p className="text-xs text-muted-foreground">{contact.title}</p>}
                                {contact.email && <p className="text-xs text-muted-foreground">{contact.email}</p>}
                                {contact.phone && <p className="text-xs text-muted-foreground">{contact.phone}</p>}
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="flex gap-2 pt-1">
                        <Button size="sm" onClick={handleCoStarSave} disabled={costarSel.size === 0}>
                          Create {costarSel.size > 0 ? costarSel.size : ""}{" "}
                          {costarSel.size === 1 ? "contact" : "contacts"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={resetCoStar}>Cancel</Button>
                        <span className="ml-auto flex items-center text-xs text-muted-foreground">
                          Source: CoStar · no data invented
                        </span>
                      </div>
                    </>
                  )}
                  {costar.tag === "saving" && <Spinner label="Creating contacts…" />}
                </div>
              )}

              {costar.tag === "saved" && (
                <div className="space-y-2">
                  <p className="text-sm text-foreground flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-green-600 shrink-0" />
                    {costar.count === 0
                      ? "No contacts were created."
                      : `${costar.count} ${costar.count === 1 ? "contact" : "contacts"} created, tagged costar and unverified. Verify before outreach.`}
                  </p>
                  <button
                    onClick={resetCoStar}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    Upload another file
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

      </CardContent>
    </Card>
    </div>
  );
}
