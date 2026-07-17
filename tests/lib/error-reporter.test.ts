// Tests for lib/error-reporter.ts using the real implementation.
// No top-level vi.mock() here — we test the actual fetch calls.

import { describe, expect, it, vi, afterEach } from "vitest";
import { captureException } from "@/lib/error-reporter";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("captureException", () => {
  it("does nothing when BEACON_ERROR_DSN is not set", async () => {
    vi.stubEnv("BEACON_ERROR_DSN", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await captureException(new Error("test"), { action: "test" });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does nothing when BEACON_ERROR_DSN is undefined", async () => {
    delete process.env.BEACON_ERROR_DSN;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await captureException(new Error("test"), { action: "test" });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs structured JSON to a generic webhook URL", async () => {
    vi.stubEnv("BEACON_ERROR_DSN", "https://webhook.example.com/errors");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));

    await captureException(new Error("boom"), {
      action: "createContact",
      userId: "user-1",
      context: { name: "Alice" },
      severity: "error",
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://webhook.example.com/errors");
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const body = JSON.parse(opts.body as string);
    expect(body.action).toBe("createContact");
    expect(body.message).toBe("boom");
    expect(body.userId).toBe("user-1");
    expect(body.severity).toBe("error");
    expect(body.context).toEqual({ name: "Alice" });
    expect(body.timestamp).toBeTruthy();
  });

  it("POSTs to the Sentry store endpoint when DSN is a Sentry DSN", async () => {
    vi.stubEnv("BEACON_ERROR_DSN", "https://abc123@o999.ingest.sentry.io/12345");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));

    await captureException(new Error("sentry-test"), { action: "logOutreach" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/12345/store/");
    const authHeader = (opts.headers as Record<string, string>)["X-Sentry-Auth"];
    expect(authHeader).toContain("sentry_key=abc123");
    expect(authHeader).toContain("sentry_version=7");

    const body = JSON.parse(opts.body as string);
    expect(body.exception.values[0].value).toBe("sentry-test");
    expect(body.transaction).toBe("logOutreach");
    expect(body.level).toBe("error");
    expect(body.event_id).toBeTruthy();
  });

  it("includes userId as Sentry user when provided", async () => {
    vi.stubEnv("BEACON_ERROR_DSN", "https://key@o1.ingest.sentry.io/9");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));

    await captureException(new Error("x"), { action: "y", userId: "user-42" });

    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.user.id).toBe("user-42");
  });

  it("falls back to generic webhook when DSN has no project ID", async () => {
    vi.stubEnv("BEACON_ERROR_DSN", "https://key@sentry.io/notanumber");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));

    await captureException(new Error("x"), { action: "y" });

    // Should POST to the raw DSN as a webhook, not a Sentry store URL
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("/api/");
  });

  it("never throws when fetch rejects", async () => {
    vi.stubEnv("BEACON_ERROR_DSN", "https://webhook.example.com/errors");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    await expect(
      captureException(new Error("x"), { action: "y" })
    ).resolves.toBeUndefined();
  });

  it("never throws when fetch returns a non-2xx status", async () => {
    vi.stubEnv("BEACON_ERROR_DSN", "https://webhook.example.com/errors");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("error", { status: 500 }));

    await expect(
      captureException(new Error("x"), { action: "y" })
    ).resolves.toBeUndefined();
  });

  it("uses warn severity when specified", async () => {
    vi.stubEnv("BEACON_ERROR_DSN", "https://webhook.example.com/errors");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));

    await captureException(new Error("low priority"), { action: "z", severity: "warn" });

    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.severity).toBe("warn");
  });
});
