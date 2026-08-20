# Beacon — Team / Brokerage Multi-Tenancy: Implementation Plan
**Status:** DRAFT — planning only, no code written, nothing merged.
**Version:** August 2026
**Audience:** Alec (decision-maker), future engineers implementing this.

This document proposes how Beacon could support multiple brokers at the same firm working together, while preserving today's per-broker data isolation as the safe default. It is a planning artifact, not an implementation. Every section ends with either an explicit decision the reader needs to make, or a recommendation flagged as such.

**Bottom line up front, echoing the request that produced this doc:** this was already tagged `⚠️ SCALE — after pilot validation` in `tests/Beacon_Master_Execution_Plan.md:45,253-260` (Phase 11), and `AUDIT.md:654-656` independently states *"If the product ever needs to support a brokerage team sharing data, this is a fundamental schema redesign."* Nothing in this plan changes that recommendation. Plan now, while it's cheap; build only once a real pilot broker asks for it.

---

## 0. Current-state summary (verified against the live code, not memory)

Every one of Beacon's 16 tables is `owner_id`-scoped, RLS-enabled, with `owner_id NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` (except `error_logs`, nullable). Confirmed verbatim, e.g.:

```sql
-- scripts/migrate.ts:87,93 (properties)
CREATE POLICY "owner select" ON properties FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "owner update" ON properties FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- scripts/migrate-deals.ts:41 (deals — single FOR ALL policy)
CREATE POLICY deals_owner_all ON deals FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
```

Three facts from the audit shape everything below:

1. **No service-role key exists anywhere in the running app.** Every server action authenticates via `supabase.auth.getUser()` (never `getSession()` — zero matches repo-wide) using the anon key; RLS is real enforcement at runtime, not a backstop behind a privileged bypass. Only offline migration scripts use `DATABASE_URL` directly. This is a property worth preserving.

2. **RLS is not merely defense-in-depth everywhere.** Most server actions do redundant `.eq("owner_id", user.id)` filtering on top of RLS (sampled across deals/contacts/properties/leases/documents/custom-fields/activities). But three client-side code paths bypass server actions entirely and talk straight to PostgREST with the user's own JWT:
   - `app/crm/view.tsx:2663-2720` — the Workspace grid's inline-edit handlers (`saveProp`, `saveContact`, `savePropContact`) run `.from("properties"/"contacts").update(...)` directly from the browser.
   - `app/contacts/[id]/cre-profile-section.tsx:191` — same pattern for the CRE profile inline-edit.
   - `lib/entities.ts:100-152` (`syncPropertyEntity`) — called from the browser with the client-side Supabase instance, writes to `entities`/`entity_properties`/`properties.entity_id`.

   On these three paths, **RLS is the entire enforcement boundary** — there is no second gate. Any team-visibility RLS change has to be provably correct on these paths specifically, because a mistake there isn't caught by a server action's error handling; it's caught by nothing.

