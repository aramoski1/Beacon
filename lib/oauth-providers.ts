export type OauthProvider =
  | "google_gmail"
  | "google_calendar"
  | "microsoft_mail"
  | "microsoft_calendar"
  | "docusign";

export const OAUTH_PROVIDERS: {
  id: OauthProvider;
  label: string;
  envKeys: string[];
  description: string;
}[] = [
  {
    id: "google_gmail",
    label: "Gmail send",
    envKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    description: "Send outreach from Beacon via Gmail (OAuth). Until keys are set, drafts still open in Gmail compose.",
  },
  {
    id: "google_calendar",
    label: "Google Calendar",
    envKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    description: "Sync tours and LOI dates to Google Calendar.",
  },
  {
    id: "microsoft_mail",
    label: "Outlook send",
    envKeys: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    description: "Send outreach via Microsoft Graph.",
  },
  {
    id: "microsoft_calendar",
    label: "Outlook Calendar",
    envKeys: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    description: "Sync tours to Outlook calendar.",
  },
  {
    id: "docusign",
    label: "DocuSign",
    envKeys: ["DOCUSIGN_INTEGRATION_KEY", "DOCUSIGN_USER_ID", "DOCUSIGN_ACCOUNT_ID"],
    description: "Send deal documents for signature.",
  },
];

export function oauthConfigured(provider: OauthProvider): boolean {
  const spec = OAUTH_PROVIDERS.find((p) => p.id === provider);
  if (!spec) return false;
  return spec.envKeys.every((k) => Boolean(process.env[k]?.trim()));
}
