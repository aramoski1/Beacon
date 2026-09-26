"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  DEAL_STAGES,
  DEAL_TYPE_LABELS,
  STAGE_LABELS,
  STAGE_PROBABILITY,
  TERMINAL_STAGES,
  ACTIVE_STAGES,
  validateCreateDeal,
  isDealStale,
  daysInStage,
  isStageAllowedForType,
  type Deal,
  type DealStage,
  type DealType,
  type CreateDealInput,
  type ValidationError,
} from "@/lib/deals";
import { sumEstimatedCommission } from "@/lib/dashboard-kpis";
import { formatDealFollowUpDescription } from "@/lib/deal-follow-up";
import { deleteDocumentsForEntity } from "@/lib/documents";
import { withAction } from "@/lib/logger";

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

  const supabase = await createClient();
  const description = formatDealFollowUpDescription(params.dealName, params.nextAction);

  const { data: existing } = await supabase
    .from("follow_ups")
    .select("id")
    .eq("owner_id", params.ownerId)
    .eq("deal_id", params.dealId)
    .eq("done", false)
    .maybeSingle();

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
      deal_id: params.dealId,
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

export type DealsForecast = {
  weightedPipelineValue: number;
  totalPipelineValue: number;
  byStage: { stage: DealStage; count: number; value: number }[];
  byMonth: { month: string; count: number; value: number }[];
  winRate: number;
  winRateWon: number;
  winRateDecided: number;
  staleCount: number;
  agingDeals: Deal[];
};

export async function getDealsForecast(): Promise<DealsForecast> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      weightedPipelineValue: 0,
      totalPipelineValue: 0,
      byStage: [],
      byMonth: [],
      winRate: 0,
      winRateWon: 0,
      winRateDecided: 0,
      staleCount: 0,
      agingDeals: [],
    };
  }

  const { data } = await supabase
    .from("deals")
    .select("*, contacts(name, company), properties(address, city)")
    .eq("owner_id", user.id);

  const deals = (data ?? []) as Deal[];
  const active = deals.filter((d) => !(TERMINAL_STAGES as readonly string[]).includes(d.stage));

  const totalPipelineValue = sumEstimatedCommission(active.map((d) => d.estimated_commission));
  const weightedPipelineValue = active.reduce((sum, d) => {
    const value = d.estimated_commission ?? 0;
    if (!Number.isFinite(value) || value < 0) return sum;
    return sum + value * (STAGE_PROBABILITY[d.stage] / 100);
  }, 0);

  const byStage = ACTIVE_STAGES.map((stage) => {
    const stageDeals = active.filter((d) => d.stage === stage);
    return {
      stage,
      count: stageDeals.length,
      value: sumEstimatedCommission(stageDeals.map((d) => d.estimated_commission)),
    };
  }).filter((s) => s.count > 0);

  const monthBuckets = new Map<string, { count: number; value: number }>();
  for (const d of active) {
    if (!d.expected_close_date) continue;
    const key = d.expected_close_date.slice(0, 7);
    const cur = monthBuckets.get(key) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value += Number.isFinite(d.estimated_commission ?? NaN) ? (d.estimated_commission ?? 0) : 0;
    monthBuckets.set(key, cur);
  }
  const byMonth = [...monthBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  const closedCount = deals.filter((d) => d.stage === "closed").length;
  const lostCount = deals.filter((d) => d.stage === "lost").length;
  const winRate = closedCount + lostCount > 0 ? closedCount / (closedCount + lostCount) : 0;

  const staleDeals = active.filter((d) => isDealStale(d)).sort((a, b) => daysInStage(b) - daysInStage(a));

  return {
    weightedPipelineValue,
    totalPipelineValue,
    byStage,
    byMonth,
    winRate,
    winRateWon: closedCount,
    winRateDecided: closedCount + lostCount,
    staleCount: staleDeals.length,
    agingDeals: staleDeals.slice(0, 10),
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

  return withAction(
    "createDeal",
    async () => {
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
          expected_close_date: input.expected_close_date ?? null,
          custom_fields: input.custom_fields ?? {},
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
    },
    { userId: user.id, context: { name: input.name } },
  );
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
  const errors = validateCreateDeal(
    { name: input.name ?? "placeholder", ...input },
    { requireCloseDate: input.expected_close_date !== undefined },
  );
  const nameErrors = errors.filter((e) => e.field !== "name" || input.name != null);
  if (nameErrors.length > 0) return { fieldErrors: nameErrors };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // When the deal type is changing, the resulting stage (the one in this same
  // update if provided, else the deal's current stage) must still belong to
  // the new type's stage set — otherwise the deal ends up on a stage its
  // kanban/board no longer recognizes for that type.
  if (input.deal_type != null) {
    let effectiveStage = input.stage;
    if (effectiveStage == null) {
      const { data: existing, error: fetchErr } = await supabase
        .from("deals")
        .select("stage")
        .eq("id", dealId)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (fetchErr) return { error: fetchErr.message };
      if (!existing) return { error: "Deal not found." };
      effectiveStage = existing.stage as DealStage;
    }
    if (!isStageAllowedForType(effectiveStage, input.deal_type)) {
      return {
        fieldErrors: [{
          field: "stage",
          message: `Stage "${STAGE_LABELS[effectiveStage]}" isn't used for ${DEAL_TYPE_LABELS[input.deal_type]} pursuits.`,
        }],
      };
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name != null) patch.name = input.name.trim();
  if (input.deal_type != null) patch.deal_type = input.deal_type;
  if (input.stage != null) patch.stage = input.stage;
  if ("estimated_commission" in input) patch.estimated_commission = input.estimated_commission ?? null;
  if ("notes" in input) patch.notes = input.notes?.trim() ?? null;
  if ("next_action" in input) patch.next_action = input.next_action?.trim() ?? null;
  if ("next_action_due" in input) patch.next_action_due = input.next_action_due ?? null;
  if ("expected_close_date" in input) patch.expected_close_date = input.expected_close_date ?? null;
  if ("custom_fields" in input) patch.custom_fields = input.custom_fields ?? {};

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

  const docsResult = await deleteDocumentsForEntity(supabase, user.id, "deal", dealId);
  if (docsResult.error) return docsResult;

  // activities.deal_id and follow_ups.deal_id are both ON DELETE CASCADE, so
  // deleting the deal row cascades those on its own.
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
