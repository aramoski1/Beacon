import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const SQL = `
CREATE OR REPLACE FUNCTION beacon_touch_last_contacted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL AND NEW.activity_type IN ('call', 'email', 'meeting', 'letter', 'tour') THEN
    UPDATE contacts
    SET last_contacted_at = GREATEST(COALESCE(last_contacted_at, NEW.activity_date), NEW.activity_date)
    WHERE id = NEW.contact_id AND owner_id = NEW.owner_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS activities_touch_last_contacted ON activities;
CREATE TRIGGER activities_touch_last_contacted
AFTER INSERT ON activities
FOR EACH ROW
EXECUTE FUNCTION beacon_touch_last_contacted();

UPDATE contacts c
SET last_contacted_at = a.max_at
FROM (
  SELECT owner_id, contact_id, max(activity_date) AS max_at
  FROM activities
  WHERE contact_id IS NOT NULL
  GROUP BY owner_id, contact_id
) a
WHERE c.id = a.contact_id
  AND c.owner_id = a.owner_id
  AND (c.last_contacted_at IS NULL OR c.last_contacted_at < a.max_at);
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  console.log("last_contacted_at trigger + backfill ready");
  await client.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
