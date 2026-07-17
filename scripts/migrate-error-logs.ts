// Creates the error_logs table for structured runtime error tracking.
// Idempotent — safe to re-run.
//
// Separate from ingestion_errors (pipeline-specific) — this table captures
// unexpected throws in server actions and API routes.

import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  console.log("Creating error_logs table...");

  await client.query(`
    CREATE TABLE IF NOT EXISTS error_logs (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      owner_id    UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
      action      TEXT        NOT NULL,
      severity    TEXT        NOT NULL DEFAULT 'error'
                              CHECK (severity IN ('error', 'warn')),
      message     TEXT        NOT NULL,
      stack       TEXT,
      context     JSONB       NOT NULL DEFAULT '{}',
      resolved_at TIMESTAMPTZ
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_error_logs_owner
      ON error_logs (owner_id, occurred_at DESC);

    CREATE INDEX IF NOT EXISTS idx_error_logs_unresolved
      ON error_logs (owner_id, occurred_at DESC)
      WHERE resolved_at IS NULL;
  `);

  await client.query(`ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;`);

  // Idempotent RLS policies
  for (const [name, sql] of [
    ["el_owner_select", `CREATE POLICY el_owner_select ON error_logs FOR SELECT USING (owner_id = auth.uid());`],
    ["el_owner_insert", `CREATE POLICY el_owner_insert ON error_logs FOR INSERT WITH CHECK (owner_id = auth.uid());`],
    ["el_owner_update", `CREATE POLICY el_owner_update ON error_logs FOR UPDATE USING (owner_id = auth.uid());`],
    ["el_owner_delete", `CREATE POLICY el_owner_delete ON error_logs FOR DELETE USING (owner_id = auth.uid());`],
  ] as const) {
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE tablename = 'error_logs' AND policyname = '${name}'
        ) THEN
          ${sql}
        END IF;
      END $$;
    `);
  }

  console.log("✓ error_logs table ready");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
