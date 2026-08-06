"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  User,
  Building2,
  Database,
  Zap,
  Download,
  Palette,
  AlertTriangle,
  Eye,
  EyeOff,
  CheckCircle2,
  Moon,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/login/actions";
import {
  getUserSettings,
  upsertUserSettings,
  changePassword,
  deleteAllData,
  getIngestionErrorCount,
  type UserSettings,
} from "./actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type Section =
  | "account"
  | "brokerage"
  | "data-sources"
  | "outreach"
  | "data"
  | "appearance"
  | "danger";

// ─── Sidebar config ───────────────────────────────────────────────────────────

const SECTIONS: {
  key: Section;
  label: string;
  icon: React.ElementType;
}[] = [
  { key: "account",      label: "Account",        icon: User },
  { key: "brokerage",    label: "Brokerage",       icon: Building2 },
  { key: "data-sources", label: "Data & Sources",  icon: Database },
  { key: "outreach",     label: "Outreach",        icon: Zap },
  { key: "data",         label: "Data Management", icon: Download },
  { key: "appearance",   label: "Appearance",      icon: Palette },
  { key: "danger",       label: "Danger Zone",     icon: AlertTriangle },
];

// ─── Shared helpers ───────────────────────────────────────────────────────────

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="pb-4 border-b mb-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
    </div>
  );
}

function SaveFeedback({ saved, error }: { saved: boolean; error: string | null }) {
  if (error) {
    return (
      <p className="text-sm text-destructive flex items-center gap-1.5">
        <AlertTriangle className="size-3.5 shrink-0" /> {error}
      </p>
    );
  }
  if (saved) {
    return (
      <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5">
        <CheckCircle2 className="size-3.5 shrink-0" /> Saved
      </p>
    );
  }
  return null;
}

// ─── Account section ──────────────────────────────────────────────────────────

