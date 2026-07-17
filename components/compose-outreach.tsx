"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Loader2, Sparkles, FlaskConical, CheckCircle2, RotateCcw, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { generateDrafts, logOutreach, type OutreachTemplate } from "@/app/outreach/actions";
import { FollowUpNudge } from "@/components/follow-up-nudge";
import { composeUrl, isWebCompose, readStoredProvider, readStoredUserEmail, type EmailProviderSetting } from "@/lib/email-provider";

const TEMPLATES: { id: OutreachTemplate; label: string }[] = [
  { id: "intro",          label: "Intro" },
  { id: "check-in",       label: "Check-in" },
  { id: "market-update",  label: "Market update" },
  { id: "listing-alert",  label: "Listing alert" },
];

type Mode = "compose" | "generating" | "draft" | "sent";

export function ComposeOutreach({
  contactId,
  contactName,
  contactEmail,
  userEmail,
  emailProvider = null,
  onSent,
  onDone,
}: {
  contactId: string;
  contactName: string | null;
  contactEmail: string | null;
  userEmail?: string | null;
  emailProvider?: string | null;
  onSent?: () => void;
  onDone?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("compose");
  const [template, setTemplate] = useState<OutreachTemplate>("check-in");
  const [brokerContext, setBrokerContext] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const saved = localStorage.getItem("beacon_broker_context");
    if (saved) setBrokerContext(saved);
  }, []);

  function saveBrokerContext(val: string) {
    setBrokerContext(val);
    localStorage.setItem("beacon_broker_context", val);
  }

  function handleGenerate() {
    setError(null);
    setMode("generating");
    startTransition(async () => {
      const result = await generateDrafts([contactId], brokerContext, template);
      if (result.error || !result.drafts?.length) {
        setError(result.error ?? "No draft generated.");
        setMode("compose");
        return;
      }
      const draft = result.drafts[0];
      setSubject(draft.subject);
      setBody(draft.body);
      setMode("draft");
    });
  }

  function handleMarkSent() {
    setError(null);
    startTransition(async () => {
      const result = await logOutreach(contactId, subject, body);
      if (result.error) { setError(result.error); return; }
      setMode("sent");
      onSent?.();
    });
  }

  const toEmail = testMode ? userEmail : contactEmail;
  const toSubject = testMode ? `[TEST] ${subject}` : subject;
  // Resolve provider: prefer the explicit prop, fall back to localStorage (for when
  // this component is embedded in contexts that can't thread the setting as a prop).
  const resolvedProvider = (emailProvider ?? readStoredProvider()) as EmailProviderSetting;
  const resolvedSender   = userEmail ?? readStoredUserEmail();
  const composeHref =
    toEmail && subject
      ? composeUrl(toEmail, toSubject, body, resolvedSender, resolvedProvider)
      : null;

  // ── Sent ──────────────────────────────────────────────────────────────────────
  if (mode === "sent") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="size-4 shrink-0" />
          Outreach logged for {contactName ?? "contact"}.
        </div>
        <FollowUpNudge contactId={contactId} onDone={() => onDone?.()} />
      </div>
    );
  }

  // ── Compose / generating ──────────────────────────────────────────────────────
  if (mode === "compose" || mode === "generating") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTemplate(t.id)}
              disabled={mode === "generating"}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs border transition-colors disabled:opacity-50",
                template === t.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">About you</label>
          <textarea
            value={brokerContext}
            onChange={(e) => saveBrokerContext(e.target.value)}
            rows={2}
            disabled={mode === "generating"}
            placeholder="e.g. I'm [name], a commercial broker in Miami specializing in industrial properties…"
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background outline-none focus:ring-2 ring-ring resize-none placeholder:text-muted-foreground/60 disabled:opacity-60"
          />
          <p className="text-xs text-muted-foreground">Saved automatically across all outreach.</p>
        </div>

        {error && (
          <p className="text-xs text-destructive flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 shrink-0" />{error}
          </p>
        )}

        {mode === "generating" ? (
          <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />Generating draft…
          </div>
        ) : (
          <Button onClick={handleGenerate} size="sm" className="w-full">
            <Sparkles className="size-3.5" />Generate AI draft
          </Button>
        )}
      </div>
    );
  }

  // ── Draft ─────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Review and edit before sending.</p>
        <button
          onClick={() => setTestMode((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-colors",
            testMode
              ? "bg-amber-100 border-amber-400 text-amber-800"
              : "border-border text-muted-foreground hover:bg-muted/50"
          )}
        >
          <FlaskConical className="size-3" />
          {testMode ? "Test ON" : "Test"}
        </button>
      </div>

      {testMode && (
        <div className="rounded-md border border-amber-400/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-400">
          Mailto will address{" "}
          <span className="font-medium">{userEmail ?? "your email"}</span> with a{" "}
          <span className="font-mono">[TEST]</span> subject prefix. Mark&nbsp;as&nbsp;sent is disabled.
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-background outline-none focus:ring-2 ring-ring"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Body</label>
        <textarea
          value={body}
          rows={7}
          onChange={(e) => setBody(e.target.value)}
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background outline-none focus:ring-2 ring-ring resize-y"
        />
      </div>

      {error && (
        <p className="text-xs text-destructive flex items-center gap-1.5">
          <AlertTriangle className="size-3.5 shrink-0" />{error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
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
          !contactEmail && (
            <span className="text-xs text-muted-foreground">
              No email on file — add it on the contact first.
            </span>
          )
        )}
        <Button
          size="sm"
          onClick={handleMarkSent}
          disabled={isPending || testMode}
          title={testMode ? "Exit test mode to log real outreach" : undefined}
        >
          {isPending ? <><Loader2 className="size-3.5 animate-spin" />Logging…</> : "Mark as sent"}
        </Button>
        <button
          onClick={() => { setMode("compose"); setError(null); }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
        >
          <RotateCcw className="size-3" />Regenerate
        </button>
      </div>

      <div className="rounded-md bg-muted/30 border border-border px-3 py-2 text-xs text-muted-foreground space-y-0.5">
        <p className="font-medium text-foreground">How sending works</p>
        <p>
          <span className="font-medium text-foreground">Open in email&nbsp;↗</span> opens a draft in
          your mail client — you click Send there. Nothing is sent automatically.
        </p>
        <p>
          <span className="font-medium text-foreground">Mark as sent</span> only logs it in Beacon
          after you&apos;ve actually sent it.
        </p>
      </div>
    </div>
  );
}
