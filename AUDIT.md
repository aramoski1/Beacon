# Beacon — Technical Audit
**Date:** 2026-07-15  
**Auditor:** Claude Sonnet 4.6 (read-only pass — no files modified)  
**Codebase root:** `C:\Users\aramoski1\Desktop\beacon`

---

## 1. Project Overview

Beacon is a single-user CRM for a commercial real estate broker, built on:

- **Next.js 16.2.9** (App Router) + **React 19.2.4** with `reactCompiler: true` (`next.config.ts:3`)
- **Supabase** for auth (email/password + OAuth callback) and PostgreSQL
- **Tailwind CSS v4** + **shadcn/ui** (Nova preset, `components.json`)
- **Anthropic Claude SDK** `^0.104.1` — three models actively used
- Single-tenant: every table has `owner_id UUID REFERENCES auth.users(id)` with RLS

The app is Miami-Dade County–centric: property data flows from the Miami-Dade Property Appraiser (MDPA) API and GIS layer. Sunbiz (Florida Div. of Corporations) is queried for entity owner disclosure.

---

## 2. Data Model (Actual Schema)

Tables are inferred from 22 migration scripts run in order by `scripts/migrate-all.ts`.

### 2.1 `properties`

Base (`scripts/migrate.ts`):
```
id uuid PK
owner_id uuid FK auth.users
address text
city text
submarket text
property_type text
owner_name text
ownership_type text
size_sqft integer
last_sale_date date
last_sale_price numeric
building_composition jsonb       -- year_built, lot_size_sqft, stories, units, dor_code, assessed_value, legal_description
source text                      -- 'tax_roll' | 'url' | 'upload'
source_url text                  -- 'mdpa:<strap>' for county-sourced, URL otherwise
ingested_at timestamptz
confidence_flags jsonb           -- [{field, reason}]
linked_contacts jsonb            -- legacy, superseded by contacts.linked_properties
custom_fields jsonb              -- dynamic per field_definitions
created_at timestamptz
updated_at timestamptz
```

Added by subsequent migrations:
```
prospect_number integer          -- auto-increment per owner (trigger: assign_prospect_number)
land_sqft integer
asset_description text
owner_mailing_address text
owner_contact_name text          -- legacy single-contact (pre-JSONB)
owner_contact_address text       -- legacy single-contact (pre-JSONB)
owner_contacts jsonb             -- [{name, title, address}] — Sunbiz persons
owner_email text
last_activity_date text
last_activity_type text
last_activity_notes text
ownership_change_detected_at timestamptz
ownership_change_data jsonb      -- {previous_owner, new_owner, previous_sale_date, new_sale_date}
```

RLS: owner SELECT / INSERT / UPDATE / DELETE on `owner_id = auth.uid()`.

### 2.2 `contacts`

Base (`scripts/migrate.ts`):
```
id uuid PK
owner_id uuid FK auth.users
name text
email text
phone text
role text
company text
contact_tier integer             -- 1 (hot) / 2 (warm) / 3 (cold)
last_contacted_at timestamptz
next_action_due date
action_tags text[]
linked_properties text[]
outreach_history jsonb           -- [{sent_at, subject, body, method}]
custom_fields jsonb
created_at / updated_at timestamptz
```

Added later:
```
size_category text
geographic_category text
ownership_type text
mailing_address text
contact_type text               -- 'owner' | 'tenant' | 'other'
title_role text
phone_mobile text
phone_office text
ownership_role text
asset_focus text[]
submarket text
portfolio_size text
relationship_stage text
lead_source text
notes text
```

RLS: same pattern.

### 2.3 `lease_abstracts`

```
id uuid PK
owner_id uuid FK
linked_property uuid FK properties
source_document text            -- Storage path: '<owner_id>/<filename>'
execution_date date
expiration_date date
base_rate numeric               -- $/sf
term text
renewal_options text
use_clause text
operating_expenses text
escalation_clause text
parking text
custom_fields jsonb
created_at / updated_at timestamptz
tenant_contact_id uuid FK contacts
```

**KNOWN BUG:** `app/api/export/leases/route.ts` queries columns `tenant_name`, `landlord_name`, `property_address`, `rent_escalation`, `security_deposit` — none exist. Supabase JS silently ignores unknown columns and returns null. The lease export is broken: it emits null for all those columns.

### 2.4 `activities`