function AccountSection({
  settings,
  userEmail,
  onSaved,
}: {
  settings: UserSettings;
  userEmail: string;
  onSaved: (s: UserSettings) => void;
}) {
  const [displayName, setDisplayName] = useState(settings.display_name ?? "");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwPending, setPwPending] = useState(false);
  const [pwSaved, setPwSaved] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setSaveError(null);
    startTransition(async () => {
      const result = await upsertUserSettings({ display_name: displayName.trim() || null });
      if (result.error) {
        setSaveError(result.error);
      } else {
        setSaved(true);
        onSaved({ ...settings, display_name: displayName.trim() || null });
        setTimeout(() => setSaved(false), 2500);
      }
    });
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSaved(false);
    if (newPw !== confirmPw) { setPwError("Passwords do not match."); return; }
    if (newPw.length < 8) { setPwError("Password must be at least 8 characters."); return; }
    setPwPending(true);
    try {
      const result = await changePassword(newPw);
      if (result.error) {
        setPwError(result.error);
      } else {
        setPwSaved(true);
        setNewPw("");
        setConfirmPw("");
        setTimeout(() => setPwSaved(false), 2500);
      }
    } finally {
      setPwPending(false);
    }
  }

  return (
    <div className="space-y-8">
      <SectionHeading title="Account" description="Your display name, email, and password." />

      <form onSubmit={handleSave} className="space-y-4 max-w-sm">
        <div className="space-y-1.5">
          <Label htmlFor="display_name">Display name</Label>
          <Input
            id="display_name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Jane Smith"
            disabled={isPending}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input value={userEmail} disabled readOnly />
          <p className="text-xs text-muted-foreground">Email is managed by your auth provider.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending} size="sm">
            {isPending && <Loader2 className="animate-spin" />}
            Save
          </Button>
          <SaveFeedback saved={saved} error={saveError} />
        </div>
      </form>

      <div className="border-t pt-6 space-y-4 max-w-sm">
        <h3 className="text-sm font-semibold">Change password</h3>
        <form onSubmit={handlePasswordChange} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new_pw">New password</Label>
            <div className="relative">
              <Input
                id="new_pw"
                type={showPw ? "text" : "password"}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                disabled={pwPending}
                placeholder="Min. 8 characters"
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm_pw">Confirm password</Label>
            <Input
              id="confirm_pw"
              type={showPw ? "text" : "password"}
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              disabled={pwPending}
              placeholder="Repeat new password"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="outline" size="sm" disabled={pwPending || !newPw}>
              {pwPending && <Loader2 className="animate-spin" />}
              Update password
            </Button>
            <SaveFeedback saved={pwSaved} error={pwError} />
          </div>
        </form>
      </div>

      <div className="border-t pt-6">
        <h3 className="text-sm font-semibold mb-3">Session</h3>
        <Button variant="outline" size="sm" onClick={() => signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

// ─── Brokerage section ────────────────────────────────────────────────────────

function BrokerageSection({
  settings,
  onSaved,
}: {
  settings: UserSettings;
  onSaved: (s: UserSettings) => void;
}) {
  const [form, setForm] = useState({
    broker_name:       settings.broker_name ?? "",
    company:           settings.company ?? "",
    license_number:    settings.license_number ?? "",
    default_market:    settings.default_market ?? "",
    default_submarket: settings.default_submarket ?? "",
    phone:             settings.phone ?? "",
    website:           settings.website ?? "",
  });
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setSaveError(null);
    const partial = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, (v as string).trim() || null])
    ) as Partial<UserSettings>;
    startTransition(async () => {
      const result = await upsertUserSettings(partial);
      if (result.error) {
        setSaveError(result.error);
      } else {
        setSaved(true);
        onSaved({ ...settings, ...partial });
        setTimeout(() => setSaved(false), 2500);
      }
    });
  }

  return (
    <div>
      <SectionHeading
        title="Brokerage"
        description="Your broker profile — used in outreach signatures and reports."
      />
      <form onSubmit={handleSave} className="space-y-4 max-w-sm">
        <div className="space-y-1.5">
          <Label htmlFor="broker_name">Broker name</Label>
          <Input id="broker_name" value={form.broker_name} onChange={set("broker_name")} placeholder="Jane Smith" disabled={isPending} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bro_company">Company</Label>
          <Input id="bro_company" value={form.company} onChange={set("company")} placeholder="Acme Commercial RE" disabled={isPending} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="license_number">License #</Label>
          <Input id="license_number" value={form.license_number} onChange={set("license_number")} placeholder="FL-BK-1234567" disabled={isPending} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="default_market">Default market</Label>
            <Input id="default_market" value={form.default_market} onChange={set("default_market")} placeholder="Miami-Dade" disabled={isPending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="default_submarket">Submarket</Label>
            <Input id="default_submarket" value={form.default_submarket} onChange={set("default_submarket")} placeholder="Doral" disabled={isPending} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bro_phone">Phone</Label>
          <Input id="bro_phone" value={form.phone} onChange={set("phone")} placeholder="(305) 555-0100" disabled={isPending} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="website">Website</Label>
          <Input id="website" value={form.website} onChange={set("website")} placeholder="https://yourbrokerage.com" disabled={isPending} />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending} size="sm">
            {isPending && <Loader2 className="animate-spin" />}
            Save
          </Button>
          <SaveFeedback saved={saved} error={saveError} />
        </div>
      </form>
    </div>
  );
}

// ─── Data & Sources section ───────────────────────────────────────────────────

