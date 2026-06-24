import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const MIGRATION = `
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_mailing_address TEXT;
`;

const VERIFY = `
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'properties'
  AND column_name = 'owner_mailing_address';
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
    console.error("  ✗ owner_mailing_address — NOT FOUND");
    process.exit(1);
  }
  console.log("  ✓ properties.owner_mailing_address");

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
