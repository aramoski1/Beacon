import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const MIGRATION = `
-- Deal type for stage-set filtering (tenant rep / listing / investment sale)
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS deal_type TEXT NOT NULL DEFAULT 'tenant_rep';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deals_deal_type_check'
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_deal_type_check
      CHECK (deal_type IN ('tenant_rep', 'listing', 'investment_sale'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS deals_owner_type ON deals (owner_id, deal_type);
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected.");

  console.log("\nRunning deal_type migration...");
  await client.query(MIGRATION);
  console.log("Migration complete.");

  const { rows } = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deals'
    ORDER BY ordinal_position
  `);
  console.log(`deals columns: ${rows.map((r: { column_name: string }) => r.column_name).join(", ")}`);
  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
