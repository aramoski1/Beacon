import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const SQL = `
-- Add custom_fields JSONB to entity tables
ALTER TABLE properties      ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';
ALTER TABLE contacts        ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';
ALTER TABLE lease_abstracts ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';

-- Broker-defined field definitions
CREATE TABLE IF NOT EXISTS field_definitions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type    TEXT NOT NULL CHECK (entity_type IN ('property', 'contact', 'lease')),
  field_name     TEXT NOT NULL,
  field_type     TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'select')),
  select_options JSONB DEFAULT NULL,
  fill_mode      TEXT CHECK (fill_mode IN ('extract', 'manual')),
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (owner_id, entity_type, field_name)
);

CREATE INDEX IF NOT EXISTS idx_field_defs_owner
  ON field_definitions (owner_id, entity_type);

ALTER TABLE field_definitions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='field_definitions' AND policyname='owner select') THEN
    CREATE POLICY "owner select" ON field_definitions FOR SELECT USING (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='field_definitions' AND policyname='owner insert') THEN
    CREATE POLICY "owner insert" ON field_definitions FOR INSERT WITH CHECK (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='field_definitions' AND policyname='owner delete') THEN
    CREATE POLICY "owner delete" ON field_definitions FOR DELETE USING (auth.uid() = owner_id);
  END IF;
END $$;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected to database.");

  await client.query(SQL);
  console.log("Migration complete.");

  const { rows: fdCols } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='field_definitions' ORDER BY ordinal_position"
  );
  console.log("field_definitions columns:", fdCols.map((r: { column_name: string }) => r.column_name).join(", "));

  const { rows: cfCols } = await client.query(`
    SELECT table_name
    FROM information_schema.columns
    WHERE column_name = 'custom_fields'
      AND table_name IN ('properties', 'contacts', 'lease_abstracts')
    ORDER BY table_name
  `);
  for (const row of cfCols) {
    console.log(`  ✓ ${row.table_name}.custom_fields`);
  }

  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
