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
      { col: "entity_id",             from: "migrate-entities.ts" },
      { col: "ownership_watch_enrolled_at", from: "migrate-ownership-watch.ts" },
      { col: "ownership_last_checked_at",   from: "migrate-ownership-watch.ts" },
      { col: "field_sources",         from: "migrate-field-sources.ts" },
      { col: "visibility",            from: "migrate-firms-visibility.ts" },
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
      { col: "visibility",          from: "migrate-firms-visibility.ts" },
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
      { col: "visibility",       from: "migrate-firms-visibility.ts" },
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
      { col: "deal_type",            from: "migrate-deal-type.ts" },
      { col: "custom_fields",        from: "migrate-custom-fields-deal-entity.ts" },
      { col: "expected_close_date",  from: "migrate-deal-stages-expand.ts" },
      { col: "visibility",           from: "migrate-firms-visibility.ts" },
    ],
  },
  {
    table: "activities",
    cols: [
      { col: "id",            from: "migrate-activities.ts" },
      { col: "owner_id",      from: "migrate-activities.ts" },
      { col: "contact_id",    from: "migrate-activities.ts" },
      { col: "property_id",   from: "migrate-activities.ts" },
      { col: "activity_type", from: "migrate-activities.ts" },
      { col: "activity_date", from: "migrate-activities.ts" },
      { col: "notes",         from: "migrate-activities.ts" },
      { col: "created_at",    from: "migrate-activities.ts" },
      { col: "deal_id",       from: "migrate-deal-activity-links.ts" },
      { col: "visibility",    from: "migrate-firms-visibility.ts" },
    ],
  },
  {
    table: "follow_ups",
    cols: [
      { col: "id",           from: "migrate-follow-ups.ts" },
      { col: "owner_id",     from: "migrate-follow-ups.ts" },
      { col: "contact_id",   from: "migrate-follow-ups.ts" },
      { col: "property_id",  from: "migrate-follow-ups.ts" },
      { col: "due_date",     from: "migrate-follow-ups.ts" },
      { col: "description",  from: "migrate-follow-ups.ts" },
      { col: "done",         from: "migrate-follow-ups.ts" },
      { col: "done_at",      from: "migrate-follow-ups.ts" },
      { col: "created_at",   from: "migrate-follow-ups.ts" },
      { col: "source_type",  from: "migrate-followup-source.ts" },
      { col: "lease_id",     from: "migrate-followup-source.ts" },
      { col: "lease_bucket", from: "migrate-followup-source.ts" },
      { col: "deal_id",      from: "migrate-deal-activity-links.ts" },
      { col: "visibility",   from: "migrate-firms-visibility.ts" },
    ],
  },
  {
    table: "error_logs",
    cols: [
      { col: "id",          from: "migrate-error-logs.ts" },
      { col: "occurred_at", from: "migrate-error-logs.ts" },
      { col: "owner_id",    from: "migrate-error-logs.ts" },
      { col: "action",      from: "migrate-error-logs.ts" },
      { col: "severity",    from: "migrate-error-logs.ts" },
      { col: "message",     from: "migrate-error-logs.ts" },
      { col: "stack",       from: "migrate-error-logs.ts" },
      { col: "context",     from: "migrate-error-logs.ts" },
      { col: "resolved_at", from: "migrate-error-logs.ts" },
    ],
  },
  {
    table: "user_settings",
    cols: [
      { col: "id",                       from: "migrate-user-settings.ts" },
      { col: "owner_id",                 from: "migrate-user-settings.ts" },
      { col: "display_name",             from: "migrate-user-settings.ts" },
      { col: "broker_name",              from: "migrate-user-settings.ts" },
      { col: "company",                  from: "migrate-user-settings.ts" },
      { col: "license_number",           from: "migrate-user-settings.ts" },
      { col: "default_market",           from: "migrate-user-settings.ts" },
      { col: "default_submarket",        from: "migrate-user-settings.ts" },
      { col: "phone",                    from: "migrate-user-settings.ts" },
      { col: "website",                  from: "migrate-user-settings.ts" },
      { col: "email_signature",          from: "migrate-user-settings.ts" },
      { col: "sender_name",              from: "migrate-user-settings.ts" },
      { col: "sender_email",             from: "migrate-user-settings.ts" },
      { col: "cadence_tier1_days",       from: "migrate-user-settings.ts" },
      { col: "cadence_tier2_days",       from: "migrate-user-settings.ts" },
      { col: "cadence_tier3_days",       from: "migrate-user-settings.ts" },
      { col: "costar_enabled",           from: "migrate-user-settings.ts" },
      { col: "created_at",               from: "migrate-user-settings.ts" },
      { col: "updated_at",               from: "migrate-user-settings.ts" },
      { col: "onboarding_completed_at",  from: "migrate-onboarding.ts" },
      { col: "email_provider",           from: "migrate-email-provider.ts" },
      { col: "pilot_agreement_accepted_at", from: "migrate-pilot-agreement.ts" },
    ],
  },
  {
    table: "entities",
    cols: [
      { col: "id",                from: "migrate-entities.ts" },
      { col: "owner_id",          from: "migrate-entities.ts" },
      { col: "name",              from: "migrate-entities.ts" },
      { col: "name_normalized",   from: "migrate-entities.ts" },
      { col: "kind",              from: "migrate-entities.ts" },
      { col: "sunbiz_doc_number", from: "migrate-entities.ts" },
      { col: "created_at",        from: "migrate-entities.ts" },
      { col: "updated_at",        from: "migrate-entities.ts" },
    ],
  },
  {
    table: "entity_properties",
    cols: [
      { col: "id",          from: "migrate-entities.ts" },
      { col: "owner_id",    from: "migrate-entities.ts" },
      { col: "entity_id",   from: "migrate-entities.ts" },
      { col: "property_id", from: "migrate-entities.ts" },
      { col: "created_at",  from: "migrate-entities.ts" },
    ],
  },
  {
    table: "entity_contacts",
    cols: [
      { col: "id",         from: "migrate-entities.ts" },
      { col: "owner_id",   from: "migrate-entities.ts" },
      { col: "entity_id",  from: "migrate-entities.ts" },
      { col: "contact_id", from: "migrate-entities.ts" },
      { col: "role",       from: "migrate-entities.ts" },
      { col: "created_at", from: "migrate-entities.ts" },
    ],
  },
  {
    table: "contact_properties",
    cols: [
      { col: "id",          from: "migrate-contact-properties.ts" },
      { col: "owner_id",    from: "migrate-contact-properties.ts" },
      { col: "contact_id",  from: "migrate-contact-properties.ts" },
      { col: "property_id", from: "migrate-contact-properties.ts" },
      { col: "created_at",  from: "migrate-contact-properties.ts" },
    ],
  },
  {
    table: "documents",
    cols: [
      { col: "id",           from: "migrate-documents.ts" },
      { col: "owner_id",     from: "migrate-documents.ts" },
      { col: "entity_type",  from: "migrate-documents.ts" },
      { col: "entity_id",    from: "migrate-documents.ts" },
      { col: "file_name",    from: "migrate-documents.ts" },
      { col: "storage_path", from: "migrate-documents.ts" },
      { col: "content_type", from: "migrate-documents.ts" },
      { col: "size_bytes",   from: "migrate-documents.ts" },
      { col: "created_at",   from: "migrate-documents.ts" },
      { col: "visibility",   from: "migrate-firms-visibility.ts" },
    ],
  },
  {
    table: "firms",
    cols: [
      { col: "id",         from: "migrate-firms.ts" },
      { col: "name",       from: "migrate-firms.ts" },
      { col: "created_by", from: "migrate-firms.ts" },
      { col: "created_at", from: "migrate-firms.ts" },
    ],
  },
  {
    table: "firm_members",
    cols: [
      { col: "id",         from: "migrate-firms.ts" },
      { col: "firm_id",    from: "migrate-firms.ts" },
      { col: "user_id",    from: "migrate-firms.ts" },
      { col: "role",       from: "migrate-firms.ts" },
      { col: "status",     from: "migrate-firms.ts" },
      { col: "invited_by", from: "migrate-firms.ts" },
      { col: "created_at", from: "migrate-firms.ts" },
    ],
  },
  {
    table: "firm_invitations",
    cols: [
      { col: "id",          from: "migrate-firms.ts" },
      { col: "firm_id",     from: "migrate-firms.ts" },
      { col: "email",       from: "migrate-firms.ts" },
      { col: "role",        from: "migrate-firms.ts" },
      { col: "token",       from: "migrate-firms.ts" },
      { col: "invited_by",  from: "migrate-firms.ts" },
      { col: "expires_at",  from: "migrate-firms.ts" },
      { col: "accepted_at", from: "migrate-firms.ts" },
      { col: "revoked_at",  from: "migrate-firms.ts" },
      { col: "created_at",  from: "migrate-firms.ts" },
    ],
  },
  {
    table: "record_shares",
    cols: [
      { col: "id",                  from: "migrate-record-shares.ts" },
      { col: "entity_type",         from: "migrate-record-shares.ts" },
      { col: "entity_id",           from: "migrate-record-shares.ts" },
      { col: "shared_with_user_id", from: "migrate-record-shares.ts" },
      { col: "shared_by_user_id",   from: "migrate-record-shares.ts" },
      { col: "created_at",          from: "migrate-record-shares.ts" },
    ],
  },
];

const EXPECTED_BUCKETS = ["leases", "documents"];

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

  // ── 3. Storage buckets ─────────────────────────────────────────────────────
  const bucketExists = new Map<string, boolean>();
  try {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM storage.buckets WHERE id = ANY($1)`,
      [EXPECTED_BUCKETS]
    );
    const found = new Set(rows.map((r) => r.id));
    for (const b of EXPECTED_BUCKETS) bucketExists.set(b, found.has(b));
  } catch {
    // storage schema may not be accessible via this connection
    for (const b of EXPECTED_BUCKETS) bucketExists.set(b, false);
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
  for (const bucket of EXPECTED_BUCKETS) {
    const exists = bucketExists.get(bucket) ?? false;
    console.log(`\n  ${exists ? "✓" : "✗"} storage bucket '${bucket}'`);
    if (!exists) {
      anyMissing = true;
      missing.push(`storage bucket '${bucket}'`);
      console.log(`    MISSING — run npm run migrate`);
    }
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
