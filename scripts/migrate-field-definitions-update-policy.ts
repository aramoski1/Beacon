import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const SQL = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'field_definitions' AND policyname = 'field_definitions_owner_update'
  ) THEN
    CREATE POLICY field_definitions_owner_update ON field_definitions
      FOR UPDATE
      USING (auth.uid() = owner_id)
      WITH CHECK (auth.uid() = owner_id);
  END IF;
END;
$$;
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  console.log("field_definitions UPDATE policy ensured.");
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
