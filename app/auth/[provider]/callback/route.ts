import { NextResponse } from "next/server";
import { oauthConfigured, type OauthProvider } from "@/lib/oauth-providers";

const PROVIDERS: OauthProvider[] = [
  "google_gmail",
  "google_calendar",
  "microsoft_mail",
  "microsoft_calendar",
  "docusign",
];

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ provider: string }> },
) {
  const { provider } = await ctx.params;
  if (!PROVIDERS.includes(provider as OauthProvider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }
  if (!oauthConfigured(provider as OauthProvider)) {
    return NextResponse.json(
      {
        error: "This connection is not configured yet. Add the OAuth env vars on Vercel, then reconnect.",
        provider,
      },
      { status: 501 },
    );
  }
  return NextResponse.json(
    { error: "OAuth app is configured, but token exchange is not wired in this build yet." },
    { status: 501 },
  );
}
