# Beacon — Product Requirements Document
**Version:** July 2026  
**Audience:** New engineers joining the Beacon project

**Pilot truth for brokers:** see `Beacon_Pilot_Readiness.md` (what shipped, honest limits, day-1 path). This PRD is the engineering map.

---

## 1. What Is Beacon?

Beacon is a single-broker CRM for commercial real estate. One user. No teams, no multi-tenant. The broker uses it to:

1. **Track properties** — who owns them, when they last sold, what's on the land (Miami-Dade + Broward tax roll)
2. **Track owner contacts** — with contact tiers, outreach cadence, and relationship notes
3. **Track lease abstracts** — expiration dates, base rates, tenants (must be linked to a property)
4. **Stay on top of follow-ups** — lease expiry alerts, cadence overdue reminders
5. **Draft outreach** — AI-generated emails, sent manually via the broker's own email client
6. **Track pursuits** — type-aware deal pipeline (tenant rep / listing / investment sale)
7. **Ask Beacon** — Copilot on the dashboard for portfolio / focus questions

The app is South Florida–centric. Primary county sources: Miami-Dade Property Appraiser (MDPA) and Broward County Property Appraiser (BCPA GIS). Sunbiz (Florida Division of Corporations) identifies humans behind LLC owners.

---

## 2. Tech Stack

| Layer | What |
|-------|------|
| Framework | Next.js 16.2.9, App Router, React 19.2.4 |
| React Compiler | `reactCompiler: true` in `next.config.ts` — auto-memoization, experimental |
| Auth + DB | Supabase (email/password, PostgreSQL, RLS, Storage) |
| Styling | Tailwind CSS v4 + shadcn/ui (Nova preset) |
| AI | Anthropic Claude SDK — Opus 4.8 for extraction, Haiku for NLP/drafts/briefings |
| Testing | Vitest v4 (unit tests for pure functions only) |
| Spreadsheet export | `xlsx` library |

**No API routes for mutations.** Everything goes through Next.js Server Actions (`"use server"` functions). Data fetching in Server Components (no React Query, no SWR).

---

## 3. Running Locally

```bash
# Install
npm install

# Env vars needed (create .env.local):
NEXT_PUBLIC_SUPABASE_URL=<your supabase project url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your supabase anon key>
ANTHROPIC_API_KEY=<your anthropic api key>
DATABASE_URL=<direct postgres connection string for migrations>

# Run database migrations (idempotent, safe to re-run)
npm run migrate

# Verify schema is correct
npm run db:verify

# Start dev server
npm run dev

# Tests
npm test
```

---

## 4. Database Schema (Quick Reference)

All tables share the same pattern: `owner_id uuid FK auth.users`, RLS enforced. No shared data between users.

### Core entities

**`properties`** — the central entity. Key columns:
- `address`, `city`, `submarket`
- `owner_name`, `ownership_type`, `owner_mailing_address`
- `owner_contacts jsonb` — array of `{name, title, address}` from Sunbiz
- `size_sqft`, `land_sqft`, `asset_description`
- `last_sale_date`, `last_sale_price`
- `building_composition jsonb` — year_built, stories, units, dor_code, assessed_value, legal_description
- `source` — `'tax_roll'` (MDPA address lookup) | `'url'` | `'upload'`
- `source_url` — `'mdpa:<strap>'` for county-sourced, full URL for listing-sourced
- `confidence_flags jsonb` — `[{field, reason}]` — AI uncertainty flags
- `prospect_number integer` — auto-incremented per owner by DB trigger
- `custom_fields jsonb` — user-defined fields keyed by slug
- `ownership_change_detected_at`, `ownership_change_data jsonb` — set when MDPA re-check finds different owner

**`contacts`** — CRM contacts. Key columns:
- `name`, `email`, `phone`, `phone_mobile`, `phone_office`
- `contact_tier integer` — 1 / 2 / 3; cadence days from `user_settings.cadence_tier*_days` (defaults 14 / 30 / 90 via `lib/cadence.ts`)
- `last_contacted_at`, `next_action_due`
- `action_tags text[]` — free-form tags (also used for source: `sunbiz`, `costar`, `unverified`, `mdpa_mailing`)
- `linked_properties text[]` — **legacy** array of property IDs; still dual-written. Prefer **`contact_properties`** join for reads (`lib/contact-properties.ts`)
- `outreach_history jsonb` — `[{sent_at, subject, body, method}]` — grows unboundedly in this column
- `ownership_role`, `relationship_stage`, `lead_source`, `asset_focus text[]`
- `contact_type` — `'owner'` | `'tenant'` | `'other'`
- `custom_fields jsonb`

**`contact_properties`** — many-to-many join (contact_id, property_id, owner_id). Canonical for “contacts on asset” / “assets for contact.”

**`lease_abstracts`** — AI-extracted lease data. Key columns:
- `linked_property uuid FK properties` — **required on save** (server rejects null)
- `tenant_contact_id uuid FK contacts`
- `source_document text` — Supabase Storage path: `<owner_id>/<filename>`
- `execution_date`, `expiration_date`, `base_rate`, `term`
- `renewal_options`, `use_clause`, `escalation_clause`, `parking`, `operating_expenses`
- `custom_fields jsonb`

