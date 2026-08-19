# Migrations

## Prerequisites

`DATABASE_URL` must be set in `.env.local`. This is the direct Postgres connection string from your Supabase project settings (Settings → Database → Connection string → URI). The direct connection bypasses Row-Level Security, which is required for schema changes.

## Running migrations

```bash
npm run migrate
```

Runs all migration scripts in dependency order via `scripts/migrate-all.ts`. Every script is idempotent — safe to re-run at any time. Running `migrate` on an already-current database is a no-op.

## Verifying the schema

```bash
npm run db:verify
```

Connects to the database and checks every expected table and column. Exits with code 0 if everything is present, code 1 if anything is missing, printing exactly what is absent and which migration script is responsible.

Run this after any migration to confirm the changes landed.

## Migration scripts

Scripts run in this order:

| # | Script | What it creates |
|---|--------|-----------------|
| 1 | `scripts/migrate.ts` | `properties`, `contacts`, `lease_abstracts` tables with RLS |
| 2 | `scripts/migrate-contacts.ts` | Adds `size_category`, `geographic_category`, `ownership_type` columns to `contacts` |
| 3 | `scripts/migrate-custom-fields.ts` | `field_definitions` table; adds `custom_fields` JSONB to all three entity tables |
| 4 | `scripts/setup-storage.ts` | `leases` storage bucket (32 MB, PDF-only) with RLS |
| ... | (additional migrations — see `SCRIPTS` in `scripts/migrate-all.ts` for the full, current list) | |
| ... | `scripts/migrate-documents.ts` | `documents` table (property/lease/contact attachments) + `documents` storage bucket (32 MB, common doc/image types) with RLS |
| ... | `scripts/migrate-documents-deal-entity.ts` | Widens `documents.entity_type` CHECK to allow attachments on deals |
| ... | `scripts/migrate-custom-fields-deal-entity.ts` | Widens `field_definitions.entity_type` CHECK to allow deals; adds `custom_fields` JSONB to `deals` |
| ... | `scripts/migrate-deal-activity-links.ts` | Adds `deal_id` FK to `activities`/`follow_ups` (replaces the description-prefix soft link), backfills historical rows |
| latest | `scripts/migrate-deal-stages-expand.ts` | Widens `deals.stage` CHECK with LOI/lease/PSA milestones; adds `expected_close_date` |

## Adding a new migration

1. Create `scripts/migrate-<name>.ts` following the existing pattern: connect with `pg`, run idempotent SQL (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`), disconnect.
2. Add it to the `SCRIPTS` array in `scripts/migrate-all.ts` in the correct dependency position.
3. Add the new tables/columns to the `EXPECTED` array in `scripts/verify-schema.ts`.
4. Run `npm run migrate && npm run db:verify` to apply and confirm.

## Other database scripts

| Command | Script | Purpose |
|---------|--------|---------|
| `npm run audit:properties` | `scripts/audit-bad-properties.ts` | Lists properties with bad data from the broken old address lookup (read-only) |
| `npm run check:gis` | `scripts/check-gis-accuracy.ts` | Tests GIS address lookup accuracy against known folio numbers |
