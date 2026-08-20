# Beacon — Pilot Readiness
**As of:** July 2026 (post elevate prompts A–I, skip B)  
**Audience:** CRE brokers evaluating a pilot, and engineers shipping with them

This document reflects **current code**, not aspirational roadmap. For architecture detail see `Beacon_PRD.md`.

---

## Moat (why Beacon vs a generic CRM)

Beacon is built for a **single Miami-area CRE broker** (industrial / investment / leasing) whose edge is:

1. **Ownership truth from county tax roll** — Miami-Dade (MDPA) and Broward (BCPA GIS) parcel lookup + **owner-name portfolio discovery in both counties**, Sunbiz humans behind LLC owners, **ownership watch** with batch re-check.
2. **Lease rollover clock** — abstracts linked to properties → Lease radar → Today desk; follow-ups that do not go dark when property linkage is missing.
3. **Who to call** — tenant vs owner routing on radar/outreach; contact↔property join; Owner portfolio; call/tour logging that bumps cadence.

Everything else (cadence, deals, Copilot, lease comps, corridor book map) exists to make those three loops usable every morning.

---

## What shipped (pilot surface)

| Area | What brokers get |
|------|------------------|
| **Entities** | Properties, contacts, lease abstracts, activities, follow-ups, deals (pursuits) |
| **Joins** | `contact_properties` preferred for reads; dual-write with legacy `linked_properties[]` fallback |
| **County data** | Miami-Dade + Broward address → folio → detail; ownership change detection + **watch enroll / batch re-check** |
| **Comps** | Tax-roll **sale** comps + **lease comps from your abstracts** (submarket / type / SF band) — **not** CoStar |
| **Enrich** | County re-enrich, Sunbiz, promote to CRM, CoStar **file upload** parse, bulk enrich queue in Workspace |
| **Lease abstracts** | Single + batch; **server rejects saves without `linked_property`** |
| **Lease radar** | Expiration buckets; tenant vs owner WHO/WHY; follow-up sync |
| **Today desk** | Ranked **Do these today** queue: lease ≤90d, ownership flips, follow-ups due, deal next actions, cadence outreach |
| **Outreach** | Cadence queue; AI drafts; mailto/web compose; **Has email / Has phone** filter; mark sent — **Beacon does not send** |
| **Calls / tours** | One-click Log call (outcomes) + Log tour on contact; bumps `last_contacted_at` for call/email/meeting/letter |
| **Cadence** | Tier days from `user_settings` |
| **Deals** | Type-aware stages; `next_action_due` syncs a soft-deduped follow-up; tenant-rep soft fields; Call/Tour/Outreach on cards |
| **Owner portfolio** | Hero CTA; **Tax roll portfolio** discovery for **Miami-Dade + Broward** |
| **Book map** | Corridor view by submarket/city with SF/type filters; OSM deep links (no stored geocodes) |
| **Dashboard** | KPI strip + Today + Ask Beacon Copilot + Pipeline / Lease / Book / Ops |
| **Nav** | Dashboard, Workspace, Deals, Lease radar, Outreach, Settings; Advanced: Book map, All tasks, audit, errors |
| **Copilot** | Kept on dashboard |
| **Onboarding** | Gate on Dashboard + Workspace |
| **Exports** | Properties / contacts / leases XLSX — lease export uses real columns (`base_rate`, linked property address, etc.) |

**Not shipped (deliberately skipped):** Prompt B industrial space fields on property detail / Workspace — Workspace columns left unchanged.

---

## Honest limits (say these out loud in a pilot)

| Topic | Reality |
|-------|---------|
| **Email** | Drafts + `mailto:` / web compose. Broker sends. No SMTP / Gmail API send. |
| **Tax roll** | Miami-Dade + Broward ingest + portfolio discovery. Not statewide. Broward owner match is single `OWN_NAME` field (shallower than MDPA). |
| **Comps** | Tax-roll sales + **your** lease abstracts. **Not CoStar** market data. |
| **Book map** | Corridor aggregation + OSM links — **not** a stored pin map / GIS product. |
| **Industrial specs** | No dedicated clear-height / docks / availability model yet (Prompt B deferred). |
| **CoStar** | File upload/parse only — no live API. |
| **Teams** | Team support now exists in code (invite a teammate, share specific records) but is unvalidated with a real broker and was built ahead of pilot — treat every pilot account as single-broker unless you're specifically testing this. Nothing about it changes solo behavior; see `Beacon_Team_Multitenancy_Plan.md`. |
| **Mobile** | Responsive web only. |

---

## Broker day-1 path

1. **Import** — Add properties via MD/Broward address. Confirm folio + owner.
2. **Enrich** — County + Sunbiz; promote owners; set Tier 1.
3. **Watch** — Enroll key assets on ownership watch; run batch re-check from dashboard.
4. **Portfolio** — Owner portfolio → Tax roll discovery (MD + Broward) → import siblings.
5. **Abstract** — Upload lease PDFs; every abstract linked to a property.
6. **Radar + Today** — Lease radar WHO/WHY; Dashboard **Do these today**.
7. **Outreach / call** — Draft emails or Log call / Log tour; mark sent when emailed.
8. **Pursue** — New pursuit with next-action due (creates a task); use Book map for corridor rides.

---

## Elevate prompts A–I (skip B) — what landed

| # | Outcome |
|---|--------|
| A | Unified Today desk; Follow-ups demoted to Advanced “All tasks” |
| C | Lease comps from abstracts on property detail |
| D | Ownership watch enroll + batch re-check; honest empty copy |
| E | Call/tour cadence bump; Outreach email/phone channel filter |
| F | Broward tax-roll owner search / import for portfolio |
| G | Deal next-action → follow-up sync; pursuit quick touches |
| H | Corridor Book map + OSM links |
| I | This pilot doc + PRD alignment (lease export already column-correct) |

---

## Remaining risks

1. **Run `npm run migrate`** if ownership-watch columns are missing (`ownership_watch_enrolled_at`, `ownership_last_checked_at`) — migrate may have failed offline earlier.
2. **Scale** — full-scan style counts/aggregations; fine for one book.
3. **Dual-write** — `linked_properties[]` still written.
4. **AI non-determinism** — verify abstracts/drafts against PDF / tax roll.
5. **GIS coupling** — MDPA/BCPA field changes can break county magic.
6. **No calendar sync** — tasks live in Beacon.
7. **Industrial space model deferred** — leasing brokers still need docks/clear height manually / custom fields.

---

## Pilot success criteria

- Ingest real MD **and** Broward addresses; portfolio discovery finds siblings in both.
- Linked lease abstract appears on radar and contributes to lease comps.
- Today desk shows a ranked mix (not only cadence).
- Log call bumps contact cadence; outreach mark-sent still works.
- Ownership watch batch reports checked/flips without fake “market quiet.”
- New pursuit with next-action due creates a visible task.

---

## Related docs

- `Beacon_PRD.md` — engineer onboarding, schema, data flows  
- `MIGRATIONS.md` — migrate / verify commands  
- `tests/` — Vitest coverage for pure helpers
