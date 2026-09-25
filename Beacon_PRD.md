# Beacon — Product Requirements Document
**Version:** August 2026 (rev. 2 — team multi-tenancy)
**Audience:** New engineers joining the Beacon project

**Pilot truth for brokers:** see `Beacon_Pilot_Readiness.md` (what shipped, honest limits, day-1 path). This PRD is the engineering map.

---

## 1. What Is Beacon?

Beacon is a CRM for commercial real estate brokers. Every account still defaults to acting exactly like a single-broker tool — one owner, fully private data, nothing shared with anyone — but a broker can now invite teammates into a firm and explicitly share specific records with them. See §5.11 and `Beacon_Team_Multitenancy_Plan.md` for the full design and the safety rationale behind it; the short version is that sharing is opt-in per record, never automatic, and this was built ahead of pilot validation by explicit product decision (§9). The broker uses Beacon to:

1. **Track properties** — who owns them, when they last sold, what's on the land (Miami-Dade, Broward, and Palm Beach tax roll; Boston-metro Massachusetts via MassGIS)
2. **Track owner contacts** — with contact tiers, outreach cadence, and relationship notes
3. **Track lease abstracts** — expiration dates, base rates, tenants (must be linked to a property)
4. **Stay on top of follow-ups** — lease expiry alerts, cadence overdue reminders
5. **Draft outreach** — AI-generated emails, sent manually via the broker's own email client
6. **Run a pursuit pipeline** — type-aware deal stages (tenant rep / listing / investment sale), worked as a kanban board, a sortable list, or a weighted forecast, with a full deal detail page
7. **Attach documents** — files (leases, OMs, LOIs, etc.) attached directly to a property, contact, lease, or deal
8. **Ask Beacon** — Copilot on the dashboard for portfolio / focus questions
9. **Optionally work as a firm** — invite teammates, share specific properties/contacts/leases/deals/activities/follow-ups/documents with them, and browse "My book" vs. "Entire firm" in the Workspace

The app is South Florida–centric. Primary county sources: Miami-Dade Property Appraiser (MDPA), Broward County Property Appraiser (BCPA GIS), and Palm Beach County Property Appraiser (PBCPA). Sunbiz (Florida Division of Corporations) identifies humans behind LLC owners.

---

## 2. Tech Stack

| Layer | What |
|-------|------|
| Framework | Next.js 16.2.9, App Router, React 19.2.4 |
| React Compiler | `reactCompiler: true` in `next.config.ts` — auto-memoization, experimental |
| Auth + DB | Supabase (email/password, PostgreSQL, RLS, Storage) |
| Styling | Tailwind CSS v4 + shadcn/ui (Nova preset) |
| AI | Anthropic Claude SDK — `claude-opus-4-8` for extraction, `claude-haiku-4-5-20251001` for NLP/drafts/briefings. TypeSafe Jev (`jev-1.13.0`) for typed search/copilot routing, listing/document gates, and Today-desk cadence nudges when `JEV_API_KEY` is set; Haiku and rule scores remain the fallback. |
| Drag-and-drop | `@dnd-kit/core` — deals kanban board |
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
JEV_API_KEY=<typesafe jev key — also accepts TYPESAFE_API_KEY>
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

All tables share the same pattern: `owner_id uuid FK auth.users`, RLS enforced. Every row defaults to fully private — the sole exception is the opt-in team-sharing layer described below and in §5.11.

**Team-sharing at a glance:** `properties`, `contacts`, `lease_abstracts`, `deals`, `activities`, `follow_ups`, and `documents` each carry a `visibility` column (`'private'` default | `'team'`). Every RLS policy on these seven tables is `auth.uid() = owner_id OR (visibility = 'team' AND is_firm_teammate(owner_id))` — strictly additive on top of the original owner-only check, never a replacement of it. `field_definitions` is the one exception with no `visibility` column at all: it's firm-wide *unconditionally* (`auth.uid() = owner_id OR is_firm_teammate(owner_id)`), since a shared record's custom-field schema needs to be consistent across teammates, not opt-in per field. `entities`/`entity_properties`/`entity_contacts`, `error_logs`, `ingestion_errors`, `smart_lists`, and `user_settings` are deliberately untouched — still owner-only, no team-sharing path at all.

### Core entities

