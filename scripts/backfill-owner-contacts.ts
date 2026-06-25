// Backfill owner_contacts JSONB from legacy columns or individual MDPA owner_name.
// Usage: npx tsx --env-file=.env.local scripts/backfill-owner-contacts.ts

import { Client } from "pg";

const ENTITY_RE = /\b(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\b/i;

function isEntityOwnerName(name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  return ENTITY_RE.test(name.replace(/\./g, ""));
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const { rows } = await client.query<{
    id: string;
    owner_name: string | null;
    owner_mailing_address: string | null;
    owner_contact_name: string | null;
    owner_contact_address: string | null;
    owner_contacts: unknown;
  }>(`
    SELECT id, owner_name, owner_mailing_address, owner_contact_name, owner_contact_address, owner_contacts
    FROM properties
    WHERE owner_contacts IS NULL OR owner_contacts = '[]'::jsonb
  `);

  let updated = 0;
  for (const row of rows) {
    let name: string | null = null;
    let address: string | null = null;

    if (row.owner_contact_name?.trim()) {
      name = row.owner_contact_name.trim();
      address = row.owner_contact_address?.trim() || null;
    } else if (row.owner_name?.trim() && !isEntityOwnerName(row.owner_name)) {
      name = row.owner_name.trim();
      address = row.owner_mailing_address?.trim() || null;
    }

    if (!name) continue;

    const entry = JSON.stringify([{ name, title: "", address }]);
    await client.query(
      `UPDATE properties SET owner_contacts = $1::jsonb WHERE id = $2`,
      [entry, row.id]
    );
    updated++;
  }

  console.log(`Backfilled owner_contacts on ${updated} propert${updated === 1 ? "y" : "ies"}.`);
  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
