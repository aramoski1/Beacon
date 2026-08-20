/**
 * Shared harness for live security integration tests: real Supabase auth
 * users (direct SQL insert, bypassing the email-confirmation flow that
 * hits Supabase's rate limit almost immediately on repeated runs), signed
 * in via the real signInWithPassword() API so every assertion in the tests
 * that use this runs through a genuinely RLS-enforced client — never the
 * service role, never DATABASE_URL. DATABASE_URL (direct Postgres, bypasses
 * RLS) is used ONLY for setup/teardown/verification, never to perform the
 * action under test.
 */

import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "fs";
import path from "path";

export function loadEnvLocal(): void {
  if (process.env.DATABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const envPath = path.resolve(__dirname, "../../.env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

export const DATABASE_URL = process.env.DATABASE_URL;
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const HAS_SUPABASE_TEST_CREDS = Boolean(DATABASE_URL && SUPABASE_URL && SUPABASE_ANON_KEY);

export type TestUser = { id: string; email: string; client: SupabaseClient };

export async function createSignedInTestUser(pg: Client, label: string): Promise<TestUser> {
  const email = `beacon-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@beacon-pilot-test.local`;
  const password = `Test-${Math.random().toString(36).slice(2)}-Pw1!`;

  const { rows } = await pg.query(
    `INSERT INTO auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at, confirmation_token, recovery_token,
       email_change_token_new, email_change, is_sso_user, is_anonymous
     ) VALUES (
       '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       $1, crypt($2, gen_salt('bf')),
       now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       now(), now(), '', '', '', '', false, false
     ) RETURNING id`,
    [email, password],
  );
  const id = rows[0].id as string;

  await pg.query(
    `INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
     VALUES (gen_random_uuid(), $1::uuid, $1::text, jsonb_build_object('sub', $1::text, 'email', $2::text), 'email', now(), now(), now())`,
    [id, email],
  );

  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`Failed to sign in test user ${label}: ${error?.message}`);
  }

  return { id, email, client };
}

/** Best-effort cleanup — safe to call even if the user was already deleted by the test itself. */
export async function deleteTestUserIfExists(pg: Client, userId: string | undefined): Promise<void> {
  if (!userId) return;
  await pg.query(`DELETE FROM auth.users WHERE id = $1`, [userId]).catch(() => {});
}

/**
 * Team/firm test fixtures. Like createSignedInTestUser, these use the raw
 * DATABASE_URL client (bypasses RLS) ONLY for setup — never to perform the
 * action under test. Mirrors migrate-firms.ts's shape exactly.
 */
export async function createFirm(pg: Client, name: string, createdBy: string): Promise<string> {
  const { rows } = await pg.query(
    `INSERT INTO firms (id, name, created_by) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
    [name, createdBy],
  );
  return rows[0].id as string;
}

export async function addFirmMember(
  pg: Client,
  firmId: string,
  userId: string,
  role: "owner" | "admin" | "member",
): Promise<void> {
  await pg.query(
    `INSERT INTO firm_members (firm_id, user_id, role, status) VALUES ($1, $2, $3, 'active')`,
    [firmId, userId, role],
  );
}

export async function setFirmMemberStatus(
  pg: Client,
  firmId: string,
  userId: string,
  status: "active" | "removed",
): Promise<void> {
  await pg.query(`UPDATE firm_members SET status = $3 WHERE firm_id = $1 AND user_id = $2`, [firmId, userId, status]);
}