**`deals`** — CRE pursuit pipeline. `deal_type`: `tenant_rep` | `listing` | `investment_sale`. Stage sets are type-aware; `under_contract` and `won` are active; terminal stages are `closed` / `lost`.

### Supporting tables

- **`activities`** — touch-point log. Types: `letter | email | call | note | meeting`. Linked to contact + optionally property.
- **`follow_ups`** — tasks with due dates. Types: `manual` or `lease_expiry`. Unique constraint prevents duplicate lease-expiry follow-ups.
- **`field_definitions`** — schema for custom fields. `entity_type: 'property' | 'contact' | 'lease'`, `fill_mode: 'extract' | 'manual'`. Extract fields are dynamically added to AI extraction schemas.
- **`ingestion_errors`** — error log for property ingestion stages. Never blocks the ingestion caller.
- **`smart_lists`** — saved NL search filters. Schema exists; no UI to manage them yet.
- **`user_settings`** — per-broker profile, outreach preferences, cadence intervals, CoStar toggle.

---

## 5. Key Data Flows

### 5.1 Property Ingestion (MDPA Address)

```
User enters address
  → app/properties/new/actions.ts:ingestAddress
  → lib/mdpa.ts:searchByAddressGIS (Miami-Dade ArcGIS REST API)
  → Returns candidate parcels (never auto-selects)
User picks a folio
  → ingestChosenFolio
  → lib/mdpa.ts:getPropertyDetail (MDPA PaServicesProxy)
  → lib/property-pipeline.ts:extractPropertyFields (Claude Opus 4.8 with strict no-hallucination prompt)
  → If owner is an entity (LLC/INC/etc): lib/sunbiz.ts:searchAndExtractSunbiz (non-blocking)
  → Returns preview with confidence_flags
User confirms save
  → saveIngestedProperty
  → lib/property-ingest.ts:upsertProperty (dedup by source_url exact match, then address case-insensitive)
```

### 5.2 Property Ingestion (URL)

```
User enters URL
  → app/properties/url/actions.ts:ingestUrl
  → Fetch via r.jina.ai/{url} (Jina Reader, up to 4 retries on block)
  → extractPropertyFields (Claude Opus 4.8)
  → Preview → saveIngestedUrl
```

### 5.3 Property Enrichment (Post-Ingest)

On the property detail page (`/properties/[id]`), the EnrichPanel provides:
1. **County data** — GIS search for the property's address → pick folio → preview field diffs → apply (calls `applyCountyEnhancement`)
2. **Sunbiz owners** — looks up entity name in Sunbiz → select persons → save to `owner_contacts` JSONB
3. **Promote to CRM** — creates a contact row from a Sunbiz person or MDPA owner
4. **CoStar upload** — PDF/image/CSV → Claude Haiku extracts contacts → creates contact rows tagged `costar unverified`

### 5.4 Outreach Flow

```
Outreach page lists contacts due/overdue (by cadence thresholds)
User selects contacts → generateDrafts (Claude Haiku, max 10)
User reviews draft → "Open in email ↗" → mailto: link → broker's email client
Broker sends email manually
User clicks "Mark as sent" → logOutreach → writes to outreach_history JSONB + updates last_contacted_at + creates activity record
```

**Beacon does not send email.** This is by design.

### 5.5 Lease Radar

```
Lease Radar page
  → getLeaseRadarData: fetches leases expiring within 12 months (property-linked only are actionable)
  → Buckets: <3mo (urgent), 3-6mo (soon), 6-12mo (watch)
  → resolveOutreachContact: tenant-facing actions → tenant_contact when present; owner-facing → owner contact
User clicks "Sync follow-ups"
  → syncLeaseFollowUps: creates follow_up rows aligned to action type / contact
  → Unique index (owner_id, contact_id, lease_id, lease_bucket) prevents duplicates
```

### 5.6 AI Search (NLP)

In the CRM, the search box accepts natural language:
```
"owners in Brickell with LLC names"
  → interpretSearch (Claude Haiku, tool use)
  → Returns SearchResult: {target, properties: {filters}, contacts: {filters}, explanation}
  → Filters applied server-side via Supabase query builder
```

### 5.7 Relationship Briefing

On a contact detail page:
```
User clicks "Generate briefing"
  → generateRelationshipBriefing (Claude Haiku)
  → Gathers: contact record + linked properties + activities + follow-ups + outreach history + leases
  → Returns: {whereThingsStand: string, suggestedNextMove: string}
```

### 5.8 Owner Portfolio

From a property or contact, the "Portfolio →" link goes to `/owner-portfolio/property/[id]` or `/owner-portfolio/contact/[id]`.

This page aggregates all workspace properties belonging to the same owner (entity fuzzy match or person name match) and shows a unified timeline of lease events, contacts, outreach, and activities.

It also offers a county-wide tax roll search (via Miami-Dade ArcGIS) to discover the owner's properties that are NOT yet in the broker's workspace.

---

## 6. Authentication and Security

