# Product Requirements Document — Beacon by Lantern

| | |
|---|---|
| **Product** | Beacon (working name) — broker-owned CRM with zero manual data entry |
| **Author** | Alec Ramoski |
| **Status** | Draft v0.1 — for review |
| **Last updated** | June 10, 2026 |
| **Stakeholders** | Lantern product team, Tyler Heinerikson, design-partner brokerage (TBD) |

---

## 1. Summary

Beacon is an AI-native CRM for real estate brokers built on one principle: the broker never performs manual data entry, and the broker owns their data. Brokers ingest properties and contacts by pasting a URL, forwarding an email, or entering an address; Beacon parses public and licensed sources into a structured, queryable database that belongs to the broker. An agentic layer then segments contacts and runs personalized outreach on a cadence — automating the prospecting workflow that drives brokerage revenue.

The product enters the market through a single high-value wedge (AI lease abstraction) and expands into the full CRM platform. It serves two buyers from one architecture: individual commercial brokers and residential brokerages that resell it to their agents.

---

## 2. Background & problem

Existing real estate CRMs, Salesforce foremost, are architected to serve the *firm* — commission billing, lease-expiration tracking, and retention of the book of business — while loading data-entry labor onto the *broker*. The broker's incentive (own and control my data, minimize busywork) is structurally opposed to the tool's purpose (centralize data for the firm). Brokers respond by abandoning the CRM for Excel, where the work and the data are at least theirs.

Two segments feel this acutely:

- **Commercial brokers** at large firms are locked into company-owned systems they find nearly unusable for daily work.
- **Residential agents** are typically given no tooling at all and left to self-assemble a stack.

The individual generating the business has no system that works for them and that they control. Beacon resolves the misalignment by picking the broker's side: effortless ingestion plus genuine data ownership.

---

## 3. Goals & non-goals

### 3.1 Goals

- **G1** — Eliminate manual property/contact data entry for brokers.
- **G2** — Give brokers a structured, queryable, portable database they own.
- **G3** — Automate segmented, personalized outreach on a cadence (the revenue-driving workflow).
- **G4** — Land via a standalone lease-abstraction wedge that requires no migration.
- **G5** — Support two go-to-market motions (individual broker; brokerage-as-reseller) on one codebase.

### 3.2 Non-goals (for the initial releases)

- **NG1** — Commission billing / accounting / back-office finance (this is the firm-side job Beacon deliberately does *not* compete on).
- **NG2** — Full transaction management / deal pipeline tooling (later phase, separate vertical).
- **NG3** — National county coverage at launch (start single-market).
- **NG4** — Direct MLS data integration at launch (licensing constraints — see §9.3).
- **NG5** — Replacing a firm's entire ERP stack (that's the broader Lantern BRP play, not Beacon's wedge).

---

## 4. Success metrics

| Metric | Definition | Target (first design-partner deployment) |
|---|---|---|
| Ingestion accuracy | % of parsed records with all core fields correct | ≥ 98% on core fields (owner, address, size) |
| Time-to-record | Median seconds from input to saved structured record | < 10 seconds |
| Manual-entry rate | % of records requiring any manual field correction | < 10% |
| Activation | % of onboarded brokers who ingest ≥ 25 records in week 1 | ≥ 60% |
| Weekly active use | % of activated brokers using outreach features weekly | ≥ 50% |
| Lease-abstraction time saved | Median manual time replaced per abstract | ≥ 90 minutes |
| Retention | 90-day broker retention | ≥ 70% |

Accuracy is the make-or-break metric. A broker who encounters repeated wrong data stops trusting the system and reverts to Excel; there is no second first impression. See §8 (NFRs) for the hard accuracy gate.

---

## 5. Target users & personas

**Persona A — Independent commercial broker ("the Excel holdout").** Mid-career, manages a personal book of properties/owners/tenants in spreadsheets because firm CRMs are too cumbersome and they want to own their data. Buys Beacon directly. Primary value: never typing a property again + a database that travels with them.