function DataSourcesSection({
  errorCount,
  settings,
  onSaved,
}: {
  errorCount: number;
  settings: UserSettings;
  onSaved: (s: UserSettings) => void;
}) {
  const [costarEnabled, setCostarEnabled] = useState(settings.costar_enabled);
  const [toggling, setToggling] = useState(false);

  async function toggleCoStar() {
    setToggling(true);
    const next = !costarEnabled;
    const result = await upsertUserSettings({ costar_enabled: next });
    setToggling(false);
    if (!result.error) {
      setCostarEnabled(next);
      onSaved({ ...settings, costar_enabled: next });
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeading title="Data & Sources" description="Connected data sources and ingestion status." />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Ingestion sources</h3>
        <div className="space-y-2 max-w-md">
          {[
            { label: "Miami-Dade Property Appraiser", detail: null },
            { label: "Sunbiz (FL Sec. of State)", detail: null },
          ].map((s) => (
            <div
              key={s.label}
              className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3"
            >
              <p className="text-sm">{s.label}</p>
              <span className="shrink-0 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/40 px-2 py-0.5 rounded-full">
                Active
              </span>
            </div>
          ))}

          {/* CoStar — toggleable */}
          <div className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm">CoStar</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Export from CoStar, then upload via{" "}
                <Link href="/properties/new?method=upload" className="underline underline-offset-2 hover:text-foreground">
                  Add property
                </Link>{" "}
                or the Enrich panel on a property page. No account login required.
              </p>
            </div>
            <button
              type="button"
              onClick={toggleCoStar}
              disabled={toggling}
              className={cn(
                "shrink-0 text-xs font-medium px-2 py-0.5 rounded-full transition-colors disabled:opacity-60",
                costarEnabled
                  ? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/40 hover:bg-green-100 dark:hover:bg-green-950/60"
                  : "text-muted-foreground bg-muted hover:bg-muted/80",
              )}
            >
              {toggling ? "Saving…" : costarEnabled ? "Enabled" : "Disabled"}
            </button>
          </div>
        </div>
      </div>

      {errorCount > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 max-w-md flex items-start justify-between gap-4">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            <strong>{errorCount}</strong> ingestion error{errorCount !== 1 ? "s" : ""} logged.
            Review your data imports for failed records.
          </p>
          <Link
            href="/properties/errors"
            className="shrink-0 text-xs text-amber-700 dark:text-amber-400 underline underline-offset-2 whitespace-nowrap"
          >
            View →
          </Link>
        </div>
      )}

      <div className="pt-2">
        <Link
          href="/settings/errors"
          className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
        >
          View app error log →
        </Link>
        <p className="text-xs text-muted-foreground mt-0.5">
          Unexpected server failures logged for debugging.
        </p>
      </div>
    </div>
  );
}

// ─── Outreach section ─────────────────────────────────────────────────────────

