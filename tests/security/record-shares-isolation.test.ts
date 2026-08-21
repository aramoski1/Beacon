/**
 * Per-teammate record sharing isolation — Beacon_Per_User_Sharing_Plan.md §6.
 * Parallel to team-firm-isolation.test.ts (same 3-user, 2-firm fixture,
 * reusing the same helpers), kept in its own file so this feature's gate is
 * independently reviewable from the whole-firm visibility suite it builds on.
 *
 * Three real Supabase auth users, two firms:
 *   - userA, userB — teammates, same firm ("Firm One")
 *   - userC        — a different firm entirely ("Firm Two"), the outsider
 *
 * Every assertion runs through a real, RLS-enforced client (never
 * service-role, never DATABASE_URL). DATABASE_URL is used only to create the
 * fixtures and to inspect ground truth (e.g. confirming a cleanup delete
 * actually ran), never to perform the action under test.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  DATABASE_URL,
  HAS_SUPABASE_TEST_CREDS,
  createSignedInTestUser,
  createFirm,
  addFirmMember,
  setFirmMemberStatus,
  type TestUser,
} from "./_test-helpers";

const d = HAS_SUPABASE_TEST_CREDS ? describe : describe.skip;

if (!HAS_SUPABASE_TEST_CREDS) {
  // eslint-disable-next-line no-console
  console.warn(
    "[record-shares-isolation.test.ts] Skipping — DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL / " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY not available (checked process.env and .env.local).",
  );
}

d("Per-teammate record sharing isolation (real RLS-enforced Supabase clients)", () => {
  let pg: Client;
  let userA: TestUser; // Firm One, owner — the sharer
  let userB: TestUser; // Firm One, member — A's teammate, the recipient
  let userC: TestUser; // Firm Two, owner — the outsider
  let firmOne: string;
  let firmTwo: string;

  beforeAll(async () => {
    pg = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pg.connect();

    userA = await createSignedInTestUser(pg, "shares-a");
    userB = await createSignedInTestUser(pg, "shares-b");
    userC = await createSignedInTestUser(pg, "shares-c");

    firmOne = await createFirm(pg, "Firm One Shares Test", userA.id);
    await addFirmMember(pg, firmOne, userA.id, "owner");
    await addFirmMember(pg, firmOne, userB.id, "member");

    firmTwo = await createFirm(pg, "Firm Two Shares Test", userC.id);
    await addFirmMember(pg, firmTwo, userC.id, "owner");
  }, 60_000);

  afterAll(async () => {
    if (pg && userA?.id) await pg.query(`DELETE FROM auth.users WHERE id = $1`, [userA.id]);
    if (pg && userB?.id) await pg.query(`DELETE FROM auth.users WHERE id = $1`, [userB.id]);
    if (pg && userC?.id) await pg.query(`DELETE FROM auth.users WHERE id = $1`, [userC.id]);
    if (pg) {
      await pg
        .query(`DELETE FROM firms WHERE NOT EXISTS (SELECT 1 FROM firm_members WHERE firm_id = firms.id)`)
        .catch(() => {});
    }
    await pg?.end();
  }, 30_000);

  it("seeded distinct users across two distinct firms", () => {
    expect(userA.id).not.toBe(userB.id);
    expect(userA.id).not.toBe(userC.id);
    expect(firmOne).not.toBe(firmTwo);
  });

  // ─── Generic grant/revoke lifecycle, per entity type ───────────────────────

  async function assertShareLifecycle(opts: {
    table: "properties" | "contacts" | "deals";
    entityType: "property" | "contact" | "deal";
    id: string;
    editColumn: string;
    editValueByRecipient: unknown;
  }): Promise<void> {
    const { table, entityType, id, editColumn, editValueByRecipient } = opts;

    // Not shared yet — neither teammate nor outsider can see it (it's private).
    const teammateBefore = await userB.client.from(table).select("id").eq("id", id);
    expect(teammateBefore.data, `${table}: teammate saw an unshared private row`).toEqual([]);
    const outsiderBefore = await userC.client.from(table).select("id").eq("id", id);
    expect(outsiderBefore.data, `${table}: outsider saw an unshared private row`).toEqual([]);

    // A shares it with B.
    const share = await userA.client
      .from("record_shares")
      .insert({ entity_type: entityType, entity_id: id, shared_with_user_id: userB.id, shared_by_user_id: userA.id })
      .select();
    expect(share.error, `${table}: owner couldn't share their own row: ${share.error?.message}`).toBeNull();
    expect(share.data?.length, `${table}: share insert affected 0 rows`).toBe(1);

    // B (teammate + recipient) can now see it.
    const teammateAfter = await userB.client.from(table).select("id").eq("id", id);
    expect(teammateAfter.data?.length, `${table}: recipient couldn't see the shared row`).toBe(1);

    // C (outsider, different firm) still cannot — sharing is not team-wide visibility.
    const outsiderAfter = await userC.client.from(table).select("id").eq("id", id);
    expect(outsiderAfter.data, `${table}: CRITICAL — a per-teammate share leaked to an outsider`).toEqual([]);

    // Read-only: B's edit attempt affects 0 rows (per-teammate shares are not co-editable in v1).
    const recipientEdit = await userB.client
      .from(table)
      .update({ [editColumn]: editValueByRecipient })
      .eq("id", id)
      .select();
    expect(recipientEdit.data, `${table}: recipient was able to edit a read-only shared row`).toEqual([]);

    // Revoke: A deletes the share row.
    const revoke = await userA.client
      .from("record_shares")
      .delete()
      .eq("entity_type", entityType)
      .eq("entity_id", id)
      .eq("shared_with_user_id", userB.id);
    expect(revoke.error, `${table}: owner couldn't revoke their own share: ${revoke.error?.message}`).toBeNull();

    const teammateAfterRevoke = await userB.client.from(table).select("id").eq("id", id);
    expect(teammateAfterRevoke.data, `${table}: recipient still saw the row after the share was revoked`).toEqual([]);
  }

  it("properties: full share lifecycle — private, then shared with one teammate, never leaks to an outsider, read-only, revocable", async () => {
    const property = await userA.client
      .from("properties")
      .insert({ owner_id: userA.id, address: "1 Per-Teammate Share Test Way" })
      .select("id")
      .single();
    expect(property.error, `seed properties failed: ${property.error?.message}`).toBeNull();

    await assertShareLifecycle({
      table: "properties",
      entityType: "property",
      id: property.data!.id,
      editColumn: "address",
      editValueByRecipient: "Hijacked by recipient",
    });
  });

  it("contacts: full share lifecycle — private, then shared with one teammate, never leaks to an outsider, read-only, revocable", async () => {
    const contact = await userA.client
      .from("contacts")
      .insert({ owner_id: userA.id, name: "Per-Teammate Share Test Contact" })
      .select("id")
      .single();
    expect(contact.error, `seed contacts failed: ${contact.error?.message}`).toBeNull();

    await assertShareLifecycle({
      table: "contacts",
      entityType: "contact",
      id: contact.data!.id,
      editColumn: "name",
      editValueByRecipient: "Hijacked by recipient",
    });
  });

  it("deals: full share lifecycle — private, then shared with one teammate, never leaks to an outsider, read-only, revocable", async () => {
    const deal = await userA.client
      .from("deals")
      .insert({ owner_id: userA.id, name: "Per-Teammate Share Test Deal" })
      .select("id")
      .single();
    expect(deal.error, `seed deals failed: ${deal.error?.message}`).toBeNull();

    await assertShareLifecycle({
      table: "deals",
      entityType: "deal",
      id: deal.data!.id,
      editColumn: "name",
      editValueByRecipient: "Hijacked by recipient",
    });
  });

  // ─── The write-side attack surface — cross-firm + ownership forgery ───────

  it("record_shares: cannot share a record with someone outside my firm", async () => {
    const property = await userA.client
      .from("properties")
      .insert({ owner_id: userA.id, address: "Cross-Firm Share Attempt Test" })
      .select("id")
      .single();
    expect(property.error).toBeNull();

    const attempt = await userA.client
      .from("record_shares")
      .insert({ entity_type: "property", entity_id: property.data!.id, shared_with_user_id: userC.id, shared_by_user_id: userA.id })
      .select();
    expect(attempt.error, "shared a record with a user outside the sharer's firm").not.toBeNull();
    expect(attempt.data).toBeNull();

    // Ground truth: no row was actually written.
    const check = await pg.query(
      `SELECT 1 FROM record_shares WHERE entity_id = $1 AND shared_with_user_id = $2`,
      [property.data!.id, userC.id],
    );
    expect(check.rows.length, "a cross-firm share row exists in the database despite the rejected insert").toBe(0);
  });

  it("record_shares: CRITICAL — cannot forge a share on a record I don't own", async () => {
    // A owns this property. C (a different firm entirely, and not even a
    // teammate of A) tries to insert a record_shares row claiming to be the
    // sharer, naming themselves as recipient — the exact side-door
    // owns_shared_record() exists to close (plan §3.3).
    const property = await userA.client
      .from("properties")
      .insert({ owner_id: userA.id, address: "Ownership Forgery Attempt Test" })
      .select("id")
      .single();
    expect(property.error).toBeNull();
    const propertyId = property.data!.id;

    const forgeAttempt = await userC.client
      .from("record_shares")
      .insert({ entity_type: "property", entity_id: propertyId, shared_with_user_id: userC.id, shared_by_user_id: userC.id })
      .select();
    expect(forgeAttempt.error, "CRITICAL — a user forged a share on a record they don't own").not.toBeNull();
    expect(forgeAttempt.data).toBeNull();

    // Confirm the forgery didn't grant access even if the insert somehow half-succeeded.
    const outsiderRead = await userC.client.from("properties").select("id").eq("id", propertyId);
    expect(outsiderRead.data, "CRITICAL — ownership forgery granted read access to a private property").toEqual([]);

    const check = await pg.query(
      `SELECT 1 FROM record_shares WHERE entity_id = $1 AND shared_by_user_id = $2`,
      [propertyId, userC.id],
    );
    expect(check.rows.length, "a forged share row exists in the database despite the rejected insert").toBe(0);
  });

  it("record_shares: a teammate (not the owner) cannot share someone else's record either", async () => {
    // B is a genuine Firm One teammate of A, but B doesn't own this property —
    // owns_shared_record() must reject B just as it rejects the outsider above.
    const property = await userA.client
      .from("properties")
      .insert({ owner_id: userA.id, address: "Teammate Non-Owner Share Attempt Test" })
      .select("id")
      .single();
    expect(property.error).toBeNull();

    const attempt = await userB.client
      .from("record_shares")
      .insert({ entity_type: "property", entity_id: property.data!.id, shared_with_user_id: userB.id, shared_by_user_id: userB.id })
      .select();
    expect(attempt.error, "a non-owner teammate was able to share a record they don't own").not.toBeNull();
    expect(attempt.data).toBeNull();
  });

  // ─── Offboarding interaction — live revocation, then cleanup, then no reactivation ──

  it("firm departure revokes shared access LIVE, before any cleanup deletes the row", async () => {
    const property = await userA.client
      .from("properties")
      .insert({ owner_id: userA.id, address: "Live Revocation On Departure Test" })
      .select("id")
      .single();
    expect(property.error).toBeNull();
    const propertyId = property.data!.id;

    const share = await userA.client
      .from("record_shares")
      .insert({ entity_type: "property", entity_id: propertyId, shared_with_user_id: userB.id, shared_by_user_id: userA.id })
      .select();
    expect(share.error).toBeNull();

    const beforeLeave = await userB.client.from("properties").select("id").eq("id", propertyId);
    expect(beforeLeave.data?.length, "recipient couldn't see the shared row before leaving").toBe(1);

    // B leaves the firm — status flip only, no application-level cleanup yet.
    await setFirmMemberStatus(pg, firmOne, userB.id, "removed");

    const afterLeave = await userB.client.from("properties").select("id").eq("id", propertyId);
    expect(
      afterLeave.data,
      "former teammate could still see a shared row after leaving the firm, before any cleanup ran — the live is_firm_teammate() re-check isn't gating access",
    ).toEqual([]);

    // The record_shares row itself still exists at this point — proves the
    // above was the live join, not a row having been deleted already.
    const rowStillExists = await pg.query(
      `SELECT 1 FROM record_shares WHERE entity_id = $1 AND shared_with_user_id = $2`,
      [propertyId, userB.id],
    );
    expect(rowStillExists.rows.length, "the share row was already gone — this test isn't isolating the live-join behavior").toBe(1);

    // Now simulate the Phase 4 cleanup step (removeMember's delete) directly,
    // since this test doesn't exercise the app/settings/team server action itself.
    await pg.query(`DELETE FROM record_shares WHERE shared_with_user_id = $1 OR shared_by_user_id = $1`, [userB.id]);

    const rowGoneAfterCleanup = await pg.query(
      `SELECT 1 FROM record_shares WHERE entity_id = $1 AND shared_with_user_id = $2`,
      [propertyId, userB.id],
    );
    expect(rowGoneAfterCleanup.rows.length, "cleanup delete didn't remove the stale share row").toBe(0);

    // B rejoins the same firm — no silent reactivation, since the row is gone.
    await setFirmMemberStatus(pg, firmOne, userB.id, "active");
    const afterRejoin = await userB.client.from("properties").select("id").eq("id", propertyId);
    expect(afterRejoin.data, "a cleaned-up share silently reactivated on rejoin").toEqual([]);
  });

  it("final cross-check: properties/contacts/deals all reference is_record_shared_with_me() in their SELECT policy", async () => {
    for (const table of ["properties", "contacts", "deals"]) {
      const { rows } = await pg.query(
        `SELECT policyname FROM pg_policies WHERE tablename = $1 AND cmd = 'SELECT' AND qual LIKE '%is_record_shared_with_me%'`,
        [table],
      );
      expect(rows.length, `${table}: no SELECT policy references is_record_shared_with_me()`).toBeGreaterThan(0);
    }
  });
});
