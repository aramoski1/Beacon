import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

// Pilot NDA / terms checkbox — timestamp on user_settings.
// Additive and nullable so existing accounts keep working on main until they
// accept on the feature branch (lib/auth-require-user.ts redirects to
// /pilot-agreement when this is null).
const SQL = `
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS pilot_agreement_accepted_at TIMESTAMPTZ;
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
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'user_settings' AND column_name = 'pilot_agreement_accepted_at'",
  );
  console.log(
    "pilot_agreement_accepted_at present:",
    rows.length > 0,
  );
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
