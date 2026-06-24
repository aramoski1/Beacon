"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DueContact = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  role: string | null;
  contact_tier: number | null;
  client_status: string | null;
  last_contacted_at: string | null;
  size_category: string | null;
  geographic_category: string | null;
  ownership_type: string | null;
  linked_properties: string[];
  // computed:
  daysOverdue: number; // positive=overdue, negative=days until due
  resolvedProperties?: Array<{
    id: string;
    address: string | null;
    city: string | null;
    property_type: string | null;
    size_sqft: number | null;
  }>;
};

export type EmailDraft = {
  contactId: string;
  subject: string;
  body: string;
};

// ─── Cadence thresholds ───────────────────────────────────────────────────────

const CADENCE_DAYS: Record<number, number> = { 1: 14, 2: 30, 3: 90 };

function computeDaysOverdue(contact: {
  contact_tier: number | null;
  last_contacted_at: string | null;
}): number {
  const threshold = CADENCE_DAYS[contact.contact_tier ?? 0] ?? 90;
  if (!contact.last_contacted_at) {
    // Never contacted — treat as maximally overdue (use threshold days)
    return threshold;
  }
  const daysSince = Math.floor(
    (Date.now() - new Date(contact.last_contacted_at).getTime()) / 86_400_000
  );
  return daysSince - threshold;
}

// ─── getDueContacts ───────────────────────────────────────────────────────────

export async function getDueContacts(): Promise<DueContact[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: contacts } = await supabase
    .from("contacts")
    .select(
      "id, name, email, company, role, contact_tier, client_status, last_contacted_at, size_category, geographic_category, ownership_type, linked_properties"
    )
    .not("contact_tier", "is", null);

  if (!contacts) return [];

  // Compute daysOverdue and filter to due/overdue (>= -7)
  const dueContacts: DueContact[] = contacts
    .map((c) => ({
      ...c,
      linked_properties: c.linked_properties ?? [],
      daysOverdue: computeDaysOverdue(c),
    }))
    .filter((c) => c.daysOverdue >= -7)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  // Gather all unique property IDs
  const allPropIds = [
    ...new Set(dueContacts.flatMap((c) => c.linked_properties)),
  ];

  if (allPropIds.length > 0) {
    const { data: props } = await supabase
      .from("properties")
      .select("id, address, city, property_type, size_sqft")
      .in("id", allPropIds);

    const propMap = new Map(
      (props ?? []).map((p) => [p.id, p])
    );

    return dueContacts.map((c) => ({
      ...c,
      resolvedProperties: c.linked_properties
        .map((pid) => propMap.get(pid))
        .filter(Boolean) as DueContact["resolvedProperties"],
    }));
  }

  return dueContacts;
}

// ─── generateDrafts ───────────────────────────────────────────────────────────