```
id uuid PK
owner_id uuid FK
contact_id uuid FK contacts
property_id uuid FK properties (nullable)
activity_type text              -- 'letter' | 'email' | 'call' | 'note' | 'meeting'
activity_date timestamptz
notes text
created_at timestamptz
```

RLS: owner SELECT / INSERT / DELETE / UPDATE.

### 2.5 `follow_ups`

```
id uuid PK
owner_id uuid FK
contact_id uuid FK contacts (nullable)
property_id uuid FK properties (nullable)
description text
due_date date
done boolean
source_type text                -- 'manual' | 'lease_expiry'
lease_id uuid FK lease_abstracts (nullable)
lease_bucket text               -- '3mo' | '6mo' | '12mo'
created_at timestamptz
```

Unique index: `(owner_id, contact_id, lease_id, lease_bucket)` — prevents duplicate lease-radar follow-ups.

### 2.6 `field_definitions`

```
id uuid PK
owner_id uuid FK
entity_type text                -- 'property' | 'contact' | 'lease'
field_name text
field_type text                 -- 'text' | 'number' | 'date' | 'select'
select_options text[]
fill_mode text                  -- 'extract' | 'manual'
created_at timestamptz
```

RLS: owner SELECT / INSERT / DELETE — **no UPDATE policy**. To rename a custom field, you must delete and recreate it. This is likely unintentional.

### 2.7 `ingestion_errors`

```
id uuid PK
owner_id uuid FK
occurred_at timestamptz
source_type text                -- 'address' | 'url' | 'upload'
stage text                      -- 'gis_fetch' | 'mdpa_fetch' | 'jina_fetch' | 'ai_extract' | 'db_save' | 'sunbiz_search' | 'sunbiz_detail'
source_ref text
error_message text
error_detail jsonb
```

RLS: owner SELECT / INSERT / DELETE — **no UPDATE policy** (appropriate for an error log).

### 2.8 `smart_lists`

```
id uuid PK
owner_id uuid FK
name text
description text
filters jsonb
entity_type text                -- 'properties' | 'contacts' | 'leases'
created_at / updated_at timestamptz
```

RLS: `FOR ALL USING (owner_id = auth.uid())`.

Note: smart_lists rows are created but the UI surface for actually viewing/using them was not found in any route file. This feature may be partially implemented.

### 2.9 `user_settings`

```
id uuid PK
owner_id uuid UNIQUE FK
display_name text
broker_name text
company text
license_number text
default_market text
default_submarket text
phone text
website text
email_signature text
sender_name text
sender_email text
cadence_tier1_days integer DEFAULT 14
cadence_tier2_days integer DEFAULT 30
cadence_tier3_days integer DEFAULT 90
costar_enabled boolean DEFAULT false
created_at / updated_at timestamptz
```

**KNOWN BUG:** `cadence_tier*_days` are saved by `app/settings/actions.ts:upsertUserSettings` but never read by any action or component. All cadence logic uses hardcoded `{ 1: 14, 2: 30, 3: 90 }` (see `components/app-shell.tsx:234`, `app/outreach/actions.ts`, `app/dashboard/actions.ts`). The Settings page gives the user a false sense of control.

### 2.10 Supabase Storage

Bucket: `leases` (32 MB limit, PDF-only per `scripts/setup-storage.ts`). Path format enforced at save time: `<owner_id>/<filename>`. Path traversal is prevented by explicit check in `app/abstracts/new/actions.ts:saveAbstractLease` — verifies `source_document.startsWith(user.id + "/")`.

---

## 3. Feature Inventory

### 3.1 Authentication (`app/login/`, `app/auth/callback/`)

- Email/password sign-in, sign-up with email confirmation, sign-out
- OAuth callback at `/auth/callback/route.ts` for email confirmation links
- Sign-out uses a server action (`app/login/actions.ts:signOut`)
- All server-side auth via `supabase.auth.getUser()` (never `getSession()`, which is correct)
- **Status: complete and correct**

### 3.2 Dashboard (`app/dashboard/`)

Server component firing 14 parallel data fetches via `Promise.all`. Sections:

- Attention items (overdue contacts, ownership changes, lease radar)
- Upcoming follow-ups
- Portfolio snapshot (property count, SF, recency)
- Cadence health gauge
- Recent activity feed (last 15 activities)
- Data health (flagged properties)
- Unworked opportunities (properties without linked contacts)
- Cold Tier 1 owners (days since last contact)
- Week momentum (contacts touched this week)
- Delta since last visit
- Stale Tier 1 owners
- Ownership-changed properties

