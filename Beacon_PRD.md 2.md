# Product Requirements Document — Beacon by Lantern

| | |
|---|---|
| **Product** | Beacon (working name) — broker-owned CRM with zero manual data entry |
| **Author** | Alec Ramoski |
| **Status** | **v0.2 — reconciled against the actual codebase (as-built)** |
| **Last updated** | June 24, 2026 |
| **Repo** | github.com/aramoski1/Beacon |

> **About this version.** v0.1 was written before any code existed. This v0.2 reconciles the spec with what's actually in the repo today — corrected field names, features that were added (custom fields, unified ingestion pipeline), requirements that diverged (email-forward → file upload; CoStar credentials → file-export upload), and a new **Known Issues** section (§15) capturing real bugs and tech debt. Items I couldn't fully re-verify from the code are marked *(verify)*.

---

## 1. Summary

Beacon is an AI-native CRM for real estate brokers built on one principle: the broker never performs manual data entry, and the broker owns their data. Brokers ingest properties by entering an address (Miami-Dade tax roll), pasting a URL, or uploading a file; Beacon parses each source into a structured, queryable record that belongs to the broker. Lease documents are abstracted into structured terms with source citations. An outreach layer segments contacts by tier and cadence and drafts personalized emails. Data isolation is enforced at the database layer via Supabase Row-Level Security.

The wedge is standalone AI lease abstraction; the platform is the broker-owned CRM.

---

## 2. Technical stack (as-built)

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui. Server Actions for mutations.
- **Backend / DB / Auth / Storage:** Supabase (Postgres, Auth, Storage, Row-Level Security). RLS scoped by `owner_id` on every table.
- **AI:** Anthropic SDK, model `claude-opus-4-8`, using **tool-use (structured output)** for all extraction — property fields, lease fields, and natural-language query translation.
- **Email:** Resend (outreach send).
- **Property data:** Miami-Dade ArcGIS GIS layer (address → folio) + MDPA PaServicesProxy (folio → detail).
- **Dev environment:** Cursor IDE with Claude Code in the integrated terminal.

---

## 3. Goals & non-goals

### Goals
- **G1** — Eliminate manual property/contact data entry.
- **G2** — Give brokers a structured, queryable, portable database they own (enforced by RLS).
- **G3** — Automate tier/cadence-based personalized outreach.
- **G4** — Land via a standalone lease-abstraction wedge requiring no migration.
- **G5** — One architecture, two go-to-market motions (individual broker; brokerage-as-reseller).

### Non-goals (current releases)
- **NG1** — Commission billing / accounting (the firm-side job Beacon deliberately avoids).
- **NG2** — Full transaction/deal pipeline tooling.
- **NG3** — Multi-county coverage (launch is Miami-Dade only).
- **NG4** — Direct MLS integration (licensing constraints).
- **NG5** — Brokerage multi-seat admin / firm-owned mode (not yet built; see FR-17).

---

## 4. Success metrics

| Metric | Target |
|---|---|
| Address-lookup correct-parcel rate | ≥ 98% top match on launch market |
| Core-field extraction accuracy | ≥ 98% (owner, address, size) |
| Time-to-record | < 10s |
| Lease-abstraction turnaround | < 60s |
| Lease-abstraction time saved | ≥ 90 min/abstract |

Accuracy remains the make-or-break metric and a hard release gate (§8). **It is currently unmeasured — see Known Issues §15.**

---

## 5. Personas

Unchanged from v0.1: **(A)** independent commercial broker / Excel holdout, **(B)** residential agent (user), **(C)** residential brokerage principal (buyer of seats), **(D)** mid-tier design-partner firm.

---

## 6. Functional requirements & build status

Status key: ✅ Built · 🟡 Partial / verify · 🔀 Diverged from v0.1 · ⬜ Not yet built

