import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const MIGRATION = `
-- ─── Ingestion error log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingestion_errors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_type   TEXT NOT NULL,   -- 'address' | 'url' | 'upload'
  stage         TEXT NOT NULL,   -- 'gis_fetch' | 'mdpa_fetch' | 'jina_fetch' | 'ai_extract' | 'db_save'
  source_ref    TEXT,            -- URL, filename, or address typed by broker
  error_message TEXT NOT NULL,
  error_detail  JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_ingestion_errors_owner
  ON ingestion_errors (owner_id, occurred_at DESC);

ALTER TABLE ingestion_errors ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ingestion_errors' AND policyname = 'owner select'
  ) THEN
    CREATE POLICY "owner select" ON ingestion_errors
      FOR SELECT USING (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ingestion_errors' AND policyname = 'owner insert'
  ) THEN
    CREATE POLICY "owner insert" ON ingestion_errors
      FOR INSERT WITH CHECK (auth.uid() = owner_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ingestion_errors' AND policyname = 'owner delete'
  ) THEN
    CREATE POLICY "owner delete" ON ingestion_errors
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
    WHERE table_schema = 'public' AND table_name = 'ingestion_errors'
  `);
  const colCount = parseInt(rows[0].col_count, 10);
  if (colCount === 0) {
    console.error("Table ingestion_errors not found after migration.");
    process.exit(1);
  }
  console.log(`\n✓ ingestion_errors (${colCount} columns, RLS enabled)`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
