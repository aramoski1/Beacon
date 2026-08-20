import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Team multi-tenancy Phase 2, table 6 of 7 — contacts. One of the two
 * tables Beacon_Team_Multitenancy_Plan.md §8 flags for extra scrutiny
 * (a broker's contact book is arguably the single most sensitive,
 * career-defining data in the app). Same additive-only pattern as every
 * other table — nothing structurally different here, which is itself the
 * point: no special-case logic for the sensitive tables, just the same
 * reviewed pattern applied carefully.
 */
const MIGRATION = `
DROP POLICY IF EXISTS "owner select" ON contacts;
DROP POLICY IF EXISTS "owner update" ON contacts;
DROP POLICY IF EXISTS "owner delete" ON contacts;
DROP POLICY IF EXISTS contacts_owner_or_teammate_select ON contacts;
DROP POLICY IF EXISTS contacts_owner_or_teammate_update ON contacts;
DROP POLICY IF EXISTS contacts_owner_or_teammate_delete ON contacts;

CREATE POLICY contacts_owner_or_teammate_select ON contacts
  FOR SELECT USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );

CREATE POLICY contacts_owner_or_teammate_update ON contacts
  FOR UPDATE USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  ) WITH CHECK (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );

CREATE POLICY contacts_owner_or_teammate_delete ON contacts
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

  console.log("\nRewriting contacts RLS for team visibility...");
  await client.query(MIGRATION);
  console.log("Done.");

  const { rows } = await client.query(
    `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'contacts' ORDER BY policyname`
  );
  for (const r of rows) console.log(`✓ ${r.policyname} (${r.cmd})`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
