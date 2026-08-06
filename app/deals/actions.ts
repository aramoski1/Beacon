"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  DEAL_STAGES,
  DEAL_TYPE_LABELS,
  STAGE_LABELS,
  TERMINAL_STAGES,
  ACTIVE_STAGES,
  validateCreateDeal,
  isDealStale,
  isStageAllowedForType,
  type Deal,
  type DealStage,
  type DealType,
  type CreateDealInput,
  type ValidationError,
} from "@/lib/deals";
import { sumEstimatedCommission } from "@/lib/dashboard-kpis";
import {
  dealFollowUpDescriptionPrefix,
  formatDealFollowUpDescription,
  isDealFollowUpDescription,
} from "@/lib/deal-follow-up";

async function syncDealFollowUp(params: {
  ownerId: string;
  dealId: string;
  dealName: string;
  contactId: string | null;
  propertyId: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
}): Promise<void> {
  if (!params.nextActionDue) return;
  if (!params.contactId && !params.propertyId) return;

  const supabase = await createClient();
  const description = formatDealFollowUpDescription(
    params.dealId,
    params.dealName,
    params.nextAction,
  );

  const { data: open } = await supabase
    .from("follow_ups")
    .select("id, description")
    .eq("owner_id", params.ownerId)
    .eq("done", false)
    .limit(100);

  const existing = (open ?? []).find((r) =>
    isDealFollowUpDescription(r.description ?? "", params.dealId),
  );

  if (existing) {
    await supabase
      .from("follow_ups")
      .update({
        due_date: params.nextActionDue,
        description,
        contact_id: params.contactId,
        property_id: params.propertyId,
      })
      .eq("id", existing.id)
      .eq("owner_id", params.ownerId);
  } else {
    await supabase.from("follow_ups").insert({
      owner_id: params.ownerId,
      contact_id: params.contactId,
      property_id: params.propertyId,
      due_date: params.nextActionDue,
      description,
      source_type: "manual",
    });
  }

  if (params.contactId) {
    await supabase
      .from("contacts")
      .update({ next_action_due: params.nextActionDue })
      .eq("id", params.contactId)
      .eq("owner_id", params.ownerId);
  }

  revalidatePath("/follow-ups");
  revalidatePath("/dashboard");
}

export async function getDeals(): Promise<Deal[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("deals")
    .select("*, contacts(name, company), properties(address, city)")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });

  return (data ?? []) as Deal[];
}

export type DealsDashboard = {
  activeCount: number;
  staleCount: number;
  estimatedCommissionTotal: number;
  recentActive: Deal[];
  /** All non-terminal deals loaded for dashboard (up to 50) — for Today desk. */
  activeDeals: Deal[];
};

export async function getDealsDashboard(): Promise<DealsDashboard> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      activeCount: 0,
      staleCount: 0,
      estimatedCommissionTotal: 0,
      recentActive: [],
      activeDeals: [],
    };
  }

  const { data } = await supabase
    .from("deals")
    .select("*, contacts(name, company), properties(address, city)")
    .eq("owner_id", user.id)
    .not("stage", "in", `(${TERMINAL_STAGES.join(",")})`)
    .order("updated_at", { ascending: false })
    .limit(50);

  const deals = (data ?? []) as Deal[];
  const staleCount = deals.filter((d) => isDealStale(d)).length;
  const estimatedCommissionTotal = sumEstimatedCommission(
    deals.map((d) => d.estimated_commission),
  );

  return {
    activeCount: deals.length,
    staleCount,
    estimatedCommissionTotal,
    recentActive: deals.slice(0, 5),
    activeDeals: deals,
  };
}

