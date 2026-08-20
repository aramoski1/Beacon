import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Team multi-tenancy Phase 2, table 1 of 7 (lowest-stakes first, per
 * Beacon_Team_Multitenancy_Plan.md §8). Adds the team-visibility OR-clause
 * to activities' SELECT/UPDATE/DELETE policies — additive only, the
 * existing `auth.uid() = owner_id` check is never removed, only extended.
 * INSERT stays owner-only (you can't create an activity as someone else).
 * Co-editable per the plan's resolved decision — a teammate can UPDATE a
 * 'team'-visible row, not just read it.
 */
const MIGRATION = `
DROP POLICY IF EXISTS activities_owner_select ON activities;
DROP POLICY IF EXISTS activities_owner_update ON activities;
DROP POLICY IF EXISTS activities_owner_delete ON activities;
DROP POLICY IF EXISTS activities_owner_or_teammate_select ON activities;
DROP POLICY IF EXISTS activities_owner_or_teammate_update ON activities;
DROP POLICY IF EXISTS activities_owner_or_teammate_delete ON activities;

CREATE POLICY activities_owner_or_teammate_select ON activities
  FOR SELECT USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );

CREATE POLICY activities_owner_or_teammate_update ON activities
  FOR UPDATE USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  ) WITH CHECK (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );

CREATE POLICY activities_owner_or_teammate_delete ON activities
  FOR DELETE USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nRewriting activities RLS for team visibility...");
  await client.query(MIGRATION);
  console.log("Done.");

  const { rows } = await client.query(
    `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'activities' ORDER BY policyname`
  );
  for (const r of rows) console.log(`✓ ${r.policyname} (${r.cmd})`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
