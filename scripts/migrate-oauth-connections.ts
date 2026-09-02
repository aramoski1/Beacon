import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const SQL = `
-- Connection flags only — tokens are not stored until OAuth apps are configured.
CREATE TABLE IF NOT EXISTS oauth_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN (
    'google_gmail', 'google_calendar', 'microsoft_mail', 'microsoft_calendar', 'docusign'
  )),
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','pending','connected','error')),
  connected_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, provider)
);

ALTER TABLE oauth_connections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'oauth_connections' AND policyname = 'oauth_connections_owner_all'
  ) THEN
    CREATE POLICY oauth_connections_owner_all ON oauth_connections
      FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
  END IF;
END;
$$;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  console.log("oauth_connections ready.");
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
