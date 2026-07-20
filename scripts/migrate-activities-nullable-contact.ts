import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

// Make contact_id nullable so property-only activities (drive-bys, tours with
// no contact) can be logged. Enforce that at least one of contact_id or
// property_id is non-null via a CHECK constraint.
const MIGRATION = `
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'activities'
      AND column_name  = 'contact_id'
      AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE activities ALTER COLUMN contact_id DROP NOT NULL;
    RAISE NOTICE 'contact_id: dropped NOT NULL';
  ELSE
    RAISE NOTICE 'contact_id: already nullable, skipping';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname    = 'activities_contact_or_property'
      AND conrelid   = 'activities'::regclass
  ) THEN
    ALTER TABLE activities
      ADD CONSTRAINT activities_contact_or_property
      CHECK (contact_id IS NOT NULL OR property_id IS NOT NULL);
    RAISE NOTICE 'CHECK constraint activities_contact_or_property added';
  ELSE
    RAISE NOTICE 'CHECK constraint activities_contact_or_property already exists, skipping';
  END IF;
END $$;
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nRunning migration...");
  await client.query(MIGRATION);
  console.log("Migration complete.");

  // Verify
  const { rows: col } = await client.query(`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'activities'
      AND column_name  = 'contact_id'
  `);
  const { rows: ck } = await client.query(`
    SELECT 1 FROM pg_constraint
    WHERE conname  = 'activities_contact_or_property'
      AND conrelid = 'activities'::regclass
  `);

  const nullable = col[0]?.is_nullable === "YES";
  const hasCheck = ck.length > 0;

  if (!nullable) { console.error("✗ contact_id is still NOT NULL"); process.exit(1); }
  if (!hasCheck)  { console.error("✗ CHECK constraint missing");     process.exit(1); }

  console.log("✓ contact_id is nullable");
  console.log("✓ CHECK constraint activities_contact_or_property present");

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