- Auth: `supabase.auth.getUser()` in every server action (validates JWT server-side). Never `getSession()`.
- RLS: `owner_id = auth.uid()` on all tables. Server actions also check `owner_id` explicitly in queries (defense-in-depth).
- Storage: `leases` bucket, path format `<owner_id>/<filename>`. Path traversal checked at save time.
- AI key: `process.env.ANTHROPIC_API_KEY` — server-side only, never exposed to client.

---

## 7. Navigation Structure

```
/login                    Auth (no app shell)
/onboarding               First-run gate
/dashboard                Broker command center — KPIs, Needs attention, Ask Beacon (Copilot)
/crm                      Workspace — properties / contacts / leases tabs
/deals                    Pursuit pipeline (kanban); /deals?new=1 opens create dialog
/properties/new           Add property (address / URL / upload)
/properties/[id]          Property detail + enrich + tax-roll comps + Owner portfolio CTA
/contacts/new             Add contact manually
/contacts/[id]            Contact detail + briefing + Owner portfolio CTA
/abstracts/new            Upload + abstract a lease (property required)
/abstracts/[id]           Lease abstract detail
/lease-radar              Expiring leases + tenant/owner outreach + follow-up sync
/follow-ups               Follow-up list
/outreach                 Cadence-driven outreach drafts (mailto — no send)
/owner-portfolio/...      Owner portfolio (by property or contact)
/properties/audit         Advanced — data audit
/properties/errors        Advanced — ingestion errors
/settings                 User settings (cadence, profile)
/settings/fields          Custom field definitions
/api/export/properties    XLSX download (GET, auth-checked)
/api/export/contacts      XLSX download (GET, auth-checked)
/api/export/leases        XLSX download (GET, auth-checked) — verify columns before demo
```

Primary nav labels: Dashboard, Workspace, Deals, Lease radar, Follow-ups, Outreach, Settings.
---

## 8. Custom Fields System

Users can define custom fields for properties, contacts, and leases at `/settings/fields`.

- Fields are stored in `field_definitions` with `entity_type`, `field_name`, `field_type` (text/number/date/select), `select_options`, and `fill_mode` (extract/manual).
- Field values are stored as JSONB in `custom_fields` on each entity, keyed by slug (`lib/custom-fields.ts:fieldSlug`).
- Fields with `fill_mode='extract'` are dynamically injected into the Anthropic tool schema during ingestion, so the AI can populate them from source documents.
- **Known gap:** No UPDATE RLS policy on `field_definitions`. Renaming a field requires deleting and recreating it.

---

## 9. Known Issues / Remaining Risks

### Still watch in pilot
1. **Lease export** (`app/api/export/leases/route.ts`): historically queried columns that don't exist — verify before promising export demos.
2. **CoStar toggle** (`user_settings.costar_enabled`): preference UX; CoStar remains **file upload only**, not a live API.
3. **Scale**: app shell badge counts, owner portfolio, and some dashboard aggregations favor simplicity over large-book performance.
4. **Dual-write**: `linked_properties[]` still written; reads prefer `contact_properties`.

### Fixed (do not re-open as bugs)
- Cadence settings **do** drive due/overdue math via `lib/cadence.ts` + `user_settings`.
- Lease abstracts **require** `linked_property` on save; clearing to null is blocked.
- Deals / pursuit pipeline **exists** with type-aware stages.

### UX / polish
- Dark mode may flash on load (theme from localStorage; no server-side init in `app/layout.tsx`).

See `Beacon_Pilot_Readiness.md` for the full pilot risk list.

---

## 10. What Does Not Exist Yet

- Email **sending** (only compose via mailto / web client)
- Mobile app
- Calendar sync
- CoStar **live** API (file upload only)
- Team / shared workspace
- Map view of portfolio
- Smart list management UI (table may exist; no producer UI)
- Drop of legacy `linked_properties` column (join is preferred; dual-write remains)

---

## 11. Adding a Feature — Checklist

1. **New table?** Create `scripts/migrate-<name>.ts` following existing pattern (idempotent SQL). Add to `SCRIPTS` in `scripts/migrate-all.ts`. Add to `EXPECTED` in `scripts/verify-schema.ts`. Add RLS policy.
2. **New server action?** Add `"use server"` directive. Call `supabase.auth.getUser()` first. Return `{ error?: string }` or typed result, not throw.
3. **New AI call?** Use tool use (`tools` + `tool_choice: {type: "tool", name: "..."}`), not free text. Use Haiku for speed (NLP, search, drafts). Use Opus for extraction (structured data from documents).
4. **Custom fields in extraction?** Call `fetchFieldDefs(supabase, entityType)` and pass to `extractPropertyFields` as `customExtractFields` arg. Only fields with `fill_mode='extract'` should be included.
5. **New route?** Check auth at the top. Use `createClient` from `lib/supabase/server.ts` (not client).
6. **Tests?** Add Vitest unit tests for any pure function in `lib/`. External services (Supabase, Claude, MDPA) are not mocked — don't write integration tests without a clear strategy for mocking them.
7. **Do not delete** Copilot, Deals, Lease radar, Follow-ups, Outreach, or Owner portfolio without an explicit product decision.
