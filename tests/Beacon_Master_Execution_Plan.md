# Beacon — Master Execution Plan

**Purpose:** the exact, ordered sequence of Claude Code prompts to take Beacon from its current state to a category-leading, broker-desirable, production-ready CRE product — sequenced so that broker value and reliability come first, and the business/scale layer comes only after brokers validate the core.

**How to use this:** run one prompt at a time, in order. After each: run the validation commands, do the manual test, run the self-review prompt (Appendix A), then commit. Never batch. Beacon must stay functional after every phase.

---

## Current state (from code inspection — the real source of truth, not the PRD)

**Already strong — preserve these, do not rebuild:**
- Property ingestion pipeline: address→Miami-Dade GIS lookup with folio confirmation, URL, and file upload, through one unified extract/save pipeline with dedup (`lib/mdpa.ts`, `property-pipeline.ts`, `property-ingest.ts`).
- Owner enrichment: unified Enrich panel chaining county → Sunbiz owner discovery → owner contacts, source-tagged and confidence-flagged (`lib/sunbiz.ts`, `owner-contacts.ts`).
- Lease abstraction with field-level citations (`app/abstracts`, `field_citations`).
- Lease radar, owner portfolio, smart lists, activities, follow-ups, outreach with cadence, custom fields, tenant tracking.
- Foundation: RLS on all tables, 76 passing tests, migration runner (`npm run migrate`), schema verify, accuracy checker scaffold (`check-gis-accuracy.ts`), Settings hub.

**Genuinely missing / weak (what this plan addresses):**
- **Unproven lookup accuracy** — the checker exists but has never been run against a real labeled dataset. (Highest risk.)
- **No real pagination** — CRM loads records client-side; won't scale to a real broker's book.
- **No deal/pipeline** — the biggest feature gap for being a broker's operating system.
- **No email/calendar capture** — "zero manual entry" is incomplete without it.
- **No billing, no team/multi-user** — can't sell or support teams yet.
- **Lease abstraction lacks** side-by-side verification UI, exports, batch, critical-date calendar.

**Positioning (drives every decision below):** *"Turn addresses, spreadsheets, and lease documents into a clean, searchable, broker-owned CRE database — with almost no manual entry."* Lead with lease abstraction + zero-entry database creation. Do **not** market as "another AI CRM." ICP: **independent & small-team Miami-Dade industrial/investment brokers** currently living in Excel + Outlook + CoStar.

---

# PHASE STRUCTURE & PRIORITY

| Phase | Name | Tier |
|---|---|---|
| 0 | Audit & truth | **CORE — before pilot** |
| 1 | Lookup accuracy (measure + fix) | **CORE — before pilot** |
| 2 | Performance & pagination | **CORE — before pilot** |
| 3 | Lease abstraction excellence (the wedge) | **CORE — before pilot** |
| 4 | Daily-action intelligence | **CORE — before pilot** |
| 5 | Relationship graph / owner portfolio | **CORE — before pilot** |
| 6 | Lightweight deal pipeline | **CORE — before pilot** |
| 7 | UX polish & design system | **CORE — before pilot** |
| 8 | Security, validation & observability hardening | **CORE — before pilot** |
| 9 | Onboarding & guided import | **CORE — before pilot** |
| 10 | Email & calendar sync | ⚠️ SCALE — large multi-week integration, after pilot validation |
| 11 | Team collaboration & permissions | ⚠️ SCALE — after pilot validation |
| 12 | Billing & subscriptions | ⚠️ BUSINESS — after brokers commit to pay |
| 13 | Marketing site & pilot analytics | ⚠️ BUSINESS — after core validated |
| 14 | Production readiness & launch | BUSINESS — final gate |

**You could stop after Phase 9 and have something a broker would pay for and use daily.** Phases 10–14 are upside, not prerequisites. ⚠️ = large integration; don't underestimate.

---

# PHASE 0 — AUDIT & TRUTH

