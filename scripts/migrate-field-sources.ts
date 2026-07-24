import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const SQL = `
-- Per-field provenance tags for properties (county / sunbiz / document / url / pasted),
-- keyed the same as confidence_flags[].field (e.g. "owner_name", "custom_fields.clear_height").
ALTER TABLE properties ADD COLUMN IF NOT EXISTS field_sources JSONB DEFAULT '{}';
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected to database.");

  await client.query(SQL);
  console.log("Migration complete.");

  const { rows } = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'properties' AND column_name = 'field_sources'
  `);
  if (rows.length > 0) {
    console.log("  ✓ properties.field_sources");
  } else {
    console.error("  ✗ properties.field_sources missing after migration");
    process.exit(1);
  }

  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
