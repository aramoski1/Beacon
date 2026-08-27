/**
 * app/admin/actions.ts — the app-level admin gate on every admin action.
 *
 * The REAL security boundary is the database: RLS on approved_emails/
 * access_requests (is_admin()) and admin_list_accounts()'s own internal
 * is_admin() re-check (see scripts/migrate-invite-only.ts and
 * tests/security/admin-access-isolation.test.ts for that boundary proven
 * against a real Postgres instance). These tests cover the app-level guard
 * in front of it: an unauthenticated or non-admin caller is rejected before
 * ever touching approved_emails/access_requests/admin_list_accounts, and an
 * admin's request proceeds and gets real data back.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import {
  getApprovedEmails,
  addApprovedEmail,
  removeApprovedEmail,
  getPendingAccessRequests,
  approveAccessRequest,
  dismissAccessRequest,
  getAllAccounts,
} from "@/app/admin/actions";

// A mock query-builder that ignores which chain methods were called and
// just resolves to a fixed result — enough for every shape used here
// (select/eq/maybeSingle, select/order, insert, delete/eq, update/eq).
function chainable(result: { data: unknown; error: unknown }) {
  const p = Promise.resolve(result);
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return p.then.bind(p);
        if (prop === "catch") return p.catch.bind(p);
        return () => proxy;
      },
    },
  );
  return proxy;
}

function fakeSupabase(opts: {
  authUser: { id: string } | null;
  isAdmin?: boolean;
  tableResults?: Record<string, { data: unknown; error: unknown }>;
  rpcResult?: { data: unknown; error: unknown };
}) {
  const fromCalls: string[] = [];
  const from = vi.fn((table: string) => {
    fromCalls.push(table);
    if (table === "user_settings") {
      return chainable({ data: opts.authUser ? { is_admin: opts.isAdmin ?? false } : null, error: null });
    }
    return chainable(opts.tableResults?.[table] ?? { data: null, error: null });
  });
  const rpc = vi.fn(() => Promise.resolve(opts.rpcResult ?? { data: null, error: null }));
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: opts.authUser } }) },
    from,
    rpc,
    fromCalls,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("admin actions — unauthenticated caller", () => {
  const cases: [string, () => Promise<unknown>][] = [
    ["getApprovedEmails", () => getApprovedEmails()],
    ["addApprovedEmail", () => addApprovedEmail("new@example.com")],
    ["removeApprovedEmail", () => removeApprovedEmail("id-1")],
    ["getPendingAccessRequests", () => getPendingAccessRequests()],
    ["approveAccessRequest", () => approveAccessRequest("req-1", "a@example.com")],
    ["dismissAccessRequest", () => dismissAccessRequest("req-1")],
    ["getAllAccounts", () => getAllAccounts()],
  ];

  for (const [name, run] of cases) {
    it(`${name} returns "Not authenticated." without querying user_settings`, async () => {
      const supabase = fakeSupabase({ authUser: null });
      (createClient as Mock).mockResolvedValue(supabase);
      const result = await run();
      expect(result).toEqual({ error: "Not authenticated." });
      expect(supabase.from).not.toHaveBeenCalledWith("user_settings");
    });
  }
});

describe("admin actions — authenticated non-admin caller", () => {
  const cases: [string, () => Promise<unknown>][] = [
    ["getApprovedEmails", () => getApprovedEmails()],
    ["addApprovedEmail", () => addApprovedEmail("new@example.com")],
    ["removeApprovedEmail", () => removeApprovedEmail("id-1")],
    ["getPendingAccessRequests", () => getPendingAccessRequests()],
    ["approveAccessRequest", () => approveAccessRequest("req-1", "a@example.com")],
    ["dismissAccessRequest", () => dismissAccessRequest("req-1")],
    ["getAllAccounts", () => getAllAccounts()],
  ];

  for (const [name, run] of cases) {
    it(`${name} returns "Not authorized." and never touches the underlying table/RPC`, async () => {
      const supabase = fakeSupabase({ authUser: { id: "user-1" }, isAdmin: false });
      (createClient as Mock).mockResolvedValue(supabase);
      const result = await run();
      expect(result).toEqual({ error: "Not authorized." });
      expect(supabase.from).not.toHaveBeenCalledWith("approved_emails");
      expect(supabase.from).not.toHaveBeenCalledWith("access_requests");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  }
});

describe("admin actions — authenticated admin caller", () => {
  it("getApprovedEmails returns the real list", async () => {
    const supabase = fakeSupabase({
      authUser: { id: "admin-1" },
      isAdmin: true,
      tableResults: {
        approved_emails: {
          data: [{ id: "e1", email: "broker@example.com", created_at: "2026-01-01T00:00:00Z" }],
          error: null,
        },
      },
    });
    (createClient as Mock).mockResolvedValue(supabase);
    const result = await getApprovedEmails();
    expect(result).toEqual([{ id: "e1", email: "broker@example.com", createdAt: "2026-01-01T00:00:00Z" }]);
  });

  it("addApprovedEmail rejects an invalid email without touching the table", async () => {
    const supabase = fakeSupabase({ authUser: { id: "admin-1" }, isAdmin: true });
    (createClient as Mock).mockResolvedValue(supabase);
    const result = await addApprovedEmail("not-an-email");
    expect(result).toEqual({ error: "Enter a valid email address." });
    expect(supabase.from).not.toHaveBeenCalledWith("approved_emails");
  });

  it("addApprovedEmail inserts a valid email and returns the real inserted row", async () => {
    const supabase = fakeSupabase({
      authUser: { id: "admin-1" },
      isAdmin: true,
      tableResults: {
        approved_emails: {
          data: { id: "e-real", email: "new@example.com", created_at: "2026-01-01T00:00:00Z" },
          error: null,
        },
      },
    });
    (createClient as Mock).mockResolvedValue(supabase);
    const result = await addApprovedEmail("New@Example.com");
    expect(result).toEqual({
      ok: true,
      entry: { id: "e-real", email: "new@example.com", createdAt: "2026-01-01T00:00:00Z" },
    });
  });

  it("removeApprovedEmail succeeds", async () => {
    const supabase = fakeSupabase({
      authUser: { id: "admin-1" },
      isAdmin: true,
      tableResults: { approved_emails: { data: null, error: null } },
    });
    (createClient as Mock).mockResolvedValue(supabase);
    const result = await removeApprovedEmail("e1");
    expect(result).toEqual({ ok: true });
  });

  it("getPendingAccessRequests returns the real list", async () => {
    const supabase = fakeSupabase({
      authUser: { id: "admin-1" },
      isAdmin: true,
      tableResults: {
        access_requests: {
          data: [{ id: "r1", email: "wants-in@example.com", requested_at: "2026-01-01T00:00:00Z" }],
          error: null,
        },
      },
    });
    (createClient as Mock).mockResolvedValue(supabase);
    const result = await getPendingAccessRequests();
    expect(result).toEqual([{ id: "r1", email: "wants-in@example.com", requestedAt: "2026-01-01T00:00:00Z" }]);
  });

  it("approveAccessRequest inserts into approved_emails and marks the request reviewed", async () => {
    const supabase = fakeSupabase({
      authUser: { id: "admin-1" },
      isAdmin: true,
      tableResults: {
        approved_emails: {
          data: { id: "e-real", email: "wants-in@example.com", created_at: "2026-01-01T00:00:00Z" },
          error: null,
        },
        access_requests: { data: null, error: null },
      },
    });
    (createClient as Mock).mockResolvedValue(supabase);
    const result = await approveAccessRequest("r1", "wants-in@example.com");
    expect(result).toEqual({
      ok: true,
      entry: { id: "e-real", email: "wants-in@example.com", createdAt: "2026-01-01T00:00:00Z" },
    });
    expect(supabase.from).toHaveBeenCalledWith("approved_emails");
    expect(supabase.from).toHaveBeenCalledWith("access_requests");
  });

  it("dismissAccessRequest succeeds", async () => {
    const supabase = fakeSupabase({
      authUser: { id: "admin-1" },
      isAdmin: true,
      tableResults: { access_requests: { data: null, error: null } },
    });
    (createClient as Mock).mockResolvedValue(supabase);
    const result = await dismissAccessRequest("r1");
    expect(result).toEqual({ ok: true });
  });

  it("getAllAccounts calls admin_list_accounts and maps the result", async () => {
    const supabase = fakeSupabase({
      authUser: { id: "admin-1" },
      isAdmin: true,
      rpcResult: {
        data: [{
          user_id: "u1",
          email: "broker@example.com",
          created_at: "2026-01-01T00:00:00Z",
          display_name: "Jane Broker",
          company: "Acme Realty",
          firm_name: "Acme Firm",
        }],
        error: null,
      },
    });
    (createClient as Mock).mockResolvedValue(supabase);
    const result = await getAllAccounts();
    expect(result).toEqual([{
      userId: "u1",
      email: "broker@example.com",
      createdAt: "2026-01-01T00:00:00Z",
      displayName: "Jane Broker",
      company: "Acme Realty",
      firmName: "Acme Firm",
    }]);
    expect(supabase.rpc).toHaveBeenCalledWith("admin_list_accounts");
  });
});
