"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Users, Plus, Link2, Loader2, Phone, Mail, MapPin, X,
  Zap, Clock, CalendarDays, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { linkContactsToProperty } from "@/app/crm/actions";
import { createActivity, type ActivityType } from "@/app/activities/actions";
import { generateDrafts, logOutreach } from "@/app/outreach/actions";
import { composeUrl, isWebCompose, readStoredProvider, readStoredUserEmail } from "@/lib/email-provider";
import { FollowUpNudge } from "@/components/follow-up-nudge";
import { ContactPicker } from "@/components/contact-picker";
import { suggestedCadenceDays, type CadenceSettingsSlice, cadenceMapFromSettings } from "@/lib/cadence";
import { OwnerPortfolioLink } from "@/components/owner-portfolio-link";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LinkedContact = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  mailing_address: string | null;
  company: string | null;
  role: string | null;
  contact_tier: number | null;
  next_action_due: string | null;
  action_tags?: string[] | null;
  contact_type?: string | null;
};

type ContactPhase =
  | { tag: "idle" }
  | { tag: "outreach_generating" }
  | { tag: "outreach_ready"; subject: string; body: string }
  | { tag: "outreach_sending" }
  | { tag: "outreach_sent" }
  | { tag: "logging" }
  | { tag: "nudging" }
  | { tag: "error"; message: string };

const ACTIVITY_TYPES: { value: ActivityType; label: string }[] = [
  { value: "call",    label: "Call" },
  { value: "email",   label: "Email" },
  { value: "letter",  label: "Letter" },
  { value: "meeting", label: "Meeting" },
  { value: "note",    label: "Note" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function tierLabel(t: number | null) {
  if (t === 1) return "Tier 1";
  if (t === 2) return "Tier 2";
  if (t === 3) return "Tier 3";
  return null;
}

function tierCls(t: number | null) {
  if (t === 1) return "bg-orange-100 text-orange-700";
  if (t === 2) return "bg-blue-100 text-blue-700";
  return "bg-muted text-muted-foreground";
}

function FollowUpChip({ date }: { date: string | null }) {
  if (!date) return null;
  const isOverdue = new Date(date) < new Date();
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
      isOverdue
        ? "bg-destructive/10 text-destructive font-medium"
        : "bg-primary/10 text-primary"
    )}>
      <CalendarDays className="size-3" />
      {isOverdue ? "Overdue · " : "Follow-up · "}
      {fmtDate(date)}
    </span>
  );
}

// ─── Inline log form ──────────────────────────────────────────────────────────

