import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const MIGRATION = `
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_contact_name TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_contact_address TEXT;
`;

const VERIFY = `
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'properties'
  AND column_name IN ('owner_contact_name', 'owner_contact_address')
ORDER BY column_name;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nRunning migration...");
  await client.query(MIGRATION);
  console.log("Migration complete.");

  const { rows } = await client.query(VERIFY);
  const cols = rows.map((r: { column_name: string }) => r.column_name);
  for (const col of ["owner_contact_address", "owner_contact_name"]) {
    if (!cols.includes(col)) {
      console.error(`  ✗ ${col} — NOT FOUND`);
      process.exit(1);
    }
    console.log(`  ✓ properties.${col}`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
