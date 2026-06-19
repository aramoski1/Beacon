import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const MIGRATION = `
-- ─── Properties ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS properties (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  address               TEXT,
  city                  TEXT,
  submarket             TEXT,
  geographic_category   TEXT,
  geographic_descriptor TEXT,
  owner_name            TEXT,
  ownership_type        TEXT,
  size_sqft             INTEGER,
  size_category         TEXT,
  property_type         TEXT,
  building_composition  JSONB DEFAULT '{}',
  last_sale_date        DATE,
  last_sale_price       NUMERIC,
  source                TEXT,
  source_url            TEXT,
  ingested_at           TIMESTAMPTZ DEFAULT now(),
  confidence_flags      JSONB DEFAULT '[]',
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- ─── Contacts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT,
  company           TEXT,
  role              TEXT,
  email             TEXT,
  phone             TEXT,
  contact_tier      SMALLINT CHECK (contact_tier IN (1, 2, 3)),
  client_status     TEXT,
  linked_properties UUID[] DEFAULT '{}',
  action_tags       TEXT[]  DEFAULT '{}',
  last_contacted_at TIMESTAMPTZ,
  next_action_due   TIMESTAMPTZ,
  cadence           TEXT,
  outreach_history  JSONB DEFAULT '[]',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ─── Lease abstracts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lease_abstracts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  linked_property  UUID REFERENCES properties(id) ON DELETE SET NULL,
  execution_date   DATE,
  expiration_date  DATE,
  term             TEXT,
  base_rate        NUMERIC,
  escalations      JSONB DEFAULT '[]',
  options          JSONB DEFAULT '[]',
  key_provisions   JSONB DEFAULT '[]',
  source_document  TEXT,
  field_citations  JSONB DEFAULT '[]',
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_properties_owner      ON properties      (owner_id);
CREATE INDEX IF NOT EXISTS idx_contacts_owner        ON contacts        (owner_id);
CREATE INDEX IF NOT EXISTS idx_lease_abstracts_owner ON lease_abstracts (owner_id);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE properties      ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lease_abstracts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Properties
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='properties' AND policyname='owner select') THEN
    CREATE POLICY "owner select" ON properties FOR SELECT USING (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='properties' AND policyname='owner insert') THEN
    CREATE POLICY "owner insert" ON properties FOR INSERT WITH CHECK (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='properties' AND policyname='owner update') THEN
    CREATE POLICY "owner update" ON properties FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='properties' AND policyname='owner delete') THEN
    CREATE POLICY "owner delete" ON properties FOR DELETE USING (auth.uid() = owner_id);
  END IF;

  -- Contacts
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contacts' AND policyname='owner select') THEN
    CREATE POLICY "owner select" ON contacts FOR SELECT USING (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contacts' AND policyname='owner insert') THEN
    CREATE POLICY "owner insert" ON contacts FOR INSERT WITH CHECK (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contacts' AND policyname='owner update') THEN
    CREATE POLICY "owner update" ON contacts FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contacts' AND policyname='owner delete') THEN
    CREATE POLICY "owner delete" ON contacts FOR DELETE USING (auth.uid() = owner_id);
  END IF;

  -- Lease abstracts
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lease_abstracts' AND policyname='owner select') THEN
    CREATE POLICY "owner select" ON lease_abstracts FOR SELECT USING (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lease_abstracts' AND policyname='owner insert') THEN
    CREATE POLICY "owner insert" ON lease_abstracts FOR INSERT WITH CHECK (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lease_abstracts' AND policyname='owner update') THEN
    CREATE POLICY "owner update" ON lease_abstracts FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lease_abstracts' AND policyname='owner delete') THEN
    CREATE POLICY "owner delete" ON lease_abstracts FOR DELETE USING (auth.uid() = owner_id);
  END IF;
END $$;
`;

const VERIFY = `
SELECT
  t.table_name,
  COUNT(c.column_name)::int AS column_count,
  obj_description(pc.oid, 'pg_class') AS description
FROM information_schema.tables t
JOIN information_schema.columns c
  ON c.table_name = t.table_name AND c.table_schema = t.table_schema
JOIN pg_class pc
  ON pc.relname = t.table_name
WHERE t.table_schema = 'public'
  AND t.table_name IN ('properties', 'contacts', 'lease_abstracts')
GROUP BY t.table_name, pc.oid
ORDER BY t.table_name;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nRunning migration...");
  await client.query(MIGRATION);
  console.log("Migration complete.");

  console.log("\nVerifying tables:");
  const { rows } = await client.query(VERIFY);

  if (rows.length === 0) {
    console.error("No tables found — something went wrong.");
    process.exit(1);
  }

  for (const row of rows) {
    console.log(`  ✓ ${row.table_name} (${row.column_count} columns)`);
  }

  const expected = ["contacts", "lease_abstracts", "properties"];
  const found = rows.map((r: { table_name: string }) => r.table_name).sort();
  const missing = expected.filter((t) => !found.includes(t));
  if (missing.length > 0) {
    console.error(`\nMissing tables: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log("\nAll 3 tables exist with RLS enabled.");
  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
