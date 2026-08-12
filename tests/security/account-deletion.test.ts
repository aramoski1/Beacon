/**
 * Account deletion — proves deleteAllUserRows() + deleteAuthUserById() (the
 * exact functions app/settings/actions.ts's deleteAccount() calls) leave
 * NOTHING behind: no auth.users row, no rows in any of the 15 data tables,
 * and no storage objects. Also proves a second, untouched broker's data
 * survives — this is a destructive operation, so "only the target account is
 * affected" is as important as "the target account is fully gone."
 *
 * Can't call deleteAllData()/deleteAccount() directly — they depend on
 * next/headers cookies() and next/navigation redirect(), neither of which
 * exist outside a real Next.js request. Instead this calls the same
 * underlying lib/account-deletion.ts + lib/auth-delete-user.ts functions
 * those server actions call, through a real signed-in client — exercising
 * the actual deletion logic, just not the thin server-action wrapper around
 * it (auth check + redirect, which has nothing left to verify once the
 * deletion itself is proven).
 *
 * Requires DATABASE_URL + NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  DATABASE_URL,
  HAS_SUPABASE_TEST_CREDS,
  createSignedInTestUser,
  deleteTestUserIfExists,
  type TestUser,
} from "./_test-helpers";
import { ACCOUNT_DATA_TABLES, deleteAllUserRows } from "../../lib/account-deletion";
import { deleteAuthUserById } from "../../lib/auth-delete-user";

const d = HAS_SUPABASE_TEST_CREDS ? describe : describe.skip;

if (!HAS_SUPABASE_TEST_CREDS) {
  // eslint-disable-next-line no-console
  console.warn(
    "[account-deletion.test.ts] Skipping — DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL / " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY not available (checked process.env and .env.local).",
  );
}

async function seedOneRowPerTable(user: TestUser): Promise<{ documentPath: string }> {
  const prop = await user.client
    .from("properties")
    .insert({ owner_id: user.id, address: "1 Deletion Test Way" })
    .select("id")
    .single();
  expect(prop.error, `seed properties failed: ${prop.error?.message}`).toBeNull();
  const propertyId = prop.data!.id;

  const contact = await user.client
    .from("contacts")
    .insert({ owner_id: user.id, name: "Deletion Test Contact" })
    .select("id")
    .single();
  expect(contact.error, `seed contacts failed: ${contact.error?.message}`).toBeNull();
  const contactId = contact.data!.id;

  const entity = await user.client
    .from("entities")
    .insert({ owner_id: user.id, name: "Deletion Test LLC", name_normalized: "deletion test llc" })
    .select("id")
    .single();
  expect(entity.error, `seed entities failed: ${entity.error?.message}`).toBeNull();
  const entityId = entity.data!.id;

  const lease = await user.client
    .from("lease_abstracts")
    .insert({ owner_id: user.id, linked_property: propertyId, term: "5 years" })
    .select("id")
    .single();
  expect(lease.error, `seed lease_abstracts failed: ${lease.error?.message}`).toBeNull();

  const activity = await user.client
    .from("activities")
    .insert({ owner_id: user.id, contact_id: contactId, activity_type: "note", notes: "Deletion test note" })
    .select("id")
    .single();
  expect(activity.error, `seed activities failed: ${activity.error?.message}`).toBeNull();

  const contactProperty = await user.client
    .from("contact_properties")
    .insert({ owner_id: user.id, contact_id: contactId, property_id: propertyId })
    .select("id")
    .single();
  expect(contactProperty.error, `seed contact_properties failed: ${contactProperty.error?.message}`).toBeNull();

  const documentPath = `${user.id}/property/${propertyId}/test.pdf`;
  const document = await user.client
    .from("documents")
    .insert({
      owner_id: user.id,
      entity_type: "property",
      entity_id: propertyId,
      file_name: "test.pdf",
      storage_path: documentPath,
      content_type: "application/pdf",
      size_bytes: 4,
    })
    .select("id")
    .single();
  expect(document.error, `seed documents failed: ${document.error?.message}`).toBeNull();

  const documentUpload = await user.client.storage
    .from("documents")
    .upload(documentPath, new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" }), {
      contentType: "application/pdf",
      upsert: true,
    });
  expect(documentUpload.error, `seed document storage upload failed: ${documentUpload.error?.message}`).toBeNull();

  const entityProperty = await user.client
    .from("entity_properties")
    .insert({ owner_id: user.id, entity_id: entityId, property_id: propertyId })
    .select("id")
    .single();
  expect(entityProperty.error, `seed entity_properties failed: ${entityProperty.error?.message}`).toBeNull();

  const entityContact = await user.client
    .from("entity_contacts")
    .insert({ owner_id: user.id, entity_id: entityId, contact_id: contactId, role: "Manager" })
    .select("id")
    .single();
  expect(entityContact.error, `seed entity_contacts failed: ${entityContact.error?.message}`).toBeNull();

  const deal = await user.client
    .from("deals")
    .insert({ owner_id: user.id, name: "Deletion Test Deal", contact_id: contactId, property_id: propertyId })
    .select("id")
    .single();
  expect(deal.error, `seed deals failed: ${deal.error?.message}`).toBeNull();

  const fieldDef = await user.client
    .from("field_definitions")
    .insert({ owner_id: user.id, entity_type: "property", field_name: "Deletion Test Field", field_type: "text" })
    .select("id")
    .single();
  expect(fieldDef.error, `seed field_definitions failed: ${fieldDef.error?.message}`).toBeNull();

  const ingestionError = await user.client
    .from("ingestion_errors")
    .insert({ owner_id: user.id, source_type: "address", stage: "gis_fetch", error_message: "Deletion test error" })
    .select("id")
    .single();
  expect(ingestionError.error, `seed ingestion_errors failed: ${ingestionError.error?.message}`).toBeNull();

  const smartList = await user.client
    .from("smart_lists")
    .insert({ owner_id: user.id, name: "Deletion Test List", query_text: "test", filters: {} })
    .select("id")
    .single();
  expect(smartList.error, `seed smart_lists failed: ${smartList.error?.message}`).toBeNull();

  const userSettings = await user.client
    .from("user_settings")
    .insert({ owner_id: user.id, display_name: "Deletion Test Broker" })
    .select("id")
    .single();
  expect(userSettings.error, `seed user_settings failed: ${userSettings.error?.message}`).toBeNull();

  const errorLog = await user.client
    .from("error_logs")
    .insert({ owner_id: user.id, action: "deletion_test", message: "Deletion test error log" })
    .select("id")
    .single();
  expect(errorLog.error, `seed error_logs failed: ${errorLog.error?.message}`).toBeNull();

  const followUp = await user.client
    .from("follow_ups")
    .insert({ owner_id: user.id, contact_id: contactId, description: "Deletion test follow-up", due_date: "2099-01-01" })
    .select("id")
    .single();
  expect(followUp.error, `seed follow_ups failed: ${followUp.error?.message}`).toBeNull();

  // Multiple storage files, to prove the fix isn't just "handles zero or one file".
  for (const name of ["a.pdf", "b.pdf", "c.pdf"]) {
    const upload = await user.client.storage
      .from("leases")
      .upload(`${user.id}/${name}`, new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" }), {
        contentType: "application/pdf",
        upsert: true,
      });
    expect(upload.error, `seed storage upload ${name} failed: ${upload.error?.message}`).toBeNull();
  }

  return { documentPath };
}

async function rowCountsFor(pg: Client, userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of ACCOUNT_DATA_TABLES) {
    const { rows } = await pg.query(`SELECT count(*)::int AS n FROM ${table} WHERE owner_id = $1`, [userId]);
    counts[table] = rows[0].n;
  }
  return counts;
}

d("Account deletion leaves nothing behind", () => {
  let pg: Client;
  let deletedUser: TestUser;
  let survivorUser: TestUser;
  let deletedDocPath: string;
  let survivorDocPath: string;
  let deletionSucceeded = false;

  beforeAll(async () => {
    pg = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pg.connect();

    deletedUser = await createSignedInTestUser(pg, "del");
    survivorUser = await createSignedInTestUser(pg, "keep");

    ({ documentPath: deletedDocPath } = await seedOneRowPerTable(deletedUser));
    ({ documentPath: survivorDocPath } = await seedOneRowPerTable(survivorUser));
  }, 90_000);

  afterAll(async () => {
    // Storage has no cascade on auth.users (see lib/account-deletion.ts) —
    // clean it up explicitly before dropping the auth rows, same order
    // production deleteAccount() uses, or these files orphan forever.
    if (deletedUser?.client && !deletionSucceeded) {
      await deletedUser.client.storage
        .from("leases")
        .remove(["a.pdf", "b.pdf", "c.pdf"].map((n) => `${deletedUser.id}/${n}`))
        .catch(() => {});
      await deletedUser.client.storage
        .from("documents")
        .remove([deletedDocPath])
        .catch(() => {});
    }
    if (survivorUser?.client) {
      await survivorUser.client.storage
        .from("leases")
        .remove(["a.pdf", "b.pdf", "c.pdf"].map((n) => `${survivorUser.id}/${n}`))
        .catch(() => {});
      await survivorUser.client.storage
        .from("documents")
        .remove([survivorDocPath])
        .catch(() => {});
    }

    // deletedUser's auth row (and everything under it) should already be
    // gone by the time tests finish — this is just a safety net if an
    // assertion threw before the deletion ran.
    if (!deletionSucceeded) await deleteTestUserIfExists(pg, deletedUser?.id);
    await deleteTestUserIfExists(pg, survivorUser?.id);
    await pg?.end();
  }, 30_000);

  it("seeded data across every table + storage for both users before deletion", async () => {
    const before = await rowCountsFor(pg, deletedUser.id);
    for (const table of ACCOUNT_DATA_TABLES) {
      expect(before[table], `expected a seeded row in ${table} before deletion`).toBeGreaterThan(0);
    }
    const { rows: storageBefore } = await pg.query(
      `SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'leases' AND (storage.foldername(name))[1] = $1`,
      [deletedUser.id],
    );
    expect(storageBefore[0].n).toBe(3);

    const { rows: docStorageBefore } = await pg.query(
      `SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'documents' AND (storage.foldername(name))[1] = $1`,
      [deletedUser.id],
    );
    expect(docStorageBefore[0].n).toBe(1);
  });

  it("deleteAllUserRows + deleteAuthUserById remove every row, every file, and the auth user itself", async () => {
    const dataResult = await deleteAllUserRows(deletedUser.client, deletedUser.id);
    expect(dataResult.error, `deleteAllUserRows failed: ${dataResult.error}`).toBeUndefined();

    const authResult = await deleteAuthUserById(deletedUser.id);
    expect(authResult.ok, `deleteAuthUserById failed: ${!authResult.ok ? authResult.error : ""}`).toBe(true);
    deletionSucceeded = true;

    // Verify via direct Postgres — authoritative, and the deleted user's own
    // session is no longer meaningfully checkable through the client anyway.
    const { rows: authRows } = await pg.query(`SELECT id FROM auth.users WHERE id = $1`, [deletedUser.id]);
    expect(authRows, "auth.users row still exists after deletion").toHaveLength(0);

    const after = await rowCountsFor(pg, deletedUser.id);
    for (const table of ACCOUNT_DATA_TABLES) {
      expect(after[table], `${table} still has rows for the deleted user`).toBe(0);
    }

    const { rows: storageAfter } = await pg.query(
      `SELECT name FROM storage.objects WHERE bucket_id = 'leases' AND (storage.foldername(name))[1] = $1`,
      [deletedUser.id],
    );
    expect(storageAfter, "storage objects still exist for the deleted user").toEqual([]);

    const { rows: docStorageAfter } = await pg.query(
      `SELECT name FROM storage.objects WHERE bucket_id = 'documents' AND (storage.foldername(name))[1] = $1`,
      [deletedUser.id],
    );
    expect(docStorageAfter, "document storage objects still exist for the deleted user").toEqual([]);
  }, 60_000);

  it("did not touch the other broker's data (deletion is scoped, not global)", async () => {
    const survivorCounts = await rowCountsFor(pg, survivorUser.id);
    for (const table of ACCOUNT_DATA_TABLES) {
      expect(survivorCounts[table], `${table}: survivor's row was deleted as collateral damage`).toBeGreaterThan(0);
    }
    const { rows: survivorAuth } = await pg.query(`SELECT id FROM auth.users WHERE id = $1`, [survivorUser.id]);
    expect(survivorAuth, "survivor's auth.users row was deleted as collateral damage").toHaveLength(1);

    const { rows: survivorStorage } = await pg.query(
      `SELECT name FROM storage.objects WHERE bucket_id = 'leases' AND (storage.foldername(name))[1] = $1`,
      [survivorUser.id],
    );
    expect(survivorStorage, "survivor's storage files were deleted as collateral damage").toHaveLength(3);

    const { rows: survivorDocStorage } = await pg.query(
      `SELECT name FROM storage.objects WHERE bucket_id = 'documents' AND (storage.foldername(name))[1] = $1`,
      [survivorUser.id],
    );
    expect(survivorDocStorage, "survivor's document storage files were deleted as collateral damage").toHaveLength(1);
  });
});

// ─── Storage pagination (mocked — proving the >1000-file page loop without uploading 1000+ real files) ──

describe("deleteAllUserRows storage pagination", () => {
  it("pages past Storage's list() page size instead of stopping at the first page", async () => {
    const { deleteAllUserRows: run } = await import("../../lib/account-deletion");

    const listCalls: Array<{ limit?: number; offset?: number }> = [];
    const removedPaths: string[] = [];

    const page1 = Array.from({ length: 1000 }, (_, i) => ({ name: `file-${i}.pdf` }));
    const page2 = [{ name: "file-1000.pdf" }];

    const fakeSupabase = {
      from: () => ({
        delete: () => ({ eq: async () => ({ error: null }) }),
        select: () => ({ eq: () => ({ range: async () => ({ data: [], error: null }) }) }),
      }),
      storage: {
        from: () => ({
          list: async (_path: string, opts: { limit?: number; offset?: number }) => {
            listCalls.push(opts);
            const isFirstCall = listCalls.length === 1;
            return { data: isFirstCall ? page1 : page2, error: null };
          },
          remove: async (paths: string[]) => {
            removedPaths.push(...paths);
            return { error: null };
          },
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await run(fakeSupabase, "fake-user-id");
    expect(result.error).toBeUndefined();
    expect(listCalls).toHaveLength(2);
    expect(listCalls[0].offset).toBe(0);
    expect(listCalls[1].offset).toBe(1000);
    expect(removedPaths).toHaveLength(1001);
  });

  it("pages past PostgREST's row cap when collecting document storage_path values, and chunks the removal", async () => {
    const { deleteAllUserRows: run } = await import("../../lib/account-deletion");

    const rangeCalls: Array<{ from: number; to: number }> = [];
    const removedByBucket: Record<string, string[][]> = { documents: [], leases: [] };

    const page1 = Array.from({ length: 1000 }, (_, i) => ({ storage_path: `u/property/p/file-${i}.pdf` }));
    const page2 = [{ storage_path: "u/property/p/file-1000.pdf" }];

    const fakeSupabase = {
      from: () => ({
        delete: () => ({ eq: async () => ({ error: null }) }),
        select: () => ({
          eq: () => ({
            range: async (from: number, to: number) => {
              rangeCalls.push({ from, to });
              return { data: rangeCalls.length === 1 ? page1 : page2, error: null };
            },
          }),
        }),
      }),
      storage: {
        from: (bucket: string) => ({
          list: async () => ({ data: [], error: null }),
          remove: async (paths: string[]) => {
            removedByBucket[bucket].push(paths);
            return { error: null };
          },
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await run(fakeSupabase, "fake-user-id");
    expect(result.error).toBeUndefined();
    expect(rangeCalls).toHaveLength(2);
    expect(rangeCalls[0]).toEqual({ from: 0, to: 999 });
    expect(rangeCalls[1]).toEqual({ from: 1000, to: 1999 });

    const allRemovedDocPaths = removedByBucket.documents.flat();
    expect(allRemovedDocPaths).toHaveLength(1001);
    // Removal itself is chunked at STORAGE_LIST_PAGE_SIZE (1000).
    expect(removedByBucket.documents.map((chunk) => chunk.length)).toEqual([1000, 1]);
  });
});