### Prompt 0.1 — Full codebase & product audit
**Objective:** establish a shared, accurate picture and a written audit; fix the stale PRD.
**Inspect first:** every route in `app/`, all `lib/` modules, all `scripts/` migrations, `tests/`, RLS policies, and package.json scripts.
**Prompt:**
> Do a full read-only audit of this codebase — do not change any code. Inspect every route under app/, every module in lib/, every migration in scripts/, the tests/, and the RLS policies. Produce AUDIT.md documenting: (1) every feature that exists and whether it works end-to-end or is partial/stubbed; (2) the real data model from the migration scripts; (3) security posture (RLS coverage, input validation, auth); (4) performance risks (any client-side load-all, missing pagination, N+1 queries); (5) dead/orphaned code; (6) what is genuinely missing vs. competitors (deal pipeline, email/calendar, team, billing). Then rewrite Beacon_PRD.md to match reality exactly, with a "Known gaps" section. Be blunt about what is not production-ready.

**Expected:** `AUDIT.md` + rewritten `Beacon_PRD.md`. No code changes.
**Tests:** none (read-only).
**Docs:** AUDIT.md, Beacon_PRD.md.
**Validate:** `npm run test && npx tsc --noEmit` (confirm still green).
**Definition of done:** AUDIT.md accurately lists current features/gaps; PRD matches code.
**Manual:** skim AUDIT.md; confirm it matches what you see in the app.
**Commit:** `docs: full audit + PRD rewrite`.

---

# PHASE 1 — LOOKUP ACCURACY (the trust gate)

### Prompt 1.1 — Accuracy harness
**Objective:** measure Miami-Dade lookup accuracy against real labeled data.
**Inspect first:** `scripts/check-gis-accuracy.ts`, `lib/mdpa.ts` (`searchByAddressGIS`, `parseAddressForGIS`, folio logic).
**Prompt:**
> Extend scripts/check-gis-accuracy.ts into a real accuracy harness. It should read a CSV I provide (columns: address, expected_owner, expected_folio), run each address through the actual GIS + folio lookup in lib/mdpa.ts (no mocks), and report: overall hit rate (correct folio as top match), plus per-row result (correct / wrong match / not found) and a detailed list of every miss with what it returned vs. expected. Make it `npm run check:gis -- <path-to-csv>`. Add unit tests for parseAddressForGIS covering units, directionals, and missing house numbers.

**Expected:** working harness + parse tests.
**Tests:** `parseAddressForGIS` unit tests.
**Validate:** `npm test && npm run check:gis -- test-addresses.csv`.
**Definition of done:** running it on a real CSV prints a hit rate and a miss list.
**Manual:** ⚠️ **THE key step — build a CSV of your dad's 19 properties + ~30 more with known owners/folios, run it, and record the hit rate.**
**Commit:** `feat: real GIS accuracy harness`.

### Prompt 1.2 — Fix accuracy misses (only if hit rate < ~95%)
**Objective:** raise the hit rate to a trustworthy level.
**Inspect first:** the miss list from 1.1; the GIS `WHERE` clause and address normalization.
**Prompt:**
> Here are the failing cases from the accuracy harness: [paste misses]. Diagnose why each missed (address parsing, fuzzy street matching, multi-parcel ambiguity, folio resolution) and propose fixes to lib/mdpa.ts before changing anything. Then implement the fixes, keeping the folio-confirmation step intact. Re-run the harness and report the new hit rate. Add regression tests for each previously-failing case.

**Validate:** `npm test && npm run check:gis -- test-addresses.csv` (hit rate up, no regressions).
**Definition of done:** hit rate ≥ ~95% on the real set; each fixed case has a regression test.
**Commit:** `fix: raise GIS lookup accuracy to N%`.

---

# PHASE 2 — PERFORMANCE & PAGINATION

### Prompt 2.1 — Server-side pagination for the workspace
**Objective:** survive a real broker's book (thousands of records).
**Inspect first:** `app/crm/view.tsx`, `app/crm/actions.ts`, `app/crm/page.tsx` data loading.
**Prompt:**
> The Workspace loads properties and contacts client-side with no pagination. Refactor to server-side pagination: load in pages of 50 with server-side filtering, sorting, and search pushed to Supabase (`.range()`), plus pagination or infinite scroll in the table. Preserve ALL existing behavior: my dad's column set, natural-language search, smart lists, inline editing (EditableText/Select/Tags), and per-tab filters — they must all work against the paginated query. Add loading, empty, and error states. Include a script to seed 2,000 test properties so I can verify performance.