### Ingestion
- **FR-1 — Address → tax roll.** ✅ Built, and stronger than spec. Address parsed → Miami-Dade GIS search returns candidate parcels → **broker confirms the folio before any fetch/extract** → MDPA detail pulled → Claude structures it. Folio is the unique anchor.
- **FR-2 — URL paste.** ✅ Built. Page content fetched → Claude extracts → saved.
- **FR-3 — File upload (general doorway).** 🔀 Built; replaces v0.1's "forward an email." Accepts CSV / Excel / PDF / image / text and runs it through the shared pipeline. This is also the **CoStar path** — brokers export from CoStar and upload the file (no credential storage).
- **FR-4 — CoStar credential enrichment.** 🔀 Not built as credentialed enrichment; intentionally replaced by the export-upload path (FR-3), which is the safer design. Automated CoStar account access remains off the table pending terms.
- **FR-5 — Dedup & update.** ✅ Built (`findDuplicate` / `upsertProperty`): matches on `source_url` (folio ref) first, then normalized address; updates instead of duplicating.
- **FR-6 — Confidence flagging.** ✅ Built. Extraction returns `confidence_flags: [{field, reason}]`; the model is instructed to flag absent/ambiguous/inferred fields rather than guess.

### Data model
- **FR-7 — Structured records.** ✅ Built (see Appendix A for as-built schema).
- **FR-8 — Tagging & tiering.** ✅ Built. Tier, size/geographic/ownership categories, client status. *(verify exact placement of size_category/geographic_category across properties vs contacts.)*

### Lease abstraction (wedge)
- **FR-9 — Lease abstraction.** ✅ Built, strong. Extracts execution/expiration dates, term, base_rate, structured escalations, typed options (renewal/termination/expansion), key provisions — **with field-level citations (page + source text)**.
- **FR-10 — Standalone usability.** ✅ Built. Works with no CRM setup.

### Query & outreach
- **FR-11 — Natural-language query.** 🟡 Built ("Search in plain English" in the CRM). *(verify it translates to parameterized filters, not raw SQL.)*
- **FR-12 — Personalized outreach drafts.** ✅ Built (`generateDrafts`) — per-recipient drafts using contact + linked-property context.
- **FR-13 — Cadence & actionability.** ✅ Built (`getDueContacts`). Tier-based cadence: **Tier 1 = 14 days, Tier 2 = 30, Tier 3 = 90**; surfaces due/overdue contacts.
- **FR-14 — Send & log.** 🟡 Built via Resend; updates `last_contacted_at`. **Verify a human review-before-send gate exists before running against real contacts (§15).**

### Ownership & access
- **FR-15 — Export.** ✅ Built — separate export routes for properties, contacts, and leases.
- **FR-16 — Ownership model.** ✅ Built — RLS by `owner_id` on every table.
- **FR-17 — Seat provisioning (brokerage motion).** ⬜ Not built. Deferred (Phase 2/3).

### NEW — added during build, not in v0.1
- **FR-18 — Custom fields.** 🟡 Built in code; **broken in production because its DB migration was never run (§15).** Brokers define custom fields per entity (`field_definitions`: name, type, select options, and for properties a `fill_mode` of *extract* vs *manual*). Values stored in a `custom_fields` JSONB column. Behavior: contacts = input-only; leases = extraction-only; properties = extract-where-source-has-it, manual otherwise. Custom "extract" fields are injected into the Claude tool schema dynamically.
- **FR-19 — Unified ingestion pipeline.** ✅ Built. All doorways (address, URL, upload) funnel through one extraction tool + one save path (`extractPropertyFields` → `savePipelineProperty`/`upsertProperty`), each tagging a `source`.

---

## 7. Data sources & integrations

- **Miami-Dade GIS + MDPA (primary).** Address search via the ArcGIS layer; folio detail via PaServicesProxy. *Note in code:* the old `GetPropertySearchByAddress` endpoint is broken (returns "111 NW 1 ST" for every query) — this is why the GIS layer is used. **Legacy bad rows from that endpoint may still be in the DB (§15).**
- **URL / uploaded files (incl. CoStar exports).** Parsed via the shared pipeline; CoStar is opt-in, file-based, no credentials.
- **MLS.** Out of scope (licensing).

---

## 8. Non-functional requirements

- **NFR-1 — Accuracy gate.** ≥ 98% core-field accuracy before general release. Hard gate. *Currently unmeasured.*
- **NFR-2 — Latency.** Ingestion < 10s; abstraction < 60s.
- **NFR-3 — Reliability.** Failed enrichment/source never corrupts a record.
- **NFR-4 — Security.** RLS isolation per `owner_id`; secrets in `.env.local` (gitignored); no third-party passwords stored.
- **NFR-5 — Portability.** Full export, no lock-in.
- **NFR-6 — Scale.** ⬜ Not met — CRM loads all rows client-side, no pagination (§15).