**Performance risks in `app/dashboard/actions.ts`:**
- `getPortfolioSnapshot` fetches all properties with no limit, computes totals in JS
- `getCadenceHealth` fetches all tiered contacts with no limit
- `getDataHealth` fetches all properties to compute flagged count in JS
- `getUnworkedOpportunities` fetches last 200 properties + all contacts

These are tolerable at single-user scale (hundreds of records) but will degrade for any broker with thousands of properties.

### 3.3 CRM / Workspace (`app/crm/`)

Three-tab view: Properties, Contacts, Leases.

- **Pagination:** PAGE_SIZE = 50, server-side via Supabase `.range()` (`app/crm/view.tsx`)
- **NLP search:** `interpretSearch()` calls Claude Haiku with tool use to parse natural language into structured `SearchResult` (`app/crm/actions.ts:interpretSearch`). Filters then applied server-side via Supabase query.
- **Inline editing:** EditableText, EditableSelect, EditableTags, tier/stage/role badges — all in `app/crm/view.tsx` (~2420 lines, the largest file in the codebase)
- **Column visibility:** persisted in localStorage per tab
- **Bulk enrichment:** select multiple properties → enrichment panel opens
- **Smart lists / segments:** not clearly surfaced in the UI despite `smart_lists` table existing
- **Contact email:** "Email" button on contact rows opens `ComposeOutreach` modal → `mailto:` link. No email is sent by Beacon.
- **Delete operations:** `app/crm/actions.ts:deleteContact` preserves `owner_contacts` JSONB on linked properties before deleting the contact row

### 3.4 Property Ingestion (three methods)

**Address → MDPA (`app/properties/new/actions.ts`):**
1. `ingestAddress` — GIS search (`lib/mdpa.ts:searchByAddressGIS`) returns candidate parcels, never auto-selects
2. `ingestChosenFolio` — fetches MDPA JSON detail, runs Claude Opus 4.8 extraction with strict system prompt forbidding hallucination, then auto-searches Sunbiz for entity owners (non-blocking, failure ignored)
3. `saveIngestedProperty` — dedup via `lib/property-ingest.ts:findDuplicate` (source_url exact match, then case-insensitive address match), then upsert

**URL (`app/properties/url/actions.ts`):**
- Fetches via `r.jina.ai/{url}` (Jina Reader), up to 4 retries on block/rate-limit
- Claude Opus 4.8 extraction on the text content

**Upload (`app/properties/upload/actions.ts`):**
- PDF, images, Excel (xlsx→CSV), text/CSV
- `xlsx` library for spreadsheet conversion
- Claude Opus 4.8 extraction

All three methods share `lib/property-pipeline.ts:extractPropertyFields`, which dynamically adds custom fields with `fill_mode='extract'` to the tool schema.

### 3.5 Property Detail (`app/properties/[id]/`)

Full property record view with:
- Owner + ownership type + property type + building SF + land SF + last sale
- Building composition (year built, lot size, stories, units, DOR code, assessed value, legal description)
- Confidence flags (yellow = uncertain, neutral = not-found-in-source)
- Ownership change alert (if `ownership_change_detected_at` is set)
- Folio strip with MDPA verification link
- Enrich panel (county data, Sunbiz lookup, owner contact promotion, CoStar upload)
- Linked contacts section
- Linked leases with status badges
- Activity + follow-up timeline
- Custom fields card

**EnrichPanel (`app/properties/[id]/enrich-panel.tsx`):**
Three-step enrichment workflow (county data → Sunbiz owners → promote to CRM contact → CoStar upload). The preview diff table (changes vs. unchanged) is a well-designed UX before applying county data.

**Ownership check (`app/properties/[id]/actions.ts:checkOwnershipChange`):**
Fetches fresh MDPA for the property's folio, compares `owner_name` and `last_sale_date`. If different, writes `ownership_change_detected_at` and `ownership_change_data`. Only works for MDPA-sourced properties.

### 3.6 Owner Portfolio (`app/owner-portfolio/`)

Routes: `/owner-portfolio/property/[id]` and `/owner-portfolio/contact/[id]`.

