import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

// Follow-up to migrate-zoning-fields.ts: zoning_code/zoning_far alone lose too
// much on a page reload (district name, municipality, use description,
// overlay, and — for Massachusetts — max height/dwelling units/density/min
// lot size all disappear, since only code+FAR were persisted). zoning_data
// stores the full ZoningInfo object (lib/zoning.ts) plus whether the point
// came from geocoding (so the property page can still show the "not an exact
// parcel match" caveat without re-querying) — so a broker sees the complete
// last-known result immediately on page load, not just after re-clicking
// Look up.
const SQL = `
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS zoning_data JSONB,
  ADD COLUMN IF NOT EXISTS zoning_geocoded BOOLEAN;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='properties' ORDER BY ordinal_position"
  );
  console.log("properties columns:", rows.map((r: { column_name: string }) => r.column_name).join(", "));
  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
