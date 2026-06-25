import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

const SQL = `
CREATE TABLE IF NOT EXISTS follow_ups (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id  UUID        REFERENCES contacts(id)   ON DELETE SET NULL,
  property_id UUID        REFERENCES properties(id) ON DELETE SET NULL,
  due_date    DATE        NOT NULL,
  description TEXT        NOT NULL DEFAULT 'Follow up',
  done        BOOLEAN     NOT NULL DEFAULT false,
  done_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'follow_ups' AND policyname = 'follow_ups_owner'
  ) THEN
    CREATE POLICY follow_ups_owner ON follow_ups FOR ALL USING (owner_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS follow_ups_owner_due  ON follow_ups (owner_id, due_date) WHERE done = false;
CREATE INDEX IF NOT EXISTS follow_ups_contact_id ON follow_ups (contact_id);
CREATE INDEX IF NOT EXISTS follow_ups_property_id ON follow_ups (property_id);
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='follow_ups' ORDER BY ordinal_position"
  );
  console.log("follow_ups columns:", rows.map((r: { column_name: string }) => r.column_name).join(", "));
  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
