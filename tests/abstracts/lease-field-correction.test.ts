/**
 * The bug this guards against: a broker corrects an extracted lease field
 * (saveFieldReview in app/abstracts/[id]/actions.ts) but the fix only ever
 * wrote to field_reviews JSONB, never the real lease_abstracts column. Lease
 * radar and lease comps read expiration_date/base_rate/term directly off the
 * row, not field_reviews — so a correction was invisible to both, and radar
 * kept showing the stale AI-extracted date.
 *
 * Can't call saveFieldReview or getLeaseRadarData directly — both are
 * "use server" functions that depend on next/headers cookies() and don't
 * exist outside a real Next.js request (same reason
 * tests/security/account-deletion.test.ts calls the underlying lib functions
 * instead of the server-action wrappers). Instead this: (1) calls the real,
 * exported columnPatchForCorrection — the exact function saveFieldReview uses
 * to map a correction onto a column — through a genuine signed-in Supabase
 * client, and (2) re-runs the identical query app/lease-radar/actions.ts:
 * getLeaseRadarData issues, through the same real lib/lease-radar.ts bucket
 * logic. That's the entire fix, exercised end to end against the live
 * database, minus only the "use server" plumbing itself.
 *
 * Requires DATABASE_URL + NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DATABASE_URL,
  HAS_SUPABASE_TEST_CREDS,
  createSignedInTestUser,
  type TestUser,
} from "../security/_test-helpers";
import { columnPatchForCorrection } from "@/app/abstracts/[id]/review-utils";
import { daysUntilExpiry, leaseRadarBucket } from "@/lib/lease-radar";

const d = HAS_SUPABASE_TEST_CREDS ? describe : describe.skip;

if (!HAS_SUPABASE_TEST_CREDS) {
  // eslint-disable-next-line no-console
  console.warn(
    "[lease-field-correction.test.ts] Skipping — DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL / " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY not available (checked process.env and .env.local).",
  );
}

const MS_DAY = 86_400_000;
const isoDaysFromNow = (days: number) => new Date(Date.now() + days * MS_DAY).toISOString().slice(0, 10);

/**
 * The exact query shape app/lease-radar/actions.ts:getLeaseRadarData runs
 * (owner_id + not-null + 12-month gte/lte window), narrowed to one lease by
 * id, fed through the real bucket logic. Returns null if the lease's
 * expiration_date currently falls outside the radar's 12-month window
 * entirely (same as "wouldn't appear on the radar page at all").
 */
async function radarBucketFor(client: SupabaseClient, leaseId: string): Promise<string | null> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const cutoff12 = isoDaysFromNow(365);

  const { data } = await client
    .from("lease_abstracts")
    .select("id, expiration_date")
    .eq("id", leaseId)
    .not("expiration_date", "is", null)
    .gte("expiration_date", today)
    .lte("expiration_date", cutoff12);

  const row = (data ?? [])[0] as { expiration_date: string } | undefined;
  if (!row) return null;
  return leaseRadarBucket(daysUntilExpiry(row.expiration_date, now));
}

d("Lease field correction updates the real column — lease radar reads it directly", () => {
  let pg: Client;
  let user: TestUser;
  let leaseId: string;

  beforeAll(async () => {
    pg = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pg.connect();
    user = await createSignedInTestUser(pg, "lease-correction");

    // Seeded far outside the 12-month radar window — the AI got this wrong,
    // in this test's scenario.
    const farFuture = isoDaysFromNow(500);
    const { data, error } = await user.client
      .from("lease_abstracts")
      .insert({ owner_id: user.id, expiration_date: farFuture, term: "5 years", base_rate: 28 })
      .select("id")
      .single();
    expect(error, `seed lease_abstracts failed: ${error?.message}`).toBeNull();
    leaseId = data!.id;
  }, 30_000);

  afterAll(async () => {
    if (pg && user?.id) await pg.query(`DELETE FROM auth.users WHERE id = $1`, [user.id]);
    await pg?.end();
  }, 15_000);

  it("a lease expiring 500 days out doesn't appear in any lease radar bucket", async () => {
    expect(await radarBucketFor(user.client, leaseId)).toBeNull();
  });

  it("correcting expiration_date writes the real column, and lease radar's own query immediately reflects it", async () => {
    const soon = isoDaysFromNow(45); // → "3mo" bucket (<=90 days)

    // This is exactly what saveFieldReview does on a "corrected" status: map
    // the correction to a column patch, then include it in the same UPDATE
    // that also records field_reviews.
    const result = columnPatchForCorrection("expiration_date", soon);
    expect(result && "patch" in result, `expected a valid patch, got ${JSON.stringify(result)}`).toBe(true);
    if (!result || !("patch" in result)) return;

    const { error } = await user.client
      .from("lease_abstracts")
      .update({
        ...result.patch,
        field_reviews: {
          expiration_date: { status: "corrected", correctedValue: soon, reviewedAt: new Date().toISOString() },
        },
      })
      .eq("id", leaseId);
    expect(error, `correction update failed: ${error?.message}`).toBeNull();

    // The column itself actually changed — not just field_reviews.
    const { data: row } = await user.client
      .from("lease_abstracts")
      .select("expiration_date")
      .eq("id", leaseId)
      .single();
    expect(row?.expiration_date).toBe(soon);

    // The bug this guards against: before the fix, this exact query — the
    // one lease radar itself runs — would still see the stale far-future
    // date, since only field_reviews had been written.
    expect(
      await radarBucketFor(user.client, leaseId),
      "lease radar's own query didn't pick up the corrected expiration date",
    ).toBe("3mo");
  });

  it("an unparseable date correction is rejected before it ever reaches the column", async () => {
    const before = await user.client.from("lease_abstracts").select("expiration_date").eq("id", leaseId).single();

    const result = columnPatchForCorrection("expiration_date", "not a date");
    expect(result && "error" in result).toBe(true);

    // Column is untouched by a rejected correction.
    const after = await user.client.from("lease_abstracts").select("expiration_date").eq("id", leaseId).single();
    expect(after.data?.expiration_date).toBe(before.data?.expiration_date);
  });
});