---

## 9. Data ownership & permission model

Individual-broker accounts: broker owns data, full export, no firm access — enforced by RLS. Brokerage/firm-owned mode and seat provisioning: not yet built (FR-17). Recommended default for the residential motion remains broker-owned.

---

## 10. Release status

- **Phase 1 (wedge + core ingestion):** substantially built — lease abstraction, address/URL/upload ingestion, dedup, confidence flags, CRM table + tagging, NL search, outreach, export. Remaining to be *demo-ready*: fix custom-fields migration, clean bad data, validate lookup accuracy (§15).
- **Phase 2:** brokerage seats/firm mode (FR-17), cadence refinements, second county.
- **Phase 3:** multi-county scale, MLS under license, transaction adjacency.

---

## 11–14

Dependencies, risks, and open questions from v0.1 still hold (CoStar terms, MLS licensing, market sizing, design-partner economics, pricing). The CoStar risk is now largely mitigated by the file-export approach.

---

## 15. Known issues & tech debt (NEW — fix before demoing)

Priority order:

1. **Custom-fields migration never run (breaks FR-18).** `field_definitions` table and `custom_fields` columns don't exist in Supabase, so "add a column" silently fails and never reaches extraction. Fix: run the SQL in `scripts/migrate-custom-fields.ts` against the database.
2. **Legacy bad data in `properties`.** Rows like "111 NW 1 ST / Miami-Dade County / 1.48M sqft" are artifacts of the old broken address endpoint. Audit and remove; they erode broker trust on sight.
3. **Lookup accuracy is unproven.** The GIS `WHERE hse_num=X AND sname LIKE '%keyword%'` is fuzzy and uses only the first street keyword. The folio-confirmation step mitigates wrong picks, but real accuracy against the 98% gate has never been measured.
4. **Zero automated tests.** No coverage despite a 98% accuracy gate. Highest-risk units to cover first: `parseAddressForGIS`, `normalizeAddress`/`findDuplicate`, `buildCustomFieldsSchema`.
5. **No migration runner / undocumented migrations.** No `npm run migrate`; migrations are manual and undocumented — which is how #1 happened. Other migrations (`migrate.ts`, `migrate-contacts.ts`) may be partially applied.
6. **No pagination / client-side load-all.** CRM fetches all rows in the browser — fine for a handful, fails at a real broker's book size.
7. **Outreach send gate unverified.** Sends via Resend and updates `last_contacted_at`; confirm a human review-before-send step exists before using real contact data.

---

## Appendix A — As-built data schema

### properties
`id`, `owner_id`, `address`, `city`, `submarket`, `owner_name`, `ownership_type` (institutional / private / REIT / owner-occupant / unknown), `size_sqft`, `property_type` (industrial / office / retail / multifamily / land / residential / mixed-use / other), `last_sale_date`, `last_sale_price`, `building_composition` (JSON: `year_built`, `lot_size_sqft`, `stories`, `units`, `parking_spaces`, `dor_code`, `dor_description`, `legal_description`, `assessed_value`), `source`, `source_url`, `ingested_at`, `updated_at`, `confidence_flags` [{field, reason}], `custom_fields` (JSONB). *(Plus tagging fields — size/geographic category — verify exact columns.)*

### contacts
`id`, `owner_id`, `name`, `email`, `company`, `role`, `contact_tier` (1/2/3), `client_status`, `last_contacted_at`, `size_category`, `geographic_category`, `ownership_type`, `linked_properties` (array of property ids), `custom_fields` (JSONB). Cadence is **computed** from tier (14/30/90 days), not stored. *(action_tags / next_action_due from v0.1 — verify presence.)*

### lease_abstracts
`id`, `owner_id`, `property_id` (nullable — abstraction works standalone), `execution_date`, `expiration_date`, `term`, `base_rate` (number), `escalations` [{description, rate, effective_date}], `options` [{type, description, notice_period}], `key_provisions` [{provision, citation}], `field_citations` [{field, page, text}], `source_document`, `custom_fields` (JSONB).

### field_definitions (custom fields)
`id`, `owner_id`, `entity_type` (property / contact / lease), `field_name`, `field_type` (text / number / date / select), `select_options` (JSONB), `fill_mode` (extract / manual — properties only), `created_at`. Unique on (owner_id, entity_type, field_name). RLS by owner.
