import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Team multi-tenancy Phase 2, table 2 of 7 — documents (table RLS only;
 * the documents storage BUCKET's team-visibility is Phase 3, a separate,
 * more fragile join-based policy sequenced after this table is proven).
 *
 * The original documents_owner was a single FOR ALL policy — splits it into
 * an owner-only INSERT (you can't attach a document as someone else) and an
 * owner-or-teammate SELECT/UPDATE/DELETE, matching every other table.
 */
const MIGRATION = `
DROP POLICY IF EXISTS documents_owner ON documents;
DROP POLICY IF EXISTS documents_owner_insert ON documents;
DROP POLICY IF EXISTS documents_owner_or_teammate_select ON documents;
DROP POLICY IF EXISTS documents_owner_or_teammate_update ON documents;
DROP POLICY IF EXISTS documents_owner_or_teammate_delete ON documents;

CREATE POLICY documents_owner_insert ON documents
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY documents_owner_or_teammate_select ON documents
  FOR SELECT USING (
    owner_id = auth.uid()
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );

CREATE POLICY documents_owner_or_teammate_update ON documents
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );

CREATE POLICY documents_owner_or_teammate_delete ON documents
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

  console.log("\nRewriting documents RLS for team visibility...");
  await client.query(MIGRATION);
  console.log("Done.");

  const { rows } = await client.query(
    `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'documents' ORDER BY policyname`
  );
  for (const r of rows) console.log(`✓ ${r.policyname} (${r.cmd})`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