**Tests:** pagination + filter query tests.
**Validate:** `npm test && npx tsc --noEmit && npm run build`, then seed 2,000 rows.
**Definition of done:** workspace is fast with 2,000+ rows; all filters/edits/search still work; loading/empty/error states present.
**Manual:** seed 2,000 rows, scroll/filter/search/edit — confirm snappy.
**Commit:** `perf: server-side pagination for workspace`.

---

# PHASE 3 — LEASE ABSTRACTION EXCELLENCE (the wedge)

### Prompt 3.1 — Side-by-side verification UI
**Inspect first:** `app/abstracts`, the abstraction actions, `field_citations` data.
**Prompt:**
> Make lease abstraction best-in-class — it's our wedge. Add a side-by-side view: source PDF on one side, extracted abstract on the other, with each field's citation clickable to jump to/highlight its source location in the PDF. Add a per-field confidence indicator and an accept/reject/correct control per field, persisting corrections. Reuse existing abstraction actions and citation data — do not rewrite extraction. Add loading/empty/error/success states and tests.

**Validate:** `npm test && npx tsc --noEmit && npm run build`.
**Definition of done:** upload a lease → see source + abstract side by side → click a citation → correct a field → correction persists.
**Manual:** run a real lease through it; click citations; correct a field; reload to confirm persistence.
**Commit:** `feat: lease abstraction side-by-side verification`.

### Prompt 3.2 — Exports, critical-date calendar, and batch
**Prompt:**
> Add to lease abstraction: export an abstract to Word, Excel, and PDF; export critical dates (expiration, option/notice deadlines) as an .ics calendar file; and batch abstraction of multiple uploaded leases at once. Reuse existing abstraction logic. Tests for export generation and batch handling; loading/error states throughout.

**Validate:** `npm test && npm run build`.
**Definition of done:** exports produce valid files; .ics imports into a calendar; batch processes multiple leases.
**Manual:** export to each format; import the .ics; batch 3 leases.
**Commit:** `feat: lease exports, critical-date calendar, batch abstraction`.

---

# PHASE 4 — DAILY-ACTION INTELLIGENCE

### Prompt 4.1 — Reason-driven actions
**Objective:** turn generic reminders into specific intelligence (the "why now / what to say").
**Inspect first:** dashboard actions, `lib/lease-radar.ts`, outreach actions, activity data, ownership-change flags.
**Prompt:**
> Upgrade the dashboard's "who to contact today" and outreach suggestions from generic reminders into specific, reason-driven actions using data already in the system: linked property details, lease expiration timing (lease-radar), ownership-change flags, and days since last contact. Each action should state WHY now and WHAT to mention — e.g. "Call John Smith — 42,000 SF Doral lease expires in 14 months, ownership changed recently, last contacted 93 days ago" — with one-click compose (reuse ComposeOutreach) pre-filled with that context. Do NOT redesign the dashboard layout — enhance the action items within it. Add empty/loading states and tests.

**Validate:** `npm test && npm run build`.
**Definition of done:** dashboard actions show real reasons + property/lease context, not just tier/date; compose pre-fills context.
**Manual:** confirm a real action shows a specific, accurate reason and opens a pre-filled draft.
**Commit:** `feat: reason-driven daily action intelligence`.

---

# PHASE 5 — RELATIONSHIP GRAPH / OWNER PORTFOLIO

### Prompt 5.1 — Owner portfolio as centerpiece
**Inspect first:** `lib/owner-portfolio.ts`, `app/owner-portfolio`, Sunbiz entity links, lease-radar, activities, relationship briefing.
**Prompt:**
> Elevate the owner portfolio into a central relationship-graph view — the core CRE differentiator. For any owner, show one page connecting: all owned properties, related ownership entities/LLCs (from Sunbiz), key contacts, full activity history, portfolio-wide lease expirations, recent sales, and AI-suggested next actions (who to call and why). Make it prominently reachable from any contact or property tied to that owner. Reuse owner-portfolio, lease-radar, activity, and relationship-briefing logic. Add loading/empty/error states and tests.