**Persona B — Residential agent (user, not buyer).** Given little or no tooling by their brokerage. Receives Beacon as a per-seat subscription their brokerage provides. Primary value: a working CRM with automated follow-up.

**Persona C — Residential brokerage principal / home office (the buyer for Persona B).** Wants agent visibility, stickier agents, and a competitive answer to larger firms building in-house. Buys seats for their agents. Primary value: a turnkey tool they don't have to build, with optional firm-level visibility.

**Persona D — Design-partner firm (mid-tier).** Co-builds v1 at favorable economics, becomes a reference account and potential reseller.

---

## 6. User stories / jobs-to-be-done

- **US1** — As a broker, I paste a property listing URL and get a complete structured record so I never transcribe property details.
- **US2** — As a broker, I forward a listing email or lease PDF and have it parsed into fields automatically.
- **US3** — As a broker, I type an address and Beacon retrieves owner, sale history, and building composition from the county tax roll.
- **US4** — As a broker, I tag and tier contacts (tier 1/2/3, size, geography, ownership type) so I can target outreach.
- **US5** — As a broker, I ask in plain language ("industrial owners over 100k sq ft near the airport I haven't contacted in 90 days") and get the matching list.
- **US6** — As a broker, I trigger a personalized outreach email to a segment with one action.
- **US7** — As a broker, I see who's actionable now and on what cadence, so I maintain repetition without manual tracking.
- **US8** — As a broker, I upload a lease and receive an accurate abstract (dates, rate, term, provisions) in seconds.
- **US9** — As a broker, I can export my entire database at any time, because I own it.
- **US10** — As a brokerage principal, I provision/deprovision agent seats and (where permitted) see firm-level activity.

---

## 7. Functional requirements

### 7.1 Ingestion

- **FR-1 — URL paste.** Accept a pasted listing/property URL and parse it into a structured record (owner, address, size, last sale date, sale price, building specs). *Acceptance:* a valid LoopNet/listing URL yields a saved record with core fields populated in < 10s.
- **FR-2 — Email / document forward.** Accept a forwarded email or attached document (listing blast, flyer, lease PDF) at a Beacon inbox address and parse it into fields. *Acceptance:* forwarded listing email creates/updates a record; lease PDF routes to abstraction (FR-9).
- **FR-3 — Address drop → tax roll.** Accept a street address and retrieve owner, sale history, and building composition from the county property-appraiser/tax-roll source. *Acceptance:* a valid Miami-Dade address returns owner + sale history + building data.
- **FR-4 — Optional CoStar enrichment.** Where the broker supplies their own CoStar credentials, enrich records with additional ownership-contact / tenant data. *Acceptance:* enrichment runs only with broker-authorized credentials; absence of CoStar never blocks a record.
- **FR-5 — Deduplication & update.** Detect when an ingested item matches an existing record and update rather than duplicate. *Acceptance:* re-ingesting the same property updates the existing record; no duplicate row created.
- **FR-6 — Confidence flagging.** Surface low-confidence parsed fields for one-tap broker review. *Acceptance:* fields below a confidence threshold are visibly flagged, not silently saved.

### 7.2 Data model & database

- **FR-7 — Structured records.** Every property and contact is stored as a structured record per the schema in Appendix A, queryable by all category fields.
- **FR-8 — Tagging & tiering.** Brokers assign and edit tier (1/2/3), size category, geographic category, ownership-type category, geographic descriptor, action tags, and client status. *Acceptance:* all category fields are user-editable and filterable.

### 7.3 Lease abstraction (wedge)

- **FR-9 — Lease abstraction.** Ingest a lease document and produce a structured abstract: execution date, expiration, rate, escalations, key provisions, options. *Acceptance:* abstract returns all core fields with citations to source location in the document; median turnaround < 60s.
- **FR-10 — Standalone usability.** Lease abstraction works without any CRM setup or data migration. *Acceptance:* a new user can abstract a lease in their first session with no onboarding.

### 7.4 Querying & agentic outreach

