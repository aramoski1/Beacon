import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Team multi-tenancy Phase 3 — documents storage BUCKET RLS. Sequenced
 * strictly after the documents TABLE's own RLS (Phase 2), per
 * Beacon_Team_Multitenancy_Plan.md §5.2: storage.objects has no app-level
 * concept of "team visible" in its path (`${owner_id}/${entity_type}/
 * ${entity_id}/${ts}-${name}`, from lib/documents.ts) the way table rows
 * do — the visibility flag lives on the `documents` row, keyed by
 * `storage_path`. So this policy joins storage.objects to documents on
 * name = storage_path, which is a structurally different (and more
 * fragile — the plan's own words) shape than every other table RLS
 * change in this feature. INSERT stays owner-only: there's no scenario
 * where a teammate needs to upload directly into someone else's folder —
 * they upload under their own owner_id path, and that new documents row
 * becomes team-visible on its own once shared.
 */
const MIGRATION = `
DROP POLICY IF EXISTS "document owner select" ON storage.objects;
DROP POLICY IF EXISTS "document owner update" ON storage.objects;
DROP POLICY IF EXISTS "document owner delete" ON storage.objects;

CREATE POLICY "document owner or teammate select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documents' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.storage_path = name
          AND d.visibility = 'team'
          AND is_firm_teammate(d.owner_id)
      )
    )
  );

CREATE POLICY "document owner or teammate update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'documents' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.storage_path = name
          AND d.visibility = 'team'
          AND is_firm_teammate(d.owner_id)
      )
    )
  );

CREATE POLICY "document owner or teammate delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'documents' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.storage_path = name
          AND d.visibility = 'team'
          AND is_firm_teammate(d.owner_id)
      )
    )
  );
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nRewriting documents storage bucket RLS for team visibility...");
  await client.query(MIGRATION);
  console.log("Done.");

  const { rows } = await client.query(
    `SELECT policyname, cmd FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'document %'
     ORDER BY policyname`
  );
  for (const r of rows) console.log(`✓ ${r.policyname} (${r.cmd})`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
