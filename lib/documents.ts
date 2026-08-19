import type { SupabaseClient } from "@supabase/supabase-js";

export type DocumentEntityType = "property" | "lease" | "contact" | "deal";

export type DocumentRow = {
  id: string;
  file_name: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

export type DocumentWithUrl = DocumentRow & { url: string | null };

const SIGNED_URL_TTL_SECONDS = 3600;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Lists documents for an entity, each with a fresh 1-hour signed download URL. */
export async function listDocuments(
  supabase: SupabaseClient,
  userId: string,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<DocumentWithUrl[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, file_name, storage_path, content_type, size_bytes, created_at")
    .eq("owner_id", userId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  const rows = data as DocumentRow[];

  return Promise.all(
    rows.map(async (row) => {
      const { data: signed } = await supabase.storage
        .from("documents")
        .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
      return { ...row, url: signed?.signedUrl ?? null };
    }),
  );
}

/** Uploads a file to the `documents` bucket and records it against an entity. */
export async function uploadDocument(
  supabase: SupabaseClient,
  userId: string,
  entityType: DocumentEntityType,
  entityId: string,
  file: File,
): Promise<{ id?: string; error?: string }> {
  if (file.size === 0) return { error: "File is empty." };
  if (file.size > MAX_FILE_BYTES) return { error: "File must be under 32 MB." };

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = sanitizeFileName(file.name);
  const storagePath = `${userId}/${entityType}/${entityId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) return { error: `Upload failed: ${uploadError.message}` };

  const { data, error: insertError } = await supabase
    .from("documents")
    .insert({
      owner_id: userId,
      entity_type: entityType,
      entity_id: entityId,
      file_name: file.name,
      storage_path: storagePath,
      content_type: file.type || null,
      size_bytes: file.size,
    })
    .select("id")
    .single();

  if (insertError) {
    await supabase.storage.from("documents").remove([storagePath]);
    return { error: insertError.message };
  }
  return { id: data.id };
}

/** Deletes a document's storage object and row (owner-scoped). */
export async function deleteDocument(
  supabase: SupabaseClient,
  userId: string,
  documentId: string,
): Promise<{ error?: string }> {
  const { data: doc, error: fetchError } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", documentId)
    .eq("owner_id", userId)
    .single();
  if (fetchError || !doc) return { error: "Document not found." };

  const { error: removeError } = await supabase.storage.from("documents").remove([doc.storage_path]);
  if (removeError) return { error: `Failed to delete file: ${removeError.message}` };

  const { error: deleteError } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .eq("owner_id", userId);
  if (deleteError) return { error: deleteError.message };

  return {};
}

/** Deletes every document (storage objects + rows) for one entity — used when the parent record itself is deleted. */
export async function deleteDocumentsForEntity(
  supabase: SupabaseClient,
  userId: string,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<{ error?: string }> {
  const { data, error: fetchError } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("owner_id", userId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);
  if (fetchError) return { error: fetchError.message };

  const paths = (data ?? []).map((d) => d.storage_path as string);
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from("documents").remove(paths);
    if (removeError) return { error: `Failed to delete files: ${removeError.message}` };
  }

  const { error: deleteError } = await supabase
    .from("documents")
    .delete()
    .eq("owner_id", userId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);
  if (deleteError) return { error: deleteError.message };

  return {};
}
