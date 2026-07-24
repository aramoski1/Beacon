import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

const SQL = `
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS ownership_watch_enrolled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ownership_last_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS properties_ownership_watch
  ON properties (owner_id, ownership_watch_enrolled_at)
  WHERE ownership_watch_enrolled_at IS NOT NULL;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  await client.end();
  console.log("ownership watch columns ready.");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
