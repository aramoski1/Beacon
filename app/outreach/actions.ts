"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-logger";
import { getUserSettings } from "@/app/settings/actions";
import { validateOutreach } from "@/lib/validation";
import { hydrateContactLinkedProperties } from "@/lib/contact-properties";
import { cadenceMapFromSettings, suggestedCadenceDays } from "@/lib/cadence";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DueContact = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
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
  /** Cadence interval for this contact's tier (from user_settings). */
  cadenceDays: number;
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

function computeDaysOverdue(
  contact: { contact_tier: number | null; last_contacted_at: string | null },
  cadence: Record<number, number>
): number {
  const threshold = cadence[contact.contact_tier ?? 0] ?? 90;
  if (!contact.last_contacted_at) {
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

  const [{ data: contacts }, settings] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, name, email, phone, company, role, contact_tier, client_status, last_contacted_at, size_category, geographic_category, ownership_type, linked_properties"
      )
      .eq("owner_id", user.id)
      .not("contact_tier", "is", null),
    getUserSettings(),
  ]);

  if (!contacts) return [];

  const hydrated = await hydrateContactLinkedProperties(supabase, user.id, contacts);

  const cadence = cadenceMapFromSettings(settings);

  const dueContacts: DueContact[] = hydrated
    .map((c) => ({
      ...c,
      linked_properties: c.linked_properties,
      daysOverdue: computeDaysOverdue(c, cadence),
      cadenceDays: suggestedCadenceDays(c.contact_tier, cadence),
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
      .eq("owner_id", user.id)
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

/** All contacts for batch outreach (no cadence filter). Cadence still computed for display. */
export async function getAllContactsForOutreach(): Promise<DueContact[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [{ data: contacts }, settings] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, name, email, phone, company, role, contact_tier, client_status, last_contacted_at, size_category, geographic_category, ownership_type, linked_properties"
      )
      .eq("owner_id", user.id)
      .order("name", { ascending: true }),
    getUserSettings(),
  ]);

  if (!contacts?.length) return [];

  const hydrated = await hydrateContactLinkedProperties(supabase, user.id, contacts);

  const cadence = cadenceMapFromSettings(settings);

  const list: DueContact[] = hydrated.map((c) => ({
    ...c,
    linked_properties: c.linked_properties,
    daysOverdue: computeDaysOverdue(c, cadence),
      cadenceDays: suggestedCadenceDays(c.contact_tier, cadence),
  }));

  return attachResolvedProperties(supabase, user.id, list);
}

async function attachResolvedProperties(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
  list: DueContact[]
): Promise<DueContact[]> {
  const allPropIds = [...new Set(list.flatMap((c) => c.linked_properties))];
  if (allPropIds.length === 0) return list;

  const { data: props } = await supabase
    .from("properties")
    .select("id, address, city, property_type, size_sqft")
    .eq("owner_id", ownerId)
    .in("id", allPropIds);

  const propMap = new Map((props ?? []).map((p) => [p.id, p]));

  return list.map((c) => ({
    ...c,
    resolvedProperties: c.linked_properties
      .map((pid) => propMap.get(pid))
      .filter(Boolean) as DueContact["resolvedProperties"],
  }));
}

/** Load specific contacts for smart-list / CRM selection outreach (no cadence filter). */
export async function getContactsByIds(ids: string[]): Promise<DueContact[]> {
  if (ids.length === 0) return [];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [{ data: contacts }, settings] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, name, email, phone, company, role, contact_tier, client_status, last_contacted_at, size_category, geographic_category, ownership_type, linked_properties",
      )
      .eq("owner_id", user.id)
      .in("id", ids),
    getUserSettings(),
  ]);

  if (!contacts?.length) return [];

  const hydrated = await hydrateContactLinkedProperties(supabase, user.id, contacts);

  const cadence = cadenceMapFromSettings(settings);

  const dueContacts: DueContact[] = hydrated.map((c) => ({
    ...c,
    linked_properties: c.linked_properties,
    daysOverdue: computeDaysOverdue(c, cadence),
      cadenceDays: suggestedCadenceDays(c.contact_tier, cadence),
  }));

  return attachResolvedProperties(supabase, user.id, dueContacts);
}

// ─── Template types ───────────────────────────────────────────────────────────

export type OutreachTemplate = "intro" | "check-in" | "market-update" | "listing-alert";

// ─── generateDrafts ───────────────────────────────────────────────────────────