**`properties`** — the central entity. Key columns:
- `address`, `city`, `submarket`
- `owner_name`, `ownership_type`, `owner_mailing_address`
- `owner_contacts jsonb` — array of `{name, title, address}` from Sunbiz
- `size_sqft`, `land_sqft`, `asset_description`
- `last_sale_date`, `last_sale_price`
- `building_composition jsonb` — year_built, stories, units, dor_code, assessed_value, legal_description
- `source` — `'tax_roll'` (MDPA/BCPA/PBCPA address lookup) | `'url'` | `'upload'`
- `source_url` — `'mdpa:<strap>'` / `'bcpa:<folio>'` / `'pbcpa:<pcn>'` for county-sourced, full URL for listing-sourced
- `confidence_flags jsonb` — `[{field, reason}]` — AI uncertainty flags
- `field_sources jsonb` — per-field provenance (county / sunbiz / document / url / pasted)
- `prospect_number integer` — auto-incremented per owner by DB trigger
- `custom_fields jsonb` — user-defined and industrial-spec fields keyed by slug
- `clear_height_ft`, `dock_doors`, `drive_in_doors`, `power_amps`, `power_phase`, `yard_acres`, `column_spacing`, `sprinkler_type`, `availability_status`, `asking_rent_psf`, `nnn_cam_psf`, `lease_structure` — first-class industrial columns dual-written from mapped industrial-spec slugs (`lib/industrial-fields.ts`)
- `latitude`, `longitude` — stored pin-map geocodes (Nominatim)
- `ownership_watch_enrolled_at`, `ownership_last_checked_at`, `ownership_change_detected_at`, `ownership_change_data jsonb` — set when a re-check finds a different owner
- `entity_id` — FK to `entities` (durable legal-entity record), backfilled from owner name matching

**`contacts`** — CRM contacts. Key columns:
- `name`, `email`, `phone`, `phone_mobile`, `phone_office`
- `contact_tier integer` — 1 / 2 / 3; cadence days from `user_settings.cadence_tier*_days` (defaults 14 / 30 / 90 via `lib/cadence.ts`)
- `last_contacted_at`, `next_action_due`
- `action_tags text[]` — free-form tags (also used for source: `sunbiz`, `costar`, `unverified`, `mdpa_mailing`)
- `linked_properties text[]` — **legacy** array of property IDs; still dual-written. Prefer **`contact_properties`** join for reads (`lib/contact-properties.ts`)
- `outreach_history jsonb` — `[{sent_at, subject, body, method}]` — grows unboundedly in this column
- `ownership_role`, `relationship_stage`, `lead_source`, `asset_focus text[]`
- `contact_type` — `'owner'` | `'tenant'` | `'other'`
- Buyer / 1031 criteria (cap rate, markets, exchange deadline) — see `migrate-industrial-cre.ts`
- `custom_fields jsonb`

**`contact_properties`** — many-to-many join (contact_id, property_id, owner_id). Canonical for "contacts on asset" / "assets for contact."

**`lease_abstracts`** — AI-extracted lease data. Key columns:
- `linked_property uuid FK properties` — **required on save** (server rejects null)
- `tenant_contact_id uuid FK contacts`
- `source_document text` — Supabase Storage path: `<owner_id>/<filename>`
- `execution_date`, `expiration_date`, `base_rate`, `term`
- `renewal_options`, `use_clause`, `escalation_clause`, `parking`, `operating_expenses`
- `field_reviews jsonb` — per-field accept/reject/correct with corrections
- `custom_fields jsonb`

**`deals`** — CRE pursuit pipeline. `deal_type`: `tenant_rep` | `listing` | `investment_sale`. Stages are type-aware and now span the full pursuit lifecycle: `prospect → contacted → meeting → requirement → proposal → won → loi_sent → loi_executed → lease_drafting → lease_signed → psa_signed → due_diligence → under_contract → closed / lost`. Which of these apply depends on `deal_type` (e.g. tenant-rep pursuits get the lease-track stages, investment-sale pursuits get PSA/due-diligence stages) — see `STAGES_BY_DEAL_TYPE` in `lib/deals.ts`. `under_contract` and `won` are active; terminal stages are `closed` / `lost`. Each stage carries a rough historical close probability (`STAGE_PROBABILITY`) used to weight the pipeline forecast. Other key columns:
- `estimated_commission`, `expected_close_date`
- `notes`, `next_action`, `next_action_due`
- `custom_fields jsonb`

### Supporting tables

