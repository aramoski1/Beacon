"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, Zap, FlaskConical, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  generateDrafts,
  logOutreach,
  getContactsByIds,
  getAllContactsForOutreach,
  type DueContact,
  type EmailDraft,
  type OutreachTemplate,
} from "./actions";
import { composeUrl, isWebCompose, type EmailProviderSetting } from "@/lib/email-provider";
import {
  OUTREACH_CHUNK_SIZE,
  planOutreachBatches,
} from "@/lib/outreach-chunks";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "Never contacted";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function tierCls(tier: number | null) {
  if (tier === 1) return "bg-orange-100 text-orange-700";
  if (tier === 2) return "bg-blue-100 text-blue-700";
  return "bg-muted text-muted-foreground";
}

function tierLabel(tier: number | null) {
  if (tier === 1) return "T1";
  if (tier === 2) return "T2";
  if (tier === 3) return "T3";
  return "—";
}

// ─── Template definitions ─────────────────────────────────────────────────────

const TEMPLATES: { id: OutreachTemplate; label: string; description: string }[] = [
  { id: "intro",          label: "Intro",          description: "First-touch introduction — present yourself and your focus area." },
  { id: "check-in",       label: "Check-in",       description: "Warm follow-up referencing your history and their specific property." },
  { id: "market-update",  label: "Market update",  description: "Share a concrete insight tied to their property type or geography." },
  { id: "listing-alert",  label: "Listing alert",  description: "Flag a relevant opportunity or transaction trend for their portfolio." },
];

type ListMode = "due" | "all" | "selection";

const CHUNK_SIZE = OUTREACH_CHUNK_SIZE;

// ─── Main component ───────────────────────────────────────────────────────────