export async function generateDrafts(
  contactIds: string[],
  brokerContext: string,
  template: OutreachTemplate = "check-in"
): Promise<{ drafts?: EmailDraft[]; error?: string; senderNameMissing?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  if (contactIds.length === 0) return { error: "No contacts selected." };
  if (contactIds.length > 25) return { error: "Maximum 25 contacts at once." };

  // Fetch contacts + broker settings in parallel
  const [{ data: contacts }, settings] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, name, email, phone, company, role, contact_tier, client_status, last_contacted_at, size_category, geographic_category, ownership_type, linked_properties"
      )
      .eq("owner_id", user.id)
      .in("id", contactIds),
    getUserSettings(),
  ]);

  if (!contacts || contacts.length === 0) return { error: "Contacts not found." };

  const hydratedContacts = await hydrateContactLinkedProperties(supabase, user.id, contacts);

  // Build broker signature from profile settings
  const senderName = settings.sender_name || settings.display_name;
  const senderNameMissing = !senderName;
  const signatureLines = [senderName, settings.company, settings.phone].filter(Boolean);
  const brokerSignature = signatureLines.length > 0 ? signatureLines.join("\n") : null;

  // Fetch linked properties + lease abstracts in parallel
  const allPropIds = [...new Set(hydratedContacts.flatMap((c) => c.linked_properties))];
  type PropRecord = {
    address: string | null; city: string | null; property_type: string | null;
    size_sqft: number | null; last_sale_date: string | null; asset_description: string | null;
    ownership_change_detected_at: string | null; ownership_change_data: unknown;
  };
  let propMap = new Map<string, PropRecord>();
  let leaseMap = new Map<string, Array<{ expiration_date: string | null; base_rate: number | null }>>();
  if (allPropIds.length > 0) {
    const [{ data: props }, { data: abstracts }] = await Promise.all([
      supabase
        .from("properties")
        .select("id, address, city, property_type, size_sqft, last_sale_date, asset_description, ownership_change_detected_at, ownership_change_data")
        .eq("owner_id", user.id)
        .in("id", allPropIds),
      supabase
        .from("lease_abstracts")
        .select("linked_property, expiration_date, base_rate")
        .eq("owner_id", user.id)
        .in("linked_property", allPropIds)
        .not("expiration_date", "is", null)
        .order("expiration_date", { ascending: true }),
    ]);
    propMap = new Map((props ?? []).map((p) => [p.id, p]));
    for (const a of abstracts ?? []) {
      if (!a.linked_property) continue;
      const bucket = leaseMap.get(a.linked_property) ?? [];
      bucket.push({ expiration_date: a.expiration_date, base_rate: a.base_rate });
      leaseMap.set(a.linked_property, bucket);
    }
  }

  // Fetch recent activities per contact (up to 4 each)
  const { data: activityRows } = await supabase
    .from("activities")
    .select("contact_id, activity_type, activity_date, notes")
    .in("contact_id", contactIds)
    .eq("owner_id", user.id)
    .order("activity_date", { ascending: false })
    .limit(60);

  const activityMap = new Map<string, Array<{ activity_type: string; activity_date: string; notes: string | null }>>();
  for (const a of (activityRows ?? [])) {
    const existing = activityMap.get(a.contact_id) ?? [];
    if (existing.length < 4) {
      existing.push({ activity_type: a.activity_type, activity_date: a.activity_date, notes: a.notes });
      activityMap.set(a.contact_id, existing);
    }
  }

  const TEMPLATE_INSTRUCTIONS: Record<OutreachTemplate, string> = {
    "intro":
      "This is a FIRST CONTACT — introduce yourself briefly, mention your specialty relevant to their property or portfolio, end with a low-friction ask. Do NOT imply you already know them.",
    "check-in":
      "Write a warm check-in. Reference any recent activity notes or specific property details naturally. Ask if anything has changed on their end.",
    "market-update":
      "Share a brief, concrete market insight tied to their property type, asset description, size, or location. Invite a conversation about how it affects their portfolio.",
    "listing-alert":
      "Flag a relevant opportunity or market movement tied to their ownership type or portfolio. Frame it as something they should know about and invite them to discuss.",
  };

  function relativeMonths(dateStr: string | null): string | null {
    if (!dateStr) return null;
    const months = Math.round((Date.now() - new Date(dateStr).getTime()) / (30 * 86_400_000));
    if (months <= 0) return "less than a month ago";
    if (months === 1) return "1 month ago";
    return `${months} months ago`;
  }

  function monthsUntil(dateStr: string | null): string | null {
    if (!dateStr) return null;
    const ms = new Date(dateStr).getTime() - Date.now();
    if (ms < 0) return null;
    const months = Math.round(ms / (30 * 86_400_000));
    if (months <= 0) return "this month";
    if (months === 1) return "in 1 month";
    return `in ${months} months`;
  }

  const contactSummaries = hydratedContacts.map((c) => {
    const activities = activityMap.get(c.id) ?? [];

    const tierTone =
      c.contact_tier === 1
        ? "warm and direct (Tier 1 — highest priority relationship)"
        : c.contact_tier === 2
        ? "professional and engaged (Tier 2 — warm prospect)"
        : "brief and light (Tier 3 — periodic outreach)";

    const daysSince = c.last_contacted_at
      ? Math.floor((Date.now() - new Date(c.last_contacted_at).getTime()) / 86_400_000)
      : null;

    const linkedProperties = c.linked_properties.flatMap((pid: string) => {
      const p = propMap.get(pid);
      if (!p) return [];
      const leases = (leaseMap.get(pid) ?? [])
        .map((l) => ({
          expires: monthsUntil(l.expiration_date),
          rate_per_sf: l.base_rate ? `$${l.base_rate}/sf` : null,
        }))
        .filter((l) => l.expires !== null);
      return [{
        address: p.address,
        city: p.city,
        type: p.property_type,
        sqft: p.size_sqft,
        sold: relativeMonths(p.last_sale_date),
        asset_description: p.asset_description,
        ownership_change: p.ownership_change_detected_at
          ? { detected: relativeMonths(p.ownership_change_detected_at) }
          : null,
        leases,
      }];
    });

    return {
      id: c.id,
      name: c.name ?? "Contact",
      email: c.email,
      company: c.company,
      role: c.role,
      client_status: c.client_status,
      tier_tone: tierTone,
      days_since_contact: daysSince,
      linked_properties: linkedProperties,
      recent_activities: activities.map((a) => ({
        type: a.activity_type,
        date: new Date(a.activity_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        notes: a.notes,
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

  // Claude processes at most 10 contacts per call — chunk and merge for larger batches.
  const CLAUDE_CHUNK = 10;
  const allDrafts: EmailDraft[] = [];

  for (let i = 0; i < contactSummaries.length; i += CLAUDE_CHUNK) {
    const chunk = contactSummaries.slice(i, i + CLAUDE_CHUNK);
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
            content: `You are a real estate broker's writing assistant. Generate concise, personalized outreach emails.

BROKER SIGNATURE (use this verbatim at the end of every email body):
${brokerSignature ?? "[Your Name]"}
${brokerContext ? `\nBROKER CONTEXT: ${brokerContext}` : ""}

TEMPLATE: ${template.replace(/-/g, " ")}
INSTRUCTION: ${TEMPLATE_INSTRUCTIONS[template]}

RULES — every rule is mandatory:
1. 3–5 sentences. No filler openers, no padding.
2. Never open with "I hope this email finds you well" or any generic phrase.
3. REQUIRED: Every email must include at least one specific real fact from the contact data — a property address, lease expiration timing, ownership change event, exact days since last contact, or activity note. This is what makes it personal.
4. Match tone exactly to tier_tone.
5. If recent_activities exist, reference the most recent one naturally (e.g., "Following up on our March call…").
6. End with one short, low-friction ask (e.g., "Worth a quick call?" or "Happy to share more details.").
7. SIGNATURE: End every email body with a blank line, then the BROKER SIGNATURE exactly as provided above. Never write "[Broker Name]" — use the text given.

FACT PRIORITY — use the highest-priority fact available for each contact:
- linked_properties[].leases[].expires → strongest hook: e.g. "your lease at 123 Main expires in 8 months"
- linked_properties[].ownership_change.detected → timely hook: e.g. "following the ownership change at [address] 3 months ago"
- linked_properties[].sold → market hook: e.g. "you picked up [address] about 14 months ago"
- days_since_contact → relationship hook: e.g. "it's been 45 days since we last connected"
- recent_activities → warmest personal hook: reference the activity type and date

CONTACT DATA:
${JSON.stringify(chunk, null, 2)}`,
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

    const chunkResult = toolBlock.input as {
      emails: { contact_id: string; subject: string; body: string }[];
    };
    for (const e of chunkResult.emails) {
      allDrafts.push({ contactId: e.contact_id, subject: e.subject, body: e.body });
    }
  }

  return { drafts: allDrafts, senderNameMissing };
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

  // Validate inputs before any database access
  const validationErrors = validateOutreach(subject, body);
  if (validationErrors.length > 0) {
    return { error: validationErrors[0].message };
  }

  // Fetch current contact — scoped to this user to prevent cross-user mutation
  const [{ data: contact, error: fetchErr }, settings] = await Promise.all([
    supabase
      .from("contacts")
      .select("contact_tier, outreach_history")
      .eq("id", contactId)
      .eq("owner_id", user.id)
      .single(),
    getUserSettings(),
  ]);

  if (fetchErr || !contact) return { error: "Contact not found." };

  const newEntry = {
    sent_at: new Date().toISOString(),
    subject,
    body,
    method: "email",
  };

  const cadence = cadenceMapFromSettings(settings);

  const history = [...((contact.outreach_history as object[]) ?? []), newEntry];
  const now = new Date().toISOString();
  const cadenceDays = suggestedCadenceDays(contact.contact_tier, cadence);
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
    .eq("id", contactId)
    .eq("owner_id", user.id);

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
