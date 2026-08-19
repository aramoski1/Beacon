import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

// Widen deals.stage to add real CRE milestones (LOI / lease / PSA stages) between
// proposal and closed. Additive only — every stage value already in use stays
// valid, so no existing deal row is invalidated. See lib/deals.ts for the
// per-deal-type stage subsets that consume this widened set.
const MIGRATION = `
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_stage_check;
ALTER TABLE deals ADD CONSTRAINT deals_stage_check
  CHECK (stage IN (
    'prospect', 'contacted', 'meeting', 'requirement', 'proposal', 'won',
    'loi_sent', 'loi_executed', 'lease_drafting', 'lease_signed',
    'psa_signed', 'due_diligence', 'under_contract', 'closed', 'lost'
  ));

ALTER TABLE deals ADD COLUMN IF NOT EXISTS expected_close_date DATE;
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
    FROM pg_constraint WHERE conname = 'deals_stage_check'
  `);
  if (ck.length === 0 || !ck[0].def.includes("loi_sent")) {
    console.error("✗ deals_stage_check does not include the new stages");
    process.exit(1);
  }
  console.log(`✓ deals_stage_check: ${ck[0].def}`);

  const { rows: col } = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deals' AND column_name = 'expected_close_date'
  `);
  if (col.length === 0) {
    console.error("✗ deals.expected_close_date not found");
    process.exit(1);
  }
  console.log("✓ deals.expected_close_date");

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
