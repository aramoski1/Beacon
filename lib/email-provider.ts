// Pure utility for detecting the user's email provider and building compose URLs.
// No server imports — safe in both client and server contexts.

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmailProvider = "gmail" | "outlook" | "outlook365" | "mailto";

// Stored in user_settings.email_provider; null = auto-detect from sender domain.
export type EmailProviderSetting = EmailProvider | null;

// ─── Detection ────────────────────────────────────────────────────────────────

const GMAIL_DOMAINS       = new Set(["gmail.com", "googlemail.com"]);
const OUTLOOK_PERSONAL    = new Set(["outlook.com", "hotmail.com", "live.com", "msn.com"]);
const OUTLOOK_WORK        = new Set(["microsoft.com", "windowslive.com"]);

export function detectProvider(
  senderEmail: string | null,
  override: EmailProviderSetting
): EmailProvider {
  if (override === "gmail")      return "gmail";
  if (override === "outlook")    return "outlook";
  if (override === "outlook365") return "outlook365";
  if (override === "mailto")     return "mailto";

  if (!senderEmail) return "mailto";
  const domain = senderEmail.split("@")[1]?.toLowerCase() ?? "";
  if (GMAIL_DOMAINS.has(domain))    return "gmail";
  if (OUTLOOK_PERSONAL.has(domain)) return "outlook";
  if (OUTLOOK_WORK.has(domain))     return "outlook365";
  return "mailto";
}

// ─── URL builder ──────────────────────────────────────────────────────────────

export function buildComposeUrl(
  to: string,
  subject: string,
  body: string,
  provider: EmailProvider
): string {
  const t  = encodeURIComponent(to);
  const su = encodeURIComponent(subject);
  const bo = encodeURIComponent(body);

  if (provider === "gmail") {
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${t}&su=${su}&body=${bo}`;
  }

  if (provider === "outlook") {
    return `https://outlook.live.com/mail/0/deeplink/compose?to=${t}&subject=${su}&body=${bo}`;
  }

  if (provider === "outlook365") {
    return `https://outlook.office.com/mail/deeplink/compose?to=${t}&subject=${su}&body=${bo}`;
  }

  return `mailto:${to}?subject=${su}&body=${bo}`;
}

// Convenience wrapper: detect + build in one call.
export function composeUrl(
  to: string | null | undefined,
  subject: string,
  body: string,
  senderEmail: string | null,
  override: EmailProviderSetting
): string | null {
  if (!to) return null;
  const provider = detectProvider(senderEmail, override);
  return buildComposeUrl(to, subject, body, provider);
}

// True when the URL should open in a new browser tab (i.e. web compose, not mailto:).
export function isWebCompose(url: string): boolean {
  return url.startsWith("https://");
}

// ─── localStorage helpers (client-only) ──────────────────────────────────────

export const LS_USER_EMAIL    = "beacon_user_email";
export const LS_EMAIL_PROVIDER = "beacon_email_provider";

// Read the effective provider from localStorage (for client components that
// can't receive it as a prop). Returns null on SSR / before hydration.
export function readStoredProvider(): EmailProviderSetting {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(LS_EMAIL_PROVIDER);
  if (v === "gmail" || v === "outlook" || v === "outlook365" || v === "mailto") return v;
  return null;
}

export function readStoredUserEmail(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LS_USER_EMAIL);
}

// Human-readable label for display in the settings select.
export const PROVIDER_LABELS: Record<string, string> = {
  auto:        "Auto-detect from my email",
  gmail:       "Gmail (mail.google.com)",
  outlook:     "Outlook / Hotmail (outlook.live.com)",
  outlook365:  "Microsoft 365 (outlook.office.com)",
  mailto:      "Default mail app",
};
