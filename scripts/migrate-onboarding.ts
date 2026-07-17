import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const SQL = `
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  console.log("✓ user_settings.onboarding_completed_at column ensured.");
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
