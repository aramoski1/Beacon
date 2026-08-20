/**
 * Team multi-tenancy isolation — proves the exact leak class
 * Beacon_Team_Multitenancy_Plan.md §5/§9 exists to prevent: a `visibility`
 * value of 'team' must only ever mean "visible within my own firm," never
 * "visible to anyone." Three real Supabase auth users, two firms:
 *   - userA, userB — teammates, same firm ("Firm One")
 *   - userC        — a different firm entirely ("Firm Two"), the outsider
 *
 * Same harness discipline as tenant-isolation.test.ts: every assertion runs
 * through a real, RLS-enforced client (never service-role, never
 * DATABASE_URL). DATABASE_URL is used only to create the users/firms
 * themselves and to tear them down afterward.
 *
 * New `describe` blocks are added here one at a time, in lockstep with each
 * table's RLS migration in Phase 2 — never ahead of the RLS that backs them.
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
import { ensurePersonalFirm } from "@/lib/firms";

const d = HAS_SUPABASE_TEST_CREDS ? describe : describe.skip;

if (!HAS_SUPABASE_TEST_CREDS) {
  // eslint-disable-next-line no-console
  console.warn(
    "[team-firm-isolation.test.ts] Skipping — DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL / " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY not available (checked process.env and .env.local).",
  );
}

// ─── Generic 6-vector visibility-lifecycle assertion ───────────────────────
//
// For a 'private' row seeded by `owner`, proves, in order:
//   1. Cross-firm outsider cannot see it while private.
//   2. Within-firm teammate cannot see it while private (the OR-clause must
//      not have loosened the base owner-only case).
//   3. Owner marks it 'team'-visible.
//   4. Cross-firm outsider STILL cannot see it once shared — the single most
//      important assertion in this whole file. 'team' must only ever mean
//      "visible within my firm," never "visible to anyone."
//   5. Within-firm teammate CAN now see it.
//   6. Teammate can edit it (co-editable, per the plan's resolved decision),
//      and the edit genuinely persists (verified via the owner's own client).

async function assertVisibilityLifecycle(opts: {
  table: string;
  id: string;
  owner: TestUser;
  teammate: TestUser;
  outsider: TestUser;
  editColumn: string;
  editValueByTeammate: unknown;
}): Promise<void> {
  const { table, id, owner, teammate, outsider, editColumn, editValueByTeammate } = opts;

  const outsiderWhilePrivate = await outsider.client.from(table).select("id").eq("id", id);
  expect(outsiderWhilePrivate.data, `${table}: cross-firm outsider saw a private row`).toEqual([]);

  const teammateWhilePrivate = await teammate.client.from(table).select("id").eq("id", id);
  expect(teammateWhilePrivate.data, `${table}: teammate saw a private row (OR-clause loosened the base case)`).toEqual([]);

  const share = await owner.client.from(table).update({ visibility: "team" }).eq("id", id).select();
  expect(share.error, `${table}: owner couldn't mark their own row team-visible: ${share.error?.message}`).toBeNull();
  expect(share.data?.length, `${table}: owner's own share-update affected 0 rows`).toBe(1);

  const outsiderWhileShared = await outsider.client.from(table).select("id").eq("id", id);
  expect(
    outsiderWhileShared.data,
    `${table}: CRITICAL — 'team' visibility leaked across firms to an outsider`,
  ).toEqual([]);

  const teammateWhileShared = await teammate.client.from(table).select("id").eq("id", id);
  expect(teammateWhileShared.data?.length, `${table}: teammate couldn't see a team-visible row`).toBe(1);

  const teammateEdit = await teammate.client
    .from(table)
    .update({ [editColumn]: editValueByTeammate })
    .eq("id", id)
    .select();
  expect(teammateEdit.data?.length, `${table}: teammate's edit to a shared row was rejected`).toBe(1);

  const verify = await owner.client.from(table).select(editColumn).eq("id", id).single();
  expect(
    (verify.data as Record<string, unknown> | null)?.[editColumn],
    `${table}: teammate's edit didn't actually persist`,
  ).toBe(editValueByTeammate);
}

// ─── Suite ──────────────────────────────────────────────────────────────────

d("Team/firm visibility isolation (real RLS-enforced Supabase clients)", () => {
  let pg: Client;
  let userA: TestUser; // Firm One, owner
  let userB: TestUser; // Firm One, member — A's teammate
  let userC: TestUser; // Firm Two, owner — the outsider
  let firmOne: string;
  let firmTwo: string;

  const seeded: Record<string, string> = {};

  beforeAll(async () => {
    pg = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pg.connect();

    userA = await createSignedInTestUser(pg, "firm-a");
    userB = await createSignedInTestUser(pg, "firm-b");
    userC = await createSignedInTestUser(pg, "firm-c");

    firmOne = await createFirm(pg, "Firm One Isolation Test", userA.id);
    await addFirmMember(pg, firmOne, userA.id, "owner");
    await addFirmMember(pg, firmOne, userB.id, "member");

    firmTwo = await createFirm(pg, "Firm Two Isolation Test", userC.id);
    await addFirmMember(pg, firmTwo, userC.id, "owner");
  }, 60_000);

  afterAll(async () => {
    if (pg && userA?.id) await pg.query(`DELETE FROM auth.users WHERE id = $1`, [userA.id]);
    if (pg && userB?.id) await pg.query(`DELETE FROM auth.users WHERE id = $1`, [userB.id]);
    if (pg && userC?.id) await pg.query(`DELETE FROM auth.users WHERE id = $1`, [userC.id]);
    await pg?.end();
  }, 30_000);

  it("seeded distinct users across two distinct firms", () => {
    expect(userA.id).not.toBe(userB.id);
    expect(userA.id).not.toBe(userC.id);
    expect(firmOne).not.toBe(firmTwo);
  });

  // ─── firm_members RLS (Phase 0) ────────────────────────────────────────────

  it("firm_members: a teammate can see the whole roster of their own firm", async () => {
    const roster = await userB.client.from("firm_members").select("user_id").eq("firm_id", firmOne);
    expect(roster.error).toBeNull();
    const ids = (roster.data ?? []).map((r) => r.user_id);
    expect(ids).toContain(userA.id);
    expect(ids).toContain(userB.id);
  });

  it("firm_members: cannot see another firm's roster", async () => {
    const roster = await userB.client.from("firm_members").select("user_id").eq("firm_id", firmTwo);
    expect(roster.error).toBeNull();
    expect(roster.data, "Firm One member could see Firm Two's roster").toEqual([]);
  });

  it("firm_members: a plain member cannot change another member's role or status", async () => {
    const attempt = await userB.client
      .from("firm_members")
      .update({ role: "admin" })
      .eq("firm_id", firmOne)
      .eq("user_id", userA.id)
      .select();
    expect(attempt.data, "member B changed owner A's role").toEqual([]);
  });

  it("firm_members: a member CAN flip their own status (self-leave)", async () => {
    // Use a throwaway 4th user so this doesn't disturb userB's membership for later tests.
    const userD = await createSignedInTestUser(pg, "firm-d");
    await addFirmMember(pg, firmOne, userD.id, "member");

    const leave = await userD.client
      .from("firm_members")
      .update({ status: "removed" })
      .eq("firm_id", firmOne)
      .eq("user_id", userD.id)
      .select();
    expect(leave.error, `self-leave failed: ${leave.error?.message}`).toBeNull();
    expect(leave.data?.length).toBe(1);

    await pg.query(`DELETE FROM auth.users WHERE id = $1`, [userD.id]);
  });

  it("firm_members: is_firm_teammate() denies before any firm exists between two arbitrary users", async () => {
    // userC (Firm Two) and userB (Firm One) are not teammates — sanity check
    // the helper function itself isn't universally true.
    const cross = await userC.client.from("firm_members").select("id").eq("firm_id", firmOne);
    expect(cross.data, "Firm Two's owner could read Firm One's membership").toEqual([]);
  });

  it("ensurePersonalFirm: a brand-new user with no firm yet gets one, end to end, on their own client", async () => {
    // Exercises the exact bootstrap path signUp() calls — a user's own
    // RLS-bounded client creating its own firms row, then reading it back
    // (this is precisely what the recursion bug broke: the just-created
    // firms row wasn't visible to its own creator).
    const userE = await createSignedInTestUser(pg, "firm-e");

    await ensurePersonalFirm(userE.client, userE.id);

    const membership = await userE.client
      .from("firm_members")
      .select("firm_id, role, status")
      .eq("user_id", userE.id)
      .eq("status", "active")
      .maybeSingle();
    expect(membership.error, `bootstrap membership lookup failed: ${membership.error?.message}`).toBeNull();
    expect(membership.data?.role).toBe("owner");
    expect(membership.data?.status).toBe("active");

    // Idempotent — calling it again with an existing active membership is a no-op, not a duplicate.
    await ensurePersonalFirm(userE.client, userE.id);
    const stillOne = await pg.query(`SELECT count(*) FROM firm_members WHERE user_id = $1 AND status = 'active'`, [userE.id]);
    expect(Number(stillOne.rows[0].count)).toBe(1);

    await pg.query(`DELETE FROM auth.users WHERE id = $1`, [userE.id]);
  });

  // ─── activities (Phase 2, table 1 of 7) ────────────────────────────────────

  it("activities: full visibility lifecycle — private, then team-shared, cross-firm never leaks", async () => {
    const contact = await userA.client
      .from("contacts")
      .insert({ owner_id: userA.id, name: "Team-firm test contact" })
      .select("id")
      .single();
    expect(contact.error, `seed contacts failed: ${contact.error?.message}`).toBeNull();
    seeded.contacts = contact.data!.id;

    const activity = await userA.client
      .from("activities")
      .insert({ owner_id: userA.id, contact_id: seeded.contacts, activity_type: "note", notes: "Team-firm test activity" })
      .select("id")
      .single();
    expect(activity.error, `seed activities failed: ${activity.error?.message}`).toBeNull();
    seeded.activities = activity.data!.id;

    await assertVisibilityLifecycle({
      table: "activities",
      id: seeded.activities,
      owner: userA,
      teammate: userB,
      outsider: userC,
      editColumn: "notes",
      editValueByTeammate: "Edited by teammate B",
    });
  });

  it("activities: leaving the firm immediately revokes visibility, both directions", async () => {
    const activity = await userA.client
      .from("activities")
      .insert({ owner_id: userA.id, contact_id: seeded.contacts, activity_type: "note", notes: "Leave test", visibility: "team" })
      .select("id")
      .single();
    expect(activity.error).toBeNull();
    const activityId = activity.data!.id;

    const beforeLeave = await userB.client.from("activities").select("id").eq("id", activityId);
    expect(beforeLeave.data?.length, "teammate couldn't see the shared row before leaving").toBe(1);

    await setFirmMemberStatus(pg, firmOne, userB.id, "removed");

    const afterLeave = await userB.client.from("activities").select("id").eq("id", activityId);
    expect(afterLeave.data, "former teammate could still see the row after leaving the firm").toEqual([]);

    // Restore B's membership so later tests in this file still see B as A's teammate.
    await setFirmMemberStatus(pg, firmOne, userB.id, "active");

    const afterRejoin = await userB.client.from("activities").select("id").eq("id", activityId);
    expect(afterRejoin.data?.length, "rejoining didn't restore visibility").toBe(1);
  });

  // ─── documents (Phase 2, table 2 of 7) ─────────────────────────────────────

  it("documents: full visibility lifecycle — private, then team-shared, cross-firm never leaks", async () => {
    const doc = await userA.client
      .from("documents")
      .insert({
        owner_id: userA.id,
        entity_type: "contact",
        entity_id: seeded.contacts,
        file_name: "test.pdf",
        storage_path: `${userA.id}/contact/${seeded.contacts}/test.pdf`,
      })
      .select("id")
      .single();
    expect(doc.error, `seed documents failed: ${doc.error?.message}`).toBeNull();
    seeded.documents = doc.data!.id;

    await assertVisibilityLifecycle({
      table: "documents",
      id: seeded.documents,
      owner: userA,
      teammate: userB,
      outsider: userC,
      editColumn: "file_name",
      editValueByTeammate: "edited-by-teammate.pdf",
    });
  });
});
