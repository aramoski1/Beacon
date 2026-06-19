import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const SQL = `
-- Create the leases bucket (32 MB limit, PDFs only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('leases', 'leases', false, 33554432, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- RLS: brokers can only access their own folder ({owner_id}/filename.pdf)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'lease owner insert'
  ) THEN
    CREATE POLICY "lease owner insert" ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'leases' AND
        (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'lease owner select'
  ) THEN
    CREATE POLICY "lease owner select" ON storage.objects
      FOR SELECT USING (
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
  const { rows } = await verify.query(
    `SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'leases'`
  );
  if (rows.length === 0) { console.error("Bucket not found after setup."); process.exit(1); }
  console.log(`✓ Storage bucket '${rows[0].name}' ready (limit: ${rows[0].file_size_limit / 1024 / 1024} MB, public: ${rows[0].public})`);

  const { rows: policies } = await verify.query(
    `SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'lease owner%'`
  );
  for (const p of policies) console.log(`✓ RLS policy: ${p.policyname}`);
  await verify.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
