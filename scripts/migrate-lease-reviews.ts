import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

const SQL = `
ALTER TABLE lease_abstracts
  ADD COLUMN IF NOT EXISTS field_reviews JSONB NOT NULL DEFAULT '{}';
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='lease_abstracts' ORDER BY ordinal_position"
  );
  console.log("lease_abstracts columns:", rows.map((r: { column_name: string }) => r.column_name).join(", "));
  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
