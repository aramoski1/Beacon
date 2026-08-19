import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

// Widen field_definitions.entity_type to allow broker-defined fields on deals,
// and add the matching custom_fields JSONB column on deals itself.
const MIGRATION = `
ALTER TABLE field_definitions DROP CONSTRAINT IF EXISTS field_definitions_entity_type_check;
ALTER TABLE field_definitions ADD CONSTRAINT field_definitions_entity_type_check
  CHECK (entity_type IN ('property', 'contact', 'lease', 'deal'));

ALTER TABLE deals ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';
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

  const { rows: ck } = await client.query(`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'field_definitions_entity_type_check'
  `);
  if (ck.length === 0 || !ck[0].def.includes("'deal'")) {
    console.error("✗ field_definitions_entity_type_check does not include 'deal'");
    process.exit(1);
  }
  console.log(`✓ field_definitions_entity_type_check: ${ck[0].def}`);

  const { rows: col } = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deals' AND column_name = 'custom_fields'
  `);
  if (col.length === 0) {
    console.error("✗ deals.custom_fields not found");
    process.exit(1);
  }
  console.log("✓ deals.custom_fields");

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
