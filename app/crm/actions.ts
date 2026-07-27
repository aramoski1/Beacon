"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import {
  isEntityOwnerName,
  parseStoredOwnerContacts,
  resolvePropertyOwnerContacts,
  type StoredOwnerContact,
} from "@/lib/owner-contacts";
import { linkContactPropertyAndSync } from "@/lib/contact-properties";

// ─── Filter shapes ────────────────────────────────────────────────────────────
// These are the ONLY operations Claude is allowed to express.
// Each field maps 1:1 to a safe JS filter predicate — no raw SQL ever built.

export type PropertySearchFilters = {
  property_type?: string;         // exact enum match
  ownership_type?: string;        // exact enum match
  size_sqft_min?: number;
  size_sqft_max?: number;
  last_sale_price_min?: number;
  last_sale_price_max?: number;
  geographic_keyword?: string;    // case-insensitive substring on address + city + geographic_category
  owner_name_contains?: string;
  size_category_keyword?: string;

  /** individual = ownership_type "private"; entity = ownership_type "institutional" | "REIT". */
  ownership_individual_or_entity?: "individual" | "entity";
  /** Properties with an open ownership-change signal (ownership_change_detected_at is set). */
  has_ownership_change?: boolean;
  /** Bucketed recency of last_sale_date, relative to today. */
  last_sale_recency?: "lt1y" | "1to3y" | "3to5y" | "5plus";
};

export type ContactSearchFilters = {
  contact_tier?: number;          // 1, 2, or 3
  relationship_stage?: string;    // exact enum match — live UI stage: prospect | active | client | past_client | dormant
  ownership_role?: string;        // exact enum match — managing_member | authorized_signer | registered_agent | principal | other
  lead_source?: string;           // exact enum match — sunbiz | referral | cold | costar | existing_relationship | other
  asset_focus_includes?: string;  // array includes on asset_focus tags
  action_tags_includes?: string;  // array includes on action_tags
  not_contacted_in_days?: number; // last_contacted_at < now-N days OR is null
  last_contacted_within_days?: number;
  submarket_keyword?: string;     // substring on submarket
  portfolio_size_keyword?: string; // substring on portfolio_size
  name_contains?: string;
  company_contains?: string;
  contact_type?: string;         // owner | tenant | other

  /**
   * @deprecated Legacy fields kept only so previously-saved smart lists / stored
   * queries (built before the CRE contact fields migration) keep working.
   * New searches should use the live fields above; applyContactFilters()
   * maps these onto the live columns via a compat shim.
   */
  client_status?: string;
  /** @deprecated use submarket_keyword */
  geographic_keyword?: string;
  /** @deprecated use portfolio_size_keyword */
  size_category_keyword?: string;
  /** @deprecated no live equivalent; matches the old free-form ownership_type column */
  ownership_type_keyword?: string;

  /** overdue | due_soon | ok | never — computed from last_contacted_at + the tier's cadence days (lib/cadence.ts). */
  cadence_status?: "overdue" | "due_soon" | "ok" | "never";
};

export type LeaseSearchFilters = {
  status?: "active" | "expiring" | "expired"; // derived from expiration_date vs now
  expiring_within_days?: number;              // expiration_date within N days from today
  base_rate_min?: number;
  base_rate_max?: number;

  /** Bucketed time-to-expiration, reusing the lib/lease-radar.ts day thresholds. */
  expiration_window?: "90d" | "180d" | "12mo" | "beyond12mo";
  /** Joins to the linked property and matches on its property_type. */
  linked_property_type?: string;
  /** Whether tenant_contact_id is set on the lease abstract. */
  has_tenant_contact?: boolean;
};

export type SearchResult = {
  target: "properties" | "contacts" | "leases" | "both";
  properties?: PropertySearchFilters;
  contacts?: ContactSearchFilters;
  leases?: LeaseSearchFilters;
  explanation: string;
};

export type SearchResponse = SearchResult | { error: string };

// ─── Tool definition ──────────────────────────────────────────────────────────

