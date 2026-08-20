import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Team multi-tenancy Phase 2, table 4 of 7 — lease_abstracts. Original
 * policies (migrate.ts) were four separate owner-only select/insert/
 * update/delete; INSERT stays untouched, SELECT/UPDATE/DELETE gain the
 * team-visibility OR-clause.
 */
const MIGRATION = `
DROP POLICY IF EXISTS "owner select" ON lease_abstracts;
DROP POLICY IF EXISTS "owner update" ON lease_abstracts;
DROP POLICY IF EXISTS "owner delete" ON lease_abstracts;
DROP POLICY IF EXISTS lease_abstracts_owner_or_teammate_select ON lease_abstracts;
DROP POLICY IF EXISTS lease_abstracts_owner_or_teammate_update ON lease_abstracts;
DROP POLICY IF EXISTS lease_abstracts_owner_or_teammate_delete ON lease_abstracts;

CREATE POLICY lease_abstracts_owner_or_teammate_select ON lease_abstracts
  FOR SELECT USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );

CREATE POLICY lease_abstracts_owner_or_teammate_update ON lease_abstracts
  FOR UPDATE USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  ) WITH CHECK (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );

CREATE POLICY lease_abstracts_owner_or_teammate_delete ON lease_abstracts
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

  console.log("\nRewriting lease_abstracts RLS for team visibility...");
  await client.query(MIGRATION);
  console.log("Done.");

  const { rows } = await client.query(
    `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'lease_abstracts' ORDER BY policyname`
  );
  for (const r of rows) console.log(`✓ ${r.policyname} (${r.cmd})`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
