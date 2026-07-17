// Connects to the database and reports which expected tables and columns
// exist vs. are missing. Non-destructive — read-only queries only.
//
// Usage:  npx tsx --env-file=.env.local scripts/verify-schema.ts
//    or:  npm run db:verify

import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

// ─── Expected schema ─────────────────────────────────────────────────────────
// Mirrors the union of all migration scripts. Update this list whenever a new
// migration adds tables or columns.

type ColSpec = { col: string; from: string };
type TableSpec = { table: string; cols: ColSpec[] };

const EXPECTED: TableSpec[] = [
  {
    table: "properties",
    cols: [
      // migrate.ts
      { col: "id",                    from: "migrate.ts" },
      { col: "owner_id",              from: "migrate.ts" },
      { col: "address",               from: "migrate.ts" },
      { col: "city",                  from: "migrate.ts" },
      { col: "submarket",             from: "migrate.ts" },
      { col: "geographic_category",   from: "migrate.ts" },
      { col: "geographic_descriptor", from: "migrate.ts" },
      { col: "owner_name",            from: "migrate.ts" },
      { col: "ownership_type",        from: "migrate.ts" },
      { col: "size_sqft",             from: "migrate.ts" },
      { col: "size_category",         from: "migrate.ts" },
      { col: "property_type",         from: "migrate.ts" },
      { col: "building_composition",  from: "migrate.ts" },
      { col: "last_sale_date",        from: "migrate.ts" },
      { col: "last_sale_price",       from: "migrate.ts" },
      { col: "source",                from: "migrate.ts" },
      { col: "source_url",            from: "migrate.ts" },
      { col: "ingested_at",           from: "migrate.ts" },
      { col: "confidence_flags",      from: "migrate.ts" },
      { col: "created_at",            from: "migrate.ts" },
      { col: "updated_at",            from: "migrate.ts" },
      // migrate-custom-fields.ts
      { col: "custom_fields",         from: "migrate-custom-fields.ts" },
    ],
  },
  {
    table: "contacts",
    cols: [
      // migrate.ts
      { col: "id",                  from: "migrate.ts" },
      { col: "owner_id",            from: "migrate.ts" },
      { col: "name",                from: "migrate.ts" },
      { col: "company",             from: "migrate.ts" },
      { col: "role",                from: "migrate.ts" },
      { col: "email",               from: "migrate.ts" },
      { col: "phone",               from: "migrate.ts" },
      { col: "contact_tier",        from: "migrate.ts" },
      { col: "client_status",       from: "migrate.ts" },
      { col: "linked_properties",   from: "migrate.ts" },
      { col: "action_tags",         from: "migrate.ts" },
      { col: "last_contacted_at",   from: "migrate.ts" },
      { col: "next_action_due",     from: "migrate.ts" },
      { col: "cadence",             from: "migrate.ts" },
      { col: "outreach_history",    from: "migrate.ts" },
      { col: "created_at",          from: "migrate.ts" },
      { col: "updated_at",          from: "migrate.ts" },
      // migrate-contacts.ts
      { col: "size_category",       from: "migrate-contacts.ts" },
      { col: "geographic_category", from: "migrate-contacts.ts" },
      { col: "ownership_type",      from: "migrate-contacts.ts" },
      // migrate-custom-fields.ts
      { col: "custom_fields",       from: "migrate-custom-fields.ts" },
    ],
  },
  {
    table: "lease_abstracts",
    cols: [
      // migrate.ts
      { col: "id",               from: "migrate.ts" },
      { col: "owner_id",         from: "migrate.ts" },
      { col: "linked_property",  from: "migrate.ts" },
      { col: "execution_date",   from: "migrate.ts" },
      { col: "expiration_date",  from: "migrate.ts" },
      { col: "term",             from: "migrate.ts" },
      { col: "base_rate",        from: "migrate.ts" },
      { col: "escalations",      from: "migrate.ts" },
      { col: "options",          from: "migrate.ts" },
      { col: "key_provisions",   from: "migrate.ts" },
      { col: "source_document",  from: "migrate.ts" },
      { col: "field_citations",  from: "migrate.ts" },
      { col: "created_at",       from: "migrate.ts" },
      { col: "updated_at",       from: "migrate.ts" },
      // migrate-custom-fields.ts
      { col: "custom_fields",    from: "migrate-custom-fields.ts" },
    ],
  },
  {
    table: "field_definitions",
    cols: [
      // migrate-custom-fields.ts
      { col: "id",             from: "migrate-custom-fields.ts" },
      { col: "owner_id",       from: "migrate-custom-fields.ts" },
      { col: "entity_type",    from: "migrate-custom-fields.ts" },
      { col: "field_name",     from: "migrate-custom-fields.ts" },
      { col: "field_type",     from: "migrate-custom-fields.ts" },
      { col: "select_options", from: "migrate-custom-fields.ts" },
      { col: "fill_mode",      from: "migrate-custom-fields.ts" },
      { col: "created_at",     from: "migrate-custom-fields.ts" },
    ],
  },
  {
    table: "deals",
    cols: [
      { col: "id",                   from: "migrate-deals.ts" },
      { col: "owner_id",             from: "migrate-deals.ts" },
      { col: "name",                 from: "migrate-deals.ts" },
      { col: "stage",                from: "migrate-deals.ts" },
      { col: "contact_id",           from: "migrate-deals.ts" },
      { col: "property_id",          from: "migrate-deals.ts" },
      { col: "estimated_commission", from: "migrate-deals.ts" },
      { col: "notes",                from: "migrate-deals.ts" },
      { col: "next_action",          from: "migrate-deals.ts" },
      { col: "next_action_due",      from: "migrate-deals.ts" },
      { col: "created_at",           from: "migrate-deals.ts" },
      { col: "updated_at",           from: "migrate-deals.ts" },
    ],
  },
];

