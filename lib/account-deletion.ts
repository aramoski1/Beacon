/**
 * Full-account data wipe, shared by app/settings/actions.ts (deleteAllData /
 * deleteAccount) and directly testable here since those server actions
 * depend on next/headers cookies() and can't be called outside a request.
 *
 * ACCOUNT_DATA_TABLES is the single source of truth for "every table that
 * holds a broker's data" — keep it in sync with scripts/migrate*.ts. Storage
 * cleanup is NOT covered by a DB cascade: storage.objects has no foreign key
 * to auth.users (confirmed against the live schema), so deleting the auth
 * user does nothing for uploaded lease PDFs or documents — this module is
 * the only thing that removes them, which is why it paginates past Supabase
 * Storage's default list() page size and checks the remove() result for
 * errors instead of assuming success. Leases live flat under `${userId}/`,
 * so a folder-listing walk finds them; documents live nested under
 * `${userId}/${entity_type}/${entity_id}/`, so their paths are read from the
 * documents table itself instead.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Every table with an owner_id column holding broker data, in the order deleteAllData has always used. */
export const ACCOUNT_DATA_TABLES = [
  "follow_ups",
  "activities",
  "ingestion_errors",
  "error_logs",
  "deals",
  "smart_lists",
  "documents",
  "lease_abstracts",
  "entity_contacts",
  "entity_properties",
  "contact_properties",
  "entities",
  "contacts",
  "properties",
  "field_definitions",
  "user_settings",
] as const;

const STORAGE_LIST_PAGE_SIZE = 1000;

/** Removes every object under `${userId}/` in the given bucket, paginating past Storage's page-size cap. */
async function deleteAllStorageObjectsUnderPrefix(
  supabase: SupabaseClient,
  bucket: string,
  userId: string,
): Promise<{ error?: string }> {
  let offset = 0;
  for (;;) {
    const { data: page, error: listError } = await supabase.storage
      .from(bucket)
      .list(userId, { limit: STORAGE_LIST_PAGE_SIZE, offset });
    if (listError) return { error: `Failed to list ${bucket} files: ${listError.message}` };
    if (!page || page.length === 0) break;

    const paths = page.map((o) => `${userId}/${o.name}`);
    const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
    if (removeError) return { error: `Failed to delete ${bucket} files: ${removeError.message}` };

    if (page.length < STORAGE_LIST_PAGE_SIZE) break;
    offset += page.length;
  }
  return {};
}

const DOCUMENTS_ROW_PAGE_SIZE = 1000;

/**
 * Reads every documents.storage_path for `userId`, paginating past
 * PostgREST's default row cap. Documents live nested under
 * `${userId}/${entity_type}/${entity_id}/...`, so — unlike the flat
 * `leases` bucket — a folder-listing walk can't reliably find every object.
 * The documents table itself is the authoritative list of what's there.
 */
async function collectDocumentStoragePaths(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ paths?: string[]; error?: string }> {
  const paths: string[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("documents")
      .select("storage_path")
      .eq("owner_id", userId)
      .range(from, from + DOCUMENTS_ROW_PAGE_SIZE - 1);
    if (error) return { error: `Failed to list document rows: ${error.message}` };
    if (!data || data.length === 0) break;

    paths.push(...data.map((d) => d.storage_path as string));
    if (data.length < DOCUMENTS_ROW_PAGE_SIZE) break;
    from += data.length;
  }
  return { paths };
}

/** Removes storage objects in chunks, since Storage's remove() isn't meant for unbounded arrays. */
async function removeStorageObjectsChunked(
  supabase: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<{ error?: string }> {
  for (let i = 0; i < paths.length; i += STORAGE_LIST_PAGE_SIZE) {
    const chunk = paths.slice(i, i + STORAGE_LIST_PAGE_SIZE);
    const { error } = await supabase.storage.from(bucket).remove(chunk);
    if (error) return { error: `Failed to delete ${bucket} files: ${error.message}` };
  }
  return {};
}

/**
 * Deletes every row across ACCOUNT_DATA_TABLES for `userId`, plus every
 * uploaded lease PDF and document, using `supabase` (must already be
 * authenticated as that user — RLS is what makes each per-table delete safe
 * to scope by owner_id, and storage RLS requires the caller's own session to
 * remove their own folder).
 */
export async function deleteAllUserRows(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ error?: string }> {
  // documents.storage_path must be read before the table-row delete loop
  // below removes those rows.
  const docPaths = await collectDocumentStoragePaths(supabase, userId);
  if (docPaths.error) return { error: docPaths.error };

  for (const table of ACCOUNT_DATA_TABLES) {
    const { error } = await supabase.from(table).delete().eq("owner_id", userId);
    if (error) return { error: `Failed to delete ${table}: ${error.message}` };
  }

  if (docPaths.paths && docPaths.paths.length > 0) {
    const docStorageResult = await removeStorageObjectsChunked(supabase, "documents", docPaths.paths);
    if (docStorageResult.error) return docStorageResult;
  }

  const storageResult = await deleteAllStorageObjectsUnderPrefix(supabase, "leases", userId);
  if (storageResult.error) return storageResult;

  return {};
}