- **FR-11 — Natural-language query.** Brokers query the database in plain language and receive a filtered contact/property list. *Acceptance:* "industrial owners over 100,000 sq ft in [submarket] not contacted in 90 days" returns the correct filtered set.
- **FR-12 — Personalized outreach generation.** Generate per-recipient personalized outreach drafts for a selected segment. *Acceptance:* each draft references recipient-specific record fields; broker reviews before send.
- **FR-13 — Cadence & actionability.** Surface which contacts are due for follow-up and on what cadence; flag actionable contacts. *Acceptance:* a daily/weekly "who to contact now" view is generated from last-contact data and tier.
- **FR-14 — Send & log.** Send approved outreach and log it against each record, updating last-contact timestamps. *Acceptance:* sent messages appear in each contact's history and reset the cadence clock.

### 7.5 Ownership, portability & access

- **FR-15 — Data export.** Brokers export their full database (records, tags, contact history) on demand in a standard format. *Acceptance:* one action produces a complete export with no gating.
- **FR-16 — Ownership model.** Data is owned by the broker account by default; see §10 for the firm-vs-broker permission model.
- **FR-17 — Seat provisioning (brokerage motion).** Brokerage admins provision/deprovision agent seats. *Acceptance:* admin can add/remove a seat; removing a seat does not delete the agent's exportable data without explicit policy.

---

## 8. Non-functional requirements

