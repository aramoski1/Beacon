/**
 * Full lived-in demo account seeder.
 *
 * Usage:
 *   npm run seed:demo
 *   SEED_DEMO_EMAIL=aramoski1@babson.edu npm run seed:demo
 *
 * Env:
 *   DATABASE_URL              — required (.env.local)
 *   SEED_DEMO_EMAIL           — default aramoski1@babson.edu
 *   SEED_DEMO_PASSWORD        — used only when creating a missing auth user
 *   SEED_DEMO_RESET=1         — wipe prior seed:demo rows for this user first (default on)
 *
 * Cleanup (manual):
 *   DELETE FROM properties WHERE source = 'seed:demo';  -- cascades most links
 *   Or re-run with SEED_DEMO_RESET=1
 */

import { Client } from "pg";
import { randomUUID } from "crypto";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set — add it to .env.local");
  process.exit(1);
}

const EMAIL = (process.env.SEED_DEMO_EMAIL ?? "aramoski1@babson.edu").toLowerCase();
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "BeaconDemo2026!";
const RESET = (process.env.SEED_DEMO_RESET ?? "1") !== "0";

const DEMO_SOURCE = "seed:demo";

// ─── Domain flavor ────────────────────────────────────────────────────────────

const CITIES = [
  "Miami",
  "Doral",
  "Hialeah",
  "Medley",
  "Miami Lakes",
  "Opa-locka",
  "Homestead",
  "Coral Gables",
  "Kendall",
  "Aventura",
];

const SUBMARKETS = [
  "Airport West",
  "Doral",
  "Medley",
  "Northwest",
  "South Dade",
  "Hialeah",
  "Beacon Lakes",
  "Flagler",
];

const STREETS = [
  "NW 25th St",
  "NW 36th St",
  "NW 58th St",
  "NW 74th St",
  "NW 79th St",
  "NW 87th Ave",
  "NW 107th Ave",
  "NW 12th Ave",
  "Le Jeune Rd",
  "Bird Rd",
  "Flagler St",
  "SW 8th St",
  "SW 40th St",
  "SW 137th Ave",
  "W 33rd St",
];

const PROPERTY_TYPES = [
  "industrial",
  "industrial",
  "industrial",
  "industrial",
  "office",
  "office",
  "retail",
  "flex",
  "warehouse",
  "land",
];

const OWNERSHIP_TYPES = [
  "private",
  "private",
  "institutional",
  "owner-occupant",
  "REIT",
];

type LlcPortfolio = {
  llc: string;
  human: string;
  email: string;
  phone: string;
  city: string;
};

const PORTFOLIOS: LlcPortfolio[] = [
  {
    llc: "PALMETTO LOGISTICS LLC",
    human: "Carlos Mendez",
    email: "carlos@palmettologistics.demo",
    phone: "(305) 555-0142",
    city: "Doral",
  },
  {
    llc: "BEACON LAKES HOLDINGS LLC",
    human: "Sarah Chen",
    email: "sarah@beaconlakesholdings.demo",
    phone: "(786) 555-0198",
    city: "Miami",
  },
  {
    llc: "FLAGLER INDUSTRIAL PARTNERS LLC",
    human: "Michael Torres",
    email: "mike@flaglerip.demo",
    phone: "(305) 555-0177",
    city: "Medley",
  },
  {
    llc: "SOUTH DADE PROPERTIES LLC",
    human: "Ana Ruiz",
    email: "ana@southdadeprops.demo",
    phone: "(305) 555-0133",
    city: "Homestead",
  },
  {
    llc: "AIRPORT WEST CAPITAL LLC",
    human: "David Park",
    email: "david@airportwestcap.demo",
    phone: "(786) 555-0161",
    city: "Miami",
  },
  {
    llc: "HIALEAH FLEX GROUP LLC",
    human: "Jennifer Lopez",
    email: "jen@hialeahflex.demo",
    phone: "(305) 555-0188",
    city: "Hialeah",
  },
];

