"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import type { OwnerPortfolioData } from "@/lib/owner-portfolio";

const BRIEFING_MODEL = "claude-haiku-4-5-20251001";

export type PortfolioBriefing = {
  whereThingsStand: string;
  nextActions: Array<{
    contactId: string | null;
    contactName: string;
    reason: string;
    urgency: "critical" | "high" | "medium";
  }>;
  generatedAt: string;
};

const PORTFOLIO_BRIEFING_TOOL: Anthropic.Tool = {
  name: "write_portfolio_intelligence",
  description: "Write a portfolio intelligence brief for a commercial real estate broker viewing an owner's full portfolio.",
  input_schema: {
    type: "object" as const,
    required: ["where_things_stand", "next_actions"],
    properties: {
      where_things_stand: {
        type: "string",
        description: "2-4 sentences on the overall portfolio relationship status: deal momentum, lease exposure, and relationship temperature.",
      },
      next_actions: {
        type: "array",
        description: "2-4 specific, prioritized next actions. Each names a person to contact, why, and what property/lease context to cite.",
        items: {
          type: "object",
          required: ["contact_name", "reason", "urgency"],
          properties: {
            contact_id: { type: "string", description: "CRM contact ID, if known." },
            contact_name: { type: "string" },
            reason: {
              type: "string",
              description: "1-2 sentences: who, which property, why this week. Cite specific lease dates, sqft, or sale dates from the data.",
            },
            urgency: { type: "string", enum: ["critical", "high", "medium"] },
          },
        },
      },
    },
  },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function daysUntil(iso: string): number {
  const exp = new Date(iso.includes("T") ? iso : iso + "T12:00:00").getTime();
  return Math.ceil((exp - Date.now()) / 86_400_000);
}

function buildBriefingContext(data: OwnerPortfolioData) {
  const addrById = new Map(data.properties.map((p) => [p.id, p.address]));

  const upcomingLeases = data.leases
    .filter((l) => l.expiration_date)
    .map((l) => ({
      document: l.source_document?.split("/").pop() ?? "Lease",
      property: l.linked_property ? addrById.get(l.linked_property) ?? null : null,
      expiration_date: fmtDate(l.expiration_date!),
      days_until_expiry: daysUntil(l.expiration_date!),
      base_rate: l.base_rate,
      term: l.term,
    }))
    .filter((l) => l.days_until_expiry >= 0 && l.days_until_expiry <= 730)
    .sort((a, b) => a.days_until_expiry - b.days_until_expiry);

  const recentSales = data.properties
    .filter((p) => p.last_sale_date)
    .map((p) => ({
      address: p.address,
      sale_date: fmtDate(p.last_sale_date!),
      sale_price: p.last_sale_price,
      days_ago: daysSince(p.last_sale_date!),
    }))
    .filter((s) => s.days_ago <= 730)
    .sort((a, b) => a.days_ago - b.days_ago);

  const contacts = data.contacts.map((c) => ({
    id: c.id,
    name: c.name,
    company: c.company,
    tier: c.contact_tier,
    last_contacted_at: c.last_contacted_at ? fmtDate(c.last_contacted_at) : null,
    days_since_contact: c.last_contacted_at ? daysSince(c.last_contacted_at) : null,
  }));

  const recentTimeline = data.timeline.slice(0, 12).map((e) => ({
    kind: e.kind,
    date: fmtDate(e.date),
    title: e.title,
    property: e.property_address ?? null,
    contact: e.contact_name ?? null,
  }));

  return {
    owner: {
      name: data.displayName,
      subtitle: data.subtitle,
      total_properties: data.properties.length,
      total_sqft: data.totalSqft,
      total_leases: data.leases.length,
    },
    related_entities: data.relatedEntities.slice(0, 6).map((e) => ({
      name: e.name,
      properties: e.propertyCount,
    })),
    related_persons: data.relatedPersons.slice(0, 8).map((p) => ({
      name: p.name,
      title: p.title,
      properties: p.propertyCount,
    })),
    contacts,
    upcoming_lease_expirations: upcomingLeases.slice(0, 8),
    recent_sales: recentSales.slice(0, 5),
    recent_timeline: recentTimeline,
  };
}

export async function generatePortfolioBriefing(
  data: OwnerPortfolioData,
): Promise<{ briefing?: PortfolioBriefing; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const context = buildBriefingContext(data);

  const anthropic = new Anthropic();
  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: BRIEFING_MODEL,
      max_tokens: 768,
      tools: [PORTFOLIO_BRIEFING_TOOL],
      tool_choice: { type: "tool", name: "write_portfolio_intelligence" },
      messages: [
        {
          role: "user",
          content: `You are briefing a commercial real estate broker who is reviewing an owner's full portfolio.

Write a concise portfolio intelligence brief and a short list of prioritized next actions. Be specific — cite property addresses, lease expirations, sale dates, and contact names from the data. Do not invent facts not in the data.

Tone: direct, like a sharp senior associate summarizing the account before a call. No filler phrases.

If data is sparse, note what's missing and suggest a sensible first move anyway.

Portfolio data:
${JSON.stringify(context, null, 2)}`,
        },
      ],
    });
  } catch (e) {
    return { error: `Intelligence failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const toolBlock = message.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return { error: "Could not generate portfolio intelligence. Try again." };
  }

  const result = toolBlock.input as {
    where_things_stand: string;
    next_actions: Array<{
      contact_id?: string;
      contact_name: string;
      reason: string;
      urgency: "critical" | "high" | "medium";
    }>;
  };

  return {
    briefing: {
      whereThingsStand: result.where_things_stand.trim(),
      nextActions: (result.next_actions ?? []).map((a) => ({
        contactId: a.contact_id ?? null,
        contactName: a.contact_name,
        reason: a.reason.trim(),
        urgency: a.urgency,
      })),
      generatedAt: new Date().toISOString(),
    },
  };
}
