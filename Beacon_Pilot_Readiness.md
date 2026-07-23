# Beacon — Pilot Readiness
**As of:** July 2026 (post harden prompts 1–7)  
**Audience:** CRE brokers evaluating a pilot, and engineers shipping with them

This document reflects **current code**, not aspirational roadmap. For architecture detail see `Beacon_PRD.md`.

---

## Moat (why Beacon vs a generic CRM)

Beacon is built for a **single Miami-area CRE broker** (industrial / investment / leasing) whose edge is:

1. **Ownership truth from county tax roll** — Miami-Dade (MDPA) and Broward (BCPA GIS) parcel lookup, Sunbiz humans behind LLC owners, ownership-change signals on re-enrich.
2. **Lease rollover clock** — abstracts linked to properties → Lease radar buckets → follow-ups that do not go dark when property linkage is missing.
3. **Who to call** — tenant vs owner routing on radar/outreach; contact↔property join for “contacts on this asset” / “assets for this contact”; Owner portfolio as the one-click book view.

Everything else (cadence, deals pipeline, Copilot, dashboard KPIs) exists to make those three loops usable every morning.

---

## What shipped (pilot surface)

| Area | What brokers get |
|------|------------------|
| **Entities** | Properties, contacts, lease abstracts, activities, follow-ups, deals (pursuits) |
| **Joins** | `contact_properties` preferred for reads; dual-write with legacy `linked_properties[]` fallback |
| **County data** | Miami-Dade + Broward address → folio → detail; ownership change detection |
| **Comps** | Nearby **tax-roll** sales on property detail — **not** CoStar market comps |
| **Enrich** | County re-enrich, Sunbiz, promote to CRM, CoStar **file upload** parse, bulk enrich queue in Workspace |
| **Lease abstracts** | Single + batch upload; **server rejects saves without `linked_property`**; relink allowed, clear-to-null blocked |
| **Lease radar** | Expiration buckets; tenant-rep / vacancy / rollover → tenant contact when present; owner-facing actions → owner; WHO/WHY in UI; follow-up sync aligned |
| **Outreach** | Cadence-driven queue; AI drafts; **chunked** generation; opens broker mail (mailto / web compose) — **Beacon does not send** |
| **Cadence** | Tier 1/2/3 days from `user_settings` (defaults match Settings UI); outreach “due” and dashboard cold Tier 1 share the same math |
| **Deals** | Type-aware stages (`tenant_rep` \| `listing` \| `investment_sale`); `under_contract` + `won` stay **active**; terminal = `closed` / `lost`; illegal stage changes rejected server-side |
| **Owner portfolio** | Hero CTA from property/contact; workspace aggregation + MDPA tax-roll discovery |
| **Dashboard** | Broker command center: KPI strip (pursuits/commission, lease ≤90d, Tier-1 overdue, ownership changes, book), Needs attention rail, **Ask Beacon** Copilot kept, Pipeline / Lease / Book / Ops sections |
| **Nav** | Dashboard, **Workspace** (`/crm`), Deals, Lease radar, Follow-ups, Outreach, Settings; **+ New** includes New pursuit → create dialog (`/deals?new=1`); Advanced: data audit / ingestion errors |
| **Copilot** | Kept on dashboard — natural-language portfolio / focus questions |
| **Onboarding** | Gate on Dashboard + Workspace until `onboarding_completed_at` |

---

## Honest limits (say these out loud in a pilot)

| Topic | Reality |
|-------|---------|
| **Email** | Drafts + `mailto:` / web compose. Broker sends. No SMTP / Gmail API send. |
| **Tax roll** | **Miami-Dade + Broward** for county ingest/enrich. Owner portfolio **county-wide discovery** is Miami-Dade–scoped. Not statewide. |
| **Comps** | Tax-roll neighbor sales only. **Not CoStar**, not LoopNet live market data. |
| **CoStar** | Upload/parse into contacts (tagged). Settings “CoStar enabled” is preference UX — **no live CoStar API**. |
| **Teams** | Single-broker. No shared workspace, no roles. |
| **Mobile** | Responsive web only; no native app. |
| **Smart lists** | Table may exist; no first-class producer UI for managing NL saved searches. |

---

## Broker day-1 path (recommended pilot script)

1. **Import / ingest** — Add 5–20 properties via address (MD/Broward) or Workspace bulk paths. Confirm folio + owner name.
2. **Enrich** — County fields, Sunbiz persons, promote key owners to contacts; set Tier 1 on people you actually call.
3. **Portfolio** — From a property or contact, open **Owner portfolio**; optionally pull MDPA tax-roll siblings into the book.
4. **Abstract** — Upload a lease PDF; **link every abstract to a property** (required). Batch: resolve property per file before save.
5. **Radar** — Open Lease radar; confirm WHO (tenant vs owner) for the next rollover; sync follow-ups.
6. **Outreach** — Queue Tier-1 / due contacts; generate drafts; open in email; mark sent.
7. **Daily desk** — Dashboard KPIs + Needs attention + Ask Beacon; log pursuits under Deals when a conversation becomes a real chase.

---

## Harden prompts 1–7 — what they fixed

| # | Outcome |
|---|---------|
| 1 | No orphan lease abstracts; radar cannot go dark from a silent unlink |
| 2 | Rollover outreach targets the right party (tenant vs owner) with explicit UI |
| 3 | Contact↔asset graph reads prefer the join table |
| 4 | Cadence Settings actually drive due/overdue math |
| 5 | Deal stages match CRE pursuit semantics (under contract = active) |
| 6 | Command dashboard with real KPIs (no fake numbers) |
| 7 | Producer desk: New pursuit opens create; Workspace onboarding gate; Advanced ops framing |

---

## Remaining risks (after 1–7)

These are still real; do not paper over them in a pilot:

1. **Lease XLSX export** — historically queried wrong columns; verify before promising export demos.
2. **Scale / cost** — shell badge counts, portfolio “load all properties,” and some dashboard aggregations are full-scan style; fine for a single book, not for 50k parcels.
3. **Dual-write debt** — `linked_properties[]` still written; join is preferred for reads. Full column drop is future work.
4. **AI non-determinism** — abstracts, drafts, briefings, Copilot can miss or overstate; broker must verify against the PDF / tax roll.
5. **Broward GIS coupling** — parcel FeatureServer field names can change; keep a live address smoke check in the pilot checklist.
6. **Ownership-change coverage** — signals depend on re-enrich / MDPA path; empty “ownership changes” KPI may mean “not yet checked,” not “market quiet.”
7. **No calendar sync** — follow-ups live in Beacon unless the broker copies them out.

---

## Pilot success criteria (suggested)

- Broker can ingest a real MD or Broward address and see correct owner + SF.
- At least one lease abstract is property-linked and appears on Lease radar with a sensible contact.
- One outreach draft opens in their mail client and is marked sent.
- Dashboard KPI strip shows non-zero numbers that match their book (or honest zeros with clear empty copy).
- Owner portfolio opens in one click from a known property.

---

## Related docs

- `Beacon_PRD.md` — engineer onboarding, schema, data flows  
- `MIGRATIONS.md` — migrate / verify commands  
- `tests/` — Vitest coverage for pure helpers (lease property, radar contact, cadence, deals stages, dashboard KPIs, etc.)