const TENANTS = [
  { name: "FedEx Ground — Miami Sort", company: "FedEx Ground", contact: "Ops Manager Luis Vega" },
  { name: "Amazon DSP Hub", company: "Amazon Logistics", contact: "Site Lead Priya Shah" },
  { name: "Sysco Miami", company: "Sysco Corporation", contact: "RE Manager Tom Bradley" },
  { name: "HD Supply Facilities", company: "HD Supply", contact: "Facilities Dir. Kim Nguyen" },
  { name: "Uline Distribution", company: "Uline", contact: "Warehouse Mgr. Rob Alvarez" },
  { name: "Performance Team", company: "Performance Team LLC", contact: "GM Elena Soto" },
  { name: "XPO Logistics", company: "XPO Logistics", contact: "Site Supervisor Mark Quinn" },
  { name: "Lineage Logistics", company: "Lineage", contact: "Cold Storage Lead Ava Brooks" },
  { name: "Goya Foods Warehouse", company: "Goya Foods", contact: "Plant Mgr. Hector Diaz" },
  { name: "Pepsi Beverages FL", company: "PepsiCo", contact: "RE Coord. Natalie Cho" },
];

const DEAL_SPECS: { name: string; deal_type: string; stage: string; commission: number }[] = [
  { name: "Sysco — 80k SF renewal (Airport West)", deal_type: "tenant_rep", stage: "loi_executed", commission: 95000 },
  { name: "Listing — 142k SF warehouse Doral", deal_type: "listing", stage: "proposal", commission: 180000 },
  { name: "Investment — Medley portfolio sale", deal_type: "investment_sale", stage: "due_diligence", commission: 220000 },
  { name: "Uline — expansion search NW corridor", deal_type: "tenant_rep", stage: "requirement", commission: 72000 },
  { name: "Owner listing — Hialeah flex 42k", deal_type: "listing", stage: "contacted", commission: 48000 },
  { name: "Amazon DSP — new hub RFP", deal_type: "tenant_rep", stage: "meeting", commission: 110000 },
  { name: "REIT disposition — South Dade land", deal_type: "investment_sale", stage: "prospect", commission: 65000 },
  { name: "FedEx — early renewal outreach", deal_type: "tenant_rep", stage: "closed", commission: 88000 },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function sizeForType(ptype: string): { sqft: number; cat: string } {
  if (ptype === "land") return { sqft: randInt(20000, 180000), cat: "Large" };
  if (ptype === "retail" || ptype === "office") {
    const sqft = randInt(4000, 45000);
    return { sqft, cat: sqft < 10000 ? "Small" : sqft < 30000 ? "Medium" : "Large" };
  }
  const sqft = randInt(12000, 220000);
  return {
    sqft,
    cat: sqft < 25000 ? "Small" : sqft < 75000 ? "Medium" : sqft < 150000 ? "Large" : "Extra Large",
  };
}

async function ensureUser(db: Client): Promise<{ id: string; created: boolean }> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM auth.users WHERE lower(email) = lower($1)`,
    [EMAIL],
  );
  if (existing.rows[0]) {
    return { id: existing.rows[0].id, created: false };
  }

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at, confirmation_token, recovery_token,
       email_change_token_new, email_change, is_sso_user, is_anonymous
     ) VALUES (
       '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       $1, crypt($2, gen_salt('bf')),
       now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       now(), now(), '', '', '', '', false, false
     ) RETURNING id`,
    [EMAIL, PASSWORD],
  );
  const id = rows[0].id;

  await db.query(
    `INSERT INTO auth.identities (
       id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
     ) VALUES (
       gen_random_uuid(), $1::uuid, $1::text,
       jsonb_build_object('sub', $1::text, 'email', $2::text),
       'email', now(), now(), now()
     )`,
    [id, EMAIL],
  );

  return { id, created: true };
}

