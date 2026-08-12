"use server";

import { createClient } from "@/lib/supabase/server";
import {
  listDocuments,
  uploadDocument,
  deleteDocument,
  type DocumentEntityType,
  type DocumentWithUrl,
} from "@/lib/documents";

export async function fetchDocuments(
  entityType: DocumentEntityType,
  entityId: string,
): Promise<DocumentWithUrl[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  return listDocuments(supabase, user.id, entityType, entityId);
}

export async function uploadDocumentAction(
  entityType: DocumentEntityType,
  entityId: string,
  formData: FormData,
): Promise<{ id?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Please select a file." };

  return uploadDocument(supabase, user.id, entityType, entityId, file);
}

export async function deleteDocumentAction(documentId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  return deleteDocument(supabase, user.id, documentId);
}