**Validate:** `npm test && npm run build`.
**Definition of done:** opening an owner shows their whole portfolio + relationships + suggested actions in one place.
**Manual:** open an owner with multiple properties; confirm the graph and suggestions render.
**Commit:** `feat: owner portfolio relationship graph`.

---

# PHASE 6 — LIGHTWEIGHT DEAL PIPELINE

### Prompt 6.1 — Deals model + views
**Objective:** stop being "just a data tool" — add the deal lifecycle brokers live in.
**Inspect first:** contacts/properties/activities schema; how records link.
**Prompt:**
> Add a lightweight deal/pursuit pipeline (not a heavy transaction suite). Create a deals table via an idempotent migration (run by npm run migrate), RLS by owner, with: stage (prospect / contacted / meeting / requirement / proposal / won / under_contract / closed / lost), links to contacts and properties, estimated commission, next action, and timestamps. Add a Deals view (kanban by stage + list), let me create a deal from any contact or property, and surface active/stale deals on the dashboard. Server-side validation, loading/empty/error/success states, and tests. Run npm run migrate and npm run db:verify after.

**Validate:** `npm run migrate && npm run db:verify && npm test && npm run build`.
**Definition of done:** create a deal from a contact/property, move it through stages, see it on the dashboard.
**Manual:** create a deal, drag through stages, confirm dashboard surfaces stale ones.
**Commit:** `feat: lightweight deal pipeline`.

---

# PHASE 7 — UX POLISH & DESIGN SYSTEM

### Prompt 7.1 — Design system + brand
**Inspect first:** existing app-shell, Tailwind config, component styles.
**Prompt:**
> Establish and apply one consistent design system across every page — calm, professional, Attio/Linear-quality. Brand: navy #14233B primary, amber #E8A33D accent. Lock a spacing scale and type scale; consistent app shell, buttons, inputs, badges (tier/status/type/source as pills), muted "not found"/unverified states, tables with sticky headers and right-aligned tabular numerics. Styling only — do not change functionality. Preserve the dashboard's current layout; apply only shared tokens to it. Light and dark mode. Do not introduce fake states.

**Validate:** `npm test && npm run build`.
**Definition of done:** app looks cohesive/on-brand; every feature still works; dashboard layout unchanged.
**Manual:** click through every page in light + dark; confirm consistency and that nothing broke.
**Commit:** `style: unified design system`.

### Prompt 7.2 — Mobile responsiveness & accessibility
**Prompt:**
> Make the app responsive down to mobile widths (brokers check it on phones) and accessible: keyboard navigation, focus states, ARIA labels on interactive elements, sufficient contrast, and screen-reader-friendly tables. Do not change functionality. Add basic a11y tests where practical.

**Validate:** `npm test && npm run build`.
**Definition of done:** usable on a phone; keyboard-navigable; no obvious a11y violations.
**Manual:** use it on your phone; tab through a form; check contrast.
**Commit:** `feat: responsive + accessible UI`.

---

# PHASE 8 — SECURITY, VALIDATION & OBSERVABILITY HARDENING

