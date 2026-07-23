"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { loadPropertyIdsForContact } from "@/lib/contact-properties";
import { cadenceMapFromSettings, cadenceDaysForTier } from "@/lib/cadence";
import { getUserSettings } from "@/app/settings/actions";

/** Cheaper model — briefings run on demand and may refresh often. */
const BRIEFING_MODEL = "claude-haiku-4-5-20251001";

export type RelationshipBriefing = {
  whereThingsStand: string;
  suggestedNextMove: string;
  generatedAt: string;
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

async function gatherBriefingContext(contactId: string, userId: string) {
  const supabase = await createClient();

  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select(
      "id, name, company, role, email, contact_tier, client_status, contact_type, last_contacted_at, next_action_due, linked_properties, outreach_history, action_tags, size_category, geographic_category, ownership_type",
    )
    .eq("id", contactId)
    .eq("owner_id", userId)
    .single();

  if (contactErr || !contact) return { error: "Contact not found." as const };

  const propertyIds = await loadPropertyIdsForContact(
    supabase,
    userId,
    contactId,
    contact.linked_properties as string[] | null,
  );

  const [propsResult, activitiesResult, followUpsResult, leasesResult] = await Promise.all([
    propertyIds.length > 0
      ? supabase
          .from("properties")
          .select("id, address, city, submarket, property_type, size_sqft, owner_name, last_sale_date, asset_description")
          .in("id", propertyIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("activities")
      .select("activity_type, activity_date, notes, property_id, properties(address)")
      .eq("owner_id", userId)
      .eq("contact_id", contactId)
      .order("activity_date", { ascending: false })
      .limit(20),
    supabase
      .from("follow_ups")
      .select("description, due_date, done, property_id, properties(address)")
      .eq("owner_id", userId)
      .eq("contact_id", contactId)
      .order("due_date", { ascending: true })
      .limit(10),
    propertyIds.length > 0
      ? supabase
          .from("lease_abstracts")
          .select("id, linked_property, source_document, expiration_date, execution_date, base_rate, term, properties(address)")
          .eq("owner_id", userId)
          .in("linked_property", propertyIds)
          .order("expiration_date", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  const properties = propsResult.data ?? [];
  const activities = activitiesResult.data ?? [];
  const followUps = followUpsResult.data ?? [];
  const leases = leasesResult.data ?? [];

  const settings = await getUserSettings();
  const threshold = cadenceDaysForTier(
    contact.contact_tier as number | null,
    cadenceMapFromSettings(settings),
  );
  const days = daysSince(contact.last_contacted_at);
  const cadenceStatus =
    threshold == null
      ? null
      : days == null
        ? "never contacted"
        : days > threshold
          ? `${days - threshold} days overdue (${days}d since last touch, ${threshold}d cadence)`
          : `${threshold - days} days until due (${days}d since last touch)`;

  const outreach = [...((contact.outreach_history as { sent_at: string; subject: string; body: string; method?: string }[]) ?? [])]
    .slice(-8)
    .reverse()
    .map((e) => ({
      date: fmtDate(e.sent_at),
      subject: e.subject,
      excerpt: e.body.slice(0, 160) + (e.body.length > 160 ? "…" : ""),
      method: e.method ?? "email",
    }));

  const propAddress = (row: { properties: unknown }) => {
    const p = row.properties as { address: string | null } | { address: string | null }[] | null;
    if (Array.isArray(p)) return p[0]?.address ?? null;
    return p?.address ?? null;
  };

  return {
    context: {
      contact: {
        name: contact.name,
        company: contact.company,
        role: contact.role,
        tier: contact.contact_tier,
        client_status: contact.client_status,
        contact_type: contact.contact_type,
        last_contacted_at: contact.last_contacted_at ? fmtDate(contact.last_contacted_at) : null,
        next_action_due: contact.next_action_due ? fmtDate(contact.next_action_due) : null,
        cadence_status: cadenceStatus,
        tags: contact.action_tags ?? [],
        size_category: contact.size_category,
        geographic_category: contact.geographic_category,
        ownership_type: contact.ownership_type,
      },
      linked_properties: properties.map((p) => ({
        address: p.address,
        city: p.city,
        submarket: p.submarket,
        type: p.property_type,
        sqft: p.size_sqft,
        owner_name: p.owner_name,
        last_sale_date: p.last_sale_date ? fmtDate(p.last_sale_date) : null,
        asset_description: p.asset_description,
      })),
      recent_activities: activities.map((a) => ({
        type: a.activity_type,
        date: fmtDate(a.activity_date),
        notes: a.notes,
        property: propAddress(a),
      })),
      outreach_log: outreach,
      follow_ups: followUps.map((f) => ({
        description: f.description,
        due: fmtDate(f.due_date),
        done: f.done,
        property: propAddress(f),
      })),
      leases: leases.map((l) => ({
        property: propAddress(l),
        document: l.source_document?.split("/").pop() ?? "Lease abstract",
        execution_date: l.execution_date ? fmtDate(l.execution_date) : null,
        expiration_date: l.expiration_date ? fmtDate(l.expiration_date) : null,
        base_rate: l.base_rate,
        term: l.term,
        days_until_expiry: l.expiration_date
          ? Math.ceil(
              (new Date(l.expiration_date + "T12:00:00").getTime() - Date.now()) / 86_400_000,
            )
          : null,
      })),
    },
  };
}

const BRIEFING_TOOL: Anthropic.Tool = {
  name: "write_relationship_briefing",
  description: "Write a short relationship briefing for a commercial real estate broker.",
  input_schema: {
    type: "object" as const,
    required: ["where_things_stand", "suggested_next_move"],
    properties: {
      where_things_stand: {
        type: "string",
        description: "2-4 sentences summarizing relationship status, recent touchpoints, and portfolio/lease context.",
      },
      suggested_next_move: {
        type: "string",
        description: "1-2 sentences with one concrete, prioritized next action for the broker.",
      },
    },
  },
};

export async function generateRelationshipBriefing(
  contactId: string,
): Promise<{ briefing?: RelationshipBriefing; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const gathered = await gatherBriefingContext(contactId, user.id);
  if ("error" in gathered) return { error: gathered.error };

  const anthropic = new Anthropic();
  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: BRIEFING_MODEL,
      max_tokens: 512,
      tools: [BRIEFING_TOOL],
      tool_choice: { type: "tool", name: "write_relationship_briefing" },
      messages: [
        {
          role: "user",
          content: `You are briefing a commercial real estate broker before they reach out to a contact.

Write a concise relationship briefing from the CRM data below. Be specific — cite property addresses, lease expirations, activity dates, and outreach subjects when relevant. Do not invent facts not in the data.

Tone: direct, professional, like a sharp associate summarizing the file. No filler phrases.

If data is sparse, say so honestly and suggest a sensible first move anyway.

CRM data:
${JSON.stringify(gathered.context, null, 2)}`,
        },
      ],
    });
  } catch (e) {
    return {
      error: `Briefing failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const toolBlock = message.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return { error: "Could not generate briefing. Try again." };
  }

  const result = toolBlock.input as {
    where_things_stand: string;
    suggested_next_move: string;
  };

  return {
    briefing: {
      whereThingsStand: result.where_things_stand.trim(),
      suggestedNextMove: result.suggested_next_move.trim(),
      generatedAt: new Date().toISOString(),
    },
  };
}
