import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

// Dashboard show/hide customization (lib/dashboard-layout.ts) — nullable so
// existing accounts with no prefs render identically to today's fixed layout
// (resolveVisible treats a null column and missing keys the same: visible).
const SQL = `
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS dashboard_layout JSONB;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='user_settings' ORDER BY ordinal_position"
  );
  console.log("user_settings columns:", rows.map((r: { column_name: string }) => r.column_name).join(", "));
  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
