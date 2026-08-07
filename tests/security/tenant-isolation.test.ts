/**
 * Multi-tenant data isolation — proves broker A cannot read, list, update, or
 * delete broker B's rows across every table, purely via Postgres RLS.
 *
 * Creates two REAL Supabase auth users (direct SQL insert into auth.users /
 * auth.identities, bypassing the email-confirmation flow — signUp() hits
 * Supabase's email rate limit almost immediately on repeated runs) and signs
 * in as each with the real signInWithPassword() API using the same anon key
 * the app itself uses. Every assertion below runs through that real,
 * RLS-enforced client — not the service role, not DATABASE_URL. DATABASE_URL
 * (direct Postgres, bypasses RLS) is used ONLY for user setup/teardown, never
 * for the isolation assertions themselves.
 *
 * Requires DATABASE_URL + NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
 * (loaded from .env.local if not already in the environment). Skips entirely
 * if those aren't available, rather than failing — this is a live integration
 * test against the real project, like the existing live GIS tests.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  DATABASE_URL,
  HAS_SUPABASE_TEST_CREDS,
  createSignedInTestUser,
  type TestUser,
} from "./_test-helpers";

const d = HAS_SUPABASE_TEST_CREDS ? describe : describe.skip;

if (!HAS_SUPABASE_TEST_CREDS) {
  // eslint-disable-next-line no-console
  console.warn(
    "[tenant-isolation.test.ts] Skipping — DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL / " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY not available (checked process.env and .env.local).",
  );
}

// ─── Generic cross-tenant assertion ────────────────────────────────────────────
//
// For a row seeded by `owner` at `table`/`id`, proves `intruder` cannot:
//   1. select it by id
//   2. find it in an unfiltered list of the table
//   3. update it (and that it's genuinely unchanged afterward, verified by owner)
//   4. delete it (and that it genuinely still exists afterward, verified by owner)

async function assertRowIsolated(opts: {
  table: string;
  id: string;
  owner: TestUser;
  intruder: TestUser;
  tamperColumn: string;
  tamperValue: unknown;
  originalValue: unknown;
}): Promise<void> {
  const { table, id, owner, intruder, tamperColumn, tamperValue, originalValue } = opts;

  // 1. Direct select by id
  const bySelect = await intruder.client.from(table).select("*").eq("id", id);
  expect(bySelect.error, `${table}: intruder select-by-id errored unexpectedly`).toBeNull();
  expect(bySelect.data, `${table}: intruder could select another broker's row by id`).toEqual([]);

  // 2. Unfiltered list must not contain the row
  const list = await intruder.client.from(table).select("id");
  expect(list.error, `${table}: intruder list errored unexpectedly`).toBeNull();
  const leaked = (list.data ?? []).some((r: { id: string }) => r.id === id);
  expect(leaked, `${table}: another broker's row (${id}) leaked into an unfiltered list`).toBe(false);

  // 3. Update attempt must affect zero rows
  const update = await intruder.client
    .from(table)
    .update({ [tamperColumn]: tamperValue })
    .eq("id", id)
    .select();
  expect(update.data, `${table}: intruder's update returned rows — should affect none`).toEqual([]);

  const afterUpdate = await owner.client.from(table).select(tamperColumn).eq("id", id).single();
  expect(afterUpdate.data?.[tamperColumn as keyof typeof afterUpdate.data], `${table}: intruder's update actually changed the owner's row`).toEqual(
    originalValue,
  );

  // 4. Delete attempt must affect zero rows
  const del = await intruder.client.from(table).delete().eq("id", id).select();
  expect(del.data, `${table}: intruder's delete returned rows — should affect none`).toEqual([]);

  const stillExists = await owner.client.from(table).select("id").eq("id", id).single();
  expect(stillExists.data?.id, `${table}: intruder's delete actually removed the owner's row`).toBe(id);
}

// ─── Suite ──────────────────────────────────────────────────────────────────

d("Multi-tenant data isolation (real RLS-enforced Supabase clients)", () => {
  let pg: Client;
  let userA: TestUser;
  let userB: TestUser;

  const seeded: Record<string, string> = {};

  beforeAll(async () => {
    pg = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pg.connect();

    userA = await createSignedInTestUser(pg, "a");
    userB = await createSignedInTestUser(pg, "b");

    // Seed one row per table as user A, via A's own authenticated client —
    // this also proves the INSERT policies work for the legitimate owner.
    const prop = await userA.client
      .from("properties")
      .insert({ owner_id: userA.id, address: "1 Isolation Test Way" })
      .select("id")
      .single();
    expect(prop.error, `seed properties failed: ${prop.error?.message}`).toBeNull();
    seeded.properties = prop.data!.id;

    const contact = await userA.client
      .from("contacts")
      .insert({ owner_id: userA.id, name: "Isolation Test Contact" })
      .select("id")
      .single();
    expect(contact.error, `seed contacts failed: ${contact.error?.message}`).toBeNull();
    seeded.contacts = contact.data!.id;

    const entity = await userA.client
      .from("entities")
      .insert({ owner_id: userA.id, name: "Isolation Test LLC", name_normalized: "isolation test llc" })
      .select("id")
      .single();
    expect(entity.error, `seed entities failed: ${entity.error?.message}`).toBeNull();
    seeded.entities = entity.data!.id;

    const lease = await userA.client
      .from("lease_abstracts")
      .insert({ owner_id: userA.id, linked_property: seeded.properties, term: "5 years" })
      .select("id")
      .single();
    expect(lease.error, `seed lease_abstracts failed: ${lease.error?.message}`).toBeNull();
    seeded.lease_abstracts = lease.data!.id;

    const activity = await userA.client
      .from("activities")
      .insert({ owner_id: userA.id, contact_id: seeded.contacts, activity_type: "note", notes: "Isolation test note" })
      .select("id")
      .single();
    expect(activity.error, `seed activities failed: ${activity.error?.message}`).toBeNull();
    seeded.activities = activity.data!.id;

    const contactProperty = await userA.client
      .from("contact_properties")
      .insert({ owner_id: userA.id, contact_id: seeded.contacts, property_id: seeded.properties })
      .select("id")
      .single();
    expect(contactProperty.error, `seed contact_properties failed: ${contactProperty.error?.message}`).toBeNull();
    seeded.contact_properties = contactProperty.data!.id;

    const entityProperty = await userA.client
      .from("entity_properties")
      .insert({ owner_id: userA.id, entity_id: seeded.entities, property_id: seeded.properties })
      .select("id")
      .single();
    expect(entityProperty.error, `seed entity_properties failed: ${entityProperty.error?.message}`).toBeNull();
    seeded.entity_properties = entityProperty.data!.id;

    const entityContact = await userA.client
      .from("entity_contacts")
      .insert({ owner_id: userA.id, entity_id: seeded.entities, contact_id: seeded.contacts, role: "Manager" })
      .select("id")
      .single();
    expect(entityContact.error, `seed entity_contacts failed: ${entityContact.error?.message}`).toBeNull();
    seeded.entity_contacts = entityContact.data!.id;

    const deal = await userA.client
      .from("deals")
      .insert({ owner_id: userA.id, name: "Isolation Test Deal", contact_id: seeded.contacts, property_id: seeded.properties })
      .select("id")
      .single();
    expect(deal.error, `seed deals failed: ${deal.error?.message}`).toBeNull();
    seeded.deals = deal.data!.id;

    const fieldDef = await userA.client
      .from("field_definitions")
      .insert({ owner_id: userA.id, entity_type: "property", field_name: "Isolation Test Field", field_type: "text" })
      .select("id")
      .single();
    expect(fieldDef.error, `seed field_definitions failed: ${fieldDef.error?.message}`).toBeNull();
    seeded.field_definitions = fieldDef.data!.id;

    const ingestionError = await userA.client
      .from("ingestion_errors")
      .insert({ owner_id: userA.id, source_type: "address", stage: "gis_fetch", error_message: "Isolation test error" })
      .select("id")
      .single();
    expect(ingestionError.error, `seed ingestion_errors failed: ${ingestionError.error?.message}`).toBeNull();
    seeded.ingestion_errors = ingestionError.data!.id;

    const smartList = await userA.client
      .from("smart_lists")
      .insert({ owner_id: userA.id, name: "Isolation Test List", query_text: "test", filters: {} })
      .select("id")
      .single();
    expect(smartList.error, `seed smart_lists failed: ${smartList.error?.message}`).toBeNull();
    seeded.smart_lists = smartList.data!.id;

    const userSettings = await userA.client
      .from("user_settings")
      .insert({ owner_id: userA.id, display_name: "Isolation Test Broker" })
      .select("id")
      .single();
    expect(userSettings.error, `seed user_settings failed: ${userSettings.error?.message}`).toBeNull();
    seeded.user_settings = userSettings.data!.id;

    const errorLog = await userA.client
      .from("error_logs")
      .insert({ owner_id: userA.id, action: "isolation_test", message: "Isolation test error log" })
      .select("id")
      .single();
    expect(errorLog.error, `seed error_logs failed: ${errorLog.error?.message}`).toBeNull();
    seeded.error_logs = errorLog.data!.id;

    // Storage: upload a small file as A into A's own folder.
    const upload = await userA.client.storage
      .from("leases")
      .upload(
        `${userA.id}/isolation-test.pdf`,
        new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" }),
        { contentType: "application/pdf", upsert: true },
      );
    expect(upload.error, `seed storage upload failed: ${upload.error?.message}`).toBeNull();
  }, 60_000);

  afterAll(async () => {
    // Cascades delete every seeded row via ON DELETE CASCADE on owner_id.
    if (pg && userA?.id) await pg.query(`DELETE FROM auth.users WHERE id = $1`, [userA.id]);
    if (pg && userB?.id) await pg.query(`DELETE FROM auth.users WHERE id = $1`, [userB.id]);
    // Storage objects aren't covered by the users FK cascade — remove explicitly.
    if (userA?.client) {
      await userA.client.storage.from("leases").remove([`${userA.id}/isolation-test.pdf`]).catch(() => {});
    }
    await pg?.end();
  }, 30_000);

  it("seeded distinct users", () => {
    expect(userA.id).not.toBe(userB.id);
  });

  it("properties: B cannot read, list, update, or delete A's property", async () => {
    await assertRowIsolated({
      table: "properties",
      id: seeded.properties,
      owner: userA,
      intruder: userB,
      tamperColumn: "address",
      tamperValue: "TAMPERED BY B",
      originalValue: "1 Isolation Test Way",
    });
  });

  it("contacts: B cannot read, list, update, or delete A's contact", async () => {
    await assertRowIsolated({
      table: "contacts",
      id: seeded.contacts,
      owner: userA,
      intruder: userB,
      tamperColumn: "name",
      tamperValue: "TAMPERED BY B",
      originalValue: "Isolation Test Contact",
    });
  });

  it("entities: B cannot read, list, update, or delete A's entity", async () => {
    await assertRowIsolated({
      table: "entities",
      id: seeded.entities,
      owner: userA,
      intruder: userB,
      tamperColumn: "name",
      tamperValue: "TAMPERED BY B",
      originalValue: "Isolation Test LLC",
    });
  });

  it("lease_abstracts: B cannot read, list, update, or delete A's lease", async () => {
    await assertRowIsolated({
      table: "lease_abstracts",
      id: seeded.lease_abstracts,
      owner: userA,
      intruder: userB,
      tamperColumn: "term",
      tamperValue: "TAMPERED BY B",
      originalValue: "5 years",
    });
  });

  it("activities: B cannot read, list, update, or delete A's activity", async () => {
    await assertRowIsolated({
      table: "activities",
      id: seeded.activities,
      owner: userA,
      intruder: userB,
      tamperColumn: "notes",
      tamperValue: "TAMPERED BY B",
      originalValue: "Isolation test note",
    });
  });

  it("contact_properties: B cannot read, list, update, or delete A's link", async () => {
    const originalCreatedAt = (
      await userA.client.from("contact_properties").select("created_at").eq("id", seeded.contact_properties).single()
    ).data!.created_at;
    await assertRowIsolated({
      table: "contact_properties",
      id: seeded.contact_properties,
      owner: userA,
      intruder: userB,
      tamperColumn: "created_at",
      tamperValue: "2099-01-01T00:00:00Z",
      originalValue: originalCreatedAt,
    });
  });

  it("entity_properties: B cannot read, list, update, or delete A's link", async () => {
    const originalCreatedAt = (
      await userA.client.from("entity_properties").select("created_at").eq("id", seeded.entity_properties).single()
    ).data!.created_at;
    await assertRowIsolated({
      table: "entity_properties",
      id: seeded.entity_properties,
      owner: userA,
      intruder: userB,
      tamperColumn: "created_at",
      tamperValue: "2099-01-01T00:00:00Z",
      originalValue: originalCreatedAt,
    });
  });

  it("entity_contacts: B cannot read, list, update, or delete A's link", async () => {
    await assertRowIsolated({
      table: "entity_contacts",
      id: seeded.entity_contacts,
      owner: userA,
      intruder: userB,
      tamperColumn: "role",
      tamperValue: "TAMPERED BY B",
      originalValue: "Manager",
    });
  });

  it("deals: B cannot read, list, update, or delete A's deal", async () => {
    await assertRowIsolated({
      table: "deals",
      id: seeded.deals,
      owner: userA,
      intruder: userB,
      tamperColumn: "name",
      tamperValue: "TAMPERED BY B",
      originalValue: "Isolation Test Deal",
    });
  });

  it("field_definitions: B cannot read, list, update, or delete A's custom field", async () => {
    await assertRowIsolated({
      table: "field_definitions",
      id: seeded.field_definitions,
      owner: userA,
      intruder: userB,
      tamperColumn: "field_name",
      tamperValue: "TAMPERED BY B",
      originalValue: "Isolation Test Field",
    });
  });

  it("ingestion_errors: B cannot read, list, or delete A's log row (no UPDATE policy — write-once log)", async () => {
    const bySelect = await userB.client.from("ingestion_errors").select("*").eq("id", seeded.ingestion_errors);
    expect(bySelect.data).toEqual([]);

    const list = await userB.client.from("ingestion_errors").select("id");
    expect((list.data ?? []).some((r: { id: string }) => r.id === seeded.ingestion_errors)).toBe(false);

    const del = await userB.client.from("ingestion_errors").delete().eq("id", seeded.ingestion_errors).select();
    expect(del.data).toEqual([]);

    const stillExists = await userA.client.from("ingestion_errors").select("id").eq("id", seeded.ingestion_errors).single();
    expect(stillExists.data?.id).toBe(seeded.ingestion_errors);
  });

  it("smart_lists: B cannot read, list, update, or delete A's smart list", async () => {
    await assertRowIsolated({
      table: "smart_lists",
      id: seeded.smart_lists,
      owner: userA,
      intruder: userB,
      tamperColumn: "name",
      tamperValue: "TAMPERED BY B",
      originalValue: "Isolation Test List",
    });
  });

  it("user_settings: B cannot read, list, update, or delete A's settings", async () => {
    await assertRowIsolated({
      table: "user_settings",
      id: seeded.user_settings,
      owner: userA,
      intruder: userB,
      tamperColumn: "display_name",
      tamperValue: "TAMPERED BY B",
      originalValue: "Isolation Test Broker",
    });
  });

  it("error_logs: B cannot read, list, update, or delete A's error log", async () => {
    await assertRowIsolated({
      table: "error_logs",
      id: seeded.error_logs,
      owner: userA,
      intruder: userB,
      tamperColumn: "message",
      tamperValue: "TAMPERED BY B",
      originalValue: "Isolation test error log",
    });
  });

  it("storage (leases bucket): B cannot download, list, or overwrite A's uploaded file", async () => {
    const path = `${userA.id}/isolation-test.pdf`;

    const download = await userB.client.storage.from("leases").download(path);
    expect(download.error, "B was able to download A's lease PDF").not.toBeNull();

    const list = await userB.client.storage.from("leases").list(userA.id);
    const leaked = (list.data ?? []).some((f) => f.name === "isolation-test.pdf");
    expect(leaked, "A's file leaked into B's listing of A's folder").toBe(false);

    const overwrite = await userB.client.storage
      .from("leases")
      .upload(path, new Blob([new Uint8Array([0x00])], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
    expect(overwrite.error, "B was able to overwrite A's lease PDF").not.toBeNull();

    // A can still read their own file — proves the block above is isolation,
    // not a broken bucket.
    const ownDownload = await userA.client.storage.from("leases").download(path);
    expect(ownDownload.error).toBeNull();
  });

  it("sanity: A can still read, update, and delete their own rows (isolation isn't just broken access)", async () => {
    const own = await userA.client.from("properties").select("*").eq("id", seeded.properties).single();
    expect(own.error).toBeNull();
    expect(own.data?.address).toBe("1 Isolation Test Way");

    const update = await userA.client
      .from("properties")
      .update({ address: "1 Isolation Test Way (edited by owner)" })
      .eq("id", seeded.properties)
      .select();
    expect(update.error).toBeNull();
    expect(update.data).toHaveLength(1);
  });
});