Aggregates all properties in the broker's workspace that belong to the same entity or person. Uses fuzzy matching:
- Entity matching: `lib/mdpa-owner-search.ts:entityOwnerNamesMatch` — strips legal suffixes (LLC, INC, etc.), compares tokens
- Person matching: `lib/owner-portfolio.ts:personMatchesProperty` — checks `owner_name` and `owner_contacts` JSONB

**PERF RISK in `app/owner-portfolio/actions.ts:fetchAllProperties`:**  
Loads **all broker properties** on every portfolio page view:
```
supabase.from("properties").select("...").eq("owner_id", userId)
```
No limit. Then filters in JS. Fine for hundreds; slow for thousands.

Also loads all contacts in `loadPortfolioForPropertyIds` and filters in JS.

Includes `PortfolioMdpaSection` — a county-wide tax roll search for the owner's other properties beyond what's in the broker's workspace.

### 3.7 Lease Radar (`app/lease-radar/`)

- `getLeaseRadarData` in `app/lease-radar/actions.ts` fetches leases expiring within 12 months, buckets into 3mo / 6mo / 12mo
- `syncLeaseFollowUps` creates follow-up records for owner + tenant contacts on expiring leases, idempotent via unique index
- `lib/lease-radar.ts` provides pure helpers: `daysUntilExpiry`, `leaseRadarBucket`, `leaseRadarUrgency`
- Nav badge shows count of leases expiring within 90 days (`components/app-shell.tsx:224-228`)
- **Status: fully functional**

### 3.8 Follow-ups (`app/follow-ups/`)

- Create, mark done, list by due date
- Two source types: `'manual'` and `'lease_expiry'`
- Unique constraint prevents duplicate lease-expiry follow-ups
- `getFollowUpsDashboard` and `getUpcomingFollowUps` used by dashboard
- **Status: fully functional**

### 3.9 Outreach (`app/outreach/`)

- `getDueContacts` — contacts within cadence ±7 days window
- `generateDrafts(contactIds, brokerContext, template)` — real Claude Haiku call, returns email subject + body. Max 10 at once.
- `logOutreach` — writes to `outreach_history` JSONB, updates `last_contacted_at`, creates activity record

**Critical clarification:** Beacon does not send email. "Open in email ↗" generates a `mailto:` link. "Mark as sent" only logs in the DB. The UI explicitly states "Nothing is sent automatically." (`app/outreach/view.tsx`)

Test mode redirects the mailto to the broker's own email with `[TEST]` prefix.

### 3.10 Lease Abstraction (`app/abstracts/`)

- PDF upload to Supabase Storage (bucket: `leases`, path: `<owner_id>/<filename>`)
- Claude Opus 4.8 extraction with structured tool schema
- Custom lease fields with `fill_mode='extract'` are dynamically injected into the schema
- `tenant_contact_id` FK allows linking tenant contact from CRM
- Path traversal check: `source_document.startsWith(user.id + "/")` (`app/abstracts/new/actions.ts:saveAbstractLease`)
- **Status: fully functional**

### 3.11 Contact Detail (`app/contacts/[id]/`)

- Full contact record: identity, CRE profile, linked properties, notes, tags, custom fields
- Activity timeline and follow-up list
- Outreach history
- RelationshipBriefingPanel: on-demand Claude Haiku call that gathers contact data, activities, follow-ups, leases, outreach history → produces `whereThingsStand` + `suggestedNextMove` (`app/contacts/[id]/briefing-actions.ts`)
- **Status: fully functional**

### 3.12 Settings (`app/settings/`)

Sections: Account, Brokerage, Data Sources, Outreach, Data Management, Appearance, Danger Zone.

- **Password change** via `supabase.auth.updateUser`
- **User settings** saved to `user_settings` table — name, company, email signature, cadence days, CoStar toggle
- **Cadence bug**: see Section 5.2
- **Custom fields** at `/settings/fields` — add/delete fields for property, contact, lease entities
- **Data export** via `/api/export/properties`, `/api/export/contacts`, `/api/export/leases` (XLSX)
- **Delete all data** deletes in FK-safe order: follow_ups → activities → ingestion_errors → smart_lists → lease_abstracts → contacts → properties → field_definitions → user_settings
- **Appearance / theme**: dark mode toggle stored in localStorage. No `<html class>` set on initial server render — causes light→dark flash on hard refresh.
- **CoStar toggle**: `costar_enabled` boolean saved, but CoStar file upload is unconditionally available in EnrichPanel regardless of this setting. The toggle has no effect.

