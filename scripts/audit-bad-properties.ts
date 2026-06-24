// Audit properties table for bad data from the broken old address lookup.
//
// The GetPropertySearchByAddress PaServicesProxy operation was broken — it
// returned "111 NW 1 ST" (Miami-Dade Government Center) for every query.
// This script surfaces three categories of suspect records:
//
//   A. Address stuck at "111 NW 1 ST"
//   B. owner_name is a Miami-Dade County government entity
//   C. confidence_flags show core fields (address / owner_name) were never found
//
// Prints results to stdout — does NOT delete anything.
// Usage: npx tsx --env-file=.env.local scripts/audit-bad-properties.ts

import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

// ─── Queries ──────────────────────────────────────────────────────────────────

// The broken PA proxy returned exactly "111 NW 1 ST" as the address for every
// address-search request. Match on prefix so variants with city suffix also hit.
const QUERY_BAD_ADDRESS = `
  SELECT id, address, city, owner_name, source, source_url, ingested_at
  FROM properties
  WHERE address ILIKE '111 NW 1 ST%'
  ORDER BY ingested_at DESC
`;

// Common patterns for Miami-Dade County government entities as they appear in
// tax roll owner_name fields. This is intentionally broad.
const QUERY_GOVT_OWNER = `
  SELECT id, address, city, owner_name, source, source_url, ingested_at
  FROM properties
  WHERE
    owner_name ILIKE '%MIAMI-DADE%'
    OR owner_name ILIKE '%MIAMI DADE%'
    OR owner_name ILIKE '%COUNTY OF MIAMI%'
    OR owner_name ILIKE '%DADE COUNTY%'
    OR owner_name ILIKE '%BOARD OF COUNTY%'
    OR owner_name ILIKE '%SCHOOL BOARD%'
    OR owner_name ILIKE '%HOUSING AUTHORITY%'
    OR owner_name ILIKE '%PUBLIC HEALTH TRUST%'
    OR owner_name ILIKE '%JACKSON HEALTH%'
    OR owner_name ILIKE '%SOUTH FLORIDA WATER%'
    OR owner_name ILIKE '%FDOT%'
    OR owner_name ILIKE '%FLORIDA DEPT OF TRANSP%'
    OR owner_name ILIKE '%MDTA%'
  ORDER BY ingested_at DESC
`;

// Properties where confidence_flags records that a core field was absent.
// Flags are {field, reason} objects. We surface rows flagged on address or
// owner_name specifically — those are the fields the broken lookup poisoned.
const QUERY_MISSING_CORE = `
  SELECT
    p.id,
    p.address,
    p.city,
    p.owner_name,
    p.source,
    p.source_url,
    p.ingested_at,
    jsonb_agg(flag ORDER BY flag->>'field') AS flagged_fields
  FROM properties p,
       jsonb_array_elements(
         CASE WHEN jsonb_typeof(p.confidence_flags) = 'array'
              THEN p.confidence_flags ELSE '[]'::jsonb END
       ) AS flag
  WHERE flag->>'field' IN ('address', 'owner_name', 'size_sqft', 'property_type')
  GROUP BY p.id, p.address, p.city, p.owner_name, p.source, p.source_url, p.ingested_at
  ORDER BY p.ingested_at DESC
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HR = "─".repeat(62);

function section(title: string) {
  console.log(`\n${HR}`);
  console.log(`  ${title}`);
  console.log(HR);
}

function printRow(row: Record<string, unknown>, extras?: string[]) {
  console.log(`  id:         ${row.id}`);
  console.log(`  address:    ${row.address ?? "(null)"}`);
  console.log(`  city:       ${row.city ?? "(null)"}`);
  console.log(`  owner_name: ${row.owner_name ?? "(null)"}`);
  console.log(`  source:     ${row.source ?? "?"}  →  ${row.source_url ?? "?"}`);
  console.log(`  ingested:   ${String(row.ingested_at).slice(0, 19)}`);
  if (extras) for (const e of extras) console.log(`  ${e}`);
  console.log();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected.\n");

  // ── A ──────────────────────────────────────────────────────────────────────
  section("A — Address stuck at '111 NW 1 ST'  (broken PA proxy artifact)");
  const { rows: badAddr } = await client.query(QUERY_BAD_ADDRESS);
  if (badAddr.length === 0) {
    console.log("  (none found)");
  } else {
    console.log(`  ${badAddr.length} record(s):\n`);
    for (const row of badAddr) printRow(row);
  }

  // ── B ──────────────────────────────────────────────────────────────────────
  section("B — owner_name matches a Miami-Dade County government entity");
  const { rows: govtOwner } = await client.query(QUERY_GOVT_OWNER);
  if (govtOwner.length === 0) {
    console.log("  (none found)");
  } else {
    console.log(`  ${govtOwner.length} record(s):\n`);
    for (const row of govtOwner) printRow(row);
  }

  // ── C ──────────────────────────────────────────────────────────────────────
  section("C — Core fields flagged absent in confidence_flags");
  const { rows: missingCore } = await client.query(QUERY_MISSING_CORE);
  if (missingCore.length === 0) {
    console.log("  (none found)");
  } else {
    console.log(`  ${missingCore.length} record(s):\n`);
    for (const row of missingCore) {
      const flags = (row.flagged_fields as { field: string; reason: string }[])
        .map((f) => `${f.field}: ${f.reason}`)
        .join(" | ");
      printRow(row, [`flags:      ${flags}`]);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const uniqueIds = new Set([
    ...badAddr.map((r) => r.id as string),
    ...govtOwner.map((r) => r.id as string),
    ...missingCore.map((r) => r.id as string),
  ]);

  section("Summary");
  console.log(`  A  bad address (111 NW 1 ST):   ${badAddr.length}`);
  console.log(`  B  government owner:             ${govtOwner.length}`);
  console.log(`  C  core fields flagged absent:   ${missingCore.length}`);
  console.log(`  ─`);
  console.log(`  Unique records across all three: ${uniqueIds.size}`);
  console.log();
  if (uniqueIds.size > 0) {
    console.log("  To delete, paste the UUIDs above into the Beacon UI or run:");
    console.log("  DELETE FROM properties WHERE id IN ('<uuid>', ...);\n");
  }

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
