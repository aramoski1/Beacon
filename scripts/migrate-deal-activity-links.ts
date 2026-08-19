import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

// Direct deal_id FK on activities/follow_ups, replacing the fragile soft-link
// via "Deal:<id>|" description-prefix matching (lib/deal-follow-up.ts). Backfills
// follow_ups.deal_id from that prefix for historical rows before app code stops
// writing/reading it.
const MIGRATION = `
ALTER TABLE activities ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE CASCADE;
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS activities_deal_id ON activities (deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS follow_ups_deal_id  ON follow_ups (deal_id) WHERE deal_id IS NOT NULL;

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_contact_or_property;
ALTER TABLE activities ADD CONSTRAINT activities_contact_or_property
  CHECK (contact_id IS NOT NULL OR property_id IS NOT NULL OR deal_id IS NOT NULL);

UPDATE follow_ups f
SET deal_id = sub.did
FROM (
  SELECT id, (substring(description from 'Deal:([0-9a-fA-F-]{36})\\|'))::uuid AS did
  FROM follow_ups
  WHERE description LIKE 'Deal:%|%'
) sub
WHERE f.id = sub.id
  AND f.deal_id IS NULL
  AND EXISTS (SELECT 1 FROM deals d WHERE d.id = sub.did AND d.owner_id = f.owner_id);
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

  const { rows: cols } = await client.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'deal_id'
      AND table_name IN ('activities', 'follow_ups')
  `);
  const found = new Set(cols.map((r) => r.table_name as string));
  for (const t of ["activities", "follow_ups"]) {
    if (!found.has(t)) {
      console.error(`✗ ${t}.deal_id not found`);
      process.exit(1);
    }
    console.log(`✓ ${t}.deal_id`);
  }

  const { rows: ck } = await client.query(`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conname = 'activities_contact_or_property'
  `);
  if (ck.length === 0 || !ck[0].def.includes("deal_id")) {
    console.error("✗ activities_contact_or_property does not include deal_id");
    process.exit(1);
  }
  console.log(`✓ activities_contact_or_property: ${ck[0].def}`);

  // Backfill sanity check — every legacy prefixed follow-up should now have deal_id set,
  // unless it referenced a deal that no longer exists (or belongs to a different owner).
  const { rows: prefixed } = await client.query(
    `SELECT COUNT(*)::int AS n FROM follow_ups WHERE description LIKE 'Deal:%|%'`
  );
  const { rows: linked } = await client.query(
    `SELECT COUNT(*)::int AS n FROM follow_ups WHERE description LIKE 'Deal:%|%' AND deal_id IS NOT NULL`
  );
  console.log(
    `Backfill: ${linked[0].n}/${prefixed[0].n} legacy prefixed follow_ups now have deal_id set` +
      (linked[0].n < prefixed[0].n ? " — remainder reference a deleted/inaccessible deal." : ".")
  );

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
