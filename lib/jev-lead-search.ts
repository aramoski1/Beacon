// Jev-first Prospect sentence interpret. Same output as Haiku + refineLeadCriteria.

import {
  refineLeadCriteria,
  sanitizeLeadCriteria,
  type IgnoredLeadTerm,
} from "@/lib/lead-search-interpret";
import { resolveCity } from "@/lib/lead-search-interpret";
import type { LeadSearchCriteria, PropertyTypeFilter } from "@/lib/lead-finder";
import { jevChoice, jevDecide, jevEnabled, jevIsYes, jevNoul, type JevQuestion } from "@/lib/jev";

const TYPES: PropertyTypeFilter[] = [
  "residential",
  "multifamily",
  "retail",
  "office",
  "industrial",
  "land",
];

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

export function parseLeadSearchHints(query: string): LeadSearchCriteria {
  const q = query.toLowerCase();
  const criteria: LeadSearchCriteria = { markets: [] };

  const range = query.match(/([\d.,]+)\s*(k|m)?\s*(?:sf|sq\.?\s*ft|sqft)?\s*[-–to]+\s*([\d.,]+)\s*(k|m)?\s*(?:sf|sq\.?\s*ft|sqft)?/i);
  if (range) {
    const unit = range[4] || range[2] || "";
    criteria.buildingSqftMin = parseNumberToken(`${range[1]}${range[2] || unit}`) ?? undefined;
    criteria.buildingSqftMax = parseNumberToken(`${range[3]}${range[4] || unit}`) ?? undefined;
  } else {
    const over = q.match(/\b(?:over|above|greater than|more than|at least)\s+([\d.,]+)\s*(k|m)?\s*(?:sf|sq)/);
    const under = q.match(/\b(?:under|below|less than|up to)\s+([\d.,]+)\s*(k|m)?\s*(?:sf|sq)/);
    if (over) criteria.buildingSqftMin = parseNumberToken(`${over[1]}${over[2] ?? ""}`) ?? undefined;
    if (under) criteria.buildingSqftMax = parseNumberToken(`${under[1]}${under[2] ?? ""}`) ?? undefined;
  }

  const yearAfter = q.match(/\b(?:built|year)\s+(?:after|since|over|>)\s*(19|20)\d{2}\b/);
  const yearOnly = q.match(/\b(?:after|since)\s+((?:19|20)\d{2})\b/);
  if (yearAfter) criteria.yearBuiltMin = Number(yearAfter[0].match(/(?:19|20)\d{2}/)?.[0]);
  else if (yearOnly) criteria.yearBuiltMin = Number(yearOnly[1]);

  if (/\bindustrial\b|\bwarehouse\b|\bflex\b/.test(q)) criteria.propertyType = "industrial";
  else if (/\boffice\b/.test(q)) criteria.propertyType = "office";
  else if (/\bretail\b/.test(q)) criteria.propertyType = "retail";
  else if (/\bmultifamily\b|\bapartment\b/.test(q)) criteria.propertyType = "multifamily";
  else if (/\bland\b/.test(q)) criteria.propertyType = "land";
  else if (/\bresidential\b/.test(q)) criteria.propertyType = "residential";

  if (/\bheld\b|\blong[-\s]?held\b/.test(q)) {
    const yrs = q.match(/\b(\d+)\s*\+?\s*years?\b/);
    criteria.heldAtLeastYears = yrs ? Number(yrs[1]) : 10;
  } else if (/\bsold recently\b|\bjust sold\b/.test(q)) {
    criteria.soldWithinYears = 2;
  }

  if (/\bleases? expir/.test(q)) {
    criteria.leaseExpiringWithinDays = /\bsoon\b/.test(q) ? 90 : 90;
  }

  const cities: string[] = [];
  const inMatch = query.match(/\bin\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?:\s+(?:over|under|built|sold|held|,)|$)/i);
  if (inMatch) {
    const raw = inMatch[1].trim();
    const { canonical } = resolveCity(raw);
    cities.push(canonical);
  }
  if (cities.length) criteria.cities = cities;

  return sanitizeLeadCriteria(criteria) ?? { markets: [] };
}

export type JevLeadInterpret = {
  criteria: LeadSearchCriteria;
  explanation: string;
  ignored: IgnoredLeadTerm[];
};

