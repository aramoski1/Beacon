"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_CADENCE_TIER_DAYS } from "@/lib/cadence";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CopilotMessage = {
  role: "user" | "assistant";
  content: string;
};

// ─── Tools ───────────────────────────────────────────────────────────────────

const COPILOT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_properties",
    description:
      "Search the broker's tracked properties by location, type, size, owner name, etc. Call this for any question about properties in the book.",
    input_schema: {
      type: "object",
      properties: {
        city:           { type: "string",  description: "Filter by city (partial match)" },
        property_type:  { type: "string",  description: "Filter by type (e.g. Industrial, Office, Retail, Multifamily)" },
        ownership_type: { type: "string",  description: "Filter by ownership structure" },
        owner_name:     { type: "string",  description: "Filter by listed owner name (partial match)" },
        min_sqft:       { type: "number",  description: "Minimum building size in sq ft" },
        max_sqft:       { type: "number",  description: "Maximum building size in sq ft" },
        limit:          { type: "number",  description: "Max results to return (default 25, max 50)" },
      },
    },
  },
  {
    name: "search_contacts",
    description:
      "Search the broker's contacts by name, company, tier, or days since last contact. Use this for relationship, outreach, or cadence questions.",
    input_schema: {
      type: "object",
      properties: {
        name:                    { type: "string",  description: "Filter by contact name (partial match)" },
        company:                 { type: "string",  description: "Filter by company (partial match)" },
        contact_tier:            { type: "number",  description: "Filter by tier: 1=highest priority, 2=warm, 3=periodic" },
        client_status:           { type: "string",  description: "Filter by status (e.g. active, prospect, past)" },
        min_days_since_contact:  { type: "number",  description: "Only include contacts not touched in at least this many days" },
        limit:                   { type: "number",  description: "Max results (default 25)" },
      },
    },
  },
  {
    name: "search_leases",
    description:
      "Search lease abstracts in the book. Use this for expiry timelines, rollover risk, or lease rate questions.",
    input_schema: {
      type: "object",
      properties: {
        days_until_expiry: { type: "number", description: "Only return leases expiring within this many days (e.g. 365)" },
        limit:             { type: "number", description: "Max results (default 25)" },
      },
    },
  },
  {
    name: "search_deals",
    description:
      "Search the broker's pursuit pipeline. Use this for deal stage, commission, or active pursuit questions.",
    input_schema: {
      type: "object",
      properties: {
        stage: { type: "string", description: "Filter by stage: prospect, contacted, meeting, requirement, proposal, under_contract, won, closed, lost" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  {
    name: "search_follow_ups",
    description:
      "Search pending follow-up tasks. Use this when asked what's overdue, coming up, or what the broker needs to do.",
    input_schema: {
      type: "object",
      properties: {
        overdue_only:   { type: "boolean", description: "If true, return only past-due incomplete tasks" },
        upcoming_days:  { type: "number",  description: "Return tasks due within this many days" },
      },
    },
  },
  {
    name: "get_dashboard_metrics",
    description:
      "Get a real-time portfolio snapshot: property count, contacts, overdue outreach, expiring leases, pending follow-ups. Use this for 'what should I focus on today?' or overview questions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_recent_activities",
    description:
      "Get the most recently logged CRM activities (calls, emails, meetings, notes).",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (default 15)" },
      },
    },
  },
];

// ─── Tool runner ──────────────────────────────────────────────────────────────

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function runTool(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const limit = (typeof input.limit === "number" ? Math.min(input.limit, 50) : 25);

  switch (name) {
    case "search_properties": {
      let q = supabase
        .from("properties")
        .select("id, address, city, property_type, size_sqft, owner_name, ownership_type, last_sale_date, asset_description")
        .eq("owner_id", userId);
      if (input.city)           q = q.ilike("city",           `%${input.city}%`);
      if (input.property_type)  q = q.ilike("property_type",  `%${input.property_type}%`);
      if (input.ownership_type) q = q.ilike("ownership_type", `%${input.ownership_type}%`);
      if (input.owner_name)     q = q.ilike("owner_name",     `%${input.owner_name}%`);
      if (input.min_sqft)       q = q.gte("size_sqft", input.min_sqft);
      if (input.max_sqft)       q = q.lte("size_sqft", input.max_sqft);
      q = q.order("size_sqft", { ascending: false, nullsFirst: false }).limit(limit);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return { count: data?.length ?? 0, properties: data ?? [] };
    }

    case "search_contacts": {
      let q = supabase
        .from("contacts")
        .select("id, name, email, company, role, contact_tier, client_status, last_contacted_at, geographic_category, size_category")
        .eq("owner_id", userId);
      if (input.name)         q = q.ilike("name",    `%${input.name}%`);
      if (input.company)      q = q.ilike("company", `%${input.company}%`);
      if (input.contact_tier) q = q.eq("contact_tier", input.contact_tier);
      if (input.client_status) q = q.eq("client_status", input.client_status);
      const { data, error } = await q.limit(limit);
      if (error) return { error: error.message };
      let contacts = data ?? [];
      if (typeof input.min_days_since_contact === "number") {
        contacts = contacts.filter((c) => {
          if (!c.last_contacted_at) return true;
          const days = Math.floor((Date.now() - new Date(c.last_contacted_at).getTime()) / 86_400_000);
          return days >= (input.min_days_since_contact as number);
        });
      }
      const enriched = contacts.map((c) => ({
        ...c,
        days_since_contact: c.last_contacted_at
          ? Math.floor((Date.now() - new Date(c.last_contacted_at).getTime()) / 86_400_000)
          : null,
      }));
      return { count: enriched.length, contacts: enriched };
    }

    case "search_leases": {
      const today = new Date().toISOString().slice(0, 10);
      let q = supabase
        .from("lease_abstracts")
        .select("id, linked_property, expiration_date, execution_date, base_rate, term, source_document")
        .eq("owner_id", userId)
        .not("expiration_date", "is", null)
        .gte("expiration_date", today)
        .order("expiration_date", { ascending: true });
      if (typeof input.days_until_expiry === "number") {
        const cutoff = new Date(Date.now() + (input.days_until_expiry as number) * 86_400_000)
          .toISOString().slice(0, 10);
        q = q.lte("expiration_date", cutoff);
      }
      const { data: leases, error } = await q.limit(limit);
      if (error) return { error: error.message };

      const propIds = [...new Set((leases ?? []).map((l) => l.linked_property).filter(Boolean))];
      let propMap = new Map<string, string>();
      if (propIds.length > 0) {
        const { data: props } = await supabase
          .from("properties")
          .select("id, address, city")
          .in("id", propIds);
        propMap = new Map((props ?? []).map((p) => [p.id, [p.address, p.city].filter(Boolean).join(", ")]));
      }

      const enriched = (leases ?? []).map((l) => ({
        ...l,
        property_address: l.linked_property ? propMap.get(l.linked_property) ?? null : null,
        days_until_expiry: l.expiration_date
          ? Math.ceil((new Date(l.expiration_date).getTime() - Date.now()) / 86_400_000)
          : null,
      }));
      return { count: enriched.length, leases: enriched };
    }

    case "search_deals": {
      let q = supabase
        .from("deals")
        .select("id, name, stage, estimated_commission, notes, next_action, next_action_due, created_at")
        .eq("owner_id", userId);
      if (input.stage) q = q.eq("stage", input.stage);
      const { data, error } = await q.order("updated_at", { ascending: false }).limit(limit);
      if (error) return { error: error.message };
      return { count: data?.length ?? 0, deals: data ?? [] };
    }

    case "search_follow_ups": {
      const today = new Date().toISOString().slice(0, 10);
      let q = supabase
        .from("follow_ups")
        .select("id, description, due_date, done, contact_id, property_id, created_at")
        .eq("owner_id", userId);
      if (input.overdue_only) {
        q = q.lte("due_date", today).eq("done", false);
      } else if (typeof input.upcoming_days === "number") {
        const cutoff = new Date(Date.now() + (input.upcoming_days as number) * 86_400_000)
          .toISOString().slice(0, 10);
        q = q.gte("due_date", today).lte("due_date", cutoff).eq("done", false);
      } else {
        q = q.eq("done", false);
      }
      const { data, error } = await q.order("due_date", { ascending: true }).limit(25);
      if (error) return { error: error.message };
      return { count: data?.length ?? 0, follow_ups: data ?? [] };
    }

    case "get_dashboard_metrics": {
      const today = new Date().toISOString().slice(0, 10);
      const ninetyDays = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
      const [
        { count: propCount },
        { count: contactCount },
        { count: leaseCount },
        { count: followUpsDue },
        { count: urgentLeases },
        { count: activeDeals },
        { data: contactsRaw },
        { data: settingsRaw },
      ] = await Promise.all([
        supabase.from("properties").select("*", { count: "exact", head: true }).eq("owner_id", userId),
        supabase.from("contacts").select("*", { count: "exact", head: true }).eq("owner_id", userId),
        supabase.from("lease_abstracts").select("*", { count: "exact", head: true }).eq("owner_id", userId),
        supabase.from("follow_ups").select("*", { count: "exact", head: true }).eq("owner_id", userId).eq("done", false).lte("due_date", today),
        supabase.from("lease_abstracts").select("*", { count: "exact", head: true }).eq("owner_id", userId).not("expiration_date", "is", null).gte("expiration_date", today).lte("expiration_date", ninetyDays),
        supabase.from("deals").select("*", { count: "exact", head: true }).eq("owner_id", userId).not("stage", "in", '("won","closed","lost")'),
        supabase.from("contacts").select("contact_tier, last_contacted_at").eq("owner_id", userId).not("contact_tier", "is", null),
        supabase.from("user_settings").select("cadence_tier1_days, cadence_tier2_days, cadence_tier3_days").eq("owner_id", userId).maybeSingle(),
      ]);
      const cadence: Record<number, number> = {
        1: settingsRaw?.cadence_tier1_days ?? DEFAULT_CADENCE_TIER_DAYS[1],
        2: settingsRaw?.cadence_tier2_days ?? DEFAULT_CADENCE_TIER_DAYS[2],
        3: settingsRaw?.cadence_tier3_days ?? DEFAULT_CADENCE_TIER_DAYS[3],
      };
      const overdueOutreach = (contactsRaw ?? []).filter((c) => {
        const threshold = cadence[c.contact_tier as 1 | 2 | 3] ?? 90;
        if (!c.last_contacted_at) return true;
        return Math.floor((Date.now() - new Date(c.last_contacted_at).getTime()) / 86_400_000) >= threshold;
      }).length;
      return {
        properties: propCount ?? 0,
        contacts: contactCount ?? 0,
        leases: leaseCount ?? 0,
        active_deals: activeDeals ?? 0,
        follow_ups_due_today: followUpsDue ?? 0,
        leases_expiring_90_days: urgentLeases ?? 0,
        overdue_outreach_contacts: overdueOutreach,
        today: today,
      };
    }

    case "get_recent_activities": {
      const { data, error } = await supabase
        .from("activities")
        .select("id, activity_type, activity_date, notes, contact_id, property_id")
        .eq("owner_id", userId)
        .order("activity_date", { ascending: false })
        .limit(limit);
      if (error) return { error: error.message };
      return { count: data?.length ?? 0, activities: data ?? [] };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── askCopilot ───────────────────────────────────────────────────────────────

export async function askCopilot(
  history: CopilotMessage[]
): Promise<{ reply?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  if (history.length === 0) return { error: "No message provided." };

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  const systemPrompt = `You are Beacon Copilot, the AI assistant built into Beacon — a CRM platform for commercial real estate brokers.

You have access to this broker's complete book of business through the tools below. Always call the appropriate tool before answering any data question — never guess at numbers or names.

## What you can help with
- Finding and analyzing properties, contacts, leases, deals, and activities in the book
- Surfacing insights ("what should I focus on today?", "who haven't I called in 90 days?")
- Answering product/navigation questions about Beacon
- Recommending next steps based on data patterns

## Beacon platform knowledge

Everything below is the complete, exhaustive list of what Beacon has. If something a user asks about isn't listed here, Beacon does not have it — see the fabrication rule at the end of this section.

### Features & navigation
- **Dashboard** (/dashboard) — Daily briefing: "Do these today" queue (cadence, follow-ups, deals, ownership flips, urgent leases, option-notice dates, 1031 deadlines), ready-to-pursue properties, cadence health, Ask Beacon Copilot. A **Customize** button (top right, above the KPI strip) lets you show/hide dashboard sections — KPIs, signals, primary, and secondary blocks — with Save and Reset to default. Show/hide only, no reordering or drag-and-drop; section order is fixed. The hero and Ask Beacon always show and can't be hidden.
- **Workspace / CRM** (/crm) — Properties, Leases, and Contacts tabs (in that order); AI-powered natural-language search bar; inline editing; each tab has "Manage fields" (broker custom columns for that entity type — not industrial specs) and export buttons (see Exporting data below). Industrial / flex specs live on the property detail card. On Contacts, All / Owners / Tenants toggles the book; tenant rows show occupancy (property, leased SF, lease expiry, landlord).
- **Outreach** (/outreach) — Select overdue contacts, generate AI email drafts (each becomes a separate email — Beacon never sends a group email), open the draft in your own mail client, then click "Mark as sent" to log it. Drafts merge {name}, {address}, {sf}, {landlord}, and {expiry} from the contact’s property and lease.
- **Lease Radar** (/lease-radar) — Expiry tracker for leases within 3/6/12 months; option-notice countdown when the abstract has a notice period
- **This week** (/week) — Main nav. Pin a Contacts smart list and work N people this week (log call with outcome, email, or **Generate drafts** for the whole list). Falls back to cadence-due contacts in the next 7 days if nothing is pinned.
- **Deals** (/deals) — Pursuit pipeline (kanban or list view). Stage order: prospect → contacted → meeting → requirement → proposal → won → under_contract → closed / lost. The exact stage set shown depends on the deal's type (tenant rep, listing, or investment sale)
- **All tasks** (/follow-ups) — Follow-up task list with due dates; found under "Advanced" in the sidebar, not the main nav row
- **Tours** (/tours) — Schedule property tours with attendees and prep notes (Advanced in the sidebar). Calendar sync stays off until Settings → Connections has OAuth keys.
- **Book map** (/book-map) — Corridor buckets plus a pin map of geocoded properties. **Geocode missing pins** stores lat/lng via OpenStreetMap Nominatim (no Mapbox key).
- **Prospect** (/prospect) — Find off-book industrial / flex owners from county tax rolls
- **Settings** (/settings) — sections: Account (name/email/password; Delete account — type DELETE — permanently removes all data and the login), Brokerage (company info), Data & Sources (connected ingestion sources; CoStar upload toggle), Outreach (sender name, cadence days per tier), Connections (Gmail/Outlook send, Google/Outlook calendar, DocuSign — stubs that return 501 until OAuth env vars are set on Vercel; token exchange is not wired yet), Data Management (data exports — see below), Appearance (light/dark theme), Danger Zone (Delete all data — type DELETE — wipes CRM data but keeps login credentials; to remove login too use Account → Delete account). Settings header also links to **How Beacon works** (/how-beacon-works)
- **How Beacon works** (/how-beacon-works) — product overview plus **page-by-page guides for every screen**: table of contents by category, step-by-step walkthrough and feature list per route (Dashboard, Workspace, Deals, Prospect, Lease radar, Outreach, All tasks, This week, Book map, audit/errors, add flows, detail pages, owner portfolio, settings/team, admin, join, access-revoked). Also covers the three loops, day-1 path, redirect notes (/abstracts, /contacts, etc.), and honest limits. Linked from Settings and onboarding (Welcome / Done). Not in the main nav. When opened from onboarding, shows a Back to setup link. **Every page also has a floating ? button (bottom-right)** that opens the same guide for the current screen without leaving the page.

### Exporting data (this is a real, fully-built feature — always point here; never invent a support/API/integrations path for this)
- **From Workspace** (/crm): each tab (Properties, Leases, Contacts) has an "Export all" button that downloads the full list as an XLSX file — beacon-properties.xlsx, beacon-leases.xlsx, beacon-contacts.xlsx. Each tab also has "Export this page" and "Export selected" (select rows with the checkboxes first).
- **From Settings**: Settings → Data Management has direct download links for Properties, Contacts, and Leases, each as XLSX.
- Exports are XLSX only — there is no CSV export, no scheduled/automatic export, and no export beyond these three entity types.

### How to do common things
- **Import a spreadsheet**: /onboarding
- **Learn how Beacon works**: /how-beacon-works (also linked from Settings and onboarding)
- **Abstract a lease**: /abstracts/new — upload a PDF, AI extracts key fields automatically
- **Add a property**: /properties/new (address lookup, listing URL, or file upload), or "+ New" in the sidebar
- **Add a contact**: /contacts/new, or "+ New" in the sidebar — Book (owner / tenant / other) is required
- **This week's list**: This week in the main nav — pin a Contacts smart list, then Generate drafts
- **Owner vs tenant book**: Workspace → Contacts → All / Owners / Tenants
- **Export data**: see "Exporting data" above
- **Start outreach**: /outreach → pick contacts → Generate drafts → Open in email → Mark as sent
- **Set outreach cadence**: Settings → Outreach → Cadence (days between outreach), per tier
- **Set sender name**: Settings → Outreach → Sender name
- **Add a custom field**: In Workspace (/crm), click "Manage fields" on the tab for that entity type (property, lease, or contact). That does not control industrial specs.
- **Customize industrial specs**: open a property → Industrial / flex specs → **Customize** (add, rename, or delete defaults). Listing/document extract fills a spec only when the source states it.
- **Log an activity**: Open any contact or property page → Timeline section → Log activity
- **Customize the dashboard**: Dashboard → Customize (top right) → check/uncheck sections → Save (or Reset to default to restore everything)
- **Schedule a tour**: /tours → date/time, optional property/contact, Save tour
- **Download a draft LOI**: open a deal → **Download LOI** (Word file from deal + property fields; not legal advice)
- **Industrial specs / rent notebook**: open a property → Industrial / flex specs and Rent notebook (seed South Florida bands, not live CoStar)
- **Buyer / 1031 criteria**: open a contact → Buyer / 1031 criteria. Deadlines within 90 days also appear on the Dashboard Today desk.
- **Delete all your data (keep login)**: Settings → Danger Zone → type DELETE to confirm
- **Delete your account (data + login)**: Settings → Account → Delete account → type DELETE to confirm

### Contact tiers
- Tier 1: Highest-priority relationships. Default cadence 14 days.
- Tier 2: Warm prospects. Default cadence 30 days.
- Tier 3: Periodic outreach. Default cadence 90 days.

### What Beacon does NOT have — do not reference these under any name
- No support team, help desk, live chat, or "contact support" channel of any kind
- No feedback form or feedback page
- No live Gmail/Outlook send, calendar sync, or DocuSign from Beacon yet — Settings → Connections shows status and required env vars; OAuth callbacks return 501 until keys are added and token exchange is wired
- No public/external API beyond the export routes listed above
- No email sending from Beacon itself — Outreach only drafts and opens your own mail client; you send it
- No CSV export
- No live CoStar rent comps (rent notebook uses static tri-county seed bands plus broker-entered comps)
- No Mapbox — pin map uses OSM/Leaflet

## Fabrication — hard rule, not a preference
You may ONLY reference features, pages, menu paths, settings, buttons, and processes that are explicitly listed in the "Beacon platform knowledge" section above. This applies even when a plausible-sounding answer would be more satisfying.
- NEVER invent a menu path, settings tab, button, support channel, integration, or API that isn't listed above.
- NEVER paper over a gap by suggesting a workaround you made up (e.g. "contact support," "check Settings → X," "use the API") unless that exact thing is listed above.
- If Beacon genuinely doesn't have something, say so plainly: "Beacon doesn't have that" or "I'm not sure how to do that in Beacon." A flat, honest "no" is always the correct answer over a fabricated "yes."
- If you're not certain whether something exists, say you're not sure rather than guessing.

## Response style
- Be concise and direct. Skip preamble ("Great question!").
- Use **bold** for names, addresses, and key terms.
- Use bullet lists for multiple items; tables only when comparing values.
- When tools return data, highlight the most important items first.
- For navigation questions, give the exact path (e.g. "Go to **Settings → Outreach**") using only paths listed above.

Today is ${today}.`;

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const anthropic = new Anthropic();
  const MAX_ITERATIONS = 6;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: systemPrompt,
        tools: COPILOT_TOOLS,
        messages,
      });
    } catch (e) {
      return { error: `AI error: ${e instanceof Error ? e.message : String(e)}` };
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return {
        reply: text || "I couldn't find a clear answer. Try asking something more specific about your book or Beacon.",
      };
    }

    // Execute all tool calls in parallel
    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (tu) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: JSON.stringify(await runTool(supabase, user.id, tu.name, tu.input as Record<string, unknown>)),
      }))
    );

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user",      content: toolResults });
  }

  return { reply: "I wasn't able to complete that analysis. Try a more focused question." };
}