export default function OutreachView({
  initialContacts,
  userEmail,
  emailProvider = null,
  senderName = null,
}: {
  initialContacts: DueContact[];
  userEmail: string | null;
  emailProvider?: string | null;
  senderName?: string | null;
}) {
  const [listMode, setListMode] = useState<ListMode>("due");
  const [dueContactsCache] = useState<DueContact[]>(initialContacts);
  const [allContactsCache, setAllContactsCache] = useState<DueContact[] | null>(null);
  const [contacts, setContacts] = useState<DueContact[]>(initialContacts);
  const [loadingList, setLoadingList] = useState(false);
  const [step, setStep] = useState<"select" | "review">("select");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brokerContext, setBrokerContext] = useState("");

  // Draft edits
  const [editedSubjects, setEditedSubjects] = useState<Record<string, string>>({});
  const [editedBodies, setEditedBodies] = useState<Record<string, string>>({});

  const [template, setTemplate] = useState<OutreachTemplate>("check-in");

  // Chunked batch: when >10 selected, generate/review in batches of 10
  const [batchQueue, setBatchQueue] = useState<string[][]>([]);
  const [batchIndex, setBatchIndex] = useState(0);

  // ── Safety gates ───────────────────────────────────────────────────────────
  const [testMode, setTestMode] = useState(false);
  const [confirmingMarkAll, setConfirmingMarkAll] = useState(false);

  // Load broker context from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("beacon_broker_context");
    if (saved) setBrokerContext(saved);
  }, []);

  // Smart-list / CRM multi-select / deep-link pre-selection (no cadence filter)
  useEffect(() => {
    const raw = sessionStorage.getItem("beacon_outreach_selection");
    const urlContact = new URLSearchParams(window.location.search).get("contact");
    let ids: string[] = [];
    if (raw) {
      sessionStorage.removeItem("beacon_outreach_selection");
      try {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) ids = parsed;
      } catch { /* ignore */ }
    }
    if (urlContact && !ids.includes(urlContact)) ids = [urlContact, ...ids];
    if (ids.length === 0) return;
    setLoadingList(true);
    getContactsByIds(ids).then((segmentContacts) => {
      setLoadingList(false);
      if (segmentContacts.length === 0) return;
      setListMode("selection");
      setContacts(segmentContacts);
      setSelected(new Set(segmentContacts.map((c) => c.id)));
    });
  }, []);

  function saveBrokerContext(val: string) {
    setBrokerContext(val);
    localStorage.setItem("beacon_broker_context", val);
  }

  async function switchMode(mode: "due" | "all") {
    if (listMode === mode) return;
    setError(null);
    setSelected(new Set());
    if (mode === "due") {
      setListMode("due");
      setContacts(dueContactsCache);
      return;
    }
    setListMode("all");
    if (allContactsCache) {
      setContacts(allContactsCache);
      return;
    }
    setLoadingList(true);
    const all = await getAllContactsForOutreach();
    setLoadingList(false);
    setAllContactsCache(all);
    setContacts(all);
  }

  const overdueInList = contacts.filter((c) => c.daysOverdue > 0);
  const tier1Contacts   = contacts.filter((c) => c.contact_tier === 1);
  const tier2Contacts   = contacts.filter((c) => c.contact_tier === 2);
  const tier3Contacts   = contacts.filter((c) => c.contact_tier === 3 || c.contact_tier === null);

  function toggleContact(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected(new Set(contacts.map((c) => c.id)));
  }

  function selectAllOverdue() {
    setSelected(new Set(overdueInList.map((c) => c.id)));
  }

  async function generateForIds(ids: string[]) {
    setGenerating(true);
    setError(null);
    setStep("review");

    const result = await generateDrafts(ids, brokerContext, template);
    setGenerating(false);

    if (result.error) {
      setError(result.error);
      setStep("select");
      return;
    }

    const generatedDrafts = result.drafts ?? [];
    setDrafts(generatedDrafts);

    const subjects: Record<string, string> = {};
    const bodies: Record<string, string> = {};
    for (const d of generatedDrafts) {
      subjects[d.contactId] = d.subject;
      bodies[d.contactId] = d.body;
    }
    setEditedSubjects(subjects);
    setEditedBodies(bodies);
    setSentIds(new Set());
    setConfirmingMarkAll(false);
    setTestMode(false);
  }

  async function handleGenerate() {
    if (selected.size === 0) return;
    const plan = planOutreachBatches([...selected], CHUNK_SIZE);
    setBatchQueue(plan.chunks);
    setBatchIndex(0);
    await generateForIds(plan.chunks[0] ?? []);
  }

  async function handleNextBatch() {
    const next = batchIndex + 1;
    if (next >= batchQueue.length) return;
    setBatchIndex(next);
    await generateForIds(batchQueue[next] ?? []);
  }

  // Logs outreach in the DB — does NOT send email.
  async function handleMarkSent(contactId: string) {
    const subject = editedSubjects[contactId] ?? "";
    const body = editedBodies[contactId] ?? "";
    const result = await logOutreach(contactId, subject, body);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSentIds((prev) => new Set([...prev, contactId]));
    setContacts((prev) =>
      prev.map((c) =>
        c.id === contactId
          ? { ...c, last_contacted_at: new Date().toISOString(), daysOverdue: -99 }
          : c
      )
    );
  }

  // Requires confirmation before running. Called after the confirmation panel is accepted.
  async function handleMarkAllSentConfirmed() {
    setConfirmingMarkAll(false);
    for (const draft of drafts) {
      if (!sentIds.has(draft.contactId)) {
        await handleMarkSent(draft.contactId);
      }
    }
  }

  // Drafts that haven't been marked sent yet
  const pendingDrafts = drafts.filter((d) => !sentIds.has(d.contactId));

  // ── Select view ───────────────────────────────────────────────────────────

  if (step === "select") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 sm:px-6 sm:py-8 space-y-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {listMode === "selection" ? "Selected contacts" : "Outreach"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {listMode === "due" && (
              <>
                Contacts due by cadence.
                {overdueInList.length > 0 && (
                  <span className="text-destructive font-medium"> {overdueInList.length} overdue.</span>
                )}
                {" "}Each draft becomes a separate email — never a group send.
              </>
            )}
            {listMode === "all" && (
              <>All contacts. Pick anyone, anytime. Each person gets their own separate email.</>
            )}
            {listMode === "selection" && (
              <>
                {contacts.length} contact{contacts.length !== 1 ? "s" : ""} from CRM.
                {" "}Each draft is a separate personalized email.
              </>
            )}
          </p>
        </div>

        {listMode !== "selection" && (
          <div className="flex gap-1 border border-border rounded-lg p-1 w-fit">
            <button
              type="button"
              onClick={() => switchMode("due")}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                listMode === "due"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Due now
            </button>
            <button
              type="button"
              onClick={() => switchMode("all")}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                listMode === "all"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              All contacts
            </button>
          </div>
        )}

        {listMode === "selection" && (
          <button
            type="button"
            onClick={() => switchMode("due")}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Clear selection — show due contacts
          </button>
        )}

        {!senderName && (
          <div className="rounded-lg border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex items-start gap-2">
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Add your name in{" "}
              <a href="/settings" className="font-medium underline underline-offset-2 hover:text-amber-900">
                Settings → Outreach
              </a>{" "}
              so drafts include your real signature instead of a placeholder.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium">About you</label>
          <textarea
            value={brokerContext}
            onChange={(e) => saveBrokerContext(e.target.value)}
            rows={3}
            placeholder="e.g. I'm [name], a commercial broker in Miami specializing in industrial properties over 50,000 sqft…"
            className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background resize-y placeholder:text-muted-foreground/60"
          />
          <p className="text-xs text-muted-foreground">
            Claude will use this to personalize each draft.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Email type</label>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTemplate(t.id)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm border transition-colors",
                  template === t.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {TEMPLATES.find((t) => t.id === template)?.description}
          </p>
        </div>

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {loadingList ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading contacts…
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            {listMode === "due" ? (
              <>
                <CheckCircle2 className="size-10 text-green-500" />
                <p className="font-medium">All caught up on cadence.</p>
                <p className="text-sm text-muted-foreground">
                  Switch to{" "}
                  <button type="button" onClick={() => switchMode("all")} className="underline underline-offset-2 hover:text-foreground">
                    All contacts
                  </button>{" "}
                  to email anyone anytime, or pick contacts in the{" "}
                  <a href="/crm?tab=contacts" className="underline underline-offset-2 hover:text-foreground">Contacts tab</a>.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">No contacts yet</p>
                <p className="text-sm text-muted-foreground">
                  <a href="/contacts/new" className="underline underline-offset-2 hover:text-foreground">Add a contact</a>
                  {" "}or import from onboarding.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={selectAllVisible}
                className="text-xs text-primary hover:underline underline-offset-2"
              >
                Select all ({contacts.length})
              </button>
              {listMode === "due" && overdueInList.length > 0 && (
                <button
                  type="button"
                  onClick={selectAllOverdue}
                  className="text-xs text-primary hover:underline underline-offset-2"
                >
                  Select all overdue ({overdueInList.length})
                </button>
              )}
              <span className="text-xs text-muted-foreground">
                Drafts generate in batches of {CHUNK_SIZE} — one personalized email per contact.
              </span>
            </div>

            {tier1Contacts.length > 0 && (
              <ContactSection
                title="Tier 1 — Priority"
                contacts={tier1Contacts}
                selected={selected}
                onToggle={toggleContact}
                accent="border-l-orange-400"
              />
            )}

            {tier2Contacts.length > 0 && (
              <ContactSection
                title="Tier 2"
                contacts={tier2Contacts}
                selected={selected}
                onToggle={toggleContact}
                accent="border-l-blue-400/60"
              />
            )}

            {tier3Contacts.length > 0 && (
              <ContactSection
                title={listMode === "all" || listMode === "selection" ? "Tier 3 / Untiered" : "Tier 3"}
                contacts={tier3Contacts}
                selected={selected}
                onToggle={toggleContact}
                accent="border-l-border"
              />
            )}
          </div>
        )}

        {/* Sticky bottom bar */}
        {selected.size > 0 && (
          <div className="fixed bottom-0 left-52 right-0 border-t bg-background/95 backdrop-blur px-6 py-4 flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {selected.size} contact{selected.size !== 1 ? "s" : ""} selected
              {selected.size > CHUNK_SIZE && (
                <span>
                  {" "}
                  — will generate in {Math.ceil(selected.size / CHUNK_SIZE)} batches of up to{" "}
                  {CHUNK_SIZE}
                </span>
              )}
            </p>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Zap className="size-4" />
              Generate drafts
              {selected.size > CHUNK_SIZE
                ? ` (batch 1 of ${Math.ceil(selected.size / CHUNK_SIZE)})`
                : ` for ${selected.size}`}{" "}
              →
            </button>
          </div>
        )}
        {selected.size > 0 && <div className="h-20" />}
      </div>
    );
  }

  // ── Review view ───────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => { setStep("select"); setError(null); setConfirmingMarkAll(false); }}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-xl font-semibold tracking-tight">Review drafts</h1>
        </div>

        {/* Test mode toggle */}
        <button
          onClick={() => { setTestMode((v) => !v); setConfirmingMarkAll(false); }}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
            testMode
              ? "bg-amber-100 border-amber-400 text-amber-800 hover:bg-amber-200"
              : "border-border text-muted-foreground hover:bg-muted/50"
          )}
          title={testMode
            ? "Test mode on — mailto links point to your address. Click to exit."
            : "Enable test mode — sends to you instead of contacts"}
        >
          <FlaskConical className="size-3.5" />
          {testMode ? "Test mode ON" : "Test mode"}
        </button>
      </div>

      {batchQueue.length > 1 && (
        <div className="rounded-lg border bg-muted/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            Batch{" "}
            <span className="font-medium text-foreground">
              {batchIndex + 1} of {batchQueue.length}
            </span>
            {" "}
            ({drafts.length} draft{drafts.length !== 1 ? "s" : ""} this batch · one email per contact)
          </p>
          {batchIndex + 1 < batchQueue.length && (
            <button
              type="button"
              onClick={handleNextBatch}
              disabled={generating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {generating ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Generating…
                </>
              ) : (
                <>Next batch ({batchQueue[batchIndex + 1]?.length ?? 0}) →</>
              )}
            </button>
          )}
        </div>
      )}

      {/* How this works — always visible on review step */}
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">How sending works</p>
        <p>
          Clicking <span className="font-medium text-foreground">Open in email ↗</span> opens
          a draft in your mail client — <span className="font-medium">you</span> click Send there.
          Nothing is sent automatically.
        </p>
        <p>
          <span className="font-medium text-foreground">Mark as sent</span> only logs the
          outreach in Beacon (updates last-contacted date). Do it after you've actually sent.
        </p>
      </div>

      {/* Test mode banner */}
      {testMode && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex items-start gap-2">
          <FlaskConical className="size-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-300 space-y-0.5">
            <p className="font-semibold">Test mode is on</p>
            <p>
              All <span className="font-medium">Open in email</span> links will address{" "}
              <span className="font-medium">{userEmail ?? "your account email"}</span> instead
              of the real contact. Subjects will be prefixed with{" "}
              <span className="font-mono">[TEST]</span>.{" "}
              <span className="font-medium">Mark as sent is disabled</span> — exit test mode
              to log real outreach.
            </p>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {generating ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" />
          <p className="text-sm">Generating personalized drafts…</p>
        </div>
      ) : (
        <>
          {/* Confirmation panel — shown instead of the mark-all button */}
          {confirmingMarkAll ? (
            <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    About to log outreach for {pendingDrafts.length}{" "}
                    {pendingDrafts.length === 1 ? "contact" : "contacts"}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    This marks them as contacted today and resets their cadence timer. Only do
                    this after you've actually sent the emails.
                  </p>
                </div>
              </div>
              <ul className="text-xs space-y-1 pl-6">
                {pendingDrafts.map((d) => {
                  const c = contacts.find((x) => x.id === d.contactId);
                  return (
                    <li key={d.contactId} className="text-muted-foreground">
                      <span className="font-medium text-foreground">{c?.name ?? "Unknown"}</span>
                      {c?.email ? ` — ${c.email}` : " — no email on file"}
                    </li>
                  );
                })}
              </ul>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleMarkAllSentConfirmed}
                  className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
                >
                  Yes, mark all {pendingDrafts.length} as sent
                </button>
                <button
                  onClick={() => setConfirmingMarkAll(false)}
                  className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted/50 transition-colors text-muted-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            /* Mark-all button — triggers confirmation, never sends directly */
            pendingDrafts.length > 1 && !testMode && (
              <button
                onClick={() => setConfirmingMarkAll(true)}
                className="text-xs text-primary hover:underline underline-offset-2"
              >
                Mark all {pendingDrafts.length} unsent as sent…
              </button>
            )
          )}

          <div className="space-y-6">
            {drafts.map((draft) => {
              const contact = contacts.find((c) => c.id === draft.contactId);
              const isSent = sentIds.has(draft.contactId);
              const subject = editedSubjects[draft.contactId] ?? draft.subject;
              const body = editedBodies[draft.contactId] ?? draft.body;
              const realEmail = contact?.email ?? null;

              // In test mode: redirect to broker's own address, prefix subject
              const toEmail = testMode ? (userEmail ?? null) : realEmail;
              const toSubject = testMode ? `[TEST] ${subject}` : subject;

              const composeHref = composeUrl(
                toEmail,
                toSubject,
                body,
                userEmail,
                emailProvider as EmailProviderSetting
              );

              return (
                <div
                  key={draft.contactId}
                  className={cn(
                    "rounded-lg border bg-card shadow-sm overflow-hidden",
                    isSent && "opacity-60"
                  )}
                >
                  {/* Draft card header */}
                  <div className="px-4 py-3 border-b bg-muted/20 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">
                        {contact?.name ?? "Unknown"}
                      </p>
                      {realEmail && (
                        <p className="text-xs text-muted-foreground">
                          {testMode ? (
                            <>
                              <span className="line-through opacity-50">{realEmail}</span>
                              {" → "}
                              <span className="text-amber-700 font-medium">{userEmail ?? "your email"}</span>
                              {" "}
                              <span className="text-amber-600">(test)</span>
                            </>
                          ) : realEmail}
                        </p>
                      )}
                    </div>
                    {isSent && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
                        <CheckCircle2 className="size-3.5" />
                        Sent
                      </span>
                    )}
                  </div>

                  {/* Draft card body */}
                  <div className="p-4 space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Subject
                      </label>
                      <input
                        type="text"
                        value={subject}
                        onChange={(e) =>
                          setEditedSubjects((prev) => ({
                            ...prev,
                            [draft.contactId]: e.target.value,
                          }))
                        }
                        disabled={isSent}
                        className="w-full border border-border rounded-md px-3 py-1.5 text-sm outline-none focus:ring-2 ring-ring bg-background disabled:opacity-50"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Body
                      </label>
                      <textarea
                        value={body}
                        rows={6}
                        onChange={(e) =>
                          setEditedBodies((prev) => ({
                            ...prev,
                            [draft.contactId]: e.target.value,
                          }))
                        }
                        disabled={isSent}
                        className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background resize-y disabled:opacity-50"
                      />
                    </div>
                  </div>

                  {/* Draft card footer */}
                  <div className="px-4 py-3 border-t bg-muted/10 flex items-center justify-end gap-2">
                    {composeHref ? (
                      <a
                        href={composeHref}
                        target={isWebCompose(composeHref) ? "_blank" : undefined}
                        rel={isWebCompose(composeHref) ? "noopener noreferrer" : undefined}
                        className={cn(
                          "inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border transition-colors",
                          testMode
                            ? "border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100"
                            : "border-border hover:bg-muted/50"
                        )}
                      >
                        {testMode ? "Open test email ↗" : "Open in email ↗"}
                      </a>
                    ) : (
                      <button
                        disabled
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-border opacity-40 cursor-not-allowed"
                      >
                        Open in email ↗
                      </button>
                    )}
                    {!isSent && (
                      <button
                        onClick={() => handleMarkSent(draft.contactId)}
                        disabled={testMode}
                        title={testMode ? "Exit test mode to log real outreach" : undefined}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Mark as sent
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Contact section ──────────────────────────────────────────────────────────

function ContactSection({
  title,
  contacts,
  selected,
  onToggle,
  accent,
}: {
  title: string;
  contacts: DueContact[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  accent: string;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-1">
        {contacts.map((c) => (
          <ContactRow
            key={c.id}
            contact={c}
            checked={selected.has(c.id)}
            onToggle={() => onToggle(c.id)}
            accent={accent}
          />
        ))}
      </div>
    </div>
  );
}

function ContactRow({
  contact: c,
  checked,
  onToggle,
  accent,
}: {
  contact: DueContact;
  checked: boolean;
  onToggle: () => void;
  accent: string;
}) {
  const overdueLabel =
    c.daysOverdue > 0
      ? `${c.daysOverdue} day${c.daysOverdue !== 1 ? "s" : ""} overdue`
      : c.daysOverdue === 0
      ? "Due today"
      : `Due in ${Math.abs(c.daysOverdue)} day${Math.abs(c.daysOverdue) !== 1 ? "s" : ""}`;

  return (
    <label
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-lg border bg-card cursor-pointer hover:bg-muted/20 transition-colors border-l-4",
        accent,
        checked && "bg-primary/5 border-primary/30"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="size-4 rounded border-border accent-primary cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">
            {c.name ?? "Unknown"}
          </span>
          {c.company && (
            <span className="text-xs text-muted-foreground truncate">
              {c.company}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {overdueLabel} · {fmtDate(c.last_contacted_at)}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 text-xs font-semibold rounded-full px-2 py-0.5",
          tierCls(c.contact_tier)
        )}
      >
        {tierLabel(c.contact_tier)}
      </span>
    </label>
  );
}
