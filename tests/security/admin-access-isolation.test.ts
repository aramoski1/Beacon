/**
 * Invite-only signup + admin-only access — scripts/migrate-invite-only.ts.
 *
 * The app-level gate in app/admin/actions.ts (tests/server/admin-actions.test.ts)
 * is only a convenience layer; the real boundary is the database. This proves
 * that boundary against real Postgres/RLS, through genuinely RLS-enforced
 * clients (never service-role, never DATABASE_URL) for every assertion:
 *
 *   - A non-admin's client cannot read approved_emails or access_requests at
 *     all (RLS), and cannot insert into approved_emails to self-approve.
 *   - Calling admin_list_accounts() as a non-admin returns zero rows, even
 *     though the function itself can see auth.users — its own internal
 *     is_admin() check filters everything out for a non-admin caller.
 *   - An admin's client can read both tables and admin_list_accounts()
 *     genuinely returns other users' identity (email/signup date), proving
 *     the admin view works — without ever touching their properties/
 *     contacts/deals, which this suite never queries.
 *   - The two SECURITY DEFINER functions the pre-auth signup flow depends on
 *     (is_email_approved, record_access_request) work for a plain anon-key
 *     client with no session at all, matching how signUp() actually calls
 *     them before the user exists.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import {
  DATABASE_URL,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  HAS_SUPABASE_TEST_CREDS,
  createSignedInTestUser,
  type TestUser,
} from "./_test-helpers";

const d = HAS_SUPABASE_TEST_CREDS ? describe : describe.skip;

if (!HAS_SUPABASE_TEST_CREDS) {
  // eslint-disable-next-line no-console
  console.warn(
    "[admin-access-isolation.test.ts] Skipping — DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL / " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY not available (checked process.env and .env.local).",
  );
}

d("Invite-only + admin access isolation (real RLS-enforced Supabase clients)", () => {
  let pg: Client;
  let admin: TestUser;
  let regular: TestUser;
  let approvedEmailId: string;
  const approvedTestEmail = `beacon-approved-${Date.now()}@beacon-pilot-test.local`;
  const unapprovedTestEmail = `beacon-unapproved-${Date.now()}@beacon-pilot-test.local`;

  beforeAll(async () => {
    pg = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pg.connect();

    admin = await createSignedInTestUser(pg, "admin-access-admin");
    regular = await createSignedInTestUser(pg, "admin-access-regular");

    await pg.query(`INSERT INTO user_settings (owner_id, is_admin) VALUES ($1, true)`, [admin.id]);

    const { rows } = await pg.query(
      `INSERT INTO approved_emails (email, added_by) VALUES ($1, $2) RETURNING id`,
      [approvedTestEmail, admin.id],
    );
    approvedEmailId = rows[0].id as string;
  }, 60_000);

  afterAll(async () => {
    if (pg) {
      await pg.query(`DELETE FROM approved_emails WHERE email IN ($1, $2)`, [approvedTestEmail, unapprovedTestEmail]).catch(() => {});
      await pg.query(`DELETE FROM access_requests WHERE email IN ($1, $2)`, [approvedTestEmail, unapprovedTestEmail]).catch(() => {});
      if (admin?.id) await pg.query(`DELETE FROM auth.users WHERE id = $1`, [admin.id]);
      if (regular?.id) await pg.query(`DELETE FROM auth.users WHERE id = $1`, [regular.id]);
    }
    await pg?.end();
  }, 30_000);

  it("seeded a distinct admin and a distinct regular user", () => {
    expect(admin.id).not.toBe(regular.id);
    expect(approvedEmailId).toBeTruthy();
  });

  describe("approved_emails / access_requests — RLS", () => {
    it("a non-admin cannot read approved_emails at all", async () => {
      const { data, error } = await regular.client.from("approved_emails").select("id, email");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a non-admin cannot insert into approved_emails to self-approve", async () => {
      const { error } = await regular.client
        .from("approved_emails")
        .insert({ email: regular.email });
      expect(error).not.toBeNull();
    });

    it("a non-admin cannot read access_requests at all", async () => {
      const { data, error } = await regular.client.from("access_requests").select("id, email");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("an admin can read approved_emails and sees the seeded row", async () => {
      const { data, error } = await admin.client
        .from("approved_emails")
        .select("id, email")
        .eq("id", approvedEmailId);
      expect(error).toBeNull();
      expect(data).toEqual([{ id: approvedEmailId, email: approvedTestEmail }]);
    });

    it("an admin can insert and delete approved_emails rows", async () => {
      const { data: inserted, error: insertError } = await admin.client
        .from("approved_emails")
        .insert({ email: unapprovedTestEmail })
        .select("id")
        .single();
      expect(insertError).toBeNull();
      expect(inserted?.id).toBeTruthy();

      const { error: deleteError } = await admin.client
        .from("approved_emails")
        .delete()
        .eq("id", inserted!.id as string);
      expect(deleteError).toBeNull();
    });
  });

  describe("admin_list_accounts() — SECURITY DEFINER accounts view", () => {
    it("returns zero rows for a non-admin caller, even though the function can see auth.users", async () => {
      const { data, error } = await regular.client.rpc("admin_list_accounts");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("returns real accounts (including the non-admin's) for the admin caller", async () => {
      const { data, error } = await admin.client.rpc("admin_list_accounts");
      expect(error).toBeNull();
      const rows = (data ?? []) as { user_id: string; email: string }[];
      expect(rows.some((r) => r.user_id === regular.id && r.email === regular.email)).toBe(true);
      expect(rows.some((r) => r.user_id === admin.id && r.email === admin.email)).toBe(true);
    });
  });

  describe("is_email_approved / record_access_request — pre-auth signup path", () => {
    it("an unauthenticated (anon-key, no session) client can check an approved email and gets true", async () => {
      const anon = createAnonClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
      const { data, error } = await anon.rpc("is_email_approved", { check_email: approvedTestEmail });
      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it("an unauthenticated client gets false for a genuinely non-approved email", async () => {
      const anon = createAnonClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
      const { data, error } = await anon.rpc("is_email_approved", { check_email: unapprovedTestEmail });
      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it("an unauthenticated client can record an access request, but still cannot read approved_emails/access_requests directly", async () => {
      const anon = createAnonClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
      const { error: rpcError } = await anon.rpc("record_access_request", { requested_email: unapprovedTestEmail });
      expect(rpcError).toBeNull();

      const { data: reqData } = await anon.from("access_requests").select("id");
      expect(reqData).toEqual([]);
      const { data: approvedData } = await anon.from("approved_emails").select("id");
      expect(approvedData).toEqual([]);

      const { rows } = await pg.query(`SELECT email FROM access_requests WHERE email = $1`, [unapprovedTestEmail]);
      expect(rows).toHaveLength(1);
    });
  });
});