async function ensureFirmAndSettings(db: Client, userId: string) {
  const mem = await db.query(
    `SELECT id FROM firm_members WHERE user_id = $1 AND status = 'active' LIMIT 1`,
    [userId],
  );
  if (mem.rows.length === 0) {
    const firm = await db.query<{ id: string }>(
      `INSERT INTO firms (id, name, created_by) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      ["Beacon Demo Team", userId],
    );
    await db.query(
      `INSERT INTO firm_members (firm_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [firm.rows[0].id, userId],
    );
  }

  await db.query(
    `INSERT INTO user_settings (
       owner_id, display_name, broker_name, company, default_market,
       default_submarket, phone, sender_email, onboarding_completed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (owner_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       broker_name = EXCLUDED.broker_name,
       company = EXCLUDED.company,
       default_market = EXCLUDED.default_market,
       default_submarket = EXCLUDED.default_submarket,
       onboarding_completed_at = COALESCE(user_settings.onboarding_completed_at, now()),
       updated_at = now()`,
    [
      userId,
      "Alec Ramoski",
      "Alec Ramoski",
      "Beacon Demo Brokerage",
      "Miami-Dade",
      "Airport West",
      "(305) 555-0100",
      EMAIL,
    ],
  );
}

async function wipeDemo(db: Client, userId: string) {
  // Order: children that reference leases/deals/contacts/properties first
  await db.query(
    `DELETE FROM follow_ups WHERE owner_id = $1 AND (
       description LIKE '[Demo]%' OR source_type = 'seed:demo'
     )`,
    [userId],
  );
  await db.query(
    `DELETE FROM activities WHERE owner_id = $1 AND notes LIKE '[Demo]%'`,
    [userId],
  );
  await db.query(
    `DELETE FROM deals WHERE owner_id = $1 AND notes LIKE '[Demo]%'`,
    [userId],
  );
  await db.query(
    `DELETE FROM lease_abstracts WHERE owner_id = $1 AND source_document = $2`,
    [userId, DEMO_SOURCE],
  );
  await db.query(
    `DELETE FROM contact_properties WHERE owner_id = $1 AND contact_id IN (
       SELECT id FROM contacts WHERE owner_id = $1 AND lead_source = $2
     )`,
    [userId, DEMO_SOURCE],
  );
  await db.query(
    `DELETE FROM contacts WHERE owner_id = $1 AND lead_source = $2`,
    [userId, DEMO_SOURCE],
  );
  await db.query(
    `DELETE FROM properties WHERE owner_id = $1 AND source = $2`,
    [userId, DEMO_SOURCE],
  );
  await db.query(
    `DELETE FROM entities WHERE owner_id = $1 AND sunbiz_doc_number LIKE 'DEMO-%'`,
    [userId],
  );
}

async function main() {
  const db = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  console.log(`\nDemo seed target: ${EMAIL}`);
  const { id: userId, created } = await ensureUser(db);
  console.log(`User id: ${userId}${created ? " (created)" : " (existing)"}`);
  if (created) {
    console.log(`Login password: ${PASSWORD}`);
  }

  await ensureFirmAndSettings(db, userId);

  if (RESET) {
    console.log("Wiping prior seed:demo rows…");
    await wipeDemo(db, userId);
  }

  const { rows: maxRows } = await db.query<{ max: number | null }>(
    `SELECT MAX(prospect_number) AS max FROM properties WHERE owner_id = $1`,
    [userId],
  );
  let prospect = (maxRows[0]?.max ?? 0) + 1;

  // ── Entities for shared LLCs ───────────────────────────────────────────────
  const entityIds: Record<string, string> = {};
  for (let i = 0; i < PORTFOLIOS.length; i++) {
    const p = PORTFOLIOS[i];
    const eid = randomUUID();
    const normalized = p.llc.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    await db.query(
      `INSERT INTO entities (id, owner_id, name, name_normalized, kind, sunbiz_doc_number)
       VALUES ($1, $2, $3, $4, 'entity', $5)`,
      [eid, userId, p.llc, normalized, `DEMO-${1000 + i}`],
    );
    entityIds[p.llc] = eid;
  }

  // ── Owner contacts (one per portfolio) ─────────────────────────────────────
  const ownerContactIds: string[] = [];
  for (let i = 0; i < PORTFOLIOS.length; i++) {
    const p = PORTFOLIOS[i];
    const cid = randomUUID();
    const tier = (i % 3) + 1;
    // Mix cadence: some overdue, some recent
    const lastContacted =
      i % 3 === 0 ? daysAgo(45) : i % 3 === 1 ? daysAgo(8) : daysAgo(2);
    await db.query(
      `INSERT INTO contacts (
         id, owner_id, name, company, role, email, phone, phone_office,
         contact_tier, client_status, contact_type, ownership_role,
         geographic_category, ownership_type, asset_focus, submarket,
         relationship_stage, lead_source, last_contacted_at, notes, visibility
       ) VALUES (
         $1,$2,$3,$4,'Principal',$5,$6,$6,$7,'active client','owner','managing_member',
         'Miami-Dade',$8,$9,$10,'active',$11,$12,$13,'private'
       )`,
      [
        cid,
        userId,
        p.human,
        p.llc,
        p.email,
        p.phone,
        tier,
        pick(OWNERSHIP_TYPES),
        ["industrial", "warehouse"],
        pick(SUBMARKETS),
        DEMO_SOURCE,
        lastContacted.toISOString(),
        `[Demo] Owner principal for ${p.llc}`,
      ],
    );
    ownerContactIds.push(cid);
  }

  // ── Tenant contacts ────────────────────────────────────────────────────────
  const tenantContactIds: string[] = [];
  for (let i = 0; i < TENANTS.length; i++) {
    const t = TENANTS[i];
    const cid = randomUUID();
    await db.query(
      `INSERT INTO contacts (
         id, owner_id, name, company, role, email, phone,
         contact_tier, client_status, contact_type, asset_focus,
         geographic_category, relationship_stage, lead_source,
         last_contacted_at, notes, visibility
       ) VALUES (
         $1,$2,$3,$4,'Tenant contact',$5,$6,
         $7,'prospect','tenant',$8,'Miami-Dade','prospect',$9,$10,$11,'private'
       )`,
      [
        cid,
        userId,
        t.contact,
        t.company,
        `tenant${i + 1}@${t.company.toLowerCase().replace(/[^a-z0-9]+/g, "")}.demo`,
        `(305) 555-${String(200 + i).padStart(4, "0")}`,
        (i % 3) + 1,
        ["industrial"],
        DEMO_SOURCE,
        daysAgo(randInt(3, 60)).toISOString(),
        `[Demo] Tenant side — ${t.name}`,
      ],
    );
    tenantContactIds.push(cid);
  }

  // ── Properties (~100) clustered under portfolios ───────────────────────────
  const PROP_COUNT = 100;
  const propertyIds: string[] = [];
  const propertyMeta: {
    id: string;
    portfolioIdx: number;
    address: string;
    sqft: number;
    ptype: string;
  }[] = [];

  console.log(`Inserting ${PROP_COUNT} properties…`);
  for (let i = 0; i < PROP_COUNT; i++) {
    const portfolioIdx = i % PORTFOLIOS.length;
    const portfolio = PORTFOLIOS[portfolioIdx];
    const ptype = pick(PROPERTY_TYPES);
    const { sqft, cat } = sizeForType(ptype);
    const city = pick(CITIES);
    const submarket = pick(SUBMARKETS);
    const id = randomUUID();
    const address = `${randInt(1000, 18999)} ${pick(STREETS)}`;
    const createdAt = daysAgo(randInt(1, 120));
    const watch = i % 7 === 0;
    const ownershipFlip = i % 19 === 0;

    await db.query(
      `INSERT INTO properties (
         id, owner_id, address, city, submarket, geographic_category,
         owner_name, ownership_type, size_sqft, size_category, property_type,
         asset_description, last_sale_date, last_sale_price, source,
         prospect_number, owner_mailing_address, owner_contact_name,
         owner_email, owner_contacts, entity_id,
         ownership_watch_enrolled_at, ownership_last_checked_at,
         ownership_change_detected_at, ownership_change_data,
         created_at, updated_at, visibility
       ) VALUES (
         $1,$2,$3,$4,$5,$6,
         $7,$8,$9,$10,$11,
         $12,$13,$14,$15,
         $16,$17,$18,
         $19,'[]'::jsonb,$20,
         $21,$22,
         $23,$24,
         $25,$25,'private'
       )`,
      [
        id,
        userId,
        address,
        city,
        submarket,
        "Miami-Dade",
        portfolio.llc,
        pick(OWNERSHIP_TYPES),
        sqft,
        cat,
        ptype === "flex" || ptype === "warehouse" ? "industrial" : ptype,
        `${ptype.charAt(0).toUpperCase() + ptype.slice(1)} — ${city}`,
        Math.random() > 0.35 ? daysFromNow(-randInt(30, 4000)) : null,
        Math.random() > 0.35 ? randInt(850000, 28000000) : null,
        DEMO_SOURCE,
        prospect++,
        `${randInt(100, 900)} Brickell Ave, Miami FL 33131`,
        portfolio.human,
        portfolio.email,
        entityIds[portfolio.llc],
        watch ? daysAgo(randInt(1, 40)).toISOString() : null,
        watch ? daysAgo(randInt(0, 10)).toISOString() : null,
        ownershipFlip ? daysAgo(randInt(1, 14)).toISOString() : null,
        ownershipFlip
          ? JSON.stringify({
              previous_owner: "PRIOR OWNER LLC",
              detected_via: "seed:demo",
              note: "Synthetic ownership change for Today desk",
            })
          : null,
        createdAt.toISOString(),
      ],
    );

    propertyIds.push(id);
    propertyMeta.push({ id, portfolioIdx, address, sqft, ptype });

    // Link owner contact ↔ property
    await db.query(
      `INSERT INTO contact_properties (owner_id, contact_id, property_id)
       VALUES ($1, $2, $3)`,
      [userId, ownerContactIds[portfolioIdx], id],
    );
  }

  // Update owner contacts linked_properties arrays
  for (let i = 0; i < PORTFOLIOS.length; i++) {
    const props = propertyMeta.filter((p) => p.portfolioIdx === i).map((p) => p.id);
    await db.query(
      `UPDATE contacts SET linked_properties = $1::uuid[] WHERE id = $2`,
      [props, ownerContactIds[i]],
    );
  }

  // ── Lease abstracts (~35) with staggered expirations ───────────────────────
  const EXPIRY_DAYS = [12, 28, 45, 60, 75, 88, 110, 150, 200, 320];
  const leaseIds: { id: string; propertyId: string; tenantContactId: string; exp: string; bucket: string }[] = [];
  const LEASE_COUNT = 35;
  console.log(`Inserting ${LEASE_COUNT} lease abstracts…`);

  for (let i = 0; i < LEASE_COUNT; i++) {
    const prop = propertyMeta[i % propertyMeta.length];
    const tenantIdx = i % tenantContactIds.length;
    const lid = randomUUID();
    const days = EXPIRY_DAYS[i % EXPIRY_DAYS.length] + randInt(0, 5);
    const exp = daysFromNow(days);
    const bucket = days <= 30 ? "30" : days <= 60 ? "60" : days <= 90 ? "90" : "90+";
    const tenant = TENANTS[tenantIdx];
    const exec = daysFromNow(-(randInt(365, 2200)));

    await db.query(
      `INSERT INTO lease_abstracts (
         id, owner_id, linked_property, execution_date, expiration_date,
         term, base_rate, escalations, options, key_provisions,
         source_document, tenant_contact_id, field_reviews, visibility
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,$8::jsonb,$9::jsonb,$10::jsonb,
         $11,$12,'{}'::jsonb,'private'
       )`,
      [
        lid,
        userId,
        prop.id,
        exec,
        exp,
        `${randInt(3, 10)} years`,
        randInt(8, 28) + Math.random(),
        JSON.stringify([{ type: "annual", amount: "3%" }]),
        JSON.stringify([{ type: "renewal", periods: 2, years: 5 }]),
        JSON.stringify({
          tenant: tenant.name,
          use: "Warehousing and distribution",
          notes: "[Demo] Synthetic abstract",
        }),
        DEMO_SOURCE,
        tenantContactIds[tenantIdx],
      ],
    );

    leaseIds.push({
      id: lid,
      propertyId: prop.id,
      tenantContactId: tenantContactIds[tenantIdx],
      exp,
      bucket,
    });

    await db.query(
      `INSERT INTO contact_properties (owner_id, contact_id, property_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [userId, tenantContactIds[tenantIdx], prop.id],
    ).catch(async () => {
      // unique constraint may differ — try without ON CONFLICT name
      await db.query(
        `INSERT INTO contact_properties (owner_id, contact_id, property_id)
         SELECT $1, $2, $3
         WHERE NOT EXISTS (
           SELECT 1 FROM contact_properties
           WHERE owner_id = $1 AND contact_id = $2 AND property_id = $3
         )`,
        [userId, tenantContactIds[tenantIdx], prop.id],
      );
    });
  }

  // ── Deals ──────────────────────────────────────────────────────────────────
  console.log(`Inserting ${DEAL_SPECS.length} deals…`);
  const dealIds: string[] = [];
  for (let i = 0; i < DEAL_SPECS.length; i++) {
    const spec = DEAL_SPECS[i];
    const prop = propertyMeta[i * 7 % propertyMeta.length];
    const contactId =
      spec.deal_type === "listing" || spec.deal_type === "investment_sale"
        ? ownerContactIds[i % ownerContactIds.length]
        : tenantContactIds[i % tenantContactIds.length];
    const did = randomUUID();
    const dueOffset = spec.stage === "closed" || spec.stage === "lost" ? null : randInt(-3, 21);
    await db.query(
      `INSERT INTO deals (
         id, owner_id, name, stage, deal_type, contact_id, property_id,
         estimated_commission, notes, next_action, next_action_due,
         expected_close_date, visibility
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'private')`,
      [
        did,
        userId,
        spec.name,
        spec.stage,
        spec.deal_type,
        contactId,
        prop.id,
        spec.commission,
        `[Demo] Seeded pursuit — ${spec.deal_type}`,
        dueOffset === null ? null : pick(["Send LOI follow-up", "Schedule tour", "Call principal", "Update comps", "Review lease draft"]),
        dueOffset === null ? null : daysFromNow(dueOffset),
        dueOffset === null ? null : daysFromNow(randInt(30, 120)),
      ],
    );
    dealIds.push(did);
  }

  // ── Activities ─────────────────────────────────────────────────────────────
  const ACTIVITY_TYPES = ["call", "email", "meeting", "note", "letter"] as const;
  console.log("Inserting activities…");
  for (let i = 0; i < 60; i++) {
    const contactId =
      i % 2 === 0
        ? ownerContactIds[i % ownerContactIds.length]
        : tenantContactIds[i % tenantContactIds.length];
    const prop = propertyMeta[i % propertyMeta.length];
    const atype = ACTIVITY_TYPES[i % ACTIVITY_TYPES.length];
    await db.query(
      `INSERT INTO activities (
         owner_id, contact_id, property_id, deal_id, activity_type,
         activity_date, notes, visibility
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'private')`,
      [
        userId,
        contactId,
        prop.id,
        i < dealIds.length ? dealIds[i % dealIds.length] : null,
        atype,
        daysAgo(randInt(0, 90)).toISOString(),
        `[Demo] ${atype} — ${pick(["Discussed renewal", "Left voicemail", "Sent comps", "Tour follow-up", "Ownership intro"])}`,
      ],
    );
  }

  // ── Follow-ups (manual + lease-linked) ─────────────────────────────────────
  console.log("Inserting follow-ups…");
  for (let i = 0; i < 18; i++) {
    const contactId = ownerContactIds[i % ownerContactIds.length];
    const prop = propertyMeta[i * 3 % propertyMeta.length];
    await db.query(
      `INSERT INTO follow_ups (
         owner_id, contact_id, property_id, due_date, description,
         done, source_type, visibility
       ) VALUES ($1,$2,$3,$4,$5,false,'seed:demo','private')`,
      [
        userId,
        contactId,
        prop.id,
        daysFromNow(randInt(-5, 20)),
        `[Demo] ${pick(["Call owner re: vacancy", "Send tour package", "Confirm mailing address", "Ask about sibling assets", "Schedule coffee"])}`,
      ],
    );
  }

  for (const lease of leaseIds.filter((l) => ["30", "60", "90"].includes(l.bucket)).slice(0, 20)) {
    await db.query(
      `INSERT INTO follow_ups (
         owner_id, contact_id, property_id, lease_id, lease_bucket,
         due_date, description, done, source_type, visibility
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,false,'seed:demo','private')
       ON CONFLICT DO NOTHING`,
      [
        userId,
        lease.tenantContactId,
        lease.propertyId,
        lease.id,
        lease.bucket,
        lease.exp,
        `[Demo] Lease rollover (${lease.bucket}d) — outreach tenant/owner`,
      ],
    ).catch(async () => {
      await db.query(
        `INSERT INTO follow_ups (
           owner_id, contact_id, property_id, lease_id, lease_bucket,
           due_date, description, done, source_type, visibility
         )
         SELECT $1,$2,$3,$4,$5,$6,$7,false,'seed:demo','private'
         WHERE NOT EXISTS (
           SELECT 1 FROM follow_ups
           WHERE owner_id = $1 AND lease_id = $4 AND lease_bucket = $5 AND contact_id = $2
         )`,
        [
          userId,
          lease.tenantContactId,
          lease.propertyId,
          lease.id,
          lease.bucket,
          lease.exp,
          `[Demo] Lease rollover (${lease.bucket}d) — outreach tenant/owner`,
        ],
      );
    });
  }

  // Counts
  const counts: Record<string, number> = {};
  for (const t of [
    "properties",
    "contacts",
    "lease_abstracts",
    "deals",
    "activities",
    "follow_ups",
    "entities",
  ]) {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${t} WHERE owner_id = $1`,
      [userId],
    );
    counts[t] = rows[0].n;
  }

  console.log("\n── Demo account ready ─────────────────────────");
  console.log(`Email:    ${EMAIL}`);
  if (created) console.log(`Password: ${PASSWORD}`);
  else console.log("Password: (unchanged — use your existing password)");
  console.log(`User id:  ${userId}`);
  console.log("Counts:", counts);
  console.log("\nLog in at http://localhost:3000/login");
  console.log("Re-seed:  npm run seed:demo");
  console.log("Wipe only: SEED_DEMO_RESET=1 with empty seed… or DELETE WHERE source/lead_source = seed:demo\n");

  await db.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
