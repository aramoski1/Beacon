import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Fixes two real bugs in migrate-firms.ts, caught by
 * tests/security/team-firm-isolation.test.ts before Phase 2 (RLS on the
 * existing 16 tables) began — exactly the kind of mistake
 * Beacon_Team_Multitenancy_Plan.md §5.1 flagged firm_members' own RLS as
 * the highest-risk piece to get wrong:
 *
 * 1. firm_members_roster_select and firm_members_admin_manage queried
 *    firm_members from within their own USING clause — the classic
 *    self-referencing-policy trap. Postgres RLS on a self-referencing
 *    subquery has to re-evaluate the same policy to filter the subquery's
 *    own rows, which re-triggers the subquery, forever: "infinite
 *    recursion detected in policy for relation firm_members" (Postgres
 *    error 42P17). Fixed the same way is_firm_teammate() already avoids
 *    this for the other 16 tables: a SECURITY DEFINER lookup function,
 *    whose internal query runs with the function owner's privileges and
 *    so never re-triggers RLS at all.
 *
 * 2. firms.created_by had no ON DELETE CASCADE, unlike every other
 *    owner_id-style FK in this schema — deleting a test (or real) auth
 *    user whose firms row still existed failed with a FK violation
 *    instead of cascading cleanly.
 *
 * Also fixes a bootstrap deadlock this recursion masked: a brand-new
 * user's firms row (just inserted by them) wasn't visible back to them
 * under the original firms_member_select policy, because at that instant
 * they have no active firm_members row yet — my_active_firm_id() legitimately
 * returns null until the *next* insert (into firm_members) completes. Fixed
 * by also allowing a user to see firms they created themselves.
 */
const MIGRATION = `
DROP POLICY IF EXISTS firms_member_select ON firms;
DROP POLICY IF EXISTS firms_owner_update ON firms;
DROP POLICY IF EXISTS firm_members_roster_select ON firm_members;
DROP POLICY IF EXISTS firm_members_admin_manage ON firm_members;

ALTER TABLE firms DROP CONSTRAINT IF EXISTS firms_created_by_fkey;
ALTER TABLE firms ADD CONSTRAINT firms_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION my_active_firm_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
  SELECT firm_id FROM firm_members WHERE user_id = auth.uid() AND status = 'active' LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION my_role_in_firm(target_firm_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
  SELECT role FROM firm_members
  WHERE user_id = auth.uid() AND firm_id = target_firm_id AND status = 'active'
  LIMIT 1;
$fn$;

CREATE POLICY firms_member_select ON firms
  FOR SELECT USING (id = my_active_firm_id() OR created_by = auth.uid());

CREATE POLICY firms_owner_update ON firms
  FOR UPDATE USING (my_role_in_firm(id) = 'owner')
  WITH CHECK (my_role_in_firm(id) = 'owner');

CREATE POLICY firm_members_roster_select ON firm_members
  FOR SELECT USING (firm_id = my_active_firm_id());

CREATE POLICY firm_members_admin_manage ON firm_members
  FOR UPDATE USING (user_id = auth.uid() OR my_role_in_firm(firm_id) IN ('owner', 'admin'))
  WITH CHECK (user_id = auth.uid() OR my_role_in_firm(firm_id) IN ('owner', 'admin'));
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nFixing firm_members/firms recursion + created_by cascade...");
  await client.query(MIGRATION);
  console.log("Done.");

  const { rows } = await client.query(
    `SELECT proname FROM pg_proc WHERE proname IN ('my_active_firm_id', 'my_role_in_firm') ORDER BY proname`
  );
  for (const r of rows) console.log(`✓ ${r.proname}() present`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
