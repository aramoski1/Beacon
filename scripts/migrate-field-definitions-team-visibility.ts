import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Team multi-tenancy — field_definitions, resolved decision #5
 * (Beacon_Team_Multitenancy_Plan.md §11): firm-wide by default, NOT
 * opt-in-shared like the other seven tables. No visibility column here —
 * there's nothing to toggle. A shared deal/property with teammates using
 * different custom-field schemas would be more confusing than useful, so
 * consistency across the firm wins over per-broker schema privacy.
 *
 * INSERT stays owner-only (whoever adds a field is recorded as its
 * owner_id), but that's sufficient — once inserted, is_firm_teammate()
 * makes it immediately visible AND manageable (rename/delete) to every
 * active teammate via the SELECT/UPDATE/DELETE OR-clause, unconditionally
 * (no visibility check, unlike the other tables).
 */
const MIGRATION = `
DROP POLICY IF EXISTS "owner select" ON field_definitions;
DROP POLICY IF EXISTS field_definitions_owner_update ON field_definitions;
DROP POLICY IF EXISTS "owner delete" ON field_definitions;

CREATE POLICY field_definitions_owner_or_teammate_select ON field_definitions
  FOR SELECT USING (
    auth.uid() = owner_id OR is_firm_teammate(owner_id)
  );

CREATE POLICY field_definitions_owner_or_teammate_update ON field_definitions
  FOR UPDATE USING (
    auth.uid() = owner_id OR is_firm_teammate(owner_id)
  ) WITH CHECK (
    auth.uid() = owner_id OR is_firm_teammate(owner_id)
  );

CREATE POLICY field_definitions_owner_or_teammate_delete ON field_definitions
  FOR DELETE USING (
    auth.uid() = owner_id OR is_firm_teammate(owner_id)
  );
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nRewriting field_definitions RLS for firm-wide visibility...");
  await client.query(MIGRATION);
  console.log("Done.");

  const { rows } = await client.query(
    `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'field_definitions' ORDER BY policyname`
  );
  for (const r of rows) console.log(`✓ ${r.policyname} (${r.cmd})`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