export async function createDeal(
  input: CreateDealInput
): Promise<{ deal?: Deal; error?: string; fieldErrors?: ValidationError[] }> {
  const errors = validateCreateDeal(input);
  if (errors.length > 0) return { fieldErrors: errors };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  if (input.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", input.contact_id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!contact) return { error: "That contact isn't in your book." };
  }
  if (input.property_id) {
    const { data: property } = await supabase
      .from("properties")
      .select("id")
      .eq("id", input.property_id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!property) return { error: "That property isn't in your book." };
  }

  const { data, error } = await supabase
    .from("deals")
    .insert({
      owner_id: user.id,
      name: input.name.trim(),
      deal_type: input.deal_type ?? "tenant_rep",
      stage: input.stage ?? "prospect",
      contact_id: input.contact_id ?? null,
      property_id: input.property_id ?? null,
      estimated_commission: input.estimated_commission ?? null,
      notes: input.notes?.trim() ?? null,
      next_action: input.next_action?.trim() ?? null,
      next_action_due: input.next_action_due ?? null,
    })
    .select("*, contacts(name, company), properties(address, city)")
    .single();

  if (error) return { error: error.message };

  await syncDealFollowUp({
    ownerId: user.id,
    dealId: data.id,
    dealName: data.name,
    contactId: data.contact_id,
    propertyId: data.property_id,
    nextAction: data.next_action,
    nextActionDue: data.next_action_due,
  });

  revalidatePath("/deals");
  revalidatePath("/dashboard");
  return { deal: data as Deal };
}

export async function updateDealStage(
  dealId: string,
  stage: DealStage
): Promise<{ error?: string }> {
  if (!(DEAL_STAGES as readonly string[]).includes(stage)) {
    return { error: "Invalid stage." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: existing, error: fetchErr } = await supabase
    .from("deals")
    .select("deal_type")
    .eq("id", dealId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (fetchErr) return { error: fetchErr.message };
  if (!existing) return { error: "Deal not found." };

  const dealType = existing.deal_type as DealType;
  if (!isStageAllowedForType(stage, dealType)) {
    return {
      error: `Stage "${STAGE_LABELS[stage]}" isn't used for ${DEAL_TYPE_LABELS[dealType]} pursuits.`,
    };
  }

  const { error } = await supabase
    .from("deals")
    .update({ stage, updated_at: new Date().toISOString() })
    .eq("id", dealId)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/deals");
  revalidatePath("/dashboard");
  return {};
}

export async function updateDeal(
  dealId: string,
  input: Partial<CreateDealInput>
): Promise<{ deal?: Deal; error?: string; fieldErrors?: ValidationError[] }> {
  const errors = validateCreateDeal({ name: input.name ?? "placeholder", ...input });
  const nameErrors = errors.filter((e) => e.field !== "name" || input.name != null);
  if (nameErrors.length > 0) return { fieldErrors: nameErrors };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name != null) patch.name = input.name.trim();
  if (input.stage != null) patch.stage = input.stage;
  if ("estimated_commission" in input) patch.estimated_commission = input.estimated_commission ?? null;
  if ("notes" in input) patch.notes = input.notes?.trim() ?? null;
  if ("next_action" in input) patch.next_action = input.next_action?.trim() ?? null;
  if ("next_action_due" in input) patch.next_action_due = input.next_action_due ?? null;

  const { data, error } = await supabase
    .from("deals")
    .update(patch)
    .eq("id", dealId)
    .eq("owner_id", user.id)
    .select("*, contacts(name, company), properties(address, city)")
    .single();

  if (error) return { error: error.message };

  await syncDealFollowUp({
    ownerId: user.id,
    dealId: data.id,
    dealName: data.name,
    contactId: data.contact_id,
    propertyId: data.property_id,
    nextAction: data.next_action,
    nextActionDue: data.next_action_due,
  });

  revalidatePath("/deals");
  revalidatePath("/dashboard");
  return { deal: data as Deal };
}

export async function deleteDeal(dealId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // follow_ups has no FK back to deals (soft-linked via description prefix —
  // see lib/deal-follow-up.ts), so it won't cascade on its own. Clean it up
  // explicitly or a deleted deal leaves a dangling, un-completable follow-up.
  const { error: followUpError } = await supabase
    .from("follow_ups")
    .delete()
    .eq("owner_id", user.id)
    .like("description", `${dealFollowUpDescriptionPrefix(dealId)}%`);
  if (followUpError) return { error: followUpError.message };

  const { error } = await supabase
    .from("deals")
    .delete()
    .eq("id", dealId)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/deals");
  revalidatePath("/dashboard");
  return {};
}
