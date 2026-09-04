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
JINA_API_KEY=                       # optional; listing page fetch
BRAVE_SEARCH_API_KEY=               # optional; listing discover (preferred)
SERPER_API_KEY=                     # optional; listing discover fallback
```

`DATABASE_URL` is only used by the migration scripts and never exposed to the browser.

## Database setup

Run all migrations against your Supabase database:

```bash
npm run migrate
```

This runs **all** idempotent TypeScript migrations in `scripts/migrate-all.ts` (65+ scripts). Re-running is always safe (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

Then verify:

```bash
npm run db:verify
npm run types:gen   # regenerates lib/database.types.ts from the live schema
```

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
npm run typecheck
npm test         # Vitest (exclude tests/security in CI — those need a live Supabase)
npm run db:verify
```

GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, and Vitest on pull requests and on pushes to `main`. Live GIS describes skip when `CI=true`. Security isolation tests are excluded from default CI.
