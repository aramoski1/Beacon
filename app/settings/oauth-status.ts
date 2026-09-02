"use server";

import { OAUTH_PROVIDERS, oauthConfigured, type OauthProvider } from "@/lib/oauth-providers";

export async function getOauthStatus(): Promise<Record<OauthProvider, boolean>> {
  const out = {} as Record<OauthProvider, boolean>;
  for (const p of OAUTH_PROVIDERS) {
    out[p.id] = oauthConfigured(p.id);
  }
  return out;
}