function OutreachSection({
  settings,
  onSaved,
}: {
  settings: UserSettings;
  onSaved: (s: UserSettings) => void;
}) {
  const [form, setForm] = useState({
    sender_name:        settings.sender_name ?? "",
    sender_email:       settings.sender_email ?? "",
    email_signature:    settings.email_signature ?? "",
    cadence_tier1_days: String(settings.cadence_tier1_days),
    cadence_tier2_days: String(settings.cadence_tier2_days),
    cadence_tier3_days: String(settings.cadence_tier3_days),
    email_provider:     settings.email_provider ?? "auto",
  });

  // Keep localStorage in sync so inline compose panels pick it up immediately.
  useEffect(() => {
    localStorage.setItem("beacon_email_provider", settings.email_provider ?? "auto");
  }, [settings.email_provider]);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setSaveError(null);
    const t1 = parseInt(form.cadence_tier1_days, 10);
    const t2 = parseInt(form.cadence_tier2_days, 10);
    const t3 = parseInt(form.cadence_tier3_days, 10);
    if ([t1, t2, t3].some((v) => isNaN(v) || v < 1)) {
      setSaveError("Cadence days must be positive whole numbers.");
      return;
    }
    const providerValue = form.email_provider === "auto" ? null : form.email_provider;
    const partial: Partial<UserSettings> = {
      sender_name:        form.sender_name.trim() || null,
      sender_email:       form.sender_email.trim() || null,
      email_signature:    form.email_signature.trim() || null,
      cadence_tier1_days: t1,
      cadence_tier2_days: t2,
      cadence_tier3_days: t3,
      email_provider:     providerValue,
    };
    localStorage.setItem("beacon_email_provider", form.email_provider);
    startTransition(async () => {
      const result = await upsertUserSettings(partial);
      if (result.error) {
        setSaveError(result.error);
      } else {
        setSaved(true);
        onSaved({ ...settings, ...partial });
        setTimeout(() => setSaved(false), 2500);
      }
    });
  }

  return (
    <div>
      <SectionHeading
        title="Outreach"
        description="Sender info, email signature, and contact cadence intervals."
      />
      <form onSubmit={handleSave} className="space-y-6">
        <div className="space-y-4 max-w-sm">
          <h3 className="text-sm font-semibold">Sender</h3>
          <div className="space-y-1.5">
            <Label htmlFor="sender_name">Sender name</Label>
            <Input id="sender_name" value={form.sender_name} onChange={set("sender_name")} placeholder="Jane Smith" disabled={isPending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sender_email">Sender email</Label>
            <Input id="sender_email" type="email" value={form.sender_email} onChange={set("sender_email")} placeholder="jane@yourbrokerage.com" disabled={isPending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email_provider">Email client</Label>
            <select
              id="email_provider"
              value={form.email_provider}
              onChange={(e) => setForm((f) => ({ ...f, email_provider: e.target.value }))}
              disabled={isPending}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 ring-ring disabled:opacity-60"
            >
              <option value="auto">Auto-detect from my email</option>
              <option value="gmail">Gmail (mail.google.com)</option>
              <option value="outlook">Outlook / Hotmail (outlook.live.com)</option>
              <option value="outlook365">Microsoft 365 (outlook.office.com)</option>
              <option value="mailto">Default mail app</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Controls where &ldquo;Open in email&rdquo; links open. Auto-detect works for
              @gmail.com, @outlook.com, and @hotmail.com accounts.
            </p>
          </div>
        </div>

        <div className="space-y-3 max-w-md">
          <h3 className="text-sm font-semibold">Email signature</h3>
          <textarea
            value={form.email_signature}
            onChange={set("email_signature")}
            rows={5}
            placeholder={"Jane Smith | Acme Commercial RE\n(305) 555-0100 | jane@acme.com"}
            disabled={isPending}
            className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background resize-none disabled:opacity-60"
          />
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Cadence (days between outreach)</h3>
          <p className="text-xs text-muted-foreground">
            Contacts become overdue when this many days have passed since last contact.
          </p>
          <div className="flex gap-4">
            {(
              [
                { key: "cadence_tier1_days" as const, label: "Tier 1" },
                { key: "cadence_tier2_days" as const, label: "Tier 2" },
                { key: "cadence_tier3_days" as const, label: "Tier 3" },
              ]
            ).map(({ key, label }) => (
              <div key={key} className="space-y-1.5 w-24">
                <Label htmlFor={key}>{label}</Label>
                <Input
                  id={key}
                  type="number"
                  min="1"
                  value={form[key]}
                  onChange={set(key)}
                  disabled={isPending}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending} size="sm">
            {isPending && <Loader2 className="animate-spin" />}
            Save
          </Button>
          <SaveFeedback saved={saved} error={saveError} />
        </div>
      </form>
    </div>
  );
}

// ─── Data Management section ──────────────────────────────────────────────────

function DataManagementSection() {
  const exports = [
    { label: "Properties", href: "/api/export/properties", description: "All properties as XLSX" },
    { label: "Contacts",   href: "/api/export/contacts",   description: "All contacts as XLSX" },
    { label: "Leases",     href: "/api/export/leases",     description: "All lease abstracts as XLSX" },
  ];

  return (
    <div className="space-y-6">
      <SectionHeading title="Data Management" description="Export your data and run data quality audits." />
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Export</h3>
        <div className="space-y-2 max-w-sm">
          {exports.map((ex) => (
            <a
              key={ex.href}
              href={ex.href}
              download
              className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3 hover:bg-muted/40 transition-colors group"
            >
              <div>
                <p className="text-sm font-medium">{ex.label}</p>
                <p className="text-xs text-muted-foreground">{ex.description}</p>
              </div>
              <Download className="size-4 text-muted-foreground group-hover:text-foreground shrink-0 transition-colors" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Appearance section ───────────────────────────────────────────────────────

function AppearanceSection() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = localStorage.getItem("beacon-theme");
    if (stored === "dark" || stored === "light") setTheme(stored);
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) setTheme("dark");
  }, []);

  function applyTheme(t: "light" | "dark") {
    setTheme(t);
    localStorage.setItem("beacon-theme", t);
    if (t === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeading title="Appearance" description="Theme and display preferences." />
      <div className="space-y-3 max-w-xs">
        <h3 className="text-sm font-semibold">Theme</h3>
        <div className="flex gap-2">
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => applyTheme(t)}
              className={cn(
                "flex-1 flex flex-col items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors",
                theme === t
                  ? "border-primary bg-primary/5 text-primary font-medium"
                  : "border-border text-muted-foreground hover:bg-muted/40"
              )}
            >
              {t === "light" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              {t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Danger Zone section ──────────────────────────────────────────────────────

function DangerZoneSection() {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (confirm !== "DELETE") return;
    setError(null);
    setIsPending(true);
    try {
      const result = await deleteAllData();
      if (result.error) { setError(result.error); return; }
      router.push("/login");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeading title="Danger Zone" description="Irreversible actions that permanently delete your data." />
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-5 space-y-4 max-w-md">
        <div>
          <p className="text-sm font-semibold text-destructive">Delete all data</p>
          <p className="text-xs text-muted-foreground mt-1">
            Permanently deletes all properties, contacts, leases, activities, follow-ups, and custom
            fields. This cannot be undone. Your login credentials are preserved.
          </p>
        </div>
        <form onSubmit={handleDelete} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="danger_confirm" className="text-xs">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </Label>
            <Input
              id="danger_confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="DELETE"
              disabled={isPending}
              className="font-mono max-w-[160px]"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            variant="destructive"
            size="sm"
            disabled={confirm !== "DELETE" || isPending}
          >
            {isPending && <Loader2 className="animate-spin" />}
            Delete all data
          </Button>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [section, setSection] = useState<Section>("account");
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [errorCount, setErrorCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getUserSettings().then(setSettings),
      getIngestionErrorCount().then(setErrorCount),
    ]).finally(() => setLoading(false));

    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) setUserEmail(user.email);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Account, brokerage, data sources, and platform preferences.{" "}
          <Link
            href="/how-beacon-works"
            className="text-foreground/80 hover:text-foreground underline underline-offset-4 decoration-muted-foreground/40"
          >
            How Beacon works
          </Link>
        </p>
      </div>

      <div className="flex gap-8">
        <nav className="w-44 shrink-0 space-y-0.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSection(s.key)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors text-left",
                  section === s.key
                    ? "bg-primary/8 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <Icon
                  className={cn(
                    "size-3.5 shrink-0",
                    section === s.key ? "text-primary" : "text-muted-foreground/70"
                  )}
                />
                {s.label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0">
          {section === "account" && settings && (
            <AccountSection settings={settings} userEmail={userEmail} onSaved={setSettings} />
          )}
          {section === "brokerage" && settings && (
            <BrokerageSection settings={settings} onSaved={setSettings} />
          )}
          {section === "data-sources" && settings && (
            <DataSourcesSection errorCount={errorCount} settings={settings} onSaved={setSettings} />
          )}
          {section === "outreach" && settings && (
            <OutreachSection settings={settings} onSaved={setSettings} />
          )}
          {section === "data" && <DataManagementSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "danger" && <DangerZoneSection />}
        </div>
      </div>
    </div>
  );
}