export async function interpretLeadSearchWithJev(query: string): Promise<JevLeadInterpret | null> {
  if (!jevEnabled()) return null;
  const hints = parseLeadSearchHints(query);

  const questions: Record<string, JevQuestion> = {
    property_type: {
      type: "choice",
      instructions: "Tax-roll property type if clearly stated; unspecified if not.",
      criteria: Object.fromEntries([...TYPES, "unspecified"].map((t) => [t, t])),
    },
    sold_recently: {
      type: "noul",
      instructions: "The broker wants parcels that sold recently (soldWithinYears), not long-held.",
    },
    long_held: {
      type: "noul",
      instructions: "The broker wants long-held owners (heldAtLeastYears), not a recent sale.",
    },
    lease_expiring: {
      type: "noul",
      instructions: "The broker wants lease-expiring-soon as a filter (only hits addresses already in their book).",
    },
    mentions_unsupported: {
      type: "noul",
      instructions:
        "The sentence asks for docks, clear height, parking, rail, power, asking rent, cap rate, or near-the-airport — filters the tax roll cannot apply.",
    },
    lauderdale_city: {
      type: "choice",
      instructions:
        "If the sentence says Lauderdale without Fort/Ft or Lauderhill, which city? unspecified if it already named Fort Lauderdale or Lauderhill, or did not say Lauderdale.",
      criteria: {
        "Fort Lauderdale": "Fort Lauderdale (Broward)",
        Lauderhill: "Lauderhill (Broward)",
        unspecified: "Already specific, or not about Lauderdale",
      },
    },
  };

  const decided = await jevDecide({ query }, questions);
  if (!decided) return null;

  const raw: LeadSearchCriteria = { ...hints };
  const ptype = jevChoice(decided, "property_type");
  if (ptype && ptype.choice !== "unspecified" && ptype.confidence >= 0.5) {
    raw.propertyType = ptype.choice as PropertyTypeFilter;
  }
  if (jevIsYes(jevNoul(decided, "long_held"), 0.7) && raw.heldAtLeastYears == null) {
    raw.heldAtLeastYears = 10;
    raw.soldWithinYears = undefined;
  } else if (jevIsYes(jevNoul(decided, "sold_recently"), 0.7) && raw.soldWithinYears == null) {
    raw.soldWithinYears = 2;
  }
  if (jevIsYes(jevNoul(decided, "lease_expiring"), 0.7) && raw.leaseExpiringWithinDays == null) {
    raw.leaseExpiringWithinDays = 90;
  }
  const lauderdale = jevChoice(decided, "lauderdale_city");
  const saidLauderdale = /\blauderdale\b/i.test(query) && !/\b(fort|ft\.?)\s+lauderdale\b/i.test(query);
  if (
    saidLauderdale &&
    lauderdale &&
    lauderdale.choice !== "unspecified" &&
    lauderdale.confidence >= 0.6 &&
    !raw.cities?.length
  ) {
    raw.cities = [lauderdale.choice];
  }

  const priorIgnored: IgnoredLeadTerm[] = [];
  if (jevIsYes(jevNoul(decided, "mentions_unsupported"), 0.65)) {
    for (const term of ["docks", "clear height", "parking", "rail", "airport", "asking rent"]) {
      if (query.toLowerCase().includes(term.split(" ")[0]!)) {
        priorIgnored.push({
          term,
          reason: "County tax rolls cannot filter on this.",
        });
      }
    }
  }

  const refined = refineLeadCriteria(raw, query, priorIgnored);
  if (!refined.ok) return null;

  const bits = [
    refined.criteria.propertyType,
    refined.criteria.cities?.join(", "),
    refined.criteria.buildingSqftMin != null
      ? `≥${refined.criteria.buildingSqftMin.toLocaleString()} SF`
      : null,
    refined.criteria.buildingSqftMax != null
      ? `≤${refined.criteria.buildingSqftMax.toLocaleString()} SF`
      : null,
  ].filter(Boolean);

  return {
    criteria: refined.criteria,
    explanation: bits.length
      ? `Searching county tax rolls: ${bits.join(", ")}.`
      : "Searching county tax rolls with the filters below.",
    ignored: refined.ignored,
  };
}