const EXPECTED_BUCKET = "leases";

// ─── Main ────────────────────────────────────────────────────────────────────

const HR = "─".repeat(62);
let anyMissing = false;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`\n${HR}`);
  console.log("  Beacon — schema verification");
  console.log(HR);

  // ── 1. Which public tables exist? ─────────────────────────────────────────
  const { rows: existingTables } = await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `);
  const tableSet = new Set(existingTables.map((r) => r.table_name));

  // ── 2. Which columns exist across the tables we care about? ───────────────
  const tableNames = EXPECTED.map((s) => s.table);
  const { rows: existingCols } = await client.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1)`,
    [tableNames]
  );
  const colSet = new Set(existingCols.map((r) => `${r.table_name}.${r.column_name}`));

  // ── 3. Storage bucket ─────────────────────────────────────────────────────
  let bucketExists = false;
  try {
    const { rows } = await client.query(
      `SELECT id FROM storage.buckets WHERE id = $1`,
      [EXPECTED_BUCKET]
    );
    bucketExists = rows.length > 0;
  } catch {
    // storage schema may not be accessible via this connection
  }

  // ── 4. Report ─────────────────────────────────────────────────────────────
  const missing: string[] = [];

  for (const spec of EXPECTED) {
    const tableOk = tableSet.has(spec.table);
    console.log(`\n  ${tableOk ? "✓" : "✗"} ${spec.table}`);
    if (!tableOk) {
      anyMissing = true;
      missing.push(`TABLE ${spec.table}`);
      console.log(`    MISSING TABLE — run npm run migrate`);
      continue;
    }

    // Group by migration for readable output
    const byMigration: Record<string, { col: string; exists: boolean }[]> = {};
    for (const { col, from } of spec.cols) {
      const exists = colSet.has(`${spec.table}.${col}`);
      if (!byMigration[from]) byMigration[from] = [];
      byMigration[from].push({ col, exists });
    }

    for (const [migration, cols] of Object.entries(byMigration)) {
      const allOk = cols.every((c) => c.exists);
      console.log(`    [${allOk ? "✓" : "✗"}] ${migration}`);
      for (const { col, exists } of cols) {
        if (exists) {
          console.log(`        ✓  ${col}`);
        } else {
          anyMissing = true;
          missing.push(`${spec.table}.${col}  (${migration})`);
          console.log(`        ✗  ${col}  ← MISSING`);
        }
      }
    }
  }

  // ── 5. Storage ────────────────────────────────────────────────────────────
  console.log(`\n  ${bucketExists ? "✓" : "✗"} storage bucket '${EXPECTED_BUCKET}'`);
  if (!bucketExists) {
    anyMissing = true;
    missing.push(`storage bucket 'leases'  (setup-storage.ts)`);
    console.log(`    MISSING — run npm run migrate`);
  }

  // ── 6. Summary ────────────────────────────────────────────────────────────
  console.log(`\n${HR}`);
  if (anyMissing) {
    console.log(`  RESULT: ${missing.length} item(s) MISSING\n`);
    for (const m of missing) console.log(`    ✗  ${m}`);
    console.log("\n  Fix: npm run migrate");
  } else {
    console.log("  RESULT: all expected tables, columns, and storage bucket are present.");
  }
  console.log(`${HR}\n`);

  await client.end();
  process.exit(anyMissing ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
