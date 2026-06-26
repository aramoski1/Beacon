import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

const SQL = `
ALTER TABLE smart_lists
  ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'contacts';

UPDATE smart_lists
SET entity_type = CASE
  WHEN (filters->>'target') = 'properties' THEN 'properties'
  WHEN (filters->>'target') = 'leases' THEN 'leases'
  ELSE 'contacts'
END
WHERE entity_type IS NULL OR entity_type = 'contacts';
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
