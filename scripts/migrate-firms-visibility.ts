import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Team multi-tenancy Phase 1 (see Beacon_Team_Multitenancy_Plan.md §5
 * Principle 4, resolved decision #3): adds a `visibility` column, default
 * 'private', to the seven tables the plan decided are candidates for
 * team-sharing. RLS is untouched in this migration — every row stays
 * exactly as visible as it is today. `entity_*` tables, `error_logs`,
 * `ingestion_errors`, `smart_lists`, and `user_settings` are deliberately
 * excluded (personal/operational data, not CRE business records, or —
 * for entity_* — explicitly out of scope for v1).
 *
 * `field_definitions` is NOT in this list: per resolved decision #5 it's
 * firm-wide by default rather than opt-in-shared, so it needs no
 * visibility column at all — see migrate-firm-field-definitions-rls.ts.
 */
const TABLES = [
  "properties",
  "contacts",
  "lease_abstracts",
  "deals",
  "activities",
  "follow_ups",
  "documents",
] as const;

const MIGRATION = TABLES.map(
  (t) => `
ALTER TABLE ${t}
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'team'));

CREATE INDEX IF NOT EXISTS ${t}_visibility_owner
  ON ${t} (owner_id, visibility) WHERE visibility = 'team';
`
).join("\n");

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log(`\nAdding visibility column to ${TABLES.length} tables...`);
  await client.query(MIGRATION);
  console.log("Done.");

  for (const table of TABLES) {
    const { rows } = await client.query(
      `SELECT column_name, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'visibility'`,
      [table]
    );
    console.log(`✓ ${table}.visibility — ${rows.length > 0 ? `present, default ${rows[0].column_default}` : "MISSING"}`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
