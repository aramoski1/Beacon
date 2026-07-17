import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const MIGRATION = `
-- ─── Deals / pursuit pipeline ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deals (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL,
  stage                TEXT        NOT NULL DEFAULT 'prospect'
                                   CHECK (stage IN (
                                     'prospect', 'contacted', 'meeting', 'requirement',
                                     'proposal', 'won', 'under_contract', 'closed', 'lost'
                                   )),
  contact_id           UUID        REFERENCES contacts(id)   ON DELETE SET NULL,
  property_id          UUID        REFERENCES properties(id) ON DELETE SET NULL,
  estimated_commission NUMERIC,
  notes                TEXT,
  next_action          TEXT,
  next_action_due      DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deals_owner_stage   ON deals (owner_id, stage);
CREATE INDEX IF NOT EXISTS deals_owner_updated ON deals (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS deals_contact_id    ON deals (contact_id)   WHERE contact_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS deals_property_id   ON deals (property_id)  WHERE property_id IS NOT NULL;

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'deals' AND policyname = 'deals_owner_all'
  ) THEN
    CREATE POLICY deals_owner_all ON deals
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

  console.log("\nRunning deals migration...");
  await client.query(MIGRATION);
  console.log("Migration complete.");

  const { rows } = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deals'
    ORDER BY ordinal_position
  `);
  const cols = rows.map((r: { column_name: string }) => r.column_name).join(", ");
  console.log(`\ndeals columns: ${cols}`);
  console.log(`✓ deals (${rows.length} columns, RLS enabled)`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
