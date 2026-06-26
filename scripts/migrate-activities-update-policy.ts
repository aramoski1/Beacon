import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const MIGRATION = `
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'activities' AND policyname = 'activities_owner_update'
  ) THEN
    CREATE POLICY activities_owner_update ON activities
      FOR UPDATE USING (auth.uid() = owner_id);
  END IF;
END $$;
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected.");
  await client.query(MIGRATION);
  console.log("✓ activities — owner UPDATE policy applied (idempotent)");
  await client.end();
}

main().catch((err) => { console.error(err.message); process.exit(1); });