- **`activities`** — touch-point log. Types: `letter | email | call | note | meeting`. Linked to contact and/or property, and optionally a **`deal_id`** FK (`ON DELETE CASCADE`) so a deal's timeline can show its own touches.
- **`follow_ups`** — tasks with due dates. `source_type`: `manual` or `lease_expiry`. Also carries a **`deal_id`** FK (`ON DELETE CASCADE`) — a deal's "next action due" syncs to a real follow-up row here rather than the old description-prefix soft link. Unique constraint prevents duplicate lease-expiry follow-ups.
- **`documents`** — generic file attachments. `entity_type`: `property | lease | contact | deal`, `entity_id`, `file_name`, `storage_path`, `content_type`, `size_bytes`. Backed by the `documents` Storage bucket (32 MB cap, signed URLs, owner-scoped RLS). Rendered via the shared `DocumentsSection` component on property, contact, lease, and deal detail pages.
- **`field_definitions`** — schema for custom fields. `entity_type: 'property' | 'contact' | 'lease' | 'deal'`, `fill_mode: 'extract' | 'manual'`, `field_group: 'custom' | 'industrial'`. Extract fields are dynamically added to AI extraction schemas. Industrial-group defs power the property **Industrial / flex specs** card (Customize); Workspace **Manage fields** is `custom` only. Has both INSERT/DELETE and **UPDATE** RLS policies, so renaming a field in place (rather than delete-and-recreate) is supported end-to-end — `lib/custom-fields.ts:renameCustomFieldValues` migrates any already-stored values to the new slug. Firm-wide by default (see above) — a teammate sees and can rename the whole firm's custom fields, not just their own.
- **`rent_comps`** — broker-entered + seed South Florida rent bands for the property rent notebook (not live CoStar).
- **`tours`** — scheduled property tours (attendees, prep notes, status).
- **`background_jobs`** / **`dashboard_kpi_cache`** — job queue + cached dashboard KPIs (`/api/jobs/process`).
- **`oauth_connections`** — per-user flags for Gmail/Outlook send, calendar, DocuSign. Callbacks return 501 until env keys exist; token exchange is not wired.
- **`entities`** / **`entity_properties`** / **`entity_contacts`** — durable legal-entity records (e.g. an LLC) decoupled from any one property, with join tables linking them to properties and contacts. Owner-only — explicitly out of scope for team-sharing in v1.
- **`ingestion_errors`** / **`error_logs`** — error logs for property ingestion and general server-action failures. Never block the caller. Owner-only.
- **`smart_lists`** — saved NL search filters. Schema exists; no UI to manage them yet. Owner-only — a personal saved filter can still be *run* against either Workspace scope (§5.11), it just isn't itself shared.
- **`user_settings`** — per-broker profile, outreach preferences, cadence intervals, CoStar toggle, onboarding state, email provider preference, `pilot_agreement_accepted_at`, `industrial_specs_initialized` (seed-once for default industrial field defs). Owner-only; a narrow RPC (`firm_teammate_names()`) exposes just `{user_id, display_name}` to teammates for the Workspace ownership indicator — nothing else from this table.
- **`firms`** — a brokerage/team. Every account gets a personal one automatically (at signup going forward, backfilled once for pre-existing accounts) — "solo broker" and "firm member" are the same code path, there's no separate no-firm state. `name`, `created_by` (nullable, `ON DELETE SET NULL` — the firm survives its creator's account being deleted, since other members may remain).
- **`firm_members`** — membership + `role` (`owner | admin | member`) + `status` (`active | removed`, never hard-deleted). A partial unique index enforces at most one *active* firm per user (v1: no multi-firm membership).
- **`firm_invitations`** — pending link-based invites (`token`, `email`, `role`, `expires_at`, `accepted_at`, `revoked_at`). No service-role key anywhere in this feature — invite redemption is a real RLS grant (`firm_members_join_via_invitation`) plus a `SECURITY INVOKER` RPC (`redeem_firm_invitation`), not a privileged bypass.

---

## 5. Key Data Flows

### 5.1 Property Ingestion (County Address Lookup)