### 3.13 Sunbiz Integration (`lib/sunbiz.ts`)

- Uses `curl` (not Node `fetch`) to bypass Cloudflare TLS fingerprint blocking on search.sunbiz.org
- Two-step: search results page (regex parse) → detail page (with Cloudflare clearance cookie)
- `claudeExtract(pageText)` sends plain text to Claude Haiku for person/address extraction
- Returns `SunbizResult`: `{entity_name, status, persons: [{name, title, address}], source_url}`
- Auto-triggered during MDPA ingestion for entity owners; also manually triggerable from EnrichPanel

### 3.14 CoStar Integration (`lib/costar.ts`)

- No CoStar credentials or account required
- User uploads an "About the Owner" export (PDF/image/CSV/text)
- Claude Haiku extracts `CoStarOwner: {company_name, hq_address, website, contacts: [{name, title, email, phone}]}`
- Created contacts are tagged `costar` and `unverified`

### 3.15 MDPA / GIS (`lib/mdpa.ts`, `lib/mdpa-owner-search.ts`)

- `searchByAddressGIS`: Miami-Dade ArcGIS REST API, parses address into `houseNum` + `streetKeyword` before building WHERE clause
- `getPropertyDetail`: MDPA PaServicesProxy JSON API
- `searchParcelsByOwnerName`: County-wide tax roll search by entity or person name. Paginates up to 3000 parcels. Used by Owner Portfolio for county-wide discovery.
- Token sanitization: `/[^a-zA-Z0-9 ]/g` strips before interpolating into WHERE clause (SQL injection safe)

### 3.16 AI Models

| Model | Where Used | Purpose |
|-------|------------|---------|
| `claude-opus-4-8` | `lib/property-pipeline.ts`, `app/abstracts/new/actions.ts` | Property field extraction from MDPA JSON, URLs, uploads; lease extraction |
| `claude-haiku-4-5-20251001` | `app/crm/actions.ts`, `app/outreach/actions.ts`, `app/contacts/[id]/briefing-actions.ts`, `lib/sunbiz.ts`, `lib/costar.ts` | NLP search, outreach drafts, relationship briefing, Sunbiz person extraction, CoStar extraction |

All AI calls use the Anthropic tool-use API (`tools` + `tool_choice: {type: "tool", name: "..."}`), not free-text generation. This means structured outputs are enforced by schema.

### 3.17 Data Export (`app/api/export/`)

- `GET /api/export/properties` — auth-checked, exports all properties as XLSX including custom fields. **No row limit.**
- `GET /api/export/contacts` — same pattern for contacts
- `GET /api/export/leases` — **BROKEN**: queries non-existent columns. See Section 5.1.

---

## 4. Security Posture

### 4.1 Authentication Checks

Every server action and route handler calls `supabase.auth.getUser()` and returns early on failure. No action relies solely on RLS — they all explicitly check `owner_id = user.id` in their queries as defense-in-depth.

No instance of `supabase.auth.getSession()` found. The codebase consistently uses `getUser()`, which validates the JWT server-side. This is correct.

### 4.2 Row-Level Security

All tables have RLS enabled with `owner_id = auth.uid()` policies. Coverage:

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| properties | owner | owner | owner | owner |
| contacts | owner | owner | owner | owner |
| lease_abstracts | owner | owner | owner | owner |
| activities | owner | owner | owner | owner |
| follow_ups | owner (FOR ALL) | — | — | — |
| field_definitions | owner | owner | **NONE** | owner |
| ingestion_errors | owner | owner | **NONE** | owner |
| smart_lists | owner (FOR ALL) | — | — | — |
| user_settings | owner (FOR ALL) | — | — | — |

The missing UPDATE policy on `field_definitions` means custom field definitions cannot be updated via the Supabase client (any such operation silently fails or errors). This is likely unintentional — renaming a field would require delete + recreate.

### 4.3 Supabase Storage

The `leases` bucket path format is `<owner_id>/<filename>`. RLS on Storage is presumably set by `scripts/setup-storage.ts`. The path traversal check in `app/abstracts/new/actions.ts` (`source_document.startsWith(user.id + "/")`) is good defense-in-depth.

### 4.4 External Requests