3. **A rigorous isolation test suite already exists and is the right foundation to extend, not replace:**
   - `tests/security/tenant-isolation.test.ts` — real Supabase auth users, real RLS-enforced clients (never service-role), a shared `assertRowIsolated` helper (`tests/security/tenant-isolation.test.ts:47-88`) that proves an intruder can't select-by-id, list, update, or delete another broker's row, across 14 of the 16 tables plus the `leases` storage bucket. `follow_ups` and the `documents` table/bucket aren't in this file's 4-vector attack, but they are covered by...
   - `tests/security/account-deletion.test.ts` — seeds all 16 tables + both buckets for two users, deletes one, asserts the other's data is fully intact across everything, `documents`/`follow_ups` included.
   - `tests/server/auth-isolation.test.ts` — mocked-client tests proving every sampled server action filters by `owner_id`, and that write-side FK ownership checks (`linkContactProperty`, `createDeal`, etc.) reject a foreign key pointing at another owner's row *before* the write — a vulnerability class RLS alone doesn't close (RLS stops you *reading through* a planted pointer, not planting it).

   New tests should slot into this same pattern (real RLS-enforced clients, `describe.skip` when creds aren't available), not invent a parallel style.

Everything else — `entities` (strictly per-owner, `UNIQUE(owner_id, name_normalized)`, no sharing precedent), `field_definitions`, storage buckets (`leases`, `documents`, both secured entirely by `(storage.foldername(name))[1] = auth.uid()::text` with no app-table join) — is detailed inline in the relevant sections below.

---

## 1. Terminology

The existing `/crm` nav page is already labeled "Workspace" (`Beacon_PRD.md` §7). Using "workspace" for the new multi-user concept would collide with that. This plan uses **firm** for the brokerage/team entity, matching how the domain (CRE brokerage) actually talks about it.

New tables: `firms`, `firm_members`, `firm_invitations`.

---

## 2. Data model change

### 2.1 New tables

```sql
firms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
)

firm_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','member')),
  status text NOT NULL CHECK (status IN ('active','removed')) DEFAULT 'active',
  invited_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, user_id)
)

firm_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','member')),
  token text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
)
```

`firm_members` rows are never hard-deleted on removal — `status` flips to `'removed'`, preserving history for audit and for the offboarding flow in §3. This is also what makes "leaving reverts visibility" cheap (§3).

### 2.2 Every user belongs to exactly one active firm (v1 constraint, not a schema constraint)

At signup, a personal firm is auto-created (`name = "<display name>'s team"` or similar) with the new user as its sole `'owner'`. This makes "solo broker" and "firm member" the same code path — there's no special-cased "no firm" state to test for. **Recommended constraint for v1: a user has at most one row in `firm_members` with `status='active'`** (enforced by a partial unique index: `UNIQUE (user_id) WHERE status = 'active'`). Accepting an invite to a new firm means the invite-accept transaction also sets the user's *previous* `firm_members` row to `'removed'`. This is deliberately simpler than multi-firm membership (§10, flagged as explicitly out of scope for v1) — no firm-switcher UI, no "which firm am I acting as" ambiguity anywhere in RLS or the app.

### 2.3 Migrating existing accounts — non-destructive, reversible

```sql
-- one-time backfill, idempotent (WHERE NOT EXISTS guard)
INSERT INTO firms (id, name, created_by)
SELECT gen_random_uuid(), COALESCE(us.display_name, 'My') || '''s team', u.id
FROM auth.users u
LEFT JOIN user_settings us ON us.owner_id = u.id
WHERE NOT EXISTS (SELECT 1 FROM firm_members fm WHERE fm.user_id = u.id);

INSERT INTO firm_members (firm_id, user_id, role, status)
SELECT f.id, f.created_by, 'owner', 'active'
FROM firms f
WHERE NOT EXISTS (SELECT 1 FROM firm_members fm WHERE fm.firm_id = f.id AND fm.user_id = f.created_by);
```

This touches **zero rows in any of the existing 16 tables.** It only inserts into two brand-new, empty tables. Nothing about `owner_id`'s meaning changes anywhere. This is why it's non-destructive by construction, not by careful handling — there's no data transformation to get wrong.

**Reversibility:** the whole feature can be turned off by (a) dropping the `OR`-clause additions to existing RLS policies (§5) in one idempotent migration, and (b) simply leaving `firms`/`firm_members`/`firm_invitations` unused — nothing in the base 16 tables' schema or semantics depends on them existing. No data migration is needed to "undo" this.

---

## 3. The ownership question — options, not a decision

This is the one place this plan deliberately does not pick a winner. Two independent axes:

### 3.1 Axis A — default visibility of a new record

- **(A) Firm-shared by default.** Everything any member creates is visible to the whole firm immediately; `owner_id` becomes "who's accountable for it," not "who can see it." Simplest mental model, matches "we're one team." Con: no staging/privacy — a broker can't keep a not-yet-ready prospect to themselves without a discipline of remembering to mark it private every time.
- **(B) Private by default, share explicitly.** Nothing changes for anyone until a broker opts a specific record (or set of records) into `visibility = 'team'`. Zero behavior change on day one for every existing user — closest to "least surprise." Con: real risk the sharing feature just sits unused if nobody remembers to flag things, which would mean the feature exists on paper but the actual product goal (working together) doesn't happen.
- **(C) Split by entity type.** `deals` / `activities` / `follow_ups` (the shared pipeline — plausibly the actual driver behind "work together") default to firm-shared; `contacts` / `properties` / `lease_abstracts` (a broker's personal book — arguably the single most sensitive, career-defining data in the whole app) default to private with the same opt-in escape hatch as (B). Con: two different default policies to explain and to get right in RLS — more distinct policy shapes than (A) or (B), which is directly a correctness-risk tradeoff, not just a UX one.
- **(D) Role-derived.** Owners/admins (principal broker) always see everything in the firm; regular members see only their own + explicitly-shared. Models a real brokerage structure (principal oversight of agents who don't necessarily want peers seeing their books) that (A)/(B)/(C) don't capture. Most powerful, most implementation and test surface.

**A second, independent axis under any of the above:** can a teammate *edit* a shared record, or only *view* it? "Shared pipeline you can co-work" and "shared pipeline you can only see" are very different products and very different RLS (`SELECT`-only OR-clause vs. `SELECT`+`UPDATE`+`DELETE`). This needs its own explicit answer, not an assumption bundled into the visibility choice.

### 3.2 What happens to a broker's records when they leave the firm

- **(1) Records transfer to the firm itself.** Requires a real schema change — `owner_id` is `NOT NULL REFERENCES auth.users(id)`, so "the firm owns it" needs either a synthetic service-user or a parallel `firm_id`-based ownership path. Adds real complexity for a case that may not come up often.
- **(2) Records simply revert to private, invisible to former teammates, no data mutation.** This falls out for free from the "derive visibility via an active `firm_members` join" design (§5): flip the departing broker's `firm_members.status` to `'removed'`, and every `is_firm_teammate()` check involving them stops matching immediately — no row in any of the 16 tables needs to change. Matches the real-world norm ("your book is your book"). Con: if the firm needed continuity on something the departing broker was mid-deal on, that visibility just vanishes at the moment of removal unless someone acts first.
- **(3) Admin-initiated reassignment before removal.** An explicit, audited "transfer ownership" action (admin or the departing broker themselves, before the removal takes effect) that reassigns `owner_id` on specific records to another active member. Combine with (2) as the default: nothing auto-transfers, but the firm gets a deliberate offboarding step to claim continuity on the handful of records that need it, rather than a blanket seizure of the departing broker's entire book.

**Recommendation if a default is needed to keep this plan concrete below:** (B) private-by-default + per-record opt-in, edit-permission-when-shared, and (2)+(3) for departure (revert-to-private automatically, explicit admin reassignment available before removal). This is the option requiring the fewest new distinct RLS policy shapes and the least new blast radius if something's wrong — but it is explicitly a placeholder for you to override, not a conclusion. Everything in §4–§6 below is written to work under any of (A)/(B)/(C)/(D); the choice only changes which tables' default `visibility` value ships as `'private'` vs `'team'` and whether `UPDATE`/`DELETE` get the OR-clause alongside `SELECT`.

**→ Decision needed:** pick a point on axis A, an answer to view-vs-edit, and an approach to departure, before Phase 2 (§8) starts.

---

## 4. Permissions / roles

Three roles on `firm_members.role`:

- **owner** — exactly one recommended per firm for v1 (the creator; co-ownership is a later extension, not attempted here). Can rename the firm, promote/demote admins, remove any member, reassign ownership of any team-visible record. Cannot be removed by anyone but themselves (and only after promoting a successor, or the firm becomes ownerless — block this in the server action, not just in the UI).
- **admin** — can invite/remove members (except the owner), manage shared records firm-wide, cannot delete the firm or change who the owner is.
- **member** — today's full CRUD on their own records, unchanged. Additional read (and, per §3.1's axis, possibly write) access to teammates' `visibility='team'` records. Cannot invite, remove, or change roles.

**Enforcement stays defense-in-depth, matching the existing pattern:** RLS is ground truth; server actions add explicit role checks so failures produce a real error message ("you don't have permission to remove an admin") instead of RLS's silent zero-rows-affected, which is fine for security but bad UX on its own.

**Concrete, named code change required:** the three client-side direct-mutation paths from §0.2 (`app/crm/view.tsx:2663-2720`, `cre-profile-section.tsx:191`, `lib/entities.ts:100-152`) currently assume "I can only ever be editing my own row" — their client-side `.eq("owner_id", user?.id ?? "")` filter is *narrower* than what RLS will now permit once sharing exists. That's not unsafe (RLS still bounds the true permission), but it means a teammate's edit to a shared row through the grid would need that filter loosened to match the new RLS shape, and the optimistic-UI/error-handling around it updated to distinguish "not found" from "not your row to edit." This is real, scoped work for Phase 4 (§7, §8), not a side effect to discover later.

---

## 5. RLS rewrite — the critical section

Five structural principles, then the concrete pattern.

**Principle 1 — every new policy is a strict OR addition, never a replacement.** `USING (auth.uid() = owner_id OR <team clause>)`. This guarantees today's protection for every private record never weakens; the only new access path is the explicit team clause, itself scoped to the same firm.

**Principle 2 — one helper function, not sixteen hand-written joins.** Every table that needs team-scoping calls a single function rather than re-deriving the join logic per-policy:

```sql
CREATE OR REPLACE FUNCTION is_firm_teammate(target_owner_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM firm_members me
    JOIN firm_members them
      ON me.firm_id = them.firm_id
     AND them.status = 'active'
    WHERE me.user_id = auth.uid()
      AND me.status = 'active'
      AND them.user_id = target_owner_id
  );
$$;
```

`SECURITY DEFINER` is required, not optional: `firm_members` needs its own RLS (§5, below), and a naive policy on `firm_members` that queries `firm_members` from within its own `USING` clause is exactly the self-referencing-policy trap Postgres RLS is known to have — the function sidesteps it by doing this one lookup with the function owner's privileges, not the caller's, while the function's *only* job is this narrow boolean check (it exposes no data itself). This collapses "did we get the cross-firm check right" into one reviewable, testable unit instead of a correctness question asked separately for every table.

**Principle 3 — never trust a client-supplied firm id.** The function above takes only `target_owner_id`; it always derives the caller's own firm via `auth.uid()`. No policy anywhere should accept a `firm_id` parameter from the request/query and use it directly in a visibility check — the classic mistake in multi-tenant RLS is trusting a tenant identifier the client controls.

**Principle 4 — decide the table list explicitly, don't touch all 16.** `error_logs`, `ingestion_errors`, `smart_lists`, `user_settings` are personal operational data, not CRE business records — there's no obvious product reason to ever make these team-visible, so they're recommended to stay untouched (owner-only, exactly as today). The realistic candidate list: `properties`, `contacts`, `lease_abstracts`, `deals`, `activities`, `follow_ups`, `documents`, and possibly the `entity_*` tables. **`field_definitions` is a special case worth flagging on its own** — if teammates are meant to see each other's shared deals/properties with a consistent custom-field schema (rather than each seeing their own private fields on a shared record), `field_definitions` arguably wants to be firm-wide *by default*, not opt-in-shared like the others; a mismatched custom-field schema across teammates viewing the same shared deal would be confusing. This needs its own explicit answer, not inheritance from the general model.

**Principle 5 — the concrete per-table pattern**, once §3's decision is made (shown here for `SELECT`; `UPDATE`/`DELETE` get the same clause only if the edit-permission decision says shared means co-editable):

```sql
DROP POLICY IF EXISTS "owner select" ON properties;
CREATE POLICY "owner or teammate select" ON properties
  FOR SELECT USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
  );
```

### 5.1 `firm_members` / `firm_invitations` need their own correct RLS — new attack surface

- `firm_members`: a user should see rows for firms they belong to, nothing else. `SELECT USING (firm_id IN (SELECT firm_id FROM firm_members WHERE user_id = auth.uid() AND status='active'))` — note this one *is* self-referencing by design (a user needs to see the whole roster of their own firm, not just their own row), which is exactly the case `is_firm_teammate()`'s SECURITY DEFINER pattern is meant to keep out of the *other* 16 tables' policies; `firm_members`' own policy still needs care (Postgres does support self-referencing RLS policies, but this is the one place in the whole plan to test hardest for infinite-recursion or accidental over-broad matches).
- `firm_invitations`: only the firm's admin/owner should list its pending invites; only the invited email (post-auth) should be able to redeem its own token. The redemption path is detailed in §6 and is arguably the **second-most safety-critical RLS in this entire plan** (after the teammate-visibility OR-clause) — a bug here lets a stranger add themselves to any firm.

### 5.2 Storage bucket RLS is a harder, separate problem

Both buckets today are secured *entirely* by `(storage.foldername(name))[1] = auth.uid()::text` (`scripts/setup-storage.ts`, `scripts/migrate-documents.ts:54-97`) — a pure path check with no join to any app table. Team-visibility for a document isn't representable in that path at all (the visibility flag lives in the `documents` table, keyed by `storage_path`). A team-aware storage policy has to join `storage.objects` to `documents` on `storage_path`:

```sql
CREATE POLICY "documents owner or teammate select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documents' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.storage_path = name
          AND d.visibility = 'team'
          AND is_firm_teammate(d.owner_id)
      )
    )
  );
```

This is more fragile than table RLS (an extra join, less familiar surface, no existing precedent in this codebase for storage policies referencing app tables). **Recommendation: sequence this strictly after the `documents` table's own RLS is proven correct and tested (end of Phase 2, not part of it), with its own dedicated test file mirroring the existing bucket-isolation tests in `tenant-isolation.test.ts:422-441`.**

---

## 6. Invitations & onboarding

**Recommendation: link-based invites, not email-based — deliberately, to avoid introducing the app's first service-role key.**

`auth.admin.inviteUserByEmail()` (Supabase's built-in invite) requires the service-role key, which currently doesn't exist anywhere in the running app (confirmed: zero matches for `SERVICE_ROLE`/`service_role`/`createServiceClient` repo-wide). That key bypasses RLS entirely — introducing it is a categorically new class of risk (a single leaked env var, log line, or error message becomes a total RLS bypass) that this feature does not need to accept. A link-based flow avoids it completely:

1. Owner/admin → Settings → Team (new page) → "Invite teammate" → email + role → server action inserts a `firm_invitations` row (token = `crypto.randomUUID()` or similar, `expires_at` = +7 days).
2. The inviting broker sends the resulting `/join/[token]` link themselves — same "broker sends manually" pattern the app already uses for outreach (`Beacon_PRD.md` §5.4: "Beacon does not send email. This is by design."). No new email infra, no new secret.
3. Invited person visits `/join/[token]`, signs up or logs in (existing pilot-auto-confirm signup flow, `app/login/actions.ts:60-100`, is unaffected).
4. On authenticated visit, a server action reads the invitation by token, validates (not expired, not revoked, not already accepted, email matches — case-insensitively — the now-authenticated user's own email), and **the actual `firm_members` row insert is permitted by RLS itself**, not a privileged bypass:

```sql
CREATE POLICY "join via valid invitation" ON firm_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM firm_invitations i
      WHERE i.firm_id = firm_members.firm_id
        AND lower(i.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
        AND i.accepted_at IS NULL
        AND i.revoked_at IS NULL
        AND i.expires_at > now()
    )
  );
```

The same transaction sets the user's previous `firm_members` row (if any, from §2.2's one-active-firm rule) to `'removed'` and marks the invitation `accepted_at`.

5. Settings → Team shows the roster (role, joined date), pending invites (revoke/resend), and — owner/admin only — a remove-member action, which is where §3.2's offboarding/reassignment step belongs, surfaced *before* the removal is confirmed.

**Edge case to note, not solve here:** a person invited while they already own a personal firm with their own private data — under the one-active-firm-per-user model, accepting simply demotes their personal firm to inactive-for-them; their existing records' `owner_id` never changes, so nothing about their prior data's ownership or visibility is disturbed by joining. Their old personal firm becomes an inert, memberless row (harmless; can be left alone or garbage-collected later).

---

## 7. Workspace (`/crm`) behavior once firms exist — UI spec for Phase 4

Scope: the existing three-tab Workspace grid at `app/crm/view.tsx` (Properties / Leases / Contacts, tab bar at `app/crm/view.tsx:2936-2985`), backed by three client-side loaders — `loadProperties` (`:2362`), `loadContacts` (`:2492`), `loadLeases` (`:2573`) — that each call `supabase.from(<table>).select(...)` **directly from the browser**, exactly the same client-side-query shape already flagged for the grid's inline-edit *writes* in §0.2/§4, just on the read side instead. This section is the concrete Phase 4 spec the rollout table (§8) points to.

### 7.1 Default view is the broker's own book — and why this needs a real code change, not just "leave it alone"

Today, `loadProperties`'s query (`app/crm/view.tsx:2369-2373`) has **no `owner_id` filter at all** — none is needed, because RLS currently permits nothing but the caller's own rows, so the unscoped query and "my book" are identical by construction. `loadContacts`/`loadLeases` are the same shape.

This is exactly why default behavior needs an explicit, named change once Phase 2 (§8) ships team RLS: the moment `properties`' RLS gains the `visibility='team' AND is_firm_teammate(owner_id)` OR-clause (§5 Principle 5), that *same unscoped query* starts legitimately returning teammates' shared rows too. Left unchanged, the grid would silently flip from "my book" to "entire firm" as its default the instant Phase 2 lands — the opposite of this requirement. So: **Phase 4 must add an explicit `.eq("owner_id", user.id)` to all three loaders for the "My book" scope**, rather than continuing to rely on the absence of a filter. "My book" stops being "whatever RLS happens to allow" and becomes a real, intentional narrowing on top of it.

One useful consequence of this framing: **"Entire firm" scope requires no new query logic at all** — it's `loadProperties`/`loadContacts`/`loadLeases` exactly as written today, unmodified, with RLS as the ceiling. The only new client-side code is the narrowing filter for the default "My book" scope. This keeps the net-new surface area small and puts the actual access-control decision entirely in §5's RLS, not duplicated in the UI layer.

### 7.2 The scope toggle

**Placement:** the same filter/search context bar that already holds `BarModeToggle` (`app/crm/view.tsx:2987-2994`, search-vs-filter mode) — a new toggle sits first in that row, to the left of `BarModeToggle`, since scope (whose records am I looking at) is a broader dimension than search-vs-filter (how am I looking at them).

**How many states, honestly:** the requirement asks for "My book" / "Entire firm" / possibly a third "My book + shared." Whether the third state is *actually distinct* depends entirely on the §3.1 decision, not on UI preference:

- Under axis (A)/(B)/(C) — sharing is to the whole firm, not to specific teammates — "Entire firm" is by definition `{my own rows} ∪ {every teammate's 'team'-visible rows}`, which is exactly what "My book + shared" would also mean. They're the same result set. **Ship 2 states for v1: "My book" and "Entire firm."**
- The third state only becomes meaningfully different under axis (D) (role-derived — an owner/admin's firm-wide view could exceed what a regular member's "shared with me" view shows) or under a future per-teammate (not whole-firm) sharing granularity — and that finer-grained sharing is already flagged as explicitly out of scope for v1 (§10 item 6 / §11 item 6).

**Recommendation:** build the toggle as a data-driven list of states (not hardcoded to 2), so it collapses to the right count automatically once §3.1 is decided, without a separate redesign later. Ship 2 states now.

**Every state remains bounded by RLS regardless of what the toggle says** — the toggle only decides which *additional* client-side narrowing filter to apply on top of the RLS ceiling (§7.1); it is never itself a source of access, only ever a way to ask for less than RLS would already allow.

### 7.3 The toggle is invisible for a solo broker — exact condition, not a vibe

Renders **if and only if** the broker's active firm has more than one `firm_members` row with `status='active'`. Since every account is a firm member from day one (§2.2 — personal firms are auto-created, there's no "no firm" state to branch on), "solo" precisely means "my firm's active member count is 1," nothing more exotic.

This must be computed **server-side and passed down as a prop**, not inferred client-side after the page loads — a toggle that flickers into existence after a round-trip is worse than either always-there or never-there. `app/crm/page.tsx` already does exactly this shape of server-side pre-check today (auth + an `onboarding_completed_at` lookup, `app/crm/page.tsx:13-24`, before rendering `CRMView`) — the natural place to add one more cheap server-side lookup (`firm_members` active-count for the caller's firm) and pass it as a new `isSoloFirm: boolean` (or `firmMemberCount: number`) prop into `CRMView`, exactly the pattern `/deals/page.tsx` already uses for `getDeals()`/`getDealsForecast()`. Zero client-side inference, zero flash, and the overwhelmingly common case (a solo pilot broker) pays for one small count query, not a new round-trip.

### 7.4 Ownership indicator in firm view

Only relevant once "Entire firm" scope is selected (a broker's own rows in that scope need no badge — visually identical to today, consistent with §7.3's "solo experience stays unclutered" spirit even for a firm member looking at their own records).

For a teammate's row: a small owner chip (initials/avatar + display name), sourced from `user_settings.display_name` (already the source for the dashboard greeting per `Beacon_PRD.md`). This needs a batched `Map<owner_id, {display_name, email}>` for the firm's active roster, fetched once per Workspace load — the same shape already used elsewhere in this file for other per-row lookups (e.g. `propContacts: Map<propertyId, contact[]>`), not a per-row query. The same roster fetch can be folded into §7.3's server-side member-count lookup (one query serving both the count and the name map).

### 7.5 Filters, search, and smart lists compose with scope — they don't need to know it exists

Scope is applied as the **first** predicate on the same query-builder chain each loader already builds, before the existing filter functions run — e.g. in `loadProperties`, between building the base query (`:2369-2373`) and calling `applyPropertyFilters(q, f)` (`:2377`/`:2390`), insert the scope narrowing (§7.1) for "My book," or nothing for "Entire firm." Everything downstream — `applyPropertyFilters`/`applyContactFilters`/`applyLeaseFilters` (`lib/crm-search-filters.ts`), the NLP search (`interpretSearch` → `SearchResult.properties.filters`, etc.), and smart lists (`SmartListsBar`) — is layered on top exactly as it is today, unmodified. A saved smart list is just a stored `PropertySearchFilters`-shaped object; it has no concept of scope and doesn't need one, since scope is applied *before* the filter, not as part of it. "Owners in Brickell with LLC names" run in "My book" searches only your own records; the identical search run in "Entire firm" searches the firm's visible set — same filter, different starting pool.

One consequence worth naming: `smart_lists` itself is already recommended to stay owner-only, untouched by team RLS (§5 Principle 4 — it's not in the candidate table list). That's fine and doesn't limit anything here — a broker's personal saved filters stay personal, but because scope and filter are orthogonal layers, any personal smart list can still be *run* against either scope. Nothing about keeping `smart_lists` private constrains what it can be pointed at.

### 7.6 Edit permissions in firm view

Directly inherits the §3.1 view-vs-edit decision, and is where §4's already-flagged client-side write paths become concrete:

- **If shared = view-only:** any row in "Entire firm" scope where `owner_id !== me` must render non-editable in the grid — not "editable but silently rejected by RLS on save." Each row needs an `isEditable` flag (`row.owner_id === myUserId`, or `true` if co-editable is the decided policy) computed client-side from data already on hand (no extra round-trip) alongside the ownership data from §7.4, and the grid's inline-edit cells need to respect it visually, not just functionally.
- **If shared = co-editable:** the three client-write paths already named in §4 (`app/crm/view.tsx:2663-2720`'s `saveProp`/`saveContact`/`savePropContact`, `cre-profile-section.tsx:191`, `lib/entities.ts:100-152`) need their current `.eq("owner_id", user?.id ?? "")` client-side filter loosened so a legitimate edit to a teammate's shared row isn't rejected before it even reaches the server — while RLS (§5 Principle 5's OR-clause) remains the actual authority on whether the write succeeds, exactly as it is today for the owner-only case.

**Useful scoping note:** this loosened path is only ever *reachable* while a broker is actively in "Entire firm" scope — in "My book" scope, every visible row is by definition the broker's own (§7.1), so the existing narrow filter stays exactly correct and untouched for that scope. Combined with §7.3 (no toggle, hence no "Entire firm" scope reachable at all, for a solo broker), the riskier code path is live only for brokers who are (a) in a multi-member firm and (b) have actively switched scope — which keeps its real-world blast radius small even though the code exists for everyone.

`savePropertyGridActivity` (the one real server action among these, used for `isPropertyActivityField` fields, `app/crm/view.tsx:2654`) already goes through the defense-in-depth pattern (§0.2) and needs no special client-side handling here — only the three raw client-write call sites need the loosened-filter treatment.

---

## 8. Phased rollout — small steps, tested at each gate, existing behavior never regresses

Every phase must pass the existing bar before moving on: `npm run migrate && npm run db:verify && npm test && npx tsc --noEmit && npm run build`, plus the full existing `tenant-isolation.test.ts` and `account-deletion.test.ts` suites unmodified and green.

| Phase | What ships | Risk | Why |
|---|---|---|---|
| **0 — Foundations, dark** | `firms`, `firm_members`, `firm_invitations` tables + their own RLS (§5.1). Backfill personal firms for every existing user (§2.3). `is_firm_teammate()` function created but referenced by **no** existing table's policy yet. | **Low** | Purely additive; touches zero rows in the existing 16 tables; nothing in the app queries these new tables yet. Best canary phase — any regression here is a pure bug, not a design tradeoff. |
| **1 — Visibility column, still 100% private** | Add `visibility text NOT NULL DEFAULT 'private' CHECK (...)` to the table list decided in §5 Principle 4. RLS untouched — every row stays exactly as visible as today. | **Low** | Additive column, safe default, zero RLS change, zero behavior change. |
| **2 — RLS rewrite, one table at a time** | Add the OR-clause (§5.1) to one table's policies, run the full existing isolation suite **plus a new 3-user cross-firm test for that specific table** (§9), only then move to the next table. **Start with the lowest-stakes table** (e.g. `activities` or `documents`), not `properties`/`contacts` — prove the pattern before touching the most sensitive data. `properties`/`contacts` UPDATE/DELETE policies get a mandatory second-reviewer pass, not just automated tests. | **High, but bounded per table** | This is the core safety-critical phase. One table per step, gated on its own dedicated test before the next table starts, is what keeps a mistake contained to a single table instead of a big-bang rewrite across all of them at once. |
| **3 — Storage RLS for `documents` bucket** | The join-based storage policy from §5.2, with its own dedicated bucket-isolation test file. Sequenced strictly after `documents` (table) is proven in Phase 2. | **High** | Structurally more fragile than table RLS (no precedent in this codebase); deserves isolation from the table-RLS phase. |
| **4 — UI: sharing + the client-direct-write paths** | Full spec in §7 — scope toggle, ownership indicators, and updated `app/crm/view.tsx`, `cre-profile-section.tsx`, `lib/entities.ts` client-side filters and error states for the now-broader RLS surface (§4). | **Medium** | Mostly product/UX work, but these three files are the ones flagged in §0 as having no second gate — real review priority, not just "polish." |
| **5 — Team management + invitations** | Settings → Team page, `/join/[token]` flow, the invitation-redemption RLS (§6), role management, member removal/offboarding. | **Medium**, but the invitation-redemption policy specifically gets the same one-step-plus-dedicated-tests treatment as Phase 2 | A bug in the redemption policy lets a stranger self-add to any firm — this is the second-most safety-critical piece of RLS in the whole plan. |
| **6 — `field_definitions` decision + remaining special cases** | Whatever §5 Principle 4 decided for custom fields, plus any `entity_*` table sharing. | **Medium** | Deliberately last — narrowest, most product-judgment-dependent piece. |

---

## 9. Tests needed

Extend the existing pattern (`tests/security/tenant-isolation.test.ts`'s `assertRowIsolated`, `_test-helpers.ts`'s `createSignedInTestUser`) rather than inventing a new style. New fixture: three real Supabase users — A and B in Firm 1 (teammates), C in Firm 2 (a different firm) — via a new small helper alongside `createSignedInTestUser` that also inserts the `firms`/`firm_members` rows.

For every table touched in Phase 2, per table:

1. **Cross-firm isolation — the most important new assertion in this entire plan.** C can never select/list/update/delete A or B's row, **whether `visibility` is `'private'` or `'team'`.** `'team'` must only ever mean "visible within my firm," never "visible to anyone." This is the direct regression test for the exact leak class this whole plan exists to prevent.
2. **Within-firm private stays private.** B cannot see A's `'private'` row — proves the new OR-clause didn't accidentally loosen the base case for the *default* visibility.
3. **Within-firm shared becomes visible.** B can select/list A's `'team'` row, and can/cannot update it per the §3.1 edit-permission decision.
4. **Role boundaries.** A `'member'` cannot invite, remove, or promote; only `'admin'`/`'owner'` can. Only the owner can remove an admin or rename the firm.
5. **Invitation-token correctness.** Cannot redeem with a mismatched email, an expired/revoked/already-accepted token, or another firm's token; cannot list another firm's `firm_invitations`; cannot self-insert a `firm_members` row without a valid matching invitation.
6. **Leaving reverts visibility immediately.** After A's `firm_members.status` flips to `'removed'`, B can no longer see A's previously-`'team'` rows and A can no longer see B's — proving the join-derivation is live, not a cached grant.
7. **Storage bucket team-visibility**, mirroring the existing 4-vector `leases`-bucket test (`tenant-isolation.test.ts:422-441`) for the `documents` bucket once Phase 3 ships.
8. **Account-deletion interaction.** Extend `account-deletion.test.ts`'s seeding to include a firm+teammate scenario; confirm deleting one member doesn't orphan `firm_members`/`firm_invitations`, and that the survivor's team-shared visibility of the deleted member's rows is also gone post-deletion.
9. **Full regression of the existing `tenant-isolation.test.ts`, unmodified.** The cheapest, highest-signal gate: if any of the 14 existing tables' basic two-user assertions ever fail after adding team RLS, that's an immediate stop-ship signal requiring no judgment call.
10. **Client-side mutation path coverage.** Since `app/crm/view.tsx` bypasses server actions, add real-client-level coverage (same style as `tenant-isolation.test.ts` — a genuine signed-in browser-equivalent client, not a mock) proving the grid's inline-edit specifically cannot write to a private teammate's row and behaves correctly on a shared one. This is the one path flagged in §0 as having no second gate — it needs its own explicit test, not inherited coverage from the table-level RLS tests.

All new tests should follow the existing `HAS_SUPABASE_TEST_CREDS` skip-not-fail convention — they run against a real project when creds are available, and skip cleanly otherwise, exactly like the suite they extend.

---

## 10. Biggest risks (recap)

1. **Cross-firm leak** — fatal; CRE brokerage relationships are business-sensitive, career-defining data. Mitigated structurally by: additive-only OR-clauses (never replace a policy, only extend it), one shared `is_firm_teammate()` function instead of sixteen hand-written joins, one-table-at-a-time rollout each gated on its own dedicated 3-user test, and the existing 2-user isolation suite as an unmodified regression gate at every phase.
2. **The three client-side direct-mutation paths** (§0.2) are the one place RLS is the *only* gate, not a backstop — highest code-review priority in Phase 4 (spec: §7.6), and the only place this plan calls for real-client (not mocked) test coverage of a UI code path specifically.
3. **Storage RLS** is structurally more fragile than table RLS here (a new join pattern with no precedent in this codebase) — isolated into its own phase and its own tests rather than bundled with table RLS.
4. **A service-role key would be a new, categorically different risk** (total RLS bypass on leak) — the plan's invitation design (§6) exists specifically to avoid ever needing one.
5. **`field_definitions`** doesn't fit the generic per-record opt-in-share model — needs its own explicit decision (§5 Principle 4), not silent inheritance.
6. **Scope creep** — multi-firm-per-user membership, per-teammate (not whole-firm) sharing granularity, and audit logging of who-viewed-what are all real, reasonable asks this kind of feature invites. This plan deliberately excludes all three from v1. Naming them here so they're a conscious choice, not a gap discovered later.

---

## 11. Decisions needed before Phase 0 starts

**Status: RESOLVED (auto-build directive, August 2026).** The user explicitly chose to build the whole plan without going through these interactively — offered the choice between resolving decisions first, auto-building on the plan's own recommendations, Phase-0-only, or unconditional full build, and picked full build. What follows records which way each item was actually decided, for traceability, since these choices materially shape the RLS and UI that got built. This is the plan's own recommended default on every item except #5 and #8, which had no stated default and were decided here.

1. **Default visibility model — (B) private-by-default, share explicitly.** Nothing changes for any existing record until a broker opts it into `visibility='team'`. Lowest blast radius of the four options in §3.1.
2. **Edit permission on shared records — co-editable, not view-only.** A `visibility='team'` record is writable by any active firm teammate, not just readable — the RLS OR-clause (§5 Principle 5) applies to `SELECT`, `UPDATE`, and `DELETE` alike. Matches "work together on a shared pipeline," not just "see each other's pipeline."
3. **Table list for the `visibility` column — `properties`, `contacts`, `lease_abstracts`, `deals`, `activities`, `follow_ups`, `documents`.** The `entity_*` tables (`entities`, `entity_properties`, `entity_contacts`) are excluded from v1 — the plan only flagged them as "possibly" candidates, and excluding them keeps the RLS-rewrite surface (§5 Principle 4) to the tables the ownership question was actually about. `error_logs`, `ingestion_errors`, `smart_lists`, `user_settings` stay owner-only as the plan already recommended.
4. **Departure handling — auto-revert-to-private, plus an admin-initiated reassignment action available before removal.** Combination (2)+(3) from §3.2, as the plan's text under §3.2 explicitly recommended.
5. **`field_definitions` — firm-wide by default, not opt-in, not per-broker.** The plan flagged this as needing its own answer without picking one; decided here in favor of firm-wide, because a shared deal or property with teammates using different custom-field schemas would be more confusing than useful — consistency across a shared record beats per-broker schema privacy. Implemented as a standing `owner_id = auth.uid() OR is_firm_teammate(owner_id)` RLS clause (no `visibility` column on this table — it isn't opt-in, so there's nothing to toggle).
6. **Invite mechanism — link-based.** No service-role key introduced, per the plan's explicit reasoning in §6.
7. **Single active firm per user.** Multi-firm membership stays out of scope for v1, as recommended.
8. **Workspace scope toggle — 2 states ("My book" / "Entire firm").** Under the chosen visibility model (private-opt-in, whole-firm sharing, not role-derived), a third state would be redundant per §7.2's own analysis — decided here in favor of 2, as the plan's own default reasoning already pointed to.
9. **Timing — proceeding now, by explicit user override.** This plan's own bottom line, and `AUDIT.md` §9.3 / `Beacon_Master_Execution_Plan.md` Phase 11, all called this after-pilot work. The user weighed that tradeoff explicitly and chose to build now regardless — recorded here so the reasoning isn't lost, not to relitigate it.
