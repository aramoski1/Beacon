// Shared Jina AI Reader fetch — renders JavaScript and returns clean text.
// Handles Zillow, LoopNet, Crexi, etc. Used by both new-property URL ingestion
// (app/properties/url/actions.ts) and existing-property document enhancement
// (app/properties/[id]/actions.ts).

function isBlockedPageText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    text.length < 200 ||
    lower.includes("access denied") ||
    lower.includes("performing security verification") ||
    text.includes("Ray ID:") ||
    lower.includes("just a moment")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchListingText(url: string): Promise<string> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-Return-Format": "text",
    "X-Timeout": "60",
    // Fresh fetch — Jina caches ~1h; a cached Cloudflare challenge looks like a block.
    "X-No-Cache": "true",
    // Do NOT set X-Engine: browser — on some sites (e.g. CommercialCafe) that triggers
    // Cloudflare while the default auto engine succeeds.
  };
  if (process.env.JINA_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.JINA_API_KEY}`;
  }

  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(2000);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 70_000);
    try {
      const res = await fetch(jinaUrl, { signal: controller.signal, headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = (await res.text()).trim().slice(0, 30_000);
      if (isBlockedPageText(text)) {
        if (attempt < maxAttempts - 1) continue;
        throw new Error("blocked");
      }
      return text;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "blocked" && attempt < maxAttempts - 1) continue;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("blocked");
}