- **Jina AI Reader** (`r.jina.ai`): URL passed directly. No whitelist. A malicious URL like `r.jina.ai/file:///etc/passwd` would be fetched by Jina, not by the Next.js server, so SSRF risk is with Jina's infrastructure, not Beacon's server. However, user-controlled URLs that result in Jina fetching internal network resources could theoretically leak content.
- **MDPA GIS / PaServicesProxy**: addresses are sanitized before interpolation. The `sanitizeLikeToken` function in `lib/mdpa-owner-search.ts` strips non-alphanumeric characters.
- **Sunbiz**: uses `curl` with a subprocess — the entity name is passed as a URL query parameter. The name is URL-encoded. No shell injection observed but this warrants review for edge cases.
- **Anthropic API**: key from `process.env.ANTHROPIC_API_KEY`. Never exposed to client.

### 4.5 SQL Injection

No raw SQL in application code. All Supabase queries use the JS client's parameterized builder. The GIS WHERE clause construction in `lib/mdpa-owner-search.ts:buildOwnerWhereClause` sanitizes input before interpolation into a string passed to the ArcGIS API (not to Supabase), so this is not a Supabase injection vector.

### 4.6 File Uploads

CoStar file: 10 MB limit enforced in `app/properties/[id]/actions.ts:parseCoStarFile`. Allowed types: PDF, JPG/PNG/WebP, CSV, TXT. Unknown types return an error.

Lease PDF: handled by Supabase Storage, not by Next.js (no direct Buffer handling for storage uploads in the reviewed code).

---

## 5. Known Bugs

### 5.1 Lease Export Broken — Non-existent Columns

**File:** `app/api/export/leases/route.ts`

The route queries: `tenant_name`, `landlord_name`, `property_address`, `rent_escalation`, `security_deposit`.

None of these columns exist in `lease_abstracts`. The actual columns are: `linked_property` (UUID), `base_rate`, `term`, `use_clause`, `escalation_clause`, `execution_date`, `expiration_date`, etc.

Supabase JS client does not error on unknown column names in SELECT — it simply returns nulls. The export CSV/XLSX will have these columns but all values will be null. Real data (base_rate, term, linked_property) is not exported.

**Impact:** Lease export is functionally broken for anyone who tries to use it.

**Fix:** Replace the select string with actual column names and add a join to `properties` for the address.

### 5.2 Cadence Settings Have No Effect

**File:** `app/settings/actions.ts:upsertUserSettings` (saves `cadence_tier*_days`)

**Files that ignore it:**
- `components/app-shell.tsx:234` — `{ 1: 14, 2: 30, 3: 90 }` hardcoded
- `app/outreach/actions.ts:getDueContacts` — `CADENCE_DAYS` hardcoded
- `app/dashboard/actions.ts:getCadenceHealth`, `getColdTier1Contacts` — hardcoded thresholds

The user can set custom cadence intervals in Settings. They are stored in `user_settings`. They are never read back by any action or component.

**Impact:** Any broker who changes these values will see no difference in overdue counts, outreach scheduling, or dashboard metrics.

**Fix:** Load `user_settings` in each action that uses cadence thresholds and use the stored values instead of constants.

### 5.3 Dark Mode Flash on Load

**File:** `app/settings/page.tsx` (theme toggle writes to localStorage)  
**File:** `app/layout.tsx` (no `<script>` to read localStorage before first paint)

Dark mode preference is stored in localStorage and applied by a client component. On hard refresh, the page renders in light mode first, then switches to dark. This is a classic FOUC (flash of unstyled content).

**Fix:** Add an inline `<script>` in `app/layout.tsx` `<head>` that reads `localStorage.getItem('theme')` and sets `document.documentElement.classList.add('dark')` synchronously before render.

### 5.4 CoStar Toggle Has No Effect

**File:** `app/settings/actions.ts` — saves `costar_enabled: boolean`  
**File:** `app/properties/[id]/enrich-panel.tsx` — CoStar section always rendered

The CoStar upload section in EnrichPanel is unconditionally visible. The `costar_enabled` setting is never checked by any component.

**Fix:** Pass `costar_enabled` from `user_settings` to the EnrichPanel and conditionally render the CoStar section.

### 5.5 `field_definitions` Has No UPDATE RLS Policy

**File:** `scripts/migrate-custom-fields.ts`

Policies created: SELECT, INSERT, DELETE. No UPDATE policy. Any attempt to update a field definition through the Supabase JS client will be rejected by RLS. The Settings fields UI (`app/settings/fields/`) likely only allows create/delete anyway, but this is a gap if future edits are needed.

