import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const MIGRATION = `
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_contacts JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE properties
SET owner_contacts = jsonb_build_array(
  jsonb_build_object(
    'name', owner_contact_name,
    'title', '',
    'address', owner_contact_address
  )
)
WHERE owner_contact_name IS NOT NULL
  AND trim(owner_contact_name) <> ''
  AND (owner_contacts IS NULL OR owner_contacts = '[]'::jsonb);
`;

const VERIFY = `
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'properties'
  AND column_name = 'owner_contacts';
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nRunning migration...");
  await client.query(MIGRATION);
  console.log("Migration complete.");

  const { rows } = await client.query(VERIFY);
  if (rows.length === 0) {
    console.error("  ✗ owner_contacts — NOT FOUND");
    process.exit(1);
  }
  console.log("  ✓ properties.owner_contacts");

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
