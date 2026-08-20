import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Team multi-tenancy Phase 2, table 3 of 7 — follow_ups. Splits the single
 * follow_ups_owner FOR ALL policy into an owner-only INSERT and an
 * owner-or-teammate SELECT/UPDATE/DELETE, same shape as activities/documents.
 */
const MIGRATION = `
DROP POLICY IF EXISTS follow_ups_owner ON follow_ups;
DROP POLICY IF EXISTS follow_ups_owner_insert ON follow_ups;
DROP POLICY IF EXISTS follow_ups_owner_or_teammate_select ON follow_ups;
DROP POLICY IF EXISTS follow_ups_owner_or_teammate_update ON follow_ups;
DROP POLICY IF EXISTS follow_ups_owner_or_teammate_delete ON follow_ups;

CREATE POLICY follow_ups_owner_insert ON follow_ups
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY follow_ups_owner_or_teammate_select ON follow_ups
  FOR SELECT USING (
    owner_id = auth.uid()
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );

CREATE POLICY follow_ups_owner_or_teammate_update ON follow_ups
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );

CREATE POLICY follow_ups_owner_or_teammate_delete ON follow_ups
  FOR DELETE USING (
    owner_id = auth.uid()
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

  console.log("\nRewriting follow_ups RLS for team visibility...");
  await client.query(MIGRATION);
  console.log("Done.");

  const { rows } = await client.query(
    `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'follow_ups' ORDER BY policyname`
  );
  for (const r of rows) console.log(`✓ ${r.policyname} (${r.cmd})`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