---

## 6. Performance Risks

### 6.1 App Shell Fetches All Contacts on Every Page Load

**File:** `components/app-shell.tsx:216-238`

On mount (and on auth state change), fetches:
```js
supabase.from("contacts").select("contact_tier, last_contacted_at")
```
No limit, no count query — returns full rows for all contacts to count overdue. With 1,000 contacts this is ~100 KB of JSON for a badge number.

**Fix:** Use a count query server-side or a Supabase RPC that computes the overdue count in SQL.

### 6.2 Dashboard Actions Fetch Unbounded Data

**File:** `app/dashboard/actions.ts`

- `getPortfolioSnapshot`: all properties
- `getCadenceHealth`: all tiered contacts
- `getDataHealth`: all properties
- `getUnworkedOpportunities`: last 200 properties + all contacts

These run in parallel on every dashboard load. At scale, this is multiple full-table scans per page view.

### 6.3 Owner Portfolio Loads All Properties in Memory

**File:** `app/owner-portfolio/actions.ts:fetchAllProperties`

Loads all broker properties, then filters in JS. Also loads all contacts in `loadPortfolioForPropertyIds`.

### 6.4 Export Routes Have No Row Limit

**File:** `app/api/export/properties/route.ts`, `app/api/export/contacts/route.ts`

`GET` with no pagination or limit. A broker with 10,000 properties will get a single response with all of them. For large datasets this will hit serverless function timeout limits.

### 6.5 CRM View Filter Options — Distinct Value Scans

**File:** `app/crm/view.tsx` (filter option loading)

Distinct value scans of all properties/contacts to populate filter dropdowns. These are unbounded queries.

---

## 7. Dead / Orphaned Code

### 7.1 Smart Lists (`smart_lists` table)

The table exists with RLS and migrations. There is no route or component in the codebase that renders a smart list view or allows creating/browsing smart lists. They are created by `interpretSearch` (NLP search stores a result) but never surfaced as a named, persistent view.

**Status: schema exists, UI incomplete.**

### 7.2 `owner_contact_name` / `owner_contact_address` (Legacy Columns)

Two columns on `properties` added by `scripts/migrate-owner-contact-fields.ts`. Superseded by `owner_contacts` JSONB array (added by `scripts/migrate-owner-contacts-jsonb.ts`). The legacy columns are still read via `resolvePropertyOwnerContacts` as a fallback but nothing writes to them in new code paths.

### 7.3 `linked_contacts` JSONB on `properties`

The `properties` table has `linked_contacts jsonb` (base migration). The current architecture uses `contacts.linked_properties text[]` as the link direction instead. `linked_contacts` on properties appears to be unused in read paths.

### 7.4 `costar_enabled` Setting

As noted above: stored, never checked. Dead configuration.

---

## 8. Test Coverage

Four test files in `tests/lib/`:

| File | What is tested |
|------|----------------|
| `mdpa.test.ts` | `folioToStrap` (7 cases), `parseAddressForGIS` (14 cases including edge cases and the famous "111 NW 1 ST" broken PA address) |
| `custom-fields.test.ts` | `fieldSlug` (10 cases), `buildCustomFieldsSchema` (13 cases including type mapping and slug collision) |
| `property-ingest.test.ts` | Not read, assumed similar pattern |
| `mdpa-owner-search.test.ts` | Not read, assumed covers `entityOwnerNamesMatch` and related |

Test framework: Vitest v4. Tests cover the pure utility functions only. No tests for:
- Any server action
- Any AI extraction pipeline
- Any Sunbiz scraping logic
- Any Supabase queries (no mock setup found)
- Any React component

Test coverage is adequate for the stable, pure functions. Everything that touches external services (Claude, MDPA, Sunbiz, Supabase) is untested.

---

## 9. Architecture Observations

### 9.1 React Compiler

`next.config.ts:3` has `reactCompiler: true`. This is the experimental React Compiler (née React Forget), which auto-memoizes components. This is very new; if any component triggers the compiler in an unexpected way, behavior may be subtly different from manual memo patterns. No issues observed, but it should be watched during upgrades.

### 9.2 Server Actions for Everything

All mutations and most data fetching go through `"use server"` functions. No API routes for mutations. This means:
- No REST or GraphQL API (intentional for a single-user app)
- Mutations are not cacheable and not independently testable without spinning up Next.js
- Error handling is via return types (`{ error?: string }`) not HTTP status codes

