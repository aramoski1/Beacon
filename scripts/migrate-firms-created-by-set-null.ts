import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Fixes a real design bug in migrate-firms-fix-recursion.ts's earlier
 * change: it made firms.created_by ON DELETE CASCADE to fix "can't delete
 * a user who created a firm" — but CASCADE on firms means deleting the
 * CREATOR deletes the firms row itself, which then cascades firm_members
 * for every OTHER member too (firm_members.firm_id ON DELETE CASCADE) —
 * so deleting a firm's owner would silently kick every teammate out of
 * the firm entirely, contradicting the plan's own departure semantics
 * (§3.2: leaving reverts that one person's visibility, nothing else).
 *
 * Caught by extending tests/security/account-deletion.test.ts's seeding
 * to a firm+teammate scenario, per the plan's own §9 item 8 — before this
 * fix, deleting the firm owner in that test would have deleted the
 * survivor's firm_members row too.
 *
 * Fix: created_by becomes nullable, ON DELETE SET NULL — same pattern as
 * invited_by. The firms row (the organization) survives its creator's
 * account being deleted; only the attribution is lost. A firm left with
 * zero owners after this (if the deleted user was its only owner) is a
 * known, documented edge case this migration does not attempt to solve —
 * remaining admins can still manage membership via firm_members_admin_manage,
 * just not the owner-only firms_owner_update action, until someone is
 * promoted (a future feature, not a data-integrity issue).
 */
const MIGRATION = `
ALTER TABLE firms ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE firms DROP CONSTRAINT IF EXISTS firms_created_by_fkey;
ALTER TABLE firms ADD CONSTRAINT firms_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nFixing firms.created_by to ON DELETE SET NULL (was CASCADE)...");
  await client.query(MIGRATION);
  console.log("Done.");

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
