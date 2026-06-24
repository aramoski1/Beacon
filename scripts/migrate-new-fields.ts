import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const MIGRATION = `
-- ─── Properties: new columns ──────────────────────────────────────────────────
ALTER TABLE properties ADD COLUMN IF NOT EXISTS prospect_number INTEGER;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS land_sqft       INTEGER;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS asset_description TEXT;

-- ─── Contacts: new columns ────────────────────────────────────────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS mailing_address TEXT;

-- ─── Backfill land_sqft from building_composition ─────────────────────────────
UPDATE properties
SET land_sqft = (building_composition->>'lot_size_sqft')::NUMERIC::INTEGER
WHERE building_composition IS NOT NULL
  AND building_composition->>'lot_size_sqft' IS NOT NULL
  AND land_sqft IS NULL;

-- ─── Backfill asset_description from building_composition ─────────────────────
UPDATE properties
SET asset_description = building_composition->>'dor_description'
WHERE building_composition IS NOT NULL
  AND building_composition->>'dor_description' IS NOT NULL
  AND asset_description IS NULL;

-- ─── Backfill prospect_number for existing rows (per-owner sequential) ────────
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at ASC NULLS LAST) AS rn
  FROM properties
  WHERE prospect_number IS NULL
)
UPDATE properties
SET prospect_number = ranked.rn
FROM ranked
WHERE properties.id = ranked.id;

-- ─── Trigger: auto-assign prospect_number on INSERT ───────────────────────────
CREATE OR REPLACE FUNCTION assign_prospect_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.prospect_number IS NULL THEN
    SELECT COALESCE(MAX(prospect_number), 0) + 1
    INTO NEW.prospect_number
    FROM properties
    WHERE owner_id = NEW.owner_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_assign_prospect_number ON properties;
CREATE TRIGGER trg_assign_prospect_number
  BEFORE INSERT ON properties
  FOR EACH ROW EXECUTE FUNCTION assign_prospect_number();
`;

const VERIFY = `
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('properties', 'contacts')
  AND column_name IN ('prospect_number', 'land_sqft', 'asset_description', 'mailing_address')
ORDER BY table_name, column_name;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nRunning migration...");
  await client.query(MIGRATION);
  console.log("Migration complete.");

  console.log("\nVerifying new columns:");
  const { rows } = await client.query(VERIFY);

  const expected = ["prospect_number", "land_sqft", "asset_description", "mailing_address"];
  const found = rows.map((r: { column_name: string }) => r.column_name);

  for (const col of expected) {
    if (found.includes(col)) {
      console.log(`  ✓ ${col}`);
    } else {
      console.error(`  ✗ ${col} — NOT FOUND`);
    }
  }

  const missing = expected.filter((c) => !found.includes(c));
  if (missing.length > 0) {
    console.error(`\nMissing columns: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log("\nAll 4 columns exist.");
  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