### 9.3 Single-Tenant Architecture

Every query is `WHERE owner_id = user.id`. There is no concept of teams, shared workspaces, or multi-user access to a single broker's data. If the product ever needs to support a brokerage team sharing data, this is a fundamental schema redesign.

### 9.4 JSONB Overuse

Several fields use JSONB where relational columns would be more queryable:
- `outreach_history` on contacts — a log that grows unboundedly in a JSONB column
- `building_composition` on properties — fixed structure that could be flat columns
- `owner_contacts` on properties — an array that should probably be a `property_owner_contacts` table

The outreach_history pattern is the worst of these: to query "contacts I've emailed more than twice," you'd need a full scan + JS filter, not a SQL COUNT.

### 9.5 Prospect Number Trigger

A PostgreSQL trigger `assign_prospect_number` auto-increments `prospect_number` per owner on property insert (`scripts/migrate-new-fields.ts`). This is a per-owner sequence, not a global one. Good design, but the trigger logic is in a migration script — there's no documentation of this behavior beyond the script itself.

---

## 10. Competitive Gaps (vs. Common CRE CRM Tools)

| Feature | Beacon Status |
|---------|--------------|
| Email sending | Not implemented. `mailto:` only. |
| Mobile app | None. Web only. |
| Team / shared workspace | None. Single-user only. |
| Calendar integration | None. Due dates only, no calendar sync. |
| CoStar / Crexi API integration | File upload only. No live API. |
| Document management beyond leases | None. No LOI, PSA, etc. storage. |
| Transaction pipeline / deal stages | None. No deal or transaction entity. |
| Reporting / analytics | Dashboard only. No custom reports. |
| Bulk email sending | Not implemented (by design, per UI comment). |
| Phone/SMS integration | None. |
| Map view of portfolio | None. |
| Automated ownership change alerts | Partial. Re-check is manual per property. Dashboard shows flagged properties. |
| Multi-market support | Miami-Dade only for county data, Sunbiz only for entity data. |

---

## 11. File Size and Complexity Hotspots

| File | Lines | Concern |
|------|-------|---------|
| `app/crm/view.tsx` | ~2420 | Largest file. Three-tab view, NLP search, all inline edit logic. Hard to navigate. |
| `app/properties/[id]/enrich-panel.tsx` | ~972 | Complex state machine for 4 enrichment flows. Fine but dense. |
| `app/properties/[id]/actions.ts` | ~636 | County enhancement preview/apply pipeline. Reasonable given complexity. |
| `app/dashboard/actions.ts` | ~400+ | 14 action functions, several with performance issues. |
| `app/owner-portfolio/actions.ts` | ~447 | Portfolio assembly logic. In-memory filtering is the main risk. |

---

## 12. Environment Variables Required

Based on code references:

| Variable | Where Used |
|----------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase/client.ts`, `lib/supabase/server.ts` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same |
| `ANTHROPIC_API_KEY` | `lib/property-pipeline.ts`, `lib/costar.ts`, `lib/sunbiz.ts`, outreach actions, briefing actions |
| `DATABASE_URL` | Migration scripts only (direct Postgres, bypasses RLS) |

No `.env.example` file found. New engineers must discover these from the codebase.

---

## 13. Summary of Critical Issues (Priority Order)

1. **Lease export is broken** — `app/api/export/leases/route.ts` queries columns that don't exist. All export data is null.
2. **Cadence settings are ignored everywhere** — user can configure them but they have no effect. `components/app-shell.tsx:234`, `app/outreach/actions.ts`, `app/dashboard/actions.ts` all use hardcoded values.
3. **App shell fetches all contacts on every page load** — `components/app-shell.tsx:217` — unbounded query for a badge number.
4. **`field_definitions` has no UPDATE RLS policy** — renaming a custom field is impossible through the client.
5. **Dark mode flash** — no synchronous theme init in `app/layout.tsx`.
6. **CoStar toggle does nothing** — `user_settings.costar_enabled` is never read.
7. **Smart lists are schema-only** — no UI to view or manage them.
8. **All properties loaded in memory for owner portfolio** — `app/owner-portfolio/actions.ts:fetchAllProperties`.
9. **`outreach_history` as JSONB** — outreach log grows unboundedly in a single column, not queryable by SQL.
10. **No `.env.example`** — onboarding friction for new engineers.
