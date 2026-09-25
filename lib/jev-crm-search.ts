// Jev-first CRM search interpret. Same SearchResult shape as Haiku tool_choice.
// Deterministic hints cover numbers/places/enums; Jev picks the table and enums;
// Haiku remains the caller fallback when this returns null.

import type {
  ContactSearchFilters,
  LeaseSearchFilters,
  PropertySearchFilters,
  SearchResult,
} from "@/app/crm/actions";
import { jevChoice, jevDecide, jevEnabled, jevIsYes, jevNoul, type JevQuestion } from "@/lib/jev";

const PROPERTY_TYPES = [
  "industrial",
  "office",
  "retail",
  "multifamily",
  "land",
  "residential",
  "mixed-use",
  "other",
] as const;

const OWNERSHIP_TYPES = ["institutional", "private", "REIT", "owner-occupant", "unknown"] as const;
const STAGES = ["prospect", "active", "client", "past_client", "dormant"] as const;
const ROLES = ["managing_member", "authorized_signer", "registered_agent", "principal", "other"] as const;
const LEAD_SOURCES = ["sunbiz", "referral", "cold", "costar", "existing_relationship", "other"] as const;
const ASSET_FOCUS = ["industrial", "office", "retail", "multifamily", "land", "mixed_use", "other"] as const;

function parseNumberToken(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(/,/g, "").replace(/^\$/, "");
  const m = t.match(/^(\d+(?:\.\d+)?)(k|m)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suf = (m[2] ?? "").toLowerCase();
  if (suf === "k") return Math.round(n * 1_000);
  if (suf === "m") return Math.round(n * 1_000_000);
  return n;
}

function parseSqftBounds(q: string): { min?: number; max?: number } {
  const over = q.match(/\b(?:over|above|greater than|more than|at least|>=)\s*\$?([\d.,]+)\s*(k|m)?\s*(?:sf|sq\.?\s*ft|sqft)?/i);
  const under = q.match(/\b(?:under|below|less than|up to|<=)\s*\$?([\d.,]+)\s*(k|m)?\s*(?:sf|sq\.?\s*ft|sqft)?/i);
  const range = q.match(/([\d.,]+)\s*(k|m)?\s*[-–to]+\s*([\d.,]+)\s*(k|m)?\s*(?:sf|sq\.?\s*ft|sqft)/i);
  if (range) {
    const min = parseNumberToken(`${range[1]}${range[2] ?? ""}`);
    const max = parseNumberToken(`${range[3]}${range[4] ?? ""}`);
    return { min: min ?? undefined, max: max ?? undefined };
  }
  const out: { min?: number; max?: number } = {};
  if (over && (/sf|sq/.test(over[0]) || !/\$/.test(over[0]))) {
    const n = parseNumberToken(`${over[1]}${over[2] ?? ""}`);
    if (n != null && (over[0].toLowerCase().includes("sf") || n >= 1000)) out.min = n;
  }
  if (under && (/sf|sq/.test(under[0]) || !/\$/.test(under[0]))) {
    const n = parseNumberToken(`${under[1]}${under[2] ?? ""}`);
    if (n != null) out.max = n;
  }
  return out;
}

function parsePlace(q: string): string | undefined {
  const m = q.match(/\b(?:in|near|around|at)\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?:\s+(?:over|under|with|where|that|who|expir)|[,.]|$)/i);
  if (!m) return undefined;
  const place = m[1].trim().replace(/\s+/g, " ");
  if (/^(the|a|an|my|our)$/i.test(place)) return undefined;
  return place;
}

