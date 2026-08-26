import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

// Saved lead-finder "buy box" criteria (see lib/lead-finder.ts). A personal,
// per-broker saved search preset — not a shared CRM record — so this follows
// smart_lists' simple owner-only RLS rather than the team-visibility pattern
// used for properties/contacts/etc.
const SQL = `
CREATE TABLE IF NOT EXISTS lead_buy_boxes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  criteria    JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lead_buy_boxes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_buy_boxes_owner ON lead_buy_boxes;
CREATE POLICY lead_buy_boxes_owner ON lead_buy_boxes
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS lead_buy_boxes_owner ON lead_buy_boxes (owner_id, updated_at DESC);
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='lead_buy_boxes' ORDER BY ordinal_position"
  );
  console.log("lead_buy_boxes columns:", rows.map((r: { column_name: string }) => r.column_name).join(", "));
  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
