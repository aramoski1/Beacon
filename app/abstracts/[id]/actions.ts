"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  requireLinkedPropertyId,
  LEASE_PROPERTY_UNLINK_BLOCKED_MSG,
} from "@/lib/lease-property";
import { columnPatchForCorrection, type FieldReviews, type ReviewStatus } from "./review-utils";

export async function setLeaseProperty(
  leaseId: string,
  propertyId: string | null,
): Promise<{ error?: string; ok?: true }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // Clearing to null is blocked — radar/follow-ups go dark silently otherwise.
  if (!propertyId?.trim()) {
    return { error: LEASE_PROPERTY_UNLINK_BLOCKED_MSG };
  }
  const linkErr = requireLinkedPropertyId(propertyId);
  if (linkErr) return { error: linkErr };

  const { data: prop } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!prop) {
    return { error: "That property isn't in your book." };
  }

  const { error } = await supabase
    .from("lease_abstracts")
    .update({ linked_property: propertyId })
    .eq("id", leaseId)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };
  revalidatePath(`/abstracts/${leaseId}`);
  return { ok: true };
}

export async function setLeaseTenant(
  leaseId: string,
  contactId: string | null,
): Promise<{ error?: string; ok?: true }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  if (contactId) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!contact) {
      return { error: "That contact isn't in your book." };
    }
  }

  const { error } = await supabase
    .from("lease_abstracts")
    .update({ tenant_contact_id: contactId })
    .eq("id", leaseId)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };
  revalidatePath(`/abstracts/${leaseId}`);
  return { ok: true };
}

// ─── PDF signed URL ───────────────────────────────────────────────────────────

export async function getLeasePdfUrl(
  storagePath: string,
): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  if (!storagePath.startsWith(user.id + "/")) return { error: "Access denied." };

  const { data, error } = await supabase.storage
    .from("leases")
    .createSignedUrl(storagePath, 3600);

  if (error || !data?.signedUrl) return { error: error?.message ?? "Could not generate URL." };
  return { url: data.signedUrl };
}

// ─── Per-field review ─────────────────────────────────────────────────────────

export async function saveFieldReview(
  leaseId: string,
  fieldKey: string,
  status: ReviewStatus,
  correctedValue?: string | number | null,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: current, error: fetchErr } = await supabase
    .from("lease_abstracts")
    .select("field_reviews")
    .eq("id", leaseId)
    .eq("owner_id", user.id)
    .single();

  if (fetchErr || !current) return { error: fetchErr?.message ?? "Lease not found." };

  const existing = (current.field_reviews ?? {}) as FieldReviews;
  const updated: FieldReviews = {
    ...existing,
    [fieldKey]: {
      status,
      reviewedAt: new Date().toISOString(),
      ...(correctedValue !== undefined ? { correctedValue } : {}),
    },
  };

  // If reverting to pending, remove the entry entirely to keep JSONB clean
  if (status === "pending") {
    const { [fieldKey]: _, ...rest } = updated;
    const { error } = await supabase
      .from("lease_abstracts")
      .update({ field_reviews: rest })
      .eq("id", leaseId)
      .eq("owner_id", user.id);
    if (error) return { error: error.message };
    revalidatePath(`/abstracts/${leaseId}`);
    return { ok: true };
  }

  // A correction to a scalar field (execution_date / expiration_date / term /
  // base_rate) must also land on the real column, not just field_reviews —
  // lease radar and lease comps query those columns directly, so a
  // field_reviews-only correction is invisible to both.
  let columnPatch: Record<string, string | number | null> = {};
  if (status === "corrected") {
    const result = columnPatchForCorrection(fieldKey, correctedValue);
    if (result && "error" in result) return { error: result.error };
    if (result && "patch" in result) columnPatch = result.patch;
  }

  const { error } = await supabase
    .from("lease_abstracts")
    .update({ field_reviews: updated, ...columnPatch })
    .eq("id", leaseId)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };
  revalidatePath(`/abstracts/${leaseId}`);
  return { ok: true };
}

// ─── Batch accept all pending fields ─────────────────────────────────────────

export async function acceptAllFields(
  leaseId: string,
  fieldKeys: string[],
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: current, error: fetchErr } = await supabase
    .from("lease_abstracts")
    .select("field_reviews")
    .eq("id", leaseId)
    .eq("owner_id", user.id)
    .single();

  if (fetchErr || !current) return { error: fetchErr?.message ?? "Lease not found." };

  const existing = (current.field_reviews ?? {}) as FieldReviews;
  const now = new Date().toISOString();
  const updated: FieldReviews = { ...existing };

  for (const key of fieldKeys) {
    const cur = existing[key];
    if (!cur || cur.status === "pending") {
      updated[key] = { status: "accepted", reviewedAt: now };
    }
  }

  const { error } = await supabase
    .from("lease_abstracts")
    .update({ field_reviews: updated })
    .eq("id", leaseId)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };
  revalidatePath(`/abstracts/${leaseId}`);
  return { ok: true };
}
