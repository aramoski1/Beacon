import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const SQL = `
-- Tenant occupancy on lease abstracts (Tenant book)
ALTER TABLE lease_abstracts
  ADD COLUMN IF NOT EXISTS leased_sf numeric,
  ADD COLUMN IF NOT EXISTS landlord_name text;

-- This week's work list (pinned smart list + target count)
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS weekly_list_smart_list_id uuid,
  ADD COLUMN IF NOT EXISTS weekly_list_target integer NOT NULL DEFAULT 25;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  console.log("Tenant occupancy + weekly list settings ready.");
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
