import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const SQL = `
CREATE TABLE IF NOT EXISTS user_settings (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name       text,
  broker_name        text,
  company            text,
  license_number     text,
  default_market     text,
  default_submarket  text,
  phone              text,
  website            text,
  email_signature    text,
  sender_name        text,
  sender_email       text,
  cadence_tier1_days integer     NOT NULL DEFAULT 14,
  cadence_tier2_days integer     NOT NULL DEFAULT 30,
  cadence_tier3_days integer     NOT NULL DEFAULT 90,
  costar_enabled     boolean     NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id)
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_settings' AND policyname = 'user_settings_owner_all'
  ) THEN
    CREATE POLICY user_settings_owner_all ON user_settings
      FOR ALL
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
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'user_settings' ORDER BY ordinal_position"
  );
  console.log(
    "user_settings columns:",
    rows.map((r: { column_name: string }) => r.column_name).join(", ")
  );
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