export async function generateDrafts(
  contactIds: string[],
  brokerContext: string
): Promise<{ drafts?: EmailDraft[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  if (contactIds.length === 0) return { error: "No contacts selected." };
  if (contactIds.length > 10) return { error: "Maximum 10 contacts at once." };

  // Fetch the selected contacts with their resolved properties
  const { data: contacts } = await supabase
    .from("contacts")
    .select(
      "id, name, email, company, role, contact_tier, client_status, last_contacted_at, size_category, geographic_category, ownership_type, linked_properties"
    )
    .in("id", contactIds);

  if (!contacts || contacts.length === 0)
    return { error: "Contacts not found." };

  // Fetch linked properties
  const allPropIds = [
    ...new Set(contacts.flatMap((c) => c.linked_properties ?? [])),
  ];
  let propMap = new Map<string, { address: string | null; city: string | null; property_type: string | null; size_sqft: number | null }>();
  if (allPropIds.length > 0) {
    const { data: props } = await supabase
      .from("properties")
      .select("id, address, city, property_type, size_sqft")
      .in("id", allPropIds);
    propMap = new Map((props ?? []).map((p) => [p.id, p]));
  }

  const contactSummaries = contacts.map((c) => {
    const props = (c.linked_properties ?? [])
      .map((pid: string) => propMap.get(pid))
      .filter(Boolean) as Array<{ address: string | null; city: string | null; property_type: string | null; size_sqft: number | null }>;

    const tierTone =
      c.contact_tier === 1
        ? "warm and direct (Tier 1 — highest priority)"
        : c.contact_tier === 2
        ? "professional (Tier 2 — warm prospect)"
        : "brief check-in (Tier 3 — periodic)";

    const daysSince = c.last_contacted_at
      ? Math.floor(
          (Date.now() - new Date(c.last_contacted_at).getTime()) / 86_400_000
        )
      : null;

    return {
      id: c.id,
      name: c.name ?? "Contact",
      email: c.email,
      company: c.company,
      role: c.role,
      tier_tone: tierTone,
      days_since_contact: daysSince,
      linked_properties: props.map((p) => ({
        address: p.address,
        city: p.city,
        type: p.property_type,
        sqft: p.size_sqft,
      })),
    };
  });

  const GENERATE_TOOL: Anthropic.Tool = {
    name: "generate_outreach_emails",
    description:
      "Generate personalized outreach email drafts for a real estate broker's contacts.",
    input_schema: {
      type: "object" as const,
      required: ["emails"],
      properties: {
        emails: {
          type: "array",
          items: {
            type: "object",
            required: ["contact_id", "subject", "body"],
            properties: {
              contact_id: { type: "string" },
              subject: { type: "string" },
              body: { type: "string" },
            },
          },
        },
      },
    },
  };

  const anthropic = new Anthropic();
  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      tools: [GENERATE_TOOL],
      tool_choice: { type: "tool", name: "generate_outreach_emails" },
      messages: [
        {
          role: "user",
          content: `You are helping a real estate broker write personalized outreach emails.

Broker context: ${brokerContext || "A commercial real estate broker."}

For each contact below, write a 3-5 sentence outreach email:
- Reference specific property details where available
- Match the tone to the tier (indicated in tier_tone)
- Do NOT start with "I hope this email finds you well" or similar filler phrases
- End with a low-friction ask (e.g., "Would you be open to a quick call?" or "Worth connecting?")
- Keep it concise and specific to their situation

Contacts:
${JSON.stringify(contactSummaries, null, 2)}`,
        },
      ],
    });
  } catch (e) {
    return {
      error: `AI generation failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const toolBlock = message.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return { error: "Could not generate drafts. Try again." };
  }

  const result = toolBlock.input as {
    emails: { contact_id: string; subject: string; body: string }[];
  };

  const drafts: EmailDraft[] = result.emails.map((e) => ({
    contactId: e.contact_id,
    subject: e.subject,
    body: e.body,
  }));

  return { drafts };
}

// ─── logOutreach ──────────────────────────────────────────────────────────────

export async function logOutreach(
  contactId: string,
  subject: string,
  body: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // Fetch current contact to get tier and existing outreach_history
  const { data: contact, error: fetchErr } = await supabase
    .from("contacts")
    .select("contact_tier, outreach_history")
    .eq("id", contactId)
    .single();

  if (fetchErr || !contact) return { error: "Contact not found." };

  const newEntry = {
    sent_at: new Date().toISOString(),
    subject,
    body,
    method: "email",
  };

  const history = [...((contact.outreach_history as object[]) ?? []), newEntry];
  const now = new Date().toISOString();
  const cadenceDays = CADENCE_DAYS[contact.contact_tier ?? 0] ?? 90;
  const nextActionDue = new Date(
    Date.now() + cadenceDays * 86_400_000
  ).toISOString();

  const { error: updateErr } = await supabase
    .from("contacts")
    .update({
      outreach_history: history,
      last_contacted_at: now,
      next_action_due: nextActionDue,
      updated_at: now,
    })
    .eq("id", contactId);

  if (updateErr) return { error: updateErr.message };

  // Fire-and-forget: log this send as an activity record
  await logActivity(supabase, user.id, {
    contact_id: contactId,
    activity_type: "email",
    activity_date: now,
    notes: subject,
  });

  return {};
}
