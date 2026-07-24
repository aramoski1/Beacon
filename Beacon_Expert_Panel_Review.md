# Beacon Expert Panel Review

**Date:** 2026-07-20  
**Scope:** Commercial real estate CRM codebase review  
**Panel lens:** 30-year CBRE/JLL/Cushman broker, industrial broker, CRE owner/operator, CRE-tech founder, SaaS product leader, workflow UX designer, AI product architect  

Grounded in migrations (`scripts/migrate-*.ts`), routes under `app/`, `lib/`, and tests. Visual/layout claims omitted unless verifiable from code.

---

## (1) Top 15 must-fix before a broker pilot

| # | Severity | Issue | Why / broker impact | Fix | Size | Citation |
|---|----------|--------|---------------------|-----|------|----------|
| 1 | **Critical** | Lease abstracts save **without** `linked_property` | Lease radar, property linkage, and lease-driven follow-ups depend on `linked_property` (`app/lease-radar/actions.ts`). Abstract flow inserts terms only — no property picker (`app/abstracts/new/actions.ts` `saveAbstractLease`). Brokers get “orphan” leases that don’t light up radar or property context. | Require property select (or match) on save; backfill UI; block save without link | M | `app/abstracts/new/actions.ts:207–221` |
| 2 | **Critical** | CoStar enrich is **gated off with no Settings toggle** | `costar_enabled` defaults `false` (`migrate-user-settings.ts`); EnrichPanel hides CoStar when false; Settings toggle was removed. Pilots who upload CoStar exports see no path. | Always show CoStar upload (or restore toggle defaulting on) | S | `enrich-panel.tsx` `costarEnabled`; `page.tsx:344`; `settings/actions.ts` |
| 3 | **Critical** | No durable **legal entity** model | Owner is `properties.owner_name` string + JSONB `owner_contacts`. No `entities` table, no LLC↔properties FK, no ownership history. Portfolio is recomputed (`lib/owner-portfolio.ts`). CBRE/JLL work entities first; string matching breaks on “GIMROCK PROPERTY LLC” vs typos/DBAs. | `entities` + `entity_properties` + promote Sunbiz persons to contacts with `entity_id` | L | `migrate.ts`, `migrate-owner-contacts-jsonb.ts`, `lib/owner-portfolio.ts` |
| 4 | **High** | Contact↔property is soft `UUID[]` with **no FK** | `contacts.linked_properties` can point at deleted IDs; property side doesn’t own the join. Relationship graph is fragile under deletes/imports. | Join table `contact_properties` with CASCADE/SET NULL + RLS | M | `scripts/migrate.ts` contacts |
| 5 | **High** | Address ingest is **Miami-Dade-only** | `lib/mdpa.ts` / GIS hardcoded to Miami-Dade. Non-MD pilots fail the primary “look up a property” path; URL/upload are weaker substitutes. | Gate market in settings; clear empty-state for non-MD; or multi-county PA adapters | XL | `lib/mdpa.ts`, `app/properties/new` |
| 6 | **High** | Outreach **does not send email** | `generateDrafts` + `composeUrl` / mailto only (`lib/email-provider.ts`). PRD still mentions Resend; brokers expect send-from-CRM. Extra steps: generate → open client → send → Mark sent (max 10). | Honest UX (“Opens your mail app”) + optional Gmail/Outlook OAuth send later | M–L | `app/outreach/actions.ts`, `lib/email-provider.ts` |
| 7 | **High** | **Single-user** tenancy only | Every table `owner_id` + RLS; no team/org/invite/roles. A CBRE team pilot cannot share a book of business. | Orgs + membership + shared RLS **or** explicitly sell as solo-only | XL | `scripts/migrate.ts` |
| 8 | **High** | No **comps** product | Only dashboard copy “Review market comps” (`dashboard-widgets.tsx`). No comps table, no sale/rent comps UI. Industrial/office brokers live on comps. | MVP: last-sale comps from tax roll neighborhood query; label clearly | L | `dashboard-widgets.tsx:161` |
| 9 | **High** | Activities **require** `contact_id` | Schema: `activities.contact_id` NOT NULL (`migrate-activities.ts`). Can’t log property-only tour/drive-by without inventing a contact. | Nullable `contact_id` + property-required XOR | S | `scripts/migrate-activities.ts` |
| 10 | **High** | Onboarding copy promises auto-enrich; code doesn’t | Wizard text claims enrich owner data; `parseImportFile` / `runImport` are map+upsert only — no Anthropic (`app/onboarding/actions.ts`). Trust hit on first session. | Change copy **or** post-import MDPA/Sunbiz queue | S–M | `app/onboarding/wizard.tsx`, `actions.ts` |
| 11 | **Medium** | `deleteAllData` incomplete | Deletes listed tables but **not** `deals`, `error_logs`, or `leases` storage objects (`app/settings/actions.ts`). “Wipe my data” leaves deal pipeline + PDFs. | Include deals, error_logs, storage prefix delete | S | `settings/actions.ts:99–109` |
| 12 | **Medium** | Deal stages mix agency + capital markets | Stages: prospect→…→won→under_contract→closed (`lib/deals.ts`). “Won” and “under_contract” both terminal — confusing for leasing vs investment sales. No deal type (listing/tenant-rep/sale). | `deal_type` + stage sets per type | M | `lib/deals.ts`, `migrate-deals.ts` |
| 13 | **Medium** | Batch outreach capped at **10** | Server + UI `MAX_BATCH` / `contactIds.length > 10`. Smart-list “Outreach all” dumps into a desk that rejects >10. | Raise limit with queue/chunking or warn before navigate | S | `outreach/actions.ts`, `outreach/view.tsx` |
| 14 | **Medium** | Tenant model is thin | Tenant = `contact_type` text + optional `tenant_contact_id` on lease. No suite/unit, no multi-tenant building occupancy. Industrial/office need floors/suites. | `units` or suite on lease + occupancy | L | `migrate-lease-tenant.ts`, `migrate-contact-type.ts` |
| 15 | **Medium** | Auth gating is per-page, not in `proxy.ts` | `proxy.ts` only refreshes session. Miss a `getUser()` on a new route → data leak risk (RLS still helps via anon key). | Central middleware auth redirect | S | `proxy.ts` |

