import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

// activities.property_id was ON DELETE SET NULL. That's fine for activities
// that also have a contact_id, but a property-only activity (no contact) ends
// up with both columns null, which violates activities_contact_or_property.
//
// Switch the FK to ON DELETE CASCADE. deleteProperty() (app/crm/actions.ts)
// pre-clears property_id on contact-linked activities before deleting the
// property, so those still survive as SET NULL would have; CASCADE here is
// the safety net that removes property-only activities instead of violating
// the CHECK constraint.
const MIGRATION = `
DO $$
DECLARE
  fk_name  text;
  del_type char;
BEGIN
  SELECT con.conname, con.confdeltype
    INTO fk_name, del_type
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid
   AND att.attnum = con.conkey[1]
  WHERE con.contype   = 'f'
    AND con.conrelid  = 'activities'::regclass
    AND con.confrelid = 'properties'::regclass
    AND att.attname   = 'property_id'
  LIMIT 1;

  IF fk_name IS NULL THEN
    RAISE EXCEPTION 'activities.property_id -> properties foreign key not found';
  END IF;

  IF del_type = 'c' THEN
    RAISE NOTICE 'activities.property_id FK already ON DELETE CASCADE, skipping';
  ELSE
    EXECUTE format('ALTER TABLE activities DROP CONSTRAINT %I', fk_name);
    ALTER TABLE activities
      ADD CONSTRAINT activities_property_id_fkey
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;
    RAISE NOTICE 'activities.property_id FK changed to ON DELETE CASCADE';
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
  const { rows } = await client.query(`
    SELECT con.confdeltype
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = con.conkey[1]
    WHERE con.contype   = 'f'
      AND con.conrelid  = 'activities'::regclass
      AND con.confrelid = 'properties'::regclass
      AND att.attname   = 'property_id'
    LIMIT 1;
  `);

  const isCascade = rows[0]?.confdeltype === "c";
  if (!isCascade) {
    console.error("✗ activities.property_id FK is not ON DELETE CASCADE");
    process.exit(1);
  }
  console.log("✓ activities.property_id FK is ON DELETE CASCADE");

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
