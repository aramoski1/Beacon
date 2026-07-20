/** Portfolio attention signals — ownership changes, lease roll, cold contacts. */

export type PortfolioAttentionFlag = {
  kind: "ownership_change" | "lease_expiring" | "cold_contact";
  severity: "critical" | "high" | "medium";
  title: string;
  subtitle?: string;
  href?: string;
};

export type PortfolioAttentionProperty = {
  id: string;
  address: string | null;
  ownership_change_detected_at?: string | null;
  ownership_change_data?: {
    previous_owner?: string | null;
    new_owner?: string | null;
  } | null;
};

export type PortfolioAttentionLease = {
  id: string;
  expiration_date: string | null;
  source_document: string | null;
};

export type PortfolioAttentionContact = {
  id: string;
  name: string | null;
  last_contacted_at: string | null;
  contact_tier: number | null;
};

function daysUntil(iso: string): number {
  const exp = new Date(iso.includes("T") ? iso : iso + "T12:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((exp - today.getTime()) / 86_400_000);
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/** Build prioritized attention flags for the portfolio centerpiece. */
export function buildPortfolioAttentionFlags(input: {
  properties: PortfolioAttentionProperty[];
  leases: PortfolioAttentionLease[];
  contacts: PortfolioAttentionContact[];
}): PortfolioAttentionFlag[] {
  const flags: PortfolioAttentionFlag[] = [];

  for (const p of input.properties) {
    if (p.ownership_change_detected_at) {
      const prev = p.ownership_change_data?.previous_owner;
      const next = p.ownership_change_data?.new_owner;
      flags.push({
        kind: "ownership_change",
        severity: "critical",
        title: `Ownership change — ${p.address ?? "property"}`,
        subtitle: prev && next ? `${prev} → ${next}` : undefined,
        href: `/properties/${p.id}`,
      });
    }
  }

  for (const l of input.leases) {
    if (!l.expiration_date) continue;
    const d = daysUntil(l.expiration_date);
    if (d >= 0 && d <= 90) {
      flags.push({
        kind: "lease_expiring",
        severity: d <= 30 ? "critical" : "high",
        title: `Lease expires in ${d}d`,
        subtitle: l.source_document?.split("/").pop() ?? undefined,
        href: `/abstracts/${l.id}`,
      });
    }
  }

  for (const c of input.contacts) {
    if (c.contact_tier !== 1) continue;
    if (!c.last_contacted_at || daysSince(c.last_contacted_at) >= 45) {
      flags.push({
        kind: "cold_contact",
        severity: "medium",
        title: `Tier 1 going cold — ${c.name ?? "contact"}`,
        subtitle: c.last_contacted_at
          ? `Last touch ${daysSince(c.last_contacted_at)}d ago`
          : "Never contacted",
        href: `/contacts/${c.id}`,
      });
    }
  }

  const order = { critical: 0, high: 1, medium: 2 };
  flags.sort((a, b) => order[a.severity] - order[b.severity]);
  return flags;
}
