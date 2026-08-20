import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Team multi-tenancy — supporting piece for Phase 4's ownership indicator
 * (Beacon_Team_Multitenancy_Plan.md §7.4): showing "whose record is this"
 * in Entire-firm scope needs a teammate's display name, but user_settings
 * stays owner-only RLS (Phase 2 deliberately excluded it — it's personal
 * profile/preference data, not a CRE business record). Rather than opening
 * up the whole user_settings row to teammates, this is a narrow SECURITY
 * DEFINER function that returns ONLY {user_id, display_name} for the
 * caller's active firm's teammates — nothing else from user_settings
 * (license_number, phone, cadence settings, costar_enabled, etc.) is ever
 * exposed this way.
 */
const MIGRATION = `
CREATE OR REPLACE FUNCTION firm_teammate_names()
RETURNS TABLE(user_id uuid, display_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
  SELECT them.user_id, us.display_name
  FROM firm_members me
  JOIN firm_members them ON me.firm_id = them.firm_id AND them.status = 'active'
  LEFT JOIN user_settings us ON us.owner_id = them.user_id
  WHERE me.user_id = auth.uid() AND me.status = 'active';
$fn$;

GRANT EXECUTE ON FUNCTION firm_teammate_names() TO authenticated;
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nCreating firm_teammate_names()...");
  await client.query(MIGRATION);
  console.log("Done.");

  const { rows } = await client.query(`SELECT proname FROM pg_proc WHERE proname = 'firm_teammate_names'`);
  console.log(`✓ firm_teammate_names() ${rows.length > 0 ? "present" : "MISSING"}`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
