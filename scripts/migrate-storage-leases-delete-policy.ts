import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

// setup-storage.ts only added INSERT/SELECT policies on storage.objects for the
// 'leases' bucket. Without a DELETE policy, app/settings/actions.ts deleteAllData()
// calling storage.from("leases").remove(...) is RLS-blocked and silently leaves
// uploaded lease PDFs behind after an account deletion. Add DELETE (and UPDATE,
// for parity/future use) scoped the same way as the existing policies.
const SQL = `
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'lease owner delete'
  ) THEN
    CREATE POLICY "lease owner delete" ON storage.objects
      FOR DELETE USING (
        bucket_id = 'leases' AND
        (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'lease owner update'
  ) THEN
    CREATE POLICY "lease owner update" ON storage.objects
      FOR UPDATE USING (
        bucket_id = 'leases' AND
        (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(SQL);
  await client.end();

  const verify = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await verify.connect();
  const { rows: policies } = await verify.query(
    `SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'lease owner%' ORDER BY policyname`
  );
  for (const p of policies) console.log(`✓ RLS policy: ${p.policyname}`);
  await verify.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
