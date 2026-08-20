import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Team multi-tenancy Phase 2, table 5 of 7 — deals. Splits the single
 * deals_owner_all FOR ALL policy into an owner-only INSERT and an
 * owner-or-teammate SELECT/UPDATE/DELETE. This is arguably the table the
 * whole "work together" story is most about (a shared pipeline) — same
 * additive-only pattern as every other table, no special-casing.
 */
const MIGRATION = `
DROP POLICY IF EXISTS deals_owner_all ON deals;
DROP POLICY IF EXISTS deals_owner_insert ON deals;
DROP POLICY IF EXISTS deals_owner_or_teammate_select ON deals;
DROP POLICY IF EXISTS deals_owner_or_teammate_update ON deals;
DROP POLICY IF EXISTS deals_owner_or_teammate_delete ON deals;

CREATE POLICY deals_owner_insert ON deals
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY deals_owner_or_teammate_select ON deals
  FOR SELECT USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );

CREATE POLICY deals_owner_or_teammate_update ON deals
  FOR UPDATE USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  ) WITH CHECK (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );

CREATE POLICY deals_owner_or_teammate_delete ON deals
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

  console.log("\nRewriting deals RLS for team visibility...");
  await client.query(MIGRATION);
  console.log("Done.");

  const { rows } = await client.query(
    `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'deals' ORDER BY policyname`
  );
  for (const r of rows) console.log(`✓ ${r.policyname} (${r.cmd})`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