const INTERPRET_TOOL: Anthropic.Tool = {
  name: "interpret_crm_search",
  description: `Interpret a natural-language search query for a real estate broker's CRM.

The CRM has three tables:

PROPERTIES — commercial real estate records:
  property_type: industrial | office | retail | multifamily | land | residential | mixed-use | other
  ownership_type: institutional | private | REIT | owner-occupant | unknown
  size_sqft: building square footage (number)
  last_sale_price: most recent sale price in dollars
  owner_name: text name of the owner
  geographic_category: broker's custom area label (e.g. "Brickell", "Airport West")
  size_category: broker's custom size label (e.g. "Large", ">100k sf")
  address, city: location fields

CONTACTS — people the broker manages:
  contact_tier: 1 (highest priority), 2 (medium), 3 (lower)
  relationship_stage: prospect | active | client | past_client | dormant — the stage brokers actually set in the CRM
  ownership_role: managing_member | authorized_signer | registered_agent | principal | other — the contact's role within the ownership entity
  lead_source: sunbiz | referral | cold | costar | existing_relationship | other
  asset_focus: array of the contact's property-type interests — industrial | office | retail | multifamily | land | mixed_use | other
  action_tags: array of custom string tags
  submarket: broker's neighborhood/submarket label for this contact (e.g. "Doral", "Hialeah")
  portfolio_size: free-text description of the contact's holdings (e.g. "5 buildings · ~200,000 sf")
  last_contacted_at: timestamp of most recent contact (null = never contacted)
  name, company: identity fields

LEASE_ABSTRACTS — abstracted lease documents:
  execution_date: when the lease was signed
  expiration_date: when the lease expires
  term: text description (e.g. "5 years")
  base_rate: annual rent per sqft in dollars
  Derived statuses: active = expiration > 90 days away; expiring = expiration within 90 days; expired = expiration in the past

Rules for interpretation:
- "owners" without qualifier → don't set ownership_type unless the type is clearly stated (e.g. "private owners" → ownership_type: private)
- "haven't contacted in X days" / "not reached in X days" → not_contacted_in_days: X (includes never-contacted)
- "recently contacted" / "contacted in the last X days" → last_contacted_within_days: X
- "near [place]" / "[place] area" (properties) → geographic_keyword: place name
- "in [submarket]" / "[submarket] submarket" (contacts) → submarket_keyword: place name
- "tier 1/2/3" → contact_tier: 1/2/3
- "prospects" → relationship_stage: prospect
- "active clients" / "current clients" → relationship_stage: active
- "clients" (unqualified) → relationship_stage: client
- "past clients" / "former clients" → relationship_stage: past_client
- "dormant" / "cold" / "gone quiet" (about a contact relationship) → relationship_stage: dormant
- "managing members" / "authorized signers" / "registered agents" / "principals" → ownership_role
- "industrial/office/retail/etc. focused contacts" or "contacts interested in [asset type]" → asset_focus_includes: <asset type>
- "large portfolio" / "portfolio of X" → portfolio_size_keyword: X
- "owners" / "property owners" → contact_type: owner (when targeting contacts or both)
- "tenants" → contact_type: tenant
- "over X sqft" → size_sqft_min: X; "under X sqft" → size_sqft_max: X
- "over $X" / "more than $X million" → last_sale_price_min: X (convert M to full dollars)
- "expiring leases" / "leases expiring soon" → target: leases, leases.status: expiring
- "expired leases" → target: leases, leases.status: expired
- "active leases" → target: leases, leases.status: active
- "leases expiring in X days" → target: leases, leases.expiring_within_days: X
- "leases over $X/sqft" → target: leases, leases.base_rate_min: X
- Only set target: "both" when the query meaningfully spans multiple tables
- Set target: "leases" when the query is about lease documents or expiration dates
- Set target: "properties" when primarily about real estate records
- Set target: "contacts" when primarily about people
- Omit any filter that is not clearly implied — prefer fewer, more precise filters`,

  input_schema: {
    type: "object" as const,
    required: ["target", "explanation"],
    properties: {
      target: {
        type: "string",
        enum: ["properties", "contacts", "leases", "both"],
        description: "Which table(s) the search primarily targets.",
      },
      properties: {
        type: "object",
        description: "Filters for the properties table. Omit entirely if target is 'contacts'.",
        properties: {
          property_type: {
            type: "string",
            enum: ["industrial", "office", "retail", "multifamily", "land", "residential", "mixed-use", "other"],
          },
          ownership_type: {
            type: "string",
            enum: ["institutional", "private", "REIT", "owner-occupant", "unknown"],
          },
          size_sqft_min: { type: "number", description: "Minimum building sqft (inclusive)." },
          size_sqft_max: { type: "number", description: "Maximum building sqft (inclusive)." },
          last_sale_price_min: { type: "number", description: "Minimum last sale price in dollars." },
          last_sale_price_max: { type: "number", description: "Maximum last sale price in dollars." },
          geographic_keyword: {
            type: "string",
            description: "Substring matched (case-insensitive) against address, city, and geographic_category.",
          },
          owner_name_contains: { type: "string", description: "Substring matched against owner_name." },
          size_category_keyword: { type: "string", description: "Substring matched against size_category." },
        },
      },
      contacts: {
        type: "object",
        description: "Filters for the contacts table. Omit entirely if target is 'properties' or 'leases'.",
        properties: {
          contact_tier: { type: "number", enum: [1, 2, 3] },
          relationship_stage: {
            type: "string",
            enum: ["prospect", "active", "client", "past_client", "dormant"],
            description: "The relationship stage brokers set in the CRM for this contact.",
          },
          ownership_role: {
            type: "string",
            enum: ["managing_member", "authorized_signer", "registered_agent", "principal", "other"],
            description: "The contact's role within the ownership entity.",
          },
          lead_source: {
            type: "string",
            enum: ["sunbiz", "referral", "cold", "costar", "existing_relationship", "other"],
          },
          asset_focus_includes: {
            type: "string",
            enum: ["industrial", "office", "retail", "multifamily", "land", "mixed_use", "other"],
            description: "Contact must have this property type in their asset_focus tags.",
          },
          action_tags_includes: { type: "string", description: "Contact must have this tag in action_tags." },
          not_contacted_in_days: {
            type: "number",
            description: "Contact's last_contacted_at is null OR older than N days ago.",
          },
          last_contacted_within_days: {
            type: "number",
            description: "Contact's last_contacted_at is within the last N days.",
          },
          submarket_keyword: { type: "string", description: "Substring matched against submarket." },
          portfolio_size_keyword: { type: "string", description: "Substring matched against portfolio_size." },
          name_contains: { type: "string", description: "Substring matched against name." },
          company_contains: { type: "string", description: "Substring matched against company." },
          contact_type: {
            type: "string",
            enum: ["owner", "tenant", "other"],
            description: "Contact role type — use owner for property owner queries.",
          },
        },
      },
      leases: {
        type: "object",
        description: "Filters for the lease_abstracts table. Omit entirely if target is 'properties' or 'contacts'.",
        properties: {
          status: {
            type: "string",
            enum: ["active", "expiring", "expired"],
            description: "active = expiration > 90 days away; expiring = within 90 days; expired = past.",
          },
          expiring_within_days: {
            type: "number",
            description: "Leases whose expiration_date falls within N days from today.",
          },
          base_rate_min: { type: "number", description: "Minimum base rate in $/sqft/year." },
          base_rate_max: { type: "number", description: "Maximum base rate in $/sqft/year." },
        },
      },
      explanation: {
        type: "string",
        description: "One sentence describing the search in broker-friendly terms, e.g. 'Industrial properties over 100k sqft near the airport where the owner hasn't been contacted in 90 days.'",
      },
    },
  },
};

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteProperty(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // Property-only activities (no contact) would violate activities_contact_or_property
  // once property_id is cleared below, so remove them outright first.
  const { error: purgeError } = await supabase
    .from("activities")
    .delete()
    .eq("property_id", id)
    .eq("owner_id", user.id)
    .is("contact_id", null);
  if (purgeError) return { error: purgeError.message };

  // Activities that also have a contact just lose their property link and survive.
  const { error: unlinkError } = await supabase
    .from("activities")
    .update({ property_id: null })
    .eq("property_id", id)
    .eq("owner_id", user.id);
  if (unlinkError) return { error: unlinkError.message };

  // owner_id filter is defense-in-depth; RLS already enforces this at the DB level
  const { error } = await supabase
    .from("properties")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return { error: error.message };
  return {};
}