```
User enters address
  → app/properties/new/actions.ts:ingestAddress
  → lib/county-router.ts:detectCounty + searchParcelsByAddress
      (queries Miami-Dade ArcGIS, Broward BCPA GIS, and Palm Beach PBCPA in parallel)
  → Returns candidate parcels (never auto-selects)
User picks a folio/PCN
  → ingestChosenFolio
  → County-specific detail fetch (lib/mdpa.ts / lib/bcpa.ts / lib/pbcpa.ts)
  → lib/property-pipeline.ts:extractPropertyFields (Claude Opus 4.8 with strict no-hallucination prompt)
      — Palm Beach maps its record directly to fields without a Claude call (no free-text source to parse)
  → If owner is an entity (LLC/INC/etc): lib/sunbiz.ts:searchAndExtractSunbiz (non-blocking)
  → Returns preview with confidence_flags
User confirms save
  → saveIngestedProperty
  → lib/property-ingest.ts:upsertProperty (dedup by source_url exact match, then address case-insensitive)
```

Coverage today is **Miami-Dade, Broward, and Palm Beach counties (FL), plus the Boston-metro area — Suffolk, Middlesex, Norfolk, and Essex counties (MA), via the statewide MassGIS parcel service**; an address search outside that coverage returns a coverage error rather than a false negative. Massachusetts properties are enriched deterministically from MassGIS the same way Broward/Palm Beach are (no Claude call needed) — see `lib/magis.ts`. Entity/LLC lookup (Sunbiz) remains Florida-only; it is not queried for Massachusetts properties (see §5.8).

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
1. **County data** — GIS search for the property's address (any of the three counties) → pick folio/PCN → preview field diffs → apply (calls `applyCountyEnhancement`)
2. **Sunbiz owners** — looks up entity name in Sunbiz → select persons → save to `owner_contacts` JSONB
3. **Promote to CRM** — creates a contact row from a Sunbiz person or MDPA owner
4. **CoStar upload** — PDF/image/CSV → Claude Haiku extracts contacts → creates contact rows tagged `costar unverified`
5. **Document/URL/paste enhancement** — attach a document, paste text, or point at a URL to fill in additional fields outside the county/Sunbiz flow

### 5.4 Outreach Flow

```
Outreach page lists contacts due/overdue (by cadence thresholds)
User selects contacts → generateDrafts (Claude Haiku, max 10, varies angle after repeat touches)
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

It also offers a county/state-wide tax roll search (via Miami-Dade, Broward, Palm Beach, and Massachusetts/MassGIS) to discover the owner's properties that are NOT yet in the broker's workspace. Entity/LLC lookup (Sunbiz) stays Florida-only — Massachusetts owner names are shown as the tax roll lists them, with no LLC-to-person resolution.

### 5.9 Deals Pipeline

```
/deals
  → getDeals + getDealsForecast (Server Components, fetched in parallel)
  → DealsView renders three switchable modes:
      Kanban  — @dnd-kit drag-and-drop between type-aware stage columns; quick-log call/tour
               and inline outreach compose from each card
      List    — sortable/filterable table with multi-select bulk stage-change and bulk delete
      Forecast — weighted pipeline value (commission × STAGE_PROBABILITY), win rate, stale-deal
               count, pipeline-by-stage breakdown, and an aging-deals list
  → Manage fields opens the same CustomFieldsPanel used elsewhere, scoped to entity_type "deal"
/deals/[id]
  → Deal detail page: linked contact/property cards, custom fields, DocumentsSection,
    and a combined activity + follow-up timeline (DealActivitySection)
  → Deleting a deal cascades its activities/follow_ups (deal_id FK) and cleans up its
    documents (deleteDocumentsForEntity) before the deals row itself is removed
```

A contact page also nudges the broker to create a pursuit once three outreach touches have landed with zero linked deals, one click into the existing create-deal dialog.

### 5.10 Document Attachments

```
Any property / contact / lease / deal detail page
  → DocumentsSection component
  → uploadDocument(supabase, userId, entityType, entityId, file)
      — 32 MB cap, sanitized filename, stored at <owner_id>/<entity_type>/<entity_id>/<ts>-<name>
  → listDocuments returns rows with a fresh 1-hour signed URL each render
  → Deleting the parent entity calls deleteDocumentsForEntity first, so no orphaned
    storage objects survive a property/contact/lease/deal delete
