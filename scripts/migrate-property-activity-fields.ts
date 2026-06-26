import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const MIGRATION = `
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS owner_email          TEXT,
  ADD COLUMN IF NOT EXISTS last_activity_date   TEXT,
  ADD COLUMN IF NOT EXISTS last_activity_type   TEXT,
  ADD COLUMN IF NOT EXISTS last_activity_notes  TEXT;
`;

const VERIFY = `
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'properties'
  AND column_name IN ('owner_email', 'last_activity_date', 'last_activity_type', 'last_activity_notes');
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nRunning migration...");
  await client.query(MIGRATION);
  console.log("Migration complete.");

  const { rows } = await client.query(VERIFY);
  for (const col of ["owner_email", "last_activity_date", "last_activity_type", "last_activity_notes"]) {
    if (rows.some((r) => r.column_name === col)) {
      console.log(`  ✓ properties.${col}`);
    } else {
      console.error(`  ✗ properties.${col} — NOT FOUND`);
      process.exit(1);
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