---

## (2) Top 10 highest-ROI improvements

| Rank | Improvement | Why ROI | Complexity |
|------|-------------|---------|------------|
| 1 | **Link lease → property on abstract save** | Unlocks lease radar + outreach context immediately | S–M |
| 2 | **Un-gate CoStar upload** | Restores advertised enrich path with one settings/UI fix | S |
| 3 | **Honest outreach UX + optional send later** | Stops expectation mismatch; keeps mailto working | S (copy) / L (OAuth) |
| 4 | **Entity table + portfolio on entity_id** | Turns Sunbiz/MDPA discovery into durable CRM gold | L |
| 5 | **Post-import enrich queue** | Makes onboarding claim true; fills empty CRM fast | M |
| 6 | **Join table for contact↔property** | Fixes silent relationship rot | M |
| 7 | **Tax-roll neighborhood comps (MDPA)** | Moat-ish for Miami industrial; uses existing GIS | L |
| 8 | **Property-only activities** | Matches how brokers actually log days | S |
| 9 | **Chunked batch outreach (>10)** | Makes CRM multi-select / smart lists usable | M |
| 10 | **Deal types + stage machines** | Makes `/deals` believable for leasing vs sales | M |

---

## (3) Top 5 moat features (competitors lack this combo)

1. **MDPA + Sunbiz + portfolio discovery loop** — county tax roll owner search + FL entity officers + CRM import (`lib/mdpa-owner-search.ts`, `lib/sunbiz.ts`, `app/owner-portfolio/`). Buildout/Ascendix don’t typically own this public-records depth for Miami.
2. **Source-constrained AI ingest** — MDPA-strict Opus extract + confidence flags (`lib/property-pipeline.ts`) beats generic “ChatGPT your CRM.”
3. **Lease abstract with citations → lease radar → cadence outreach** — if `linked_property` is fixed, this chain is rare in mid-market CRE CRM.
4. **Ownership-change detection fields** — `ownership_change_*` on properties + dashboard surfaces; proactive “new owner” hunting.
5. **NL → whitelist CRM filters / smart lists** — Haiku `interpret_crm_search` without raw SQL (`app/crm/actions.ts`).

---

## (4) Single biggest adoption risk

**The product sells “AI CRM that works your book,” but day-one reality is: Miami-Dade tax-roll dependency + mail-client outreach + leases that don’t attach to properties + CoStar path silently off.**

A design-partner broker outside (or even inside) Miami who abstracts leases and expects email send + CoStar upload will conclude “it doesn’t work” before they see the portfolio moat.

---

## (5) Cannot assess from code — needs broker / visual review

- Visual density, spacing, hover, mobile CRM table usability (`app/crm/view.tsx` layout)
- Whether deal kanban is usable for a working pipeline (`app/deals/deals-view.tsx`)
- Quality of AI lease abstracts / outreach tone on real documents (model output, not wiring)
- GIS owner-search precision / false positives on real LLCs (needs live MDPA)
- Sunbiz scrape reliability under rate limits / captchas
- Whether “requirement” stage language matches your ICP (tenant-rep vs investment sales)
- Competitive parity on mobile apps / Outlook add-ins (Beacon has none in repo)
- Actual time-to-value of onboarding import for a 2k-row CoStar export (cap is 500 rows — `onboarding`)
- Performance at 10k+ properties (indexes exist on `owner_id`; no load tests found)

---

## Competitive snapshot (from what’s built)

| | Beacon wins | Beacon loses |
|--|-------------|--------------|
| vs **Buildout / Ascendix / ClientLook** | Public-records enrichment + AI abstract + ownership change signals | Teams, comps, mapping, listing syndication, mature pipeline, email send |
| vs **Salesforce CRE** | Speed, opinionated Miami workflow, lower config | Enterprise sharing, audit, AppExchange, reporting |

---

## Explicit non-issues / already present (so we don’t invent gaps)

- Deals table + UI exist (`app/deals/`, `migrate-deals.ts`)
- RLS owner isolation is real (`scripts/migrate.ts`)
- Follow-ups, lease radar, smart lists, onboarding wizard, bulk enrich, owner portfolio routes exist
- Outreach batch can ignore cadence via All contacts / CRM selection (`getAllContactsForOutreach`, sessionStorage selection)

---

## Bottom line for pilot

Fix lease→property link, CoStar gate, and messaging around email/Miami scope **before** inviting brokers. Entity model and comps are the next tier that determine whether Beacon feels like a CRE system of record or a clever Miami research tool with a CRM skin.
