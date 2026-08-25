import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

// Persists the result of a broker-run zoning lookup (lib/zoning.ts) onto the
// property row, so the dashboard's action-item signals (lib/action-item-
// signals.ts) can flag a zoning-opportunity without re-querying external GIS
// services on every dashboard load. Only zoning_far is used for that signal
// today (Massachusetts is the only region with real numeric FAR data) — the
// other columns exist so the property page can show what was last looked up
// without re-fetching.
const SQL = `
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS zoning_code TEXT,
  ADD COLUMN IF NOT EXISTS zoning_far NUMERIC,
  ADD COLUMN IF NOT EXISTS zoning_source TEXT,
  ADD COLUMN IF NOT EXISTS zoning_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS properties_zoning_far
  ON properties (owner_id, zoning_far)
  WHERE zoning_far IS NOT NULL;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='properties' ORDER BY ordinal_position"
  );
  console.log("properties columns:", rows.map((r: { column_name: string }) => r.column_name).join(", "));
  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
