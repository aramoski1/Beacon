/**
 * signUp (app/login/actions.ts) — invite-only gate.
 *
 * The allowlist check runs via a SECURITY DEFINER RPC (is_email_approved),
 * not a direct table read, since this executes pre-auth as the anon role —
 * see scripts/migrate-invite-only.ts. These tests cover the gate itself:
 * a non-approved email is rejected before auth.signUp is ever called and
 * gets logged as an access request; an approved email proceeds through the
 * existing pilot flow untouched.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth-pilot-confirm", () => ({ pilotConfirmUserEmail: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/firms", () => ({ ensurePersonalFirm: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }),
}));

import { createClient } from "@/lib/supabase/server";
import { signUp } from "@/app/login/actions";

function formData(email: string, password = "password123"): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

function fakeSupabase(opts: {
  isEmailApprovedResult: { data: boolean | null; error: { message: string } | null };
}) {
  const rpc = vi.fn((fn: string) => {
    if (fn === "is_email_approved") return Promise.resolve(opts.isEmailApprovedResult);
    if (fn === "record_access_request") return Promise.resolve({ data: null, error: null });
    throw new Error(`unexpected rpc: ${fn}`);
  });
  const signUpMock = vi.fn().mockResolvedValue({
    data: { session: { access_token: "x" }, user: { id: "user-1" } },
    error: null,
  });
  const signInWithPasswordMock = vi.fn().mockResolvedValue({ error: null });
  return {
    rpc,
    auth: { signUp: signUpMock, signInWithPassword: signInWithPasswordMock },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("signUp — invite-only gate", () => {
  it("blocks a non-approved email with the invite-only message, without calling auth.signUp", async () => {
    const supabase = fakeSupabase({ isEmailApprovedResult: { data: false, error: null } });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await signUp(null, formData("stranger@example.com"));

    expect(result).toEqual({ error: "Beacon is currently invite-only — contact us for access." });
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
  });

  it("logs a non-approved attempt as an access request", async () => {
    const supabase = fakeSupabase({ isEmailApprovedResult: { data: false, error: null } });
    (createClient as Mock).mockResolvedValue(supabase);

    await signUp(null, formData("stranger@example.com"));

    expect(supabase.rpc).toHaveBeenCalledWith("record_access_request", { requested_email: "stranger@example.com" });
  });

  it("fails closed (blocks signup) when the allowlist check itself errors", async () => {
    const supabase = fakeSupabase({ isEmailApprovedResult: { data: null, error: { message: "db down" } } });
    (createClient as Mock).mockResolvedValue(supabase);

    const result = await signUp(null, formData("maybe@example.com"));

    expect(result).toEqual({ error: "Beacon is currently invite-only — contact us for access." });
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
  });

  it("proceeds to auth.signUp for an approved email", async () => {
    const supabase = fakeSupabase({ isEmailApprovedResult: { data: true, error: null } });
    (createClient as Mock).mockResolvedValue(supabase);

    await expect(signUp(null, formData("broker@example.com"))).rejects.toThrow("NEXT_REDIRECT");

    expect(supabase.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "broker@example.com", password: "password123" }),
    );
  });

  it("does not log an access request for an approved email", async () => {
    const supabase = fakeSupabase({ isEmailApprovedResult: { data: true, error: null } });
    (createClient as Mock).mockResolvedValue(supabase);

    await expect(signUp(null, formData("broker@example.com"))).rejects.toThrow("NEXT_REDIRECT");

    expect(supabase.rpc).not.toHaveBeenCalledWith("record_access_request", expect.anything());
  });
});
