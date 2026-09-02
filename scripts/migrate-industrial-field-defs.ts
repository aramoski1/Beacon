import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const SQL = `
-- Industrial / flex specs are field_definitions with field_group = 'industrial'.
-- Defaults are seeded at runtime (ensureIndustrialFieldDefs) so brokers can
-- delete them without the migration putting them back.

ALTER TABLE field_definitions
  ADD COLUMN IF NOT EXISTS field_group TEXT NOT NULL DEFAULT 'custom';

ALTER TABLE field_definitions DROP CONSTRAINT IF EXISTS field_definitions_field_group_check;
ALTER TABLE field_definitions ADD CONSTRAINT field_definitions_field_group_check
  CHECK (field_group IN ('custom', 'industrial'));

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS industrial_specs_initialized BOOLEAN NOT NULL DEFAULT false;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  console.log("field_definitions.field_group + user_settings.industrial_specs_initialized ready.");
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