### Prompt 8.1 — Server-side validation & authorization audit
**Prompt:**
> Audit every server action and API route for (1) server-side input validation, (2) authorization — confirm each mutation is scoped to the authenticated owner (defense-in-depth beyond RLS: explicitly filter by owner_id, don't rely on RLS alone), and (3) proper error handling. Fix any gaps. Confirm all tables have RLS enabled. Add tests asserting a user cannot read or mutate another user's records. Do not weaken any existing check.

**Validate:** `npm test && npm run build`.
**Definition of done:** every mutation validates input and scopes to owner; cross-user access tests pass.
**Commit:** `security: server-side validation + authorization hardening`.

### Prompt 8.2 — Observability
**Prompt:**
> Add production observability: structured error logging with context across server actions and the ingestion pipeline (extend ingestion-logger), a surfaced "recent errors" view for me, and integrate a error-monitoring hook (e.g. Sentry-compatible) gated behind an env var. Ensure failed lookups/extractions never save corrupt records — they log and surface a clear error instead. Tests for the error paths.

**Validate:** `npm test && npm run build`.
**Definition of done:** errors are logged with context and visible; bad data never silently saves.
**Commit:** `feat: observability + error monitoring`.

---

# PHASE 9 — ONBOARDING & GUIDED IMPORT

### Prompt 9.1 — First-run onboarding + white-glove import
**Objective:** deliver the "organized my scattered data in 10 minutes" moment.
**Prompt:**
> Build a first-run onboarding flow: after signup, guide the broker to import their book — upload a spreadsheet/CSV of contacts/properties and/or a folder of leases — mapping columns to fields, running dedup, and enriching addresses via the existing pipeline. Show progress and a clear result summary ("imported N properties, M contacts, enriched K owners"). Include an empty-state everywhere that guides a brand-new user to their first action. Reuse existing ingestion, dedup, and enrichment. Tests for the import mapping and dedup. Server-side validation and error states throughout.

**Validate:** `npm run migrate && npm test && npm run build`.
**Definition of done:** a new user can import a messy spreadsheet and reach a populated, deduped, enriched CRM without manual fixing.
**Manual:** import your dad's real spreadsheet end-to-end; confirm clean result.
**Commit:** `feat: onboarding + guided import`.

> ✅ **PILOT GATE:** After Phase 9, run the "Ready for broker pilot" checklist (Appendix E). If it passes, **start the pilot with your dad + a few brokers before building Phases 10–14.**

---

# PHASE 10 — EMAIL & CALENDAR SYNC ⚠️ (large, multi-week; after pilot)

### Prompt 10.1 — Read-only email/calendar capture
**Prompt:**
> Add automatic activity capture (this is a large integration — implement carefully in stages). Integrate Gmail and Outlook via OAuth (read-only first): when an email or calendar event involves a known contact, auto-log it as an activity, update last-contacted dates, and surface follow-up commitments — no manual logging. Store OAuth tokens encrypted. Start with a single provider end-to-end before adding the second. Tests for the matching logic; clear connect/disconnect UI in Settings.

**Validate:** `npm run migrate && npm test && npm run build`.
**Definition of done:** connecting an inbox auto-logs emails to linked contacts' timelines.
**Commit:** `feat: email/calendar activity capture (read-only)`.

---

# PHASE 11 — TEAM COLLABORATION ⚠️ (after pilot)

### Prompt 11.1 — Workspaces, roles, shared vs private
**Prompt:**
> Add team functionality carefully. Introduce workspaces/teams: brokerage accounts, member invites, role-based permissions, shared vs. private records, record ownership, and activity visibility rules. This changes the ownership model — design it so existing single-user data migrates cleanly into a personal workspace with no data loss. Explicit decisions for who owns data (broker vs. team). RLS updated for team scoping. Extensive tests for permission boundaries. Idempotent, non-destructive migration.

**Validate:** `npm run migrate && npm run db:verify && npm test && npm run build`.
**Definition of done:** a broker can invite a teammate, share/keep-private records, and permissions are enforced; existing data intact.
**Commit:** `feat: team workspaces + permissions`.

---

# PHASE 12 — BILLING ⚠️ (after brokers commit to pay)

### Prompt 12.1 — Subscriptions
**Prompt:**
> Add Stripe billing: subscription plans (individual broker; small team), a checkout flow, a customer portal for managing payment, and plan-gating of features/seats. Store subscription state, handle webhooks for status changes, and gate access on subscription status. Test the webhook handling and gating. Never expose secret keys client-side.

**Validate:** `npm test && npm run build`.
**Definition of done:** a user can subscribe, manage billing, and access is gated by plan.
**Commit:** `feat: Stripe billing + subscriptions`.

---

# PHASE 13 — MARKETING SITE & PILOT ANALYTICS ⚠️

### Prompt 13.1
**Prompt:**
> Build a marketing landing page (separate route or app) leading with the positioning "Turn addresses, spreadsheets, and lease documents into a clean, searchable, broker-owned CRE database — with almost no manual entry," with a clear CTA. Add privacy-respecting product analytics to measure the metrics that matter: activation (imported data), weekly retention, actions taken (calls/outreach/lease dates caught), and feature usage. Gate analytics behind consent.

**Validate:** `npm run build`.
**Commit:** `feat: marketing site + product analytics`.

---

# PHASE 14 — PRODUCTION READINESS & LAUNCH

### Prompt 14.1 — Production hardening
**Prompt:**
> Final production pass: confirm all env vars documented, secrets server-side only, rate limiting on expensive endpoints (AI extraction, lookups), database indexes on hot query paths, backups configured, error monitoring live, and a health check. Run lint, typecheck, all tests, and a production build. Produce a RELEASE_CHECKLIST.md and fix anything failing.

**Validate:** `npm run lint && npx tsc --noEmit && npm test && npm run build`.
**Definition of done:** the "Ready for paid production" checklist (Appendix F) passes.
**Commit:** `chore: production readiness`.

---

# APPENDICES

## Appendix A — Reusable self-review prompt (run after EVERY feature, before committing)
> Review the git diff of the changes you just made (`git diff`). Check for: functionality you removed or broke that wasn't part of the task; fake buttons, placeholders, mocked data, or TODOs left behind; missing server-side validation, authorization, loading/empty/error/success states; broken imports or routes; and anything that doesn't actually work end-to-end. List every issue you find, then fix them. Then run lint, typecheck, tests, and the production build and confirm all pass. Report what you changed.

## Appendix B — Reusable manual-testing prompt
> List the exact manual steps I should perform to verify the feature you just built works end-to-end, including the empty state, the error state, and the success state, and what correct behavior looks like at each step.

## Appendix C — Reusable "implement broker feedback" prompt
> A broker gave this feedback: [paste]. First inspect the relevant current implementation and tell me what you'd change and why, without coding yet. Once I approve, implement it in the smallest safe change that preserves existing functionality, with validation, proper states, and tests. Then run the self-review, lint, typecheck, tests, and build.

## Appendix D — Git workflow
- `main` = always working, deployable.
- One branch per phase/prompt: `git checkout -b phase-1-accuracy`.
- After a prompt passes validation + self-review + manual test: commit, push, open a PR, merge to `main`, pull `main` before the next branch.
- Commit before every prompt (checkpoint) and after every successful one.
- Never run a new prompt on uncommitted work.

## Appendix E — ✅ Ready for BROKER PILOT checklist
- [ ] GIS lookup accuracy measured on a real labeled set, ≥ ~95%.
- [ ] Workspace fast with 2,000+ records (pagination working).
- [ ] Lease abstraction: side-by-side verification, corrections persist, exports work.
- [ ] Dashboard shows specific, reason-driven daily actions.
- [ ] Owner portfolio relationship view working.
- [ ] Deal pipeline usable end-to-end.
- [ ] Onboarding import works on a real messy spreadsheet.
- [ ] Every feature has empty/loading/error/success states; no fake buttons.
- [ ] Server-side validation + owner-scoped authorization on all mutations; cross-user access tests pass.
- [ ] lint, typecheck, all tests, production build all green.
- [ ] You (and your dad) have used it for real without hitting broken flows.

## Appendix F — 💳 Ready for PAID PRODUCTION checklist
- [ ] Everything in Appendix E, plus:
- [ ] Billing works: subscribe, manage, plan-gating, webhooks.
- [ ] Team workspaces + permissions enforced (if selling to teams); existing data migrated safely.
- [ ] Email/calendar capture live (if promised).
- [ ] Observability + error monitoring in production.
- [ ] Rate limiting on expensive endpoints; DB indexes on hot paths.
- [ ] Backups configured; secrets server-side only; env documented.
- [ ] Privacy policy / terms; data export + deletion honored.
- [ ] A real pilot broker has used it daily for several weeks and would pay.
- [ ] Measured: activation, weekly retention, and broker actions caused.

---

## The two things no prompt can do (the real finish line)
1. **Run the Phase 1 accuracy harness on real data and act on the number.** It decides whether any of this matters.
2. **Put it in your dad's hands, then a few real brokers, and watch them.** The winning metric is *broker actions Beacon caused that wouldn't have happened otherwise* — calls made, lease dates caught, meetings booked. Ship toward Appendix E, pilot, then decide Phases 10–14 based on what real brokers actually ask for.
