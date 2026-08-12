import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

// Generic media/document attachments for properties, leases, and contacts —
// a simple upload-and-reopen shelf, not tied to any extraction pipeline.
// entity_id is polymorphic (property/lease/contact) so it can't carry a real
// FK; owner-scoped RLS is what keeps it safe, same as field_definitions'
// entity_type/entity_id pair.
const SQL = `
CREATE TABLE IF NOT EXISTS documents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type  TEXT        NOT NULL CHECK (entity_type IN ('property', 'lease', 'contact')),
  entity_id    UUID        NOT NULL,
  file_name    TEXT        NOT NULL,
  storage_path TEXT        NOT NULL,
  content_type TEXT,
  size_bytes   BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'documents' AND policyname = 'documents_owner'
  ) THEN
    CREATE POLICY documents_owner ON documents FOR ALL USING (owner_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS documents_owner_entity ON documents (owner_id, entity_type, entity_id);

-- Storage bucket — 32 MB limit, common office/image/PDF types (mirrors the
-- leases bucket's shape, broader mime allowlist since uploads here aren't
-- always lease PDFs).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents', 'documents', false, 33554432,
  ARRAY[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp', 'image/heic',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
  ]
)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'document owner insert'
  ) THEN
    CREATE POLICY "document owner insert" ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'documents' AND
        (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'document owner select'
  ) THEN
    CREATE POLICY "document owner select" ON storage.objects
      FOR SELECT USING (
        bucket_id = 'documents' AND
        (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'document owner delete'
  ) THEN
    CREATE POLICY "document owner delete" ON storage.objects
      FOR DELETE USING (
        bucket_id = 'documents' AND
        (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'document owner update'
  ) THEN
    CREATE POLICY "document owner update" ON storage.objects
      FOR UPDATE USING (
        bucket_id = 'documents' AND
        (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);

  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='documents' ORDER BY ordinal_position"
  );
  console.log("documents columns:", rows.map((r: { column_name: string }) => r.column_name).join(", "));

  const { rows: bucketRows } = await client.query(
    `SELECT id, file_size_limit FROM storage.buckets WHERE id = 'documents'`
  );
  if (bucketRows.length === 0) { console.error("documents bucket not found after setup."); process.exit(1); }
  console.log(`✓ Storage bucket 'documents' ready (limit: ${bucketRows[0].file_size_limit / 1024 / 1024} MB)`);

  const { rows: policies } = await client.query(
    `SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'document owner%' ORDER BY policyname`
  );
  for (const p of policies) console.log(`✓ RLS policy: ${p.policyname}`);

  await client.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