function detectPropertyType(q: string): (typeof PROPERTY_TYPES)[number] | undefined {
  const lower = q.toLowerCase();
  if (/\bindustrial\b|\bwarehouse\b|\bflex\b|\blogistics\b/.test(lower)) return "industrial";
  if (/\boffice\b/.test(lower)) return "office";
  if (/\bretail\b|\bstrip\b|\bshop\b/.test(lower)) return "retail";
  if (/\bmultifamily\b|\bapartment\b|\bworkforce housing\b/.test(lower)) return "multifamily";
  if (/\bland\b|\bvibrant\b|\bvacant lot\b/.test(lower)) return "land";
  if (/\bresidential\b/.test(lower)) return "residential";
  if (/\bmixed[-\s]?use\b/.test(lower)) return "mixed-use";
  return undefined;
}

export function parseCrmSearchHints(query: string): SearchResult {
  const q = query.trim();
  const lower = q.toLowerCase();
  const properties: PropertySearchFilters = {};
  const contacts: ContactSearchFilters = {};
  const leases: LeaseSearchFilters = {};

  const ptype = detectPropertyType(lower);
  if (ptype) properties.property_type = ptype;

  const sqft = parseSqftBounds(lower);
  if (sqft.min != null) properties.size_sqft_min = sqft.min;
  if (sqft.max != null) properties.size_sqft_max = sqft.max;

  const place = parsePlace(q);
  if (place) {
    properties.geographic_keyword = place;
    contacts.submarket_keyword = place;
  }

  const tier = lower.match(/\btier\s*([123])\b/);
  if (tier) contacts.contact_tier = Number(tier[1]);

  if (/\boverdue\b/.test(lower)) contacts.cadence_status = "overdue";
  else if (/\bdue soon\b/.test(lower)) contacts.cadence_status = "due_soon";
  else if (/\bnever contacted\b/.test(lower)) contacts.cadence_status = "never";

  const notDays = lower.match(/\b(?:haven'?t|not)\s+contacted\s+(?:in|for)\s+(\d+)\s+days?\b/);
  if (notDays) contacts.not_contacted_in_days = Number(notDays[1]);

  if (/\btenants?\b/.test(lower) && !/\bowners?\b/.test(lower)) contacts.contact_type = "tenant";
  else if (/\bowners?\b|\bproperty owners?\b/.test(lower) && /\bcontact/.test(lower)) {
    contacts.contact_type = "owner";
  }

  if (/\bpast clients?\b|\bformer clients?\b/.test(lower)) contacts.relationship_stage = "past_client";
  else if (/\bactive clients?\b|\bcurrent clients?\b/.test(lower)) contacts.relationship_stage = "active";
  else if (/\bprospects?\b/.test(lower)) contacts.relationship_stage = "prospect";
  else if (/\bdormant\b|\bgone quiet\b/.test(lower)) contacts.relationship_stage = "dormant";
  else if (/\bclients?\b/.test(lower) && !/\blease/.test(lower)) contacts.relationship_stage = "client";

  if (/\bexpired leases?\b/.test(lower)) leases.status = "expired";
  else if (/\bexpiring\b|\bleases? expiring\b/.test(lower)) leases.status = "expiring";
  else if (/\bactive leases?\b/.test(lower)) leases.status = "active";

  const expDays = lower.match(/\bexpir(?:ing|e)\s+(?:in|within)\s+(\d+)\s+days?\b/);
  if (expDays) leases.expiring_within_days = Number(expDays[1]);

  if (/\bownership (?:change|flip)/.test(lower)) properties.has_ownership_change = true;

  let target: SearchResult["target"] = "properties";
  if (leases.status || leases.expiring_within_days != null) target = "leases";
  else if (
    contacts.contact_tier != null ||
    contacts.cadence_status ||
    contacts.contact_type ||
    contacts.relationship_stage ||
    contacts.not_contacted_in_days != null ||
    (/\bcontacts?\b|\bpeople\b|\bowners?\b|\btenants?\b/.test(lower) && !ptype && !sqft.min)
  ) {
    target = "contacts";
  } else if (ptype || sqft.min != null || properties.has_ownership_change) {
    target = "properties";
  }

  return {
    target,
    properties: Object.keys(properties).length ? properties : undefined,
    contacts: Object.keys(contacts).length ? contacts : undefined,
    leases: Object.keys(leases).length ? leases : undefined,
    explanation: "",
  };
}

function explain(result: SearchResult): string {
  const bits: string[] = [];
  if (result.target === "leases") bits.push("leases");
  else if (result.target === "contacts") bits.push("contacts");
  else if (result.target === "both") bits.push("properties and contacts");
  else bits.push("properties");
  const p = result.properties;
  if (p?.property_type) bits.push(p.property_type);
  if (p?.size_sqft_min) bits.push(`≥${p.size_sqft_min.toLocaleString()} SF`);
  if (p?.size_sqft_max) bits.push(`≤${p.size_sqft_max.toLocaleString()} SF`);
  if (p?.geographic_keyword) bits.push(`in ${p.geographic_keyword}`);
  const c = result.contacts;
  if (c?.contact_tier) bits.push(`tier ${c.contact_tier}`);
  if (c?.cadence_status) bits.push(c.cadence_status.replace("_", " "));
  if (c?.contact_type) bits.push(c.contact_type + "s");
  const l = result.leases;
  if (l?.status) bits.push(l.status);
  return bits.join(", ") || "Matching your book.";
}

function omitUnset<T extends Record<string, unknown>>(obj: T | undefined): T | undefined {
  if (!obj) return undefined;
  const out = { ...obj };
  for (const [k, v] of Object.entries(out)) {
    if (v == null || v === "" || v === "unspecified") delete out[k];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Returns a complete SearchResult or null so the caller can fall back to Haiku. */
export async function interpretCrmSearchWithJev(query: string): Promise<SearchResult | null> {
  if (!jevEnabled()) return null;
  const hints = parseCrmSearchHints(query);

  const questions: Record<string, JevQuestion> = {
    target: {
      type: "choice",
      instructions:
        "Which Beacon CRM table does this broker search target? properties = buildings/parcels; contacts = people; leases = abstracts/expirations; both = people AND properties.",
      criteria: {
        properties: "Real estate records, buildings, SF, owners of buildings, sale price",
        contacts: "People, tiers, cadence, tenants, clients, who to call",
        leases: "Lease abstracts, expiration, rent per SF",
        both: "Query clearly needs both people and properties",
      },
    },
    property_type: {
      type: "choice",
      instructions: "Property type if clearly stated; unspecified if not.",
      criteria: Object.fromEntries([...PROPERTY_TYPES, "unspecified"].map((t) => [t, t])),
    },
    ownership_type: {
      type: "choice",
      instructions: "Ownership type if clearly stated; unspecified if not.",
      criteria: Object.fromEntries([...OWNERSHIP_TYPES, "unspecified"].map((t) => [t, t])),
    },
    relationship_stage: {
      type: "choice",
      instructions: "Contact relationship stage if clearly stated; unspecified if not.",
      criteria: Object.fromEntries([...STAGES, "unspecified"].map((t) => [t, t])),
    },
    ownership_role: {
      type: "choice",
      instructions: "Contact role in the ownership entity if clearly stated; unspecified if not.",
      criteria: Object.fromEntries([...ROLES, "unspecified"].map((t) => [t, t])),
    },
    lead_source: {
      type: "choice",
      instructions: "Lead source if clearly stated; unspecified if not.",
      criteria: Object.fromEntries([...LEAD_SOURCES, "unspecified"].map((t) => [t, t])),
    },
    asset_focus: {
      type: "choice",
      instructions: "Contact asset-focus type if they asked for contacts interested in a type; unspecified otherwise.",
      criteria: Object.fromEntries([...ASSET_FOCUS, "unspecified"].map((t) => [t, t])),
    },
    contact_type: {
      type: "choice",
      instructions: "Owner vs tenant book if stated; unspecified otherwise.",
      criteria: { owner: "property owners", tenant: "tenants", other: "other", unspecified: "not stated" },
    },
    lease_status: {
      type: "choice",
      instructions: "Lease status if stated; unspecified otherwise.",
      criteria: { active: ">90 days", expiring: "within 90 days", expired: "already expired", unspecified: "not stated" },
    },
    ownership_change: {
      type: "noul",
      instructions: "The broker is asking for properties with an ownership change / flip signal.",
    },
    individual_owners: {
      type: "noul",
      instructions: "The broker wants individual/private owners (not LLCs/REITs).",
    },
    entity_owners: {
      type: "noul",
      instructions: "The broker wants entity/institutional/REIT owners.",
    },
  };

  const decided = await jevDecide({ query }, questions);
  if (!decided) return null;

  const targetPick = jevChoice(decided, "target");
  if (!targetPick || targetPick.confidence < 0.45) return null;
  if (!["properties", "contacts", "leases", "both"].includes(targetPick.choice)) return null;

  const properties: PropertySearchFilters = { ...(hints.properties ?? {}) };
  const contacts: ContactSearchFilters = { ...(hints.contacts ?? {}) };
  const leases: LeaseSearchFilters = { ...(hints.leases ?? {}) };

  const ptype = jevChoice(decided, "property_type");
  if (ptype && ptype.choice !== "unspecified" && ptype.confidence >= 0.5) {
    properties.property_type = ptype.choice as PropertySearchFilters["property_type"];
  }
  const otype = jevChoice(decided, "ownership_type");
  if (otype && otype.choice !== "unspecified" && otype.confidence >= 0.55) {
    properties.ownership_type = otype.choice;
  }
  const stage = jevChoice(decided, "relationship_stage");
  if (stage && stage.choice !== "unspecified" && stage.confidence >= 0.55) {
    contacts.relationship_stage = stage.choice as ContactSearchFilters["relationship_stage"];
  }
  const role = jevChoice(decided, "ownership_role");
  if (role && role.choice !== "unspecified" && role.confidence >= 0.55) {
    contacts.ownership_role = role.choice;
  }
  const source = jevChoice(decided, "lead_source");
  if (source && source.choice !== "unspecified" && source.confidence >= 0.55) {
    contacts.lead_source = source.choice;
  }
  const focus = jevChoice(decided, "asset_focus");
  if (focus && focus.choice !== "unspecified" && focus.confidence >= 0.55) {
    contacts.asset_focus_includes = focus.choice;
  }
  const ctype = jevChoice(decided, "contact_type");
  if (ctype && ctype.choice !== "unspecified" && ctype.confidence >= 0.55) {
    contacts.contact_type = ctype.choice;
  }
  const lstatus = jevChoice(decided, "lease_status");
  if (lstatus && lstatus.choice !== "unspecified" && lstatus.confidence >= 0.55) {
    leases.status = lstatus.choice as LeaseSearchFilters["status"];
  }
  if (jevIsYes(jevNoul(decided, "ownership_change"), 0.7)) properties.has_ownership_change = true;
  if (jevIsYes(jevNoul(decided, "individual_owners"), 0.75)) {
    properties.ownership_individual_or_entity = "individual";
  } else if (jevIsYes(jevNoul(decided, "entity_owners"), 0.75)) {
    properties.ownership_individual_or_entity = "entity";
  }

  const result: SearchResult = {
    target: targetPick.choice as SearchResult["target"],
    properties: omitUnset(properties as Record<string, unknown>) as PropertySearchFilters | undefined,
    contacts: omitUnset(contacts as Record<string, unknown>) as ContactSearchFilters | undefined,
    leases: omitUnset(leases as Record<string, unknown>) as LeaseSearchFilters | undefined,
    explanation: "",
  };
  if (result.target === "properties") {
    delete result.contacts;
    delete result.leases;
  } else if (result.target === "contacts") {
    delete result.properties;
    delete result.leases;
  } else if (result.target === "leases") {
    delete result.properties;
    delete result.contacts;
  }
  result.explanation = explain(result);
  return result;
}
