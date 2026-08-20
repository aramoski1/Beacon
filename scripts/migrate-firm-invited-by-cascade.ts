import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Fixes a real bug caught by this test suite's own teardown (not a
 * contrived scenario): firm_members.invited_by and firm_invitations.
 * invited_by had no ON DELETE action, so deleting a user who had ever
 * invited a teammate failed with a foreign-key violation — which would
 * hit the real account-deletion flow (lib/account-deletion.ts) in
 * production the same way, not just this test's cleanup.
 *
 * invited_by is a pure audit/attribution field — nothing in this feature's
 * RLS reads it — so ON DELETE SET NULL is the right action: the
 * invitation/membership row stays valid and functional, it just loses the
 * "who invited them" breadcrumb once that person's account is gone.
 */
const MIGRATION = `
ALTER TABLE firm_members DROP CONSTRAINT IF EXISTS firm_members_invited_by_fkey;
ALTER TABLE firm_members ADD CONSTRAINT firm_members_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- firm_invitations.invited_by was NOT NULL — has to become nullable for
-- ON DELETE SET NULL to be satisfiable at all.
ALTER TABLE firm_invitations ALTER COLUMN invited_by DROP NOT NULL;
ALTER TABLE firm_invitations DROP CONSTRAINT IF EXISTS firm_invitations_invited_by_fkey;
ALTER TABLE firm_invitations ADD CONSTRAINT firm_invitations_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nFixing invited_by FKs to ON DELETE SET NULL...");
  await client.query(MIGRATION);
  console.log("Done.");

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
