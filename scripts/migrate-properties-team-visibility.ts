import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Team multi-tenancy Phase 2, table 7 of 7 (LAST, by design) — properties.
 * The other table Beacon_Team_Multitenancy_Plan.md §8 flags for extra
 * scrutiny. Same additive-only OR-clause pattern proven six times over on
 * the other candidate tables — deliberately no special-casing here either.
 * This is the last table in Phase 2; once this lands and is verified, every
 * candidate table from the plan's resolved decision #3 has team-visibility RLS.
 */
const MIGRATION = `
DROP POLICY IF EXISTS "owner select" ON properties;
DROP POLICY IF EXISTS "owner update" ON properties;
DROP POLICY IF EXISTS "owner delete" ON properties;
DROP POLICY IF EXISTS properties_owner_or_teammate_select ON properties;
DROP POLICY IF EXISTS properties_owner_or_teammate_update ON properties;
DROP POLICY IF EXISTS properties_owner_or_teammate_delete ON properties;

CREATE POLICY properties_owner_or_teammate_select ON properties
  FOR SELECT USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );

CREATE POLICY properties_owner_or_teammate_update ON properties
  FOR UPDATE USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  ) WITH CHECK (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );

CREATE POLICY properties_owner_or_teammate_delete ON properties
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

  console.log("\nRewriting properties RLS for team visibility...");
  await client.query(MIGRATION);
  console.log("Done.");

  const { rows } = await client.query(
    `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'properties' ORDER BY policyname`
  );
  for (const r of rows) console.log(`✓ ${r.policyname} (${r.cmd})`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