- **NFR-1 — Accuracy gate.** Core-field ingestion accuracy must hold ≥ 98% on the launch market before general release. Below this, the market is not shipped. This is a hard gate, not a target.
- **NFR-2 — Latency.** Median ingestion < 10s; lease abstraction < 60s; query response < 3s.
- **NFR-3 — Reliability.** Ingestion pipeline degrades gracefully — a failed enrichment or unreachable source never loses the broker's input or corrupts a record.
- **NFR-4 — Security.** Broker credentials (e.g., CoStar logins) stored encrypted; per-account data isolation; audit log of data access.
- **NFR-5 — Portability.** No proprietary lock on the data format that would prevent clean export (the product's ownership promise depends on this being real).
- **NFR-6 — Multi-tenancy.** Architecture supports both single-broker accounts and brokerage-managed multi-seat accounts without code forks.

---

## 9. Data sources & integrations

### 9.1 County tax-roll / property appraiser data (primary, defensible)

Public records (launch: Miami-Dade property appraiser) are the defensible spine — free and controllable. Each new county requires format-specific parsing work; this tedium is part of the moat.

### 9.2 CoStar / LoopNet (optional enrichment)

Treated as broker-authorized enrichment only, via the broker's own credentials. **Risk:** CoStar is historically protective of its data and terms of use. Beacon must never depend on an unsanctioned CoStar API relationship; design it as opt-in enrichment the customer turns on. Validate terms before any deeper integration.

### 9.3 MLS / residential listing data (deferred)

Direct MLS integration carries licensing/legal constraints and is **out of scope at launch** (NG4). The parsing-based ingestion paths (URL, forward, address) reduce the need for direct MLS integration; revisit only with proper RESO/MLS licensing.

---

## 10. Data ownership & permission model

This model *is* the product thesis and must be unambiguous.

- **Individual-broker accounts:** the broker is the data owner. Full export rights at all times. No firm access.
- **Brokerage-provisioned accounts (Persona C buys seats for Persona B):** define at sale which of two modes applies —
  - **Broker-owned mode:** agent owns and retains their data; firm gets aggregate/activity visibility only. (Strongest version of the "you own it" pitch.)
  - **Firm-owned mode:** firm owns the data (mirrors the commercial-firm model). Offered where a firm requires it, but it weakens the differentiator and should be the exception.
- Mode must be explicit, disclosed to the agent, and govern what happens to data on seat removal (FR-17).

Open question (§14): default mode for the residential motion. Recommendation: broker-owned, because it's the wedge.

---

## 11. Release plan

### Phase 0 — Validation (pre-build)
- Market-validation calls to residential firm home offices (would they subscribe agents?).
- Confirm design-partner brokerage.
- Confirm Miami-Dade tax-roll data access and parsing feasibility.
- Confirm/decline CoStar enrichment path and terms.

### Phase 1 — Wedge + core ingestion (v1, demoable)
**In scope:** FR-9, FR-10 (lease abstraction); FR-1, FR-3, FR-5, FR-6 (URL + address ingestion, dedup, confidence flagging) scoped to **one county (Miami-Dade)**; FR-7, FR-8 (data model + tagging); FR-11 (basic NL query); FR-12, FR-14 (personalized outreach + send/log); FR-15 (export).
**Goal:** put in front of one design-partner brokerage and prove the promise — no manual entry, the data is yours, it helps win business.

### Phase 2 — Outreach depth + brokerage motion
FR-2 (email/document forward), FR-4 (CoStar enrichment, if cleared), FR-13 (cadence/actionability), FR-17 (seat provisioning), §10 firm/broker modes, second county.

### Phase 3 — Scale
Additional county coverage, advanced segmentation/analytics, residential MLS revisited under proper licensing, transaction-management adjacency (separate PRD).

---

## 12. Dependencies

- Lantern's parsing pipeline / AI engines (core ingestion + abstraction).
- County tax-roll data access for the launch market.
- Design-partner brokerage for v1 co-build and feedback.
- (Optional) CoStar credential-based enrichment, pending terms review.

---

## 13. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Parsing accuracy below trust threshold | Brokers revert to Excel; product fails | Hard 98% accuracy gate (NFR-1); single-market launch; confidence flagging (FR-6) |
| CoStar terms / data-access conflict | Loss of enrichment or legal exposure | Broker-credentialed opt-in only; never a dependency; review terms in Phase 0 |
| MLS licensing constraints | Residential data gaps / legal risk | Parsing-based ingestion instead; MLS deferred to Phase 3 with licensing |
| Market too small / hard to reach (commercial individuals) | Weak revenue | Lead with residential-brokerage-as-buyer (larger, reachable); validate in Phase 0 |
| Low moat / cloneability | Margin erosion | Compounding county-data work + parsing reliability + switching cost from owned book |
| County-by-county scaling cost | Slow expansion | Prove unit economics on Miami-Dade before committing to national rollout |

---

## 14. Open questions

- **OQ1** — Default ownership mode for the residential brokerage motion (§10). Recommendation: broker-owned.
- **OQ2** — Which design-partner firm, and on what build/resale economics?
- **OQ3** — Is CoStar enrichment in or out for Phase 2, pending terms review?
- **OQ4** — Pricing: per-seat price points for direct-broker vs. brokerage-reseller motions?
- **OQ5** — Lease-abstraction sold standalone (separate SKU) or only as the CRM's front door?

---

## Appendix A — Core data schema (v1)

Derived from the manual category system a veteran broker built and proved in practice.

**Property record**
- `property_id` (system)
- `address`, `city`, `submarket`, `geographic_category`, `geographic_descriptor`
- `owner_name`, `ownership_type` (e.g., institutional / private / REIT / owner-occupant)
- `size_sqft`, `size_category`
- `property_type` (industrial / office / retail / multifamily / land / …)
- `last_sale_date`, `last_sale_price`
- `building_composition` / specs
- `source` (tax_roll / url / forward / costar), `source_url`, `ingested_at`, `confidence_flags[]`

**Contact record**
- `contact_id` (system)
- `name`, `company`, `role`, `email`, `phone`
- `contact_tier` (1 / 2 / 3)
- `client_status` (prospect / active client / past client)
- `linked_properties[]`
- `action_tags[]`
- `last_contacted_at`, `next_action_due`, `cadence`
- `outreach_history[]` (timestamped, message-linked)

**Lease abstract record**
- `lease_id` (system), `linked_property`
- `execution_date`, `expiration_date`, `term`
- `base_rate`, `escalations`, `options` (renewal / termination / expansion)
- `key_provisions[]`
- `source_document`, `field_citations[]` (location in source)
