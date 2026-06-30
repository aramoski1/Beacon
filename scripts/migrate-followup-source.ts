import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

const SQL = `
ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS lease_id    UUID REFERENCES lease_abstracts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS lease_bucket TEXT;

-- Prevent duplicate auto-follow-ups per (lease, bucket, contact)
CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_lease_dedup
  ON follow_ups (owner_id, lease_id, lease_bucket, contact_id)
  WHERE lease_id IS NOT NULL AND contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS follow_ups_lease_id ON follow_ups (lease_id) WHERE lease_id IS NOT NULL;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='follow_ups' ORDER BY ordinal_position"
  );
  console.log("follow_ups columns:", rows.map((r: { column_name: string }) => r.column_name).join(", "));
  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