```

### 5.11 Team / Firm Sharing

Full design, RLS rationale, and the safety testing behind this in `Beacon_Team_Multitenancy_Plan.md` — this is the condensed version.

```
Workspace (/crm)
  → app/crm/page.tsx computes isSoloFirm + a teammate display-name map server-side
    (lib/firms.ts:getWorkspaceTeamContext), passed down as props — no client flash,
    no extra round-trip for the (overwhelmingly common) solo case
  → "My book" / "Entire firm" toggle in the filter bar, rendered ONLY when the
    broker's active firm has more than one active member
  → "My book" adds an explicit .eq("owner_id", userId) narrowing filter;
    "Entire firm" is the query exactly as it always was, letting RLS itself be
    the ceiling — the unscoped query already meant "my rows only" before this
    feature existed, purely because RLS allowed nothing else
  → Teammate rows in the grid show a small ownership badge (name from
    firm_teammate_names()); shared records are co-editable, not read-only

Sharing a record
  → <ShareWithFirmToggle> on the property/contact/lease/deal detail page —
    visible only to the record's actual owner, only in a multi-member firm
  → Flips visibility 'private' <-> 'team' directly (RLS-bound client call,
    no server action needed — the RLS policy itself is the only real gate)

Inviting a teammate
  → Settings → Team (app/settings/team) → invite form (owner/admin only)
  → Creates a firm_invitations row with a random token, 7-day expiry
  → Inviting broker sends the /join/[token] link themselves (email/text/Slack) —
    same "broker sends manually" philosophy as outreach; no transactional
    email infra, no service-role key
  → Invited person visits /join/[token] → signs up/in → redeem_firm_invitation()
    RPC does, in one transaction: leave their current firm (if any), join the
    new one, mark the invitation accepted — all still RLS-checked throughout,
    not bypassed

Leaving / removal
  → firm_members.status flips to 'removed' (never hard-deleted) — every
    is_firm_teammate() check involving that person stops matching immediately,
    so their shared records disappear from former teammates' view (and vice
    versa) with no row in any of the seven shared tables needing to change