function InlineLogForm({
  contactId,
  propertyId,
  onSuccess,
  onCancel,
}: {
  contactId: string;
  propertyId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const todayLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const activity_type = fd.get("activity_type") as ActivityType;
    const rawDate = fd.get("activity_date") as string;
    const notes = (fd.get("notes") as string)?.trim() || null;
    const activity_date = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();

    startTransition(async () => {
      const result = await createActivity({ contact_id: contactId, property_id: propertyId, activity_type, activity_date, notes });
      if (result.error) { setError(result.error); return; }
      onSuccess();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 rounded-lg border border-border bg-muted/10 p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Type</label>
          <select
            name="activity_type"
            defaultValue="call"
            disabled={isPending}
            className="w-full border border-border rounded-md px-2 py-1.5 text-xs bg-background outline-none focus:ring-2 ring-ring"
          >
            {ACTIVITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Date</label>
          <input
            type="datetime-local"
            name="activity_date"
            defaultValue={todayLocal}
            disabled={isPending}
            className="w-full border border-border rounded-md px-2 py-1.5 text-xs bg-background outline-none focus:ring-2 ring-ring"
          />
        </div>
        <div className="space-y-1 col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Notes</label>
          <textarea
            name="notes"
            rows={2}
            disabled={isPending}
            placeholder="Add a note…"
            className="w-full border border-border rounded-md px-2 py-1.5 text-xs bg-background outline-none focus:ring-2 ring-ring resize-none"
          />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending} className="h-7 text-xs px-3">
          {isPending ? <><Loader2 className="size-3 animate-spin" />Saving…</> : "Log"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={onCancel} className="h-7 text-xs px-3">
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Inline draft panel ───────────────────────────────────────────────────────

function InlineDraftPanel({
  email,
  subject: initSubject,
  body: initBody,
  onSend,
  onDiscard,
  sending,
}: {
  email: string | null;
  subject: string;
  body: string;
  onSend: (subject: string, body: string) => void;
  onDiscard: () => void;
  sending: boolean;
}) {
  const [subject, setSubject] = useState(initSubject);
  const [body, setBody] = useState(initBody);

  const composeHref = composeUrl(
    email,
    subject,
    body,
    readStoredUserEmail(),
    readStoredProvider()
  );

  return (
    <div className="mt-2 rounded-lg border bg-muted/10 px-3 py-3 space-y-2">
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        disabled={sending}
        className="w-full text-sm font-medium bg-transparent border-0 border-b border-border/50 pb-1 focus:outline-none focus:border-primary"
        placeholder="Subject"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={sending}
        rows={5}
        className="w-full text-sm bg-transparent resize-none focus:outline-none leading-relaxed"
        placeholder="Email body"
      />
      <div className="flex gap-2 flex-wrap pt-1">
        {email && composeHref ? (
          <a
            href={composeHref}
            target={isWebCompose(composeHref) ? "_blank" : undefined}
            rel={isWebCompose(composeHref) ? "noopener noreferrer" : undefined}
            onClick={() => onSend(subject, body)}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Mail className="size-3" />
            Open in email · log send
          </a>
        ) : (
          <Button size="sm" className="h-7 text-xs px-3" onClick={() => onSend(subject, body)} disabled={sending}>
            Mark as sent
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 text-xs px-3" onClick={onDiscard} disabled={sending}>
          Discard
        </Button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PropertyContactsSection({
  propertyId,
  propertyLabel,
  initialContacts: contacts,
  cadenceSettings,
}: {
  propertyId: string;
  propertyLabel?: string | null;
  initialContacts: LinkedContact[];
  cadenceSettings?: CadenceSettingsSlice | null;
}) {
  const router = useRouter();
  const cadence = cadenceMapFromSettings(cadenceSettings);
  const [brokerContext, setBrokerContext] = useState("");
  const [linking, setLinking] = useState(false);
  const [pickId, setPickId] = useState<string | null>(null);
  const [pickLabel, setPickLabel] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [phases, setPhases] = useState<Map<string, ContactPhase>>(new Map());

  useEffect(() => {
    const saved = localStorage.getItem("beacon_broker_context");
    if (saved) setBrokerContext(saved);
  }, []);

  function getPhase(id: string): ContactPhase {
    return phases.get(id) ?? { tag: "idle" };
  }

  function setPhase(id: string, phase: ContactPhase) {
    setPhases((prev) => new Map(prev).set(id, phase));
  }

  async function handleStartOutreach(c: LinkedContact) {
    setPhase(c.id, { tag: "outreach_generating" });
    const res = await generateDrafts([c.id], brokerContext);
    if (res.error || !res.drafts?.length) {
      setPhase(c.id, { tag: "error", message: res.error ?? "No draft returned." });
      return;
    }
    const d = res.drafts[0];
    setPhase(c.id, { tag: "outreach_ready", subject: d.subject, body: d.body });
  }

  async function handleSendOutreach(c: LinkedContact, subject: string, body: string) {
    setPhase(c.id, { tag: "outreach_sending" });
    const res = await logOutreach(c.id, subject, body);
    if (res.error) {
      setPhase(c.id, { tag: "error", message: res.error });
      return;
    }
    setPhase(c.id, { tag: "outreach_sent" });
  }

  function cancelLink() {
    setLinking(false);
    setPickId(null);
    setPickLabel(null);
    setLinkError(null);
  }

  async function handleLinkExisting() {
    if (!pickId) return;
    setLinkBusy(true);
    setLinkError(null);
    const res = await linkContactsToProperty(propertyId, [pickId]);
    setLinkBusy(false);
    if (res.error) {
      setLinkError(res.error);
      return;
    }
    cancelLink();
    router.refresh();
  }

  const newContactHref = `/contacts/new?property=${propertyId}${
    propertyLabel ? `&propertyLabel=${encodeURIComponent(propertyLabel)}` : ""
  }`;

  const btnCls =
    "inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border border-border bg-background hover:bg-muted/60 transition-colors";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="size-4" />
          Contacts
          {contacts.length > 0 && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">({contacts.length})</span>
          )}
        </CardTitle>
        {linking ? (
          <button
            onClick={cancelLink}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />Cancel
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLinking(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Link2 className="size-3.5" />Link contact
            </button>
            <Link
              href={newContactHref}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="size-3.5" />New contact
            </Link>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Link existing contact */}
        {linking && (
          <div className="rounded-lg border p-4 space-y-3 bg-muted/10">
            <p className="text-sm font-medium">Link existing contact</p>
            <ContactPicker
              value={pickId}
              label={pickLabel}
              onChange={(id, label) => { setPickId(id); setPickLabel(label); }}
            />
            {linkError && <p className="text-xs text-destructive">{linkError}</p>}
            <div className="flex gap-2 pt-1">
              <Button size="sm" disabled={!pickId || linkBusy} onClick={handleLinkExisting}>
                {linkBusy ? <><Loader2 className="size-3.5 animate-spin" />Linking…</> : "Link"}
              </Button>
              <Button size="sm" variant="ghost" disabled={linkBusy} onClick={cancelLink}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {contacts.length === 0 && !linking && (
          <p className="text-sm text-muted-foreground">No contacts linked to this property.</p>
        )}

        {/* Contact list — grouped by contact_type when multiple types are present */}
        {contacts.length > 0 && (() => {
          const groups: { label: string; items: LinkedContact[] }[] = [
            { label: "Owners",  items: contacts.filter(c => c.contact_type === "owner") },
            { label: "Tenants", items: contacts.filter(c => c.contact_type === "tenant") },
            { label: "Other",   items: contacts.filter(c => !c.contact_type || c.contact_type === "other") },
          ].filter(g => g.items.length > 0);
          const multiType = groups.length > 1;

          return (
            <div className="space-y-4">
              {groups.map(({ label, items }) => (
                <div key={label} className="space-y-2">
                  {multiType && (
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-0.5">{label}</p>
                  )}
                  <div className="space-y-3">
                    {items.map((c) => {
                      const phase = getPhase(c.id);
                      return (
                        <div key={c.id} className="rounded-lg border px-4 py-3">
                          {/* Contact header */}
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="min-w-0 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Link
                                  href={`/contacts/${c.id}`}
                                  className="font-medium text-sm hover:underline underline-offset-2"
                                >
                                  {c.name ?? "Unknown contact"}
                                </Link>
                                {tierLabel(c.contact_tier) && (
                                  <span className={cn("text-xs rounded-full px-2 py-0.5 font-medium", tierCls(c.contact_tier))}>
                                    {tierLabel(c.contact_tier)}
                                  </span>
                                )}
                                <FollowUpChip date={c.next_action_due} />
                                <OwnerPortfolioLink contactId={c.id} />
                              </div>

                              {(c.company || c.role) && (
                                <p className="text-xs text-muted-foreground">
                                  {[c.role, c.company].filter(Boolean).join(" · ")}
                                </p>
                              )}

                              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                                {c.email && (
                                  <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2">
                                    <Mail className="size-3 shrink-0" />{c.email}
                                  </a>
                                )}
                                {c.phone && (
                                  <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                                    <Phone className="size-3 shrink-0" />{c.phone}
                                  </a>
                                )}
                                {c.mailing_address && (
                                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <MapPin className="size-3 shrink-0" />{c.mailing_address}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Per-contact action buttons (idle or error) */}
                            {(phase.tag === "idle" || phase.tag === "error") && (
                              <div className="flex gap-1.5 shrink-0 flex-wrap">
                                <button
                                  onClick={() => handleStartOutreach(c)}
                                  className={btnCls}
                                >
                                  <Zap className="size-3 text-primary" />
                                  Start outreach
                                </button>
                                <button
                                  onClick={() => setPhase(c.id, { tag: "logging" })}
                                  className={btnCls}
                                >
                                  <Clock className="size-3" />
                                  Log activity
                                </button>
                              </div>
                            )}

                            {phase.tag === "outreach_generating" && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1.5 shrink-0">
                                <Loader2 className="size-3.5 animate-spin" />
                                Drafting…
                              </span>
                            )}

                            {phase.tag === "outreach_sending" && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1.5 shrink-0">
                                <Loader2 className="size-3.5 animate-spin" />
                                Logging…
                              </span>
                            )}

                            {phase.tag === "outreach_sent" && (
                              <span className="text-xs text-green-600 flex items-center gap-1.5 shrink-0">
                                <CheckCircle2 className="size-3.5" />
                                Sent
                              </span>
                            )}
                          </div>

                          {/* Error */}
                          {phase.tag === "error" && (
                            <p className="mt-2 text-xs text-destructive flex items-center gap-1">
                              <AlertTriangle className="size-3 shrink-0" />
                              {phase.message}
                            </p>
                          )}

                          {/* Outreach draft */}
                          {phase.tag === "outreach_ready" && (
                            <InlineDraftPanel
                              email={c.email}
                              subject={phase.subject}
                              body={phase.body}
                              sending={false}
                              onSend={(subject, body) => handleSendOutreach(c, subject, body)}
                              onDiscard={() => setPhase(c.id, { tag: "idle" })}
                            />
                          )}

                          {/* Activity log form */}
                          {phase.tag === "logging" && (
                            <InlineLogForm
                              contactId={c.id}
                              propertyId={propertyId}
                              onSuccess={() => setPhase(c.id, { tag: "nudging" })}
                              onCancel={() => setPhase(c.id, { tag: "idle" })}
                            />
                          )}

                          {/* Follow-up nudge — shown after activity log or after outreach sent */}
                          {(phase.tag === "nudging" || phase.tag === "outreach_sent") && (
                            <div className="mt-2">
                              <FollowUpNudge
                                contactId={c.id}
                                propertyId={propertyId}
                                suggestedDays={suggestedCadenceDays(c.contact_tier, cadence)}
                                onDone={() => setPhase(c.id, { tag: "idle" })}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

      </CardContent>
    </Card>
  );
}
