import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

const SQL = `
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS ownership_change_detected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ownership_change_data JSONB;

CREATE INDEX IF NOT EXISTS properties_ownership_change
  ON properties (owner_id, ownership_change_detected_at)
  WHERE ownership_change_detected_at IS NOT NULL;
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
