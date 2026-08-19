import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

// Widen documents.entity_type to allow attachments (LOIs, leases, PSAs) on deals.
const MIGRATION = `
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_entity_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_entity_type_check
  CHECK (entity_type IN ('property', 'lease', 'contact', 'deal'));
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

  const { rows } = await client.query(`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'documents_entity_type_check'
  `);
  if (rows.length === 0 || !rows[0].def.includes("'deal'")) {
    console.error("✗ documents_entity_type_check does not include 'deal'");
    process.exit(1);
  }
  console.log(`✓ documents_entity_type_check: ${rows[0].def}`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
