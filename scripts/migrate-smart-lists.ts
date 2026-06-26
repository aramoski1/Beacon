import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

const SQL = `
CREATE TABLE IF NOT EXISTS smart_lists (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  query_text  TEXT        NOT NULL,
  filters     JSONB       NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'contacts',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE smart_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS smart_lists_owner ON smart_lists;
CREATE POLICY smart_lists_owner ON smart_lists
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS smart_lists_owner ON smart_lists (owner_id, updated_at DESC);
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='smart_lists' ORDER BY ordinal_position"
  );
  console.log("smart_lists columns:", rows.map((r: { column_name: string }) => r.column_name).join(", "));
  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
