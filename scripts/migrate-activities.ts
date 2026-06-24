import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const MIGRATION = `
-- ─── Activities ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id   UUID REFERENCES properties(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('letter', 'email', 'call', 'note', 'meeting')),
  activity_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activities_contact_date
  ON activities (owner_id, contact_id, activity_date DESC);

CREATE INDEX IF NOT EXISTS activities_property_date
  ON activities (owner_id, property_id, activity_date DESC)
  WHERE property_id IS NOT NULL;

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'activities' AND policyname = 'activities_owner_select'
  ) THEN
    CREATE POLICY activities_owner_select ON activities
      FOR SELECT USING (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'activities' AND policyname = 'activities_owner_insert'
  ) THEN
    CREATE POLICY activities_owner_insert ON activities
      FOR INSERT WITH CHECK (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'activities' AND policyname = 'activities_owner_delete'
  ) THEN
    CREATE POLICY activities_owner_delete ON activities
      FOR DELETE USING (auth.uid() = owner_id);
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

  console.log("\nRunning migration...");
  await client.query(MIGRATION);
  console.log("Migration complete.");

  const { rows } = await client.query(`
    SELECT COUNT(*) AS col_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activities'
  `);
  const colCount = parseInt(rows[0].col_count, 10);
  if (colCount === 0) {
    console.error("Table activities not found after migration.");
    process.exit(1);
  }
  console.log(`\n✓ activities (${colCount} columns, RLS enabled)`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
