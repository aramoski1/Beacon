// Re-fetch MDPA mailing addresses for tax-roll properties missing owner_mailing_address.
// Usage: npx tsx --env-file=.env.local scripts/backfill-owner-mailing.ts

import { Client } from "pg";
import { getPropertyDetail, extractOwnerMailing } from "../lib/mdpa";
import { parseStoredOwnerContacts, isEntityOwnerName } from "../lib/owner-contacts";

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
    address: string | null;
    owner_name: string | null;
    source_url: string | null;
    owner_mailing_address: string | null;
    owner_contacts: unknown;
  }>(`
    SELECT id, address, owner_name, source_url, owner_mailing_address, owner_contacts
    FROM properties
    WHERE source_url LIKE 'mdpa:%'
      AND (owner_mailing_address IS NULL OR trim(owner_mailing_address) = '')
  `);

  let updated = 0;
  for (const row of rows) {
    const strap = row.source_url!.replace(/^mdpa:/, "");
    let detail: unknown;
    try {
      detail = await getPropertyDetail(strap);
    } catch (e) {
      console.warn(`Skip ${row.address ?? row.id}: ${e instanceof Error ? e.message : e}`);
      continue;
    }

    const mailing = extractOwnerMailing(detail);
    if (!mailing) continue;

    let owner_contacts = parseStoredOwnerContacts(row.owner_contacts);
    if (owner_contacts.length > 0 && !isEntityOwnerName(row.owner_name)) {
      owner_contacts = owner_contacts.map((oc) => ({
        ...oc,
        address: oc.address?.trim() || mailing,
      }));
    }

    await client.query(
      `UPDATE properties SET owner_mailing_address = $1, owner_contacts = $2::jsonb WHERE id = $3`,
      [mailing, JSON.stringify(owner_contacts), row.id]
    );
    updated++;
    console.log(`  ✓ ${row.address ?? row.id}: ${mailing}`);
  }

  console.log(`Updated owner mailing address on ${updated} propert${updated === 1 ? "y" : "ies"}.`);
  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
