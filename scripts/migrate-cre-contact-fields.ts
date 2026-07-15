import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const SQL = `
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS title_role          TEXT,
  ADD COLUMN IF NOT EXISTS phone_mobile        TEXT,
  ADD COLUMN IF NOT EXISTS phone_office        TEXT,
  ADD COLUMN IF NOT EXISTS ownership_role      TEXT,
  ADD COLUMN IF NOT EXISTS asset_focus         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS submarket           TEXT,
  ADD COLUMN IF NOT EXISTS portfolio_size      TEXT,
  ADD COLUMN IF NOT EXISTS relationship_stage  TEXT,
  ADD COLUMN IF NOT EXISTS lead_source         TEXT,
  ADD COLUMN IF NOT EXISTS notes               TEXT;

-- Backfill from legacy columns (idempotent — only fills NULL rows)
UPDATE contacts SET title_role   = role                WHERE title_role IS NULL    AND role IS NOT NULL;
UPDATE contacts SET phone_mobile = phone               WHERE phone_mobile IS NULL  AND phone IS NOT NULL;
UPDATE contacts SET submarket    = geographic_category WHERE submarket IS NULL     AND geographic_category IS NOT NULL;
UPDATE contacts
  SET relationship_stage = CASE client_status
    WHEN 'prospect'      THEN 'prospect'
    WHEN 'active client' THEN 'active'
    WHEN 'past client'   THEN 'past_client'
    ELSE                      'dormant'
  END
WHERE relationship_stage IS NULL AND client_status IS NOT NULL;
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'contacts' ORDER BY ordinal_position"
  );
  console.log(
    "contacts columns:",
    rows.map((r: { column_name: string }) => r.column_name).join(", ")
  );
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
