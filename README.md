# Beacon

AI-native CRM for commercial real estate brokers. Built on Next.js 16, Supabase, and Claude.

## Prerequisites

- Node.js 20+
- A Supabase project
- An Anthropic API key

## Environment variables

Create a `.env.local` file at the project root:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
DATABASE_URL=postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
ANTHROPIC_API_KEY=sk-ant-...
```

`DATABASE_URL` is only used by the migration scripts and never exposed to the browser.

## Database setup

Run all migrations against your Supabase database:

```bash
npm run migrate
```

This runs four scripts in order — each is idempotent, so re-running is always safe:

| Script | What it does |
|---|---|
| `migrate.ts` | Creates `properties`, `contacts`, `lease_abstracts` tables with RLS |
| `migrate-contacts.ts` | Adds `size_category`, `geographic_category`, `ownership_type` to `contacts` |
| `migrate-custom-fields.ts` | Creates `field_definitions` table; adds `custom_fields JSONB` to all three entity tables |
| `setup-storage.ts` | Creates the `leases` storage bucket with RLS policies |

If any script fails the run stops immediately and prints the exit code. Fix the error and re-run — scripts that already succeeded will simply no-op.

## Development

```bash
npm install
npm run migrate   # first time, or after pulling schema changes
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Adding a new migration

1. Create `scripts/migrate-something.ts` following the same pattern (pg `Client`, idempotent SQL, `process.exit(1)` on error).
2. Add it to the `SCRIPTS` array in `scripts/migrate-all.ts` in the correct dependency order.
3. Run `npm run migrate`.

## Other scripts

```bash
npm run build    # production build
npm run start    # serve production build
npm run lint     # ESLint
```
