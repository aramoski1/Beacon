import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const MIGRATION = `
-- ─── contact_properties join (replaces soft UUID[] links) ────────────────────
CREATE TABLE IF NOT EXISTS contact_properties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, property_id)
);

CREATE INDEX IF NOT EXISTS contact_properties_owner ON contact_properties (owner_id);
CREATE INDEX IF NOT EXISTS contact_properties_contact ON contact_properties (contact_id);
CREATE INDEX IF NOT EXISTS contact_properties_property ON contact_properties (property_id);
CREATE INDEX IF NOT EXISTS contact_properties_owner_property ON contact_properties (owner_id, property_id);

ALTER TABLE contact_properties ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'contact_properties' AND policyname = 'contact_properties_owner_all'
  ) THEN
    CREATE POLICY contact_properties_owner_all ON contact_properties
      FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
  END IF;
END $$;
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nRunning contact_properties migration...");
  await client.query(MIGRATION);
  console.log("Table + RLS ready.");

  console.log("\nBackfilling from contacts.linked_properties...");
  const { rowCount } = await client.query(`
    INSERT INTO contact_properties (owner_id, contact_id, property_id)
    SELECT c.owner_id, c.id, prop_id
    FROM contacts c
    CROSS JOIN LATERAL unnest(COALESCE(c.linked_properties, '{}'::uuid[])) AS prop_id
    WHERE prop_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM properties p
        WHERE p.id = prop_id AND p.owner_id = c.owner_id
      )
    ON CONFLICT (contact_id, property_id) DO NOTHING
  `);
  console.log(`  contact_properties inserted (new): ${rowCount ?? 0}`);

  const { rows } = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contact_properties'
    ORDER BY ordinal_position
  `);
  console.log(`\n✓ contact_properties (${rows.length} columns)`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