export async function deleteContact(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // Preserve owner name/address on linked properties before removing the contact row.
  const { data: contact } = await supabase
    .from("contacts")
    .select("name, role, mailing_address, linked_properties")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  if (contact?.name?.trim() && contact.linked_properties?.length) {
    const entry: StoredOwnerContact = {
      name: contact.name.trim(),
      title: contact.role?.trim() || "",
      address: contact.mailing_address?.trim() || null,
    };
    for (const propId of contact.linked_properties as string[]) {
      const { data: prop } = await supabase
        .from("properties")
        .select("owner_contacts")
        .eq("id", propId)
        .eq("owner_id", user.id)
        .single();
      if (!prop) continue;
      const existing = parseStoredOwnerContacts(prop.owner_contacts);
      const dup = existing.some(
        (e) => e.name.toLowerCase() === entry.name.toLowerCase()
      );
      if (!dup) {
        await supabase
          .from("properties")
          .update({ owner_contacts: [...existing, entry] })
          .eq("id", propId)
          .eq("owner_id", user.id);
      }
    }
  }

  const { error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return { error: error.message };
  return {};
}

export async function deleteLease(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  const { error } = await supabase
    .from("lease_abstracts")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return { error: error.message };
  return {};
}

/**
 * Promote ALL property staging owner contacts into CRM contacts linked to the property.
 * Skips staging names that are already linked. Does not invent contacts.
 */
export async function promotePropertyOwnerToCrm(
  propertyId: string,
): Promise<{
  contacts?: Array<{
    id: string;
    name: string | null;
    email: string | null;
    mailing_address: string | null;
  }>;
  created?: number;
  skippedExisting?: number;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select(
      "owner_name, owner_mailing_address, owner_email, owner_contacts, owner_contact_name, owner_contact_address",
    )
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();

  if (propErr || !prop) return { error: propErr?.message ?? "Property not found." };

  const { data: existingLinks, error: linkReadErr } = await supabase
    .from("contact_properties")
    .select("contact_id")
    .eq("owner_id", user.id)
    .eq("property_id", propertyId);

  if (linkReadErr) {
    return { error: `Could not check existing links: ${linkReadErr.message}` };
  }

  const existingIds = (existingLinks ?? []).map((r) => r.contact_id);
  const existingByName = new Map<
    string,
    { id: string; name: string | null; email: string | null; mailing_address: string | null }
  >();

  if (existingIds.length > 0) {
    const { data: existingContacts } = await supabase
      .from("contacts")
      .select("id, name, email, mailing_address")
      .eq("owner_id", user.id)
      .in("id", existingIds);
    for (const c of existingContacts ?? []) {
      const key = (c.name ?? "").trim().toLowerCase();
      if (key) existingByName.set(key, c);
    }
  }

  const staging = resolvePropertyOwnerContacts(
    prop.owner_contacts,
    prop.owner_name,
    prop.owner_mailing_address,
    {
      owner_contact_name: prop.owner_contact_name,
      owner_contact_address: prop.owner_contact_address,
    },
  );

  const people: StoredOwnerContact[] =
    staging.length > 0
      ? staging
      : prop.owner_contact_name?.trim()
        ? [
            {
              name: prop.owner_contact_name.trim(),
              title: "",
              address:
                prop.owner_contact_address?.trim() ||
                prop.owner_mailing_address?.trim() ||
                null,
            },
          ]
        : prop.owner_name?.trim() && !isEntityOwnerName(prop.owner_name)
          ? [
              {
                name: prop.owner_name.trim(),
                title: "",
                address: prop.owner_mailing_address?.trim() || null,
              },
            ]
          : [];

  if (people.length === 0) {
    return {
      error: "No owner contacts on this property to promote. Add an owner contact name first.",
    };
  }

  const propertyEmail = prop.owner_email?.trim() || null;
  const resultContacts: Array<{
    id: string;
    name: string | null;
    email: string | null;
    mailing_address: string | null;
  }> = [];
  let created = 0;
  let skippedExisting = 0;
  const errors: string[] = [];
  let assignedEmail = false;

  for (const person of people) {
    const key = person.name.trim().toLowerCase();
    const already = existingByName.get(key);
    if (already) {
      skippedExisting += 1;
      if (!resultContacts.some((c) => c.id === already.id)) {
        resultContacts.push(already);
      }
      continue;
    }

    // Property-level email attaches to the first newly created contact only
    const email = !assignedEmail && propertyEmail ? propertyEmail : null;
    if (email) assignedEmail = true;

    const mailing_address =
      person.address?.trim() || prop.owner_mailing_address?.trim() || null;
    const titleRole = person.title?.trim() || null;

    const { data, error } = await supabase
      .from("contacts")
      .insert({
        owner_id: user.id,
        name: person.name.trim(),
        email,
        mailing_address,
        title_role: titleRole,
        role: titleRole,
        linked_properties: [propertyId],
        action_tags: ["promoted_from_property", "unverified"],
        outreach_history: [],
        custom_fields: {},
        contact_type: "owner",
        ownership_role: "principal",
      })
      .select("id, name, email, mailing_address")
      .single();

    if (error || !data) {
      errors.push(`${person.name}: ${error?.message ?? "insert failed"}`);
      continue;
    }

    try {
      await linkContactPropertyAndSync(supabase, user.id, data.id, propertyId);
    } catch (e) {
      errors.push(
        `${person.name}: contact created but link failed${
          e instanceof Error ? ` (${e.message})` : ""
        }`,
      );
    }

    created += 1;
    existingByName.set(key, data);
    resultContacts.push(data);
  }

  if (resultContacts.length === 0) {
    return { error: errors[0] ?? "Promote failed — no contacts were created." };
  }

  return {
    contacts: resultContacts,
    created,
    skippedExisting,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}


// ─── Search ───────────────────────────────────────────────────────────────────

// ─── Activity inline edit ─────────────────────────────────────────────────────

export type ActivityUpdate = {
  activity_date?: string | null;
  activity_type?: string | null;
  notes?: string | null;
};

const VALID_ACTIVITY_TYPES = new Set(["letter", "email", "call", "note", "meeting"]);

export async function saveLinkedContactActivity(
  contactId: string,
  updates: ActivityUpdate,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("owner_id", user.id)
    .single();
  if (!contact) return { error: "Contact not found." };

  const { data: existing } = await supabase
    .from("activities")
    .select("id, activity_date, activity_type, notes")
    .eq("contact_id", contactId)
    .eq("owner_id", user.id)
    .order("activity_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const patch: Record<string, unknown> = {};
    if (updates.activity_date != null) patch.activity_date = updates.activity_date;
    if (updates.activity_type != null && VALID_ACTIVITY_TYPES.has(updates.activity_type)) {
      patch.activity_type = updates.activity_type;
    }
    if (updates.notes !== undefined) patch.notes = updates.notes;
    if (Object.keys(patch).length === 0) return {};

    const { error } = await supabase
      .from("activities")
      .update(patch)
      .eq("id", existing.id)
      .eq("owner_id", user.id);
    if (error) return { error: error.message };

    const dateForContact = (updates.activity_date ?? existing.activity_date) as string;
    await supabase
      .from("contacts")
      .update({ last_contacted_at: new Date(dateForContact).toISOString() })
      .eq("id", contactId)
      .eq("owner_id", user.id);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const actType =
      updates.activity_type && VALID_ACTIVITY_TYPES.has(updates.activity_type)
        ? updates.activity_type
        : "note";
    const { error } = await supabase
      .from("activities")
      .insert({
        owner_id: user.id,
        contact_id: contactId,
        activity_date: updates.activity_date ?? today,
        activity_type: actType,
        notes: updates.notes ?? null,
      });
    if (error) return { error: error.message };

    await supabase
      .from("contacts")
      .update({ last_contacted_at: new Date(updates.activity_date ?? today).toISOString() })
      .eq("id", contactId)
      .eq("owner_id", user.id);
  }

  return {};
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function interpretSearch(query: string): Promise<SearchResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  if (!query.trim()) return { error: "Enter a search query." };

  const anthropic = new Anthropic();
  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      tools: [INTERPRET_TOOL],
      tool_choice: { type: "tool", name: "interpret_crm_search" },
      messages: [{ role: "user", content: query }],
    });
  } catch (e) {
    return { error: `AI search failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const toolBlock = message.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return { error: "Could not interpret your search. Try rephrasing." };
  }

  return toolBlock.input as SearchResult;
}