```

---

## 6. Authentication and Security

- Auth: `supabase.auth.getUser()` in every server action (validates JWT server-side). Never `getSession()`.
- RLS: `owner_id = auth.uid()` on all tables. Server actions also check `owner_id` explicitly in queries (defense-in-depth).
- Storage: `leases` bucket and `documents` bucket, path format `<owner_id>/<...>`. Path traversal checked at save time. Both buckets carry owner-scoped DELETE/UPDATE policies (not just INSERT/SELECT), so account deletion actually purges uploaded files.
- **Account deletion**: Settings → Account → Delete account (`deleteAccount` in `app/settings/actions.ts`, backed by `lib/account-deletion.ts:deleteAllUserRows`) removes every owned row across all tables, all storage objects in both buckets, and the auth login itself. Covered by an end-to-end test plus a dedicated multi-tenant isolation test suite.
- Signup: pilot auto-confirms email in Postgres directly rather than relying on Supabase's outbound mailer. Also bootstraps a personal firm (`lib/firms.ts:ensurePersonalFirm`).
- **Team sharing RLS**: every team-visibility policy calls one shared `is_firm_teammate(target_owner_id)` `SECURITY DEFINER` function rather than each of the seven tables re-deriving the cross-firm join inline — collapses "did we get the cross-firm check right" into one reviewable unit instead of seven. A handful of similarly narrow `SECURITY DEFINER` helpers exist for the same reason RLS policies can't read `auth.users` directly under the `authenticated` role: `my_email()` (self-scoped only), `firm_teammate_names()` (only `{user_id, display_name}`), `mark_invitation_accepted()` (only flips `accepted_at` on an already-validated row — an invitee isn't yet admin/owner, so a general UPDATE grant would let them tamper with their own invitation's `role`/`firm_id` first). No service-role key anywhere in this feature or the app.
- AI key: `process.env.ANTHROPIC_API_KEY` — server-side only, never exposed to client.

---

## 7. Navigation Structure

```
/login                    Auth (no app shell)
/onboarding               First-run gate
/pilot-agreement          Accept private-pilot terms (signup + existing users)
/how-beacon-works         Explainer page (linked from onboarding and Settings)
/dashboard                Broker command center — KPIs, Do these today, Ask Beacon (Copilot)
/crm                      Workspace — properties / contacts / leases tabs
/deals                    Pursuit pipeline — kanban / list / forecast views; /deals?new=1 opens create dialog
/deals/[id]               Deal detail — linked contact/property, custom fields, documents, timeline, Download LOI
/book-map                 Corridor buckets + pin map (Leaflet/OSM; Nominatim geocode)
/tours                    Schedule property tours (Advanced)
/prospect                 Off-book industrial / flex owner finder (tax roll)
/properties/new           Add property (address / URL / upload)
/properties/[id]          Property detail + enrich + industrial specs + rent notebook + tax-roll + lease comps + documents + Owner portfolio CTA
/contacts/new             Add contact manually
/contacts/[id]            Contact detail + briefing + document attachments + Owner portfolio CTA
/abstracts/new             Upload + abstract a lease (property required)
/abstracts/[id]            Lease abstract detail + document attachments
/lease-radar               Expiring leases + tenant/owner outreach + follow-up sync
/follow-ups                Task list (Advanced nav — primary queue is Today on dashboard)
/outreach                  Cadence-driven outreach drafts (mailto — no send)
/owner-portfolio/...       Owner portfolio (by property or contact) + MD/Broward/Palm Beach tax-roll discovery
/properties/audit          Advanced — data audit
/properties/errors         Advanced — ingestion errors
/settings                  User settings (cadence, profile, email provider, Connections stubs) + Account (delete account)
/settings/fields           Custom field definitions (Workspace Manage fields — not industrial specs)
/settings/team             Firm roster, role management, pending invitations, invite form
/settings/errors           Advanced — server-action error log
/join/[token]              Redeem a team invitation link (§5.11)
/api/export/properties     XLSX download (GET, auth-checked)
/api/export/contacts       XLSX download (GET, auth-checked)
/api/export/leases         XLSX download (GET, auth-checked)
```

Primary nav labels: Dashboard, Workspace, Deals, Prospect, Lease radar, Outreach, Settings. Advanced: Book map, Tours, All tasks, audit, errors.
---

## 8. Custom Fields System

Users can define custom fields for properties, contacts, leases, and **deals** from Workspace **Manage fields** (and `/settings/fields` for the custom group).

- Fields are stored in `field_definitions` with `entity_type`, `field_name`, `field_type` (text/number/date/select), `select_options`, `fill_mode` (extract/manual), and `field_group` (`custom` | `industrial`).
- Field values are stored as JSONB in `custom_fields` on each entity, keyed by slug (`lib/custom-fields.ts:fieldSlug`).
- **Industrial / flex specs** are a separate `industrial` group on the property detail card (**Customize**). Defaults seed once per user (`user_settings.industrial_specs_initialized`); deleting them does not re-seed. Mapped default slugs also dual-write first-class property columns. Listing/document extract fills a spec only when the source states it — county tax roll does not invent docks or clear height.
- Fields with `fill_mode='extract'` are dynamically injected into the Anthropic tool schema during ingestion, so the AI can populate them from source documents. (Deal custom fields are always `manual` — there's no AI extraction path onto a deal.) Industrial extract-mode defs are injected the same way as custom extract fields.
- Renaming a field is a first-class action: it updates `field_definitions` in place (an UPDATE RLS policy exists) and migrates any already-stored values from the old slug to the new one (`renameCustomFieldValues`) rather than requiring delete-and-recreate.

---

## 9. Known Issues / Remaining Risks

### Still watch in pilot
1. **CoStar toggle** (`user_settings.costar_enabled`): preference UX; CoStar remains **file upload only**, not a live API.
2. **Scale**: app shell badge counts, owner portfolio, and some dashboard aggregations favor simplicity over large-book performance.
3. **Dual-write**: `linked_properties[]` still written; reads prefer `contact_properties`.
4. **Industrial specs vs tax roll** — listing/document extract fills stated specs; county enrich will not invent docks/clear height. Existing properties stay empty until re-extract unless `custom_fields` already has those slugs.
5. **Smart lists** — save, load, and delete from Workspace (`app/crm/smart-lists-bar.tsx`).
6. **Team multi-tenancy was built ahead of pilot validation**, by explicit product decision — not because a pilot broker asked for it. The RLS/data-layer is covered by an extensive real-database test suite (`tests/security/team-firm-isolation.test.ts`), but the UI itself (Workspace scope toggle, Settings → Team, the invite flow) has not had a manual browser QA pass. Treat every pilot account as single-broker unless specifically testing this.
7. **Related sub-collections on a shared record's detail page are a known, documented gap** — e.g. opening a teammate's shared contact still only shows *your own* linked properties/deals, not theirs; a shared deal's follow-ups list is similarly scoped to the viewer. Not fixed as part of the initial build.

### Fixed (do not re-open as bugs)
- Cadence settings **do** drive due/overdue math via `lib/cadence.ts` + `user_settings`.
- Lease abstracts **require** `linked_property` on save; clearing to null is blocked.
- Deals / pursuit pipeline **exists** with type-aware stages, a kanban/list/forecast view, and a full deal detail page — not just a flat card list.
- Deal follow-ups and activities use a real `deal_id` FK with `ON DELETE CASCADE` — no longer a description-prefix soft link.
- Custom field **rename** works in place; no delete-and-recreate required.
- Palm Beach County is a **third supported county** alongside Miami-Dade and Broward, in ingestion, enrichment, and owner-portfolio discovery.
- Document attachments **exist** for properties, contacts, leases, and deals.
- Account deletion **exists** and is covered by an end-to-end test.
- **Lease XLSX export** uses real abstract + linked property columns (`app/api/export/leases/route.ts`).
- Owner portfolio tax-roll discovery covers **Miami-Dade, Broward, Palm Beach, and Massachusetts (MassGIS)**. Entity/LLC lookup (Sunbiz) is Florida-only.
- Follow-ups live primarily via **Today desk**; `/follow-ups` remains under Advanced.

### UX / polish
- Dark mode may flash on load (theme from localStorage; no server-side init in `app/layout.tsx`).

See `Beacon_Pilot_Readiness.md` for the full pilot risk list.

---

## 10. What Does Not Exist Yet

- Email **sending** (only compose via mailto / web client; Settings → Connections OAuth is stubbed / 501 until keys + token exchange)
- Mobile app
- Live calendar sync (tours exist in-app; Google/Outlook calendar connection is a stub)
- CoStar **live** API (file upload + static rent-notebook seed bands only)
- Multi-firm membership (a user belongs to at most one active firm — §5.11)
- Per-teammate (rather than whole-firm) sharing granularity — "shared" always means "visible to everyone currently in my firm," there's no "share with just Alex"
- Owner-role transfer / co-ownership UI for a firm (a firm's `owner` role can't be reassigned through the product yet)
- Drop of legacy `linked_properties` column (join is preferred; dual-write remains)
- County coverage beyond Miami-Dade / Broward / Palm Beach / Massachusetts
- Wiring generated `lib/database.types.ts` into `createClient()` (types exist; client is still loosely typed)

---

## 11. Adding a Feature — Checklist

1. **New table?** Create `scripts/migrate-<name>.ts` following existing pattern (idempotent SQL). Add to `SCRIPTS` in `scripts/migrate-all.ts`. Add to `EXPECTED` in `scripts/verify-schema.ts`. Add RLS policy.
2. **New server action?** Add `"use server"` directive. Call `supabase.auth.getUser()` first. Return `{ error?: string }` or typed result, not throw.
3. **New AI call?** Use tool use (`tools` + `tool_choice: {type: "tool", name: "..."}`), not free text. Use Haiku for speed (NLP, search, drafts). Use Opus for extraction (structured data from documents).
4. **Custom fields in extraction?** Call `fetchFieldDefs(supabase, entityType)` and pass to `extractPropertyFields` as `customExtractFields` arg. Only fields with `fill_mode='extract'` should be included. Entity types are `property | contact | lease | deal`.
5. **New route?** Check auth at the top. Use `createClient` from `lib/supabase/server.ts` (not client).
6. **Tests?** Add Vitest unit tests for any pure function in `lib/`. External services (Supabase, Claude, MDPA/BCPA/PBCPA) are not mocked — don't write integration tests without a clear strategy for mocking them.
7. **Do not delete** Copilot, Deals, Lease radar, Follow-ups, Outreach, or Owner portfolio without an explicit product decision.
8. **Adding team-sharing to a new table?** Add a `visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','team'))` column, then rewrite that table's SELECT/UPDATE/DELETE RLS policies as `auth.uid() = owner_id OR (visibility = 'team' AND is_firm_teammate(owner_id))` — additive only, never replace the owner-only check outright. INSERT stays owner-only. Test with the 3-user (two teammates + one outside firm) pattern in `tests/security/team-firm-isolation.test.ts`, not just the existing 2-user suite. See `Beacon_Team_Multitenancy_Plan.md` §5 for the full rationale before touching this.
