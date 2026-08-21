# Beacon — Per-Teammate Record Sharing: Implementation Plan (v1.5)
**Status:** DRAFT — planning only, no code written, nothing merged.
**Version:** August 2026
**Audience:** Alec (decision-maker), future engineers implementing this.
**Builds on:** `Beacon_Team_Multitenancy_Plan.md` (whole-firm `visibility='team'` sharing), which is fully implemented and live — see §0 below for exactly what already exists.

This plan resolves every decision it raises. Where the original plan left an item as "pick one," this document picks one and states why, so Phase 1 (schema + RLS) can start without a follow-up conversation.

---

## 0. Current-state summary — what's already built (verified against the live code, not memory)

The whole-firm plan shipped in full:

- **Tables:** `firms`, `firm_members` (`role` owner/admin/member, `status` active/removed), `firm_invitations` — `scripts/migrate-firms.ts`.
- **`is_firm_teammate(target_owner_id uuid)`** — `SECURITY DEFINER`, `STABLE`, defined in `scripts/migrate-firms.ts:209-226`. Returns true iff the caller and `target_owner_id` share an active `firm_members` row in the same firm. This is the one function every team-visibility policy calls; it takes no client-supplied firm id (derives the caller's firm from `auth.uid()` internally).
- **`visibility` column** (`private` default / `team`), added to seven tables: `properties`, `contacts`, `lease_abstracts`, `deals`, `activities`, `follow_ups`, `documents` — one idempotent migration per table (`scripts/migrate-{table}-team-visibility.ts`), each adding a `SELECT`/`UPDATE`/`DELETE` OR-clause of the shape:
  ```sql
  auth.uid() = owner_id OR (visibility = 'team' AND is_firm_teammate(owner_id))
  ```
  Whole-firm sharing is **co-editable**, not view-only (a teammate can `UPDATE`/`DELETE` a `'team'` row, not just read it) — confirmed by the six-vector `assertVisibilityLifecycle` helper in `tests/security/team-firm-isolation.test.ts:55-97`, which explicitly asserts a teammate's edit persists.
  `field_definitions` is the one exception: firm-wide *unconditionally*, no `visibility` column, no opt-in (`tests/security/team-firm-isolation.test.ts:465-489`).
- **Storage:** the `documents` bucket has a join-based team-visibility policy (`scripts/migrate-documents-bucket-team-visibility.ts`) joining `storage.objects.name` to `documents.storage_path`.
- **`app/settings/team`** — full roster/invite/role/remove/leave UI and server actions (`app/settings/team/actions.ts`). `removeMember`/`leaveFirm` (`actions.ts:166-247`) flip `firm_members.status` to `'removed'` — they do **not** currently do any record-level cleanup, because whole-firm visibility needs none: `is_firm_teammate()` is a live join, so revocation is instant and automatic. This matters directly for §5 below, since per-teammate shares are stored state and do *not* get this for free in the same way — the design in §3 recovers as much of that "instant, automatic revocation" property as it can.
- **`lib/firms.ts`** — `isSoloFirmForUser` (cheap solo/multi check for detail-page toggles) and `getWorkspaceTeamContext` (solo check + `firm_teammate_names()` RPC roster, used once per Workspace load, passed down as a prop per `Beacon_Team_Multitenancy_Plan.md` §7.3).
- **`components/share-with-firm-toggle.tsx`** — the detail-page toggle. Renders nothing for a solo firm or for a non-owner viewing a private row; shows a "Shared with your team" badge to a non-owner viewing a `'team'` row; shows the actual toggle only to the owner. This is the component §4 below sits *next to*, not replaces.
- **`app/crm/view.tsx`** — Workspace has a 2-state scope toggle, "My book" / "Entire firm" (`view.tsx:3070-3095`), gated on `!isSoloFirm`. `scope === "mine"` adds an explicit `.eq("owner_id", userId)` to all three loaders (`:2439`, `:2572`, `:2656`); `"firm"` scope runs the loaders unfiltered, relying on RLS as the ceiling.
- **Tests:** `tests/security/team-firm-isolation.test.ts` — the exact 3-user, 2-firm fixture (`userA`/`userB` teammates in "Firm One," `userC` in "Firm Two") this plan's own tests reuse verbatim, via `createFirm`/`addFirmMember`/`setFirmMemberStatus` in `tests/security/_test-helpers.ts:87-114`.

**What does not exist yet, and is the entire subject of this plan:** any way to share a specific record with *specific* teammates rather than the whole firm. That's the gap this document closes.

---

## 1. Data model

**Decision: keep `visibility` exactly as it is (`private` | `team`, unchanged on all seven existing tables) and add a new, orthogonal `record_shares` table.** Do not introduce a third `visibility` value (e.g. `'shared'`).

Rejected alternative and why: a `'shared'` enum value would have to be kept in sync with "does at least one share row exist for this record," which is derived state duplicated into a stored column — the exact kind of denormalization bug this plan should avoid (revoke the last share, forget to flip the column back, and the UI now lies about who can see the record). Per-teammate sharing and whole-firm sharing are independent mechanisms that can both be true at once (a record can be `'private'` yet shared with two specific people; or `'team'` *and* separately shared with someone — harmless, just redundant) — modeling them as two independent additive OR-clauses, per Principle 1 of the original plan ("every new policy is a strict OR addition, never a replacement"), needs no new enum value at all.

```sql
CREATE TABLE record_shares (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type          text        NOT NULL CHECK (entity_type IN ('property', 'contact', 'deal')),
  entity_id            uuid        NOT NULL,
  shared_with_user_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_by_user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, shared_with_user_id)
);

CREATE INDEX record_shares_recipient ON record_shares (shared_with_user_id, entity_type);
CREATE INDEX record_shares_entity    ON record_shares (entity_type, entity_id);
```

- **`entity_type`/`entity_id` is polymorphic with no FK on `entity_id`**, deliberately mirroring the existing precedent in `documents` (`scripts/migrate-documents.ts:8-16`: *"entity_id is polymorphic (property/lease/contact) so it can't carry a real FK — ownership is verified in application code against the entity_type/entity_id pair"*). Same reasoning applies here: `entity_id` spans three different tables, so a real FK is impossible; ownership is verified at write time by RLS itself (§3), not by the schema.
- **No `UPDATE` policy on `record_shares`** — a share isn't edited in place, only granted (`INSERT`) or revoked (`DELETE`). Nothing to build; Postgres RLS default-denies anything without a matching policy, so omitting `UPDATE` entirely is the correct, safe default, not a gap.
- **`UNIQUE (entity_type, entity_id, shared_with_user_id)`** makes re-sharing with the same person a no-op upsert (`ON CONFLICT DO NOTHING`) rather than a duplicate row — matters for the Phase 2 UI's multi-select, which should be able to call the same "set shares to this list" action repeatedly without erroring.

---

## 2. Which entities in v1

**Decision: `properties`, `contacts`, `deals` only. `lease_abstracts`, `activities`, `follow_ups`, `documents` are explicitly out of scope until Phase 5 (Prompt 5), and even then they get their *own* `record_shares` rows — sharing never cascades from a parent record.**

Why "each entity gets its own rows" and not "leases inherit from their linked property": an inherited grant is invisible and unrevocable on its own — there would be no row a teammate, an owner, or the offboarding cleanup in §5 could point to, list, or delete independently. Every grant in this design has to be an explicit, independently-listable, independently-revocable `record_shares` row, because:
1. §1's `record_shares_recipient_select` policy (a recipient can see their own share rows to know what's shared with them and render "Shared with you" UI) has nothing to select if the grant is implicit.
2. §5's offboarding cleanup deletes specific rows by `shared_with_user_id`/`shared_by_user_id` — an inherited grant has no row to delete.
3. Product-wise, "I shared this property with Bob" silently also sharing every lease under it is a surprising, hard-to-audit side effect — the explicit-only model is also what Prompt 5 itself specifies ("default no auto-cascade unless product says yes").

`record_shares.entity_type`'s `CHECK` constraint ships with exactly `('property', 'contact', 'deal')` in Phase 1's migration; Phase 5 widens it with its own dedicated idempotent migration adding `'lease'`/`'document'`, mirroring the exact precedent of `scripts/migrate-documents-deal-entity.ts`, which widened `documents.entity_type`'s constraint from `('property','lease','contact')` to include `'deal'` after the fact.

---

## 3. RLS shape + `is_record_shared_with_me()`

### 3.1 The read-side helper

```sql
CREATE OR REPLACE FUNCTION is_record_shared_with_me(p_entity_type text, p_entity_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM record_shares
    WHERE entity_type = p_entity_type
      AND entity_id = p_entity_id
      AND shared_with_user_id = auth.uid()
  );
$fn$;
```

### 3.2 The per-table policy addition — and a deliberate extra clause

**Decision: per-teammate shares are read-only in v1, not co-editable** — the opposite default from whole-firm `'team'` visibility. Rationale: whole-firm sharing already models "we work this together" as a firm-level policy the owner opted the whole team into; a one-off share to one specific colleague (a referral, a second opinion, coverage while out of office) is a narrower, more deliberate act that doesn't imply the same level of trust. Making every per-teammate share co-editable by default would mean granting write access every time someone just wants a second set of eyes — a bigger commitment than "let them look." `UPDATE`/`DELETE` therefore get **no** new clause; only `SELECT` does:

```sql
DROP POLICY IF EXISTS properties_owner_or_teammate_select ON properties;
CREATE POLICY properties_owner_or_teammate_or_shared_select ON properties
  FOR SELECT USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
    OR (is_firm_teammate(owner_id) AND is_record_shared_with_me('property', id))
  );
-- UPDATE/DELETE policies are untouched — no is_record_shared_with_me() clause on either.
```

Same shape for `contacts` and `deals` (`entity_type` literal changes to `'contact'`/`'deal'`; `id` is each table's own PK).

**Why the extra `is_firm_teammate(owner_id) AND` on the shared clause, when `is_record_shared_with_me()` already checks `shared_with_user_id = auth.uid()`:** this is the single most important design choice in this plan, because it gets offboarding correctness *for free* at read time, exactly the way whole-firm visibility already does. Without it, a `record_shares` row is inert stored state — if the recipient later leaves the firm, the row still exists and would still grant access on its own, requiring a bulletproof cleanup job to be the *only* thing standing between a departed teammate and a former colleague's private data. With the live `is_firm_teammate()` re-check bundled into the same clause, access is gated by *current* firm membership every single read, not by whether a row happens to still exist — so leaving the firm revokes shared-record access instantly and automatically, identical to how it already works for whole-firm `'team'` visibility (`tests/security/team-firm-isolation.test.ts:259-281`, "leaving the firm immediately revokes visibility"). §5's cleanup step becomes a hygiene measure (no stale rows, no silent reactivation on rejoin), not the security boundary itself.

### 3.3 The write side — the actual new attack surface, and why it needs its own guard function

A share row is **stored, attacker-reachable state** (unlike `visibility='team'`, which only ever describes the row it's already on). That makes `record_shares`' own `INSERT` policy the second most safety-critical piece of RLS in this whole plan, after the `SELECT` clause above — a bug here doesn't just leak visibility metadata, it forges access to someone else's private record.

**Concretely: without an ownership check, nothing stops user Eve from inserting `record_shares(entity_type='property', entity_id=<any property id she knows about>, shared_with_user_id=Eve, shared_by_user_id=Eve)`.** §3.2's `is_record_shared_with_me('property', id)` would then return `true` for Eve on that row, regardless of who actually owns it — a complete bypass of `properties`' own ownership check, using `record_shares` as the side door. This must be closed at the `record_shares` `INSERT` policy, not assumed away:

```sql
CREATE OR REPLACE FUNCTION owns_shared_record(p_entity_type text, p_entity_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
BEGIN
  IF p_entity_type = 'property' THEN
    RETURN EXISTS (SELECT 1 FROM properties WHERE id = p_entity_id AND owner_id = p_user_id);
  ELSIF p_entity_type = 'contact' THEN
    RETURN EXISTS (SELECT 1 FROM contacts WHERE id = p_entity_id AND owner_id = p_user_id);
  ELSIF p_entity_type = 'deal' THEN
    RETURN EXISTS (SELECT 1 FROM deals WHERE id = p_entity_id AND owner_id = p_user_id);
  END IF;
  RETURN false;
END;
$fn$;

CREATE POLICY record_shares_owner_insert ON record_shares
  FOR INSERT WITH CHECK (
    shared_by_user_id = auth.uid()
    AND is_firm_teammate(shared_with_user_id)
    AND owns_shared_record(entity_type, entity_id, auth.uid())
  );

CREATE POLICY record_shares_owner_delete ON record_shares
  FOR DELETE USING (shared_by_user_id = auth.uid());

CREATE POLICY record_shares_recipient_select ON record_shares
  FOR SELECT USING (shared_with_user_id = auth.uid() OR shared_by_user_id = auth.uid());
```

Three independent checks in the `INSERT` policy, each closing a distinct hole:
- `shared_by_user_id = auth.uid()` — can't forge a grant attributed to someone else.
- `is_firm_teammate(shared_with_user_id)` — **this is the "cross-firm share attempt must fail" requirement.** Closes it at the write itself, not just at read time (belt-and-suspenders with §3.2's live re-check).
- `owns_shared_record(...)` — closes the forged-access hole described above; the caller must actually own the row they're claiming to share.

`record_shares_recipient_select` intentionally also lets the *sharer* read their own grants (not just the recipient) — needed so the owner's own Share UI (§4) can list "who I've shared this with" without a service-role bypass.

### 3.4 Table list, explicitly

Only `properties`, `contacts`, `deals` get the `SELECT`-policy addition in Phase 1 (§2). `lease_abstracts`, `activities`, `follow_ups`, `documents`, `field_definitions`, and every table already excluded by the original plan (`error_logs`, `ingestion_errors`, `smart_lists`, `user_settings`, the `entity_*` tables) are untouched.

---

## 4. UI — "Share with…" picker on detail pages

Placed immediately next to the existing `ShareWithFirmToggle` on the property, contact, and deal detail pages (`app/properties/[id]/page.tsx`, `app/contacts/[id]/page.tsx`, `app/deals/[id]/page.tsx`), not inside it — they're independent controls for independent mechanisms (§1).

**Visibility of the control itself:**
- Hidden entirely for a solo firm — same `isSoloFirm` prop already threaded into `ShareWithFirmToggle` (`components/share-with-firm-toggle.tsx:38`); no new server-side check needed, reuse the value already being fetched via `isSoloFirmForUser`.
- Rendered as an editable multi-select **only when the viewer owns the record** (`ownerId === currentUserId`), matching `ShareWithFirmToggle`'s exact split (`share-with-firm-toggle.tsx:40-47`).
- For a non-owner, no picker — but if a `record_shares` row exists naming them (`is_record_shared_with_me` true for that row), a badge distinct from `ShareWithFirmToggle`'s "Shared with your team" pill: **"Shared with you by {owner display name}"**, sourced the same way `OwnerPortfolioLink`/the Workspace ownership indicator already resolve a name — the `firm_teammate_names()` RPC / `getWorkspaceTeamContext`'s `teammateNames` map (`lib/firms.ts:85-91`), keyed by `owner_id` this time instead of the viewer's own id. This is the "clear indicator" requirement, and it must read differently from the whole-firm badge so a broker can tell "the whole firm can see this" apart from "this one person specifically can."

**The owner's control:** a checkbox list of active firm teammates (excluding self), reusing the exact roster the Workspace already fetches once per load (`firm_teammate_names()`), sourced fresh via a small `getFirmTeammates()` server action shaped like `getWorkspaceTeamContext` but scoped to just the roster (no need for the solo-check math a detail page already gets separately). Each row shows current shared/unshared state (pre-populated from `record_shares` for this `entity_type`+`entity_id`); toggling calls one server action:

```ts
// e.g. app/shares/actions.ts — one file, reused by all three entity types
export async function setRecordShares(
  entityType: "property" | "contact" | "deal",
  entityId: string,
  sharedWithUserIds: string[],
): Promise<{ error?: string }>
```

which: re-verifies the caller owns the record (redundant with RLS, matching the codebase-wide defense-in-depth convention already used everywhere else — e.g. every `app/properties/[id]/actions.ts` function's `.eq("owner_id", user.id)`), diffs the requested set against the current `record_shares` rows for that entity, issues one batched insert for additions and one batched delete for removals, and calls `revalidatePath` on the detail route. A single diffing action (vs. one server action per checkbox click) matches `ShareWithFirmToggle`'s one-call-per-user-action shape while supporting the multi-select requirement without N round trips.

**Empty/error states:** if the firm has exactly one other active member, the list still renders (not collapsed to nothing) so the control's presence doesn't silently vanish depending on roster size — only `isSoloFirm` hides it. A failed insert/delete surfaces the real Postgres/RLS error inline (same pattern as `ShareWithFirmToggle`'s `error` state, `share-with-firm-toggle.tsx:56-59`), never a silently-ignored failure.

---

## 5. Offboarding — what happens to shares when a member is removed

**Decision: on `firm_members.status` → `'removed'` (both `removeMember` and self-service `leaveFirm`), delete every `record_shares` row where the departing user is *either* `shared_with_user_id` or `shared_by_user_id`.**

As established in §3.2, this delete is a **hygiene** measure, not the security boundary — access is already cut instantly at read time by the live `is_firm_teammate()` re-check, the moment `status` flips, with or without this cleanup. The cleanup exists for two separate reasons:
1. **No stale rows.** Without it, `record_shares` accumulates permanently-inert rows for every departure, and the Share UI's "shared with" list would need to filter dead teammates out at render time forever rather than the data simply being correct.
2. **No silent reactivation.** If a removed member is later re-invited to the *same* firm, an un-cleaned row would spring back to granting access with zero new deliberate action from anyone — surprising, and hard to explain after the fact ("why can Bob see this deal, nobody re-shared it with him"). Deleting on departure means rejoining is a clean slate; any sharing that's still wanted has to be redone deliberately.

Implementation: extend `removeMember` and `leaveFirm` (`app/settings/team/actions.ts:166-196` and `:227-247`) — after the existing `UPDATE firm_members SET status = 'removed'`, add:
```sql
DELETE FROM record_shares WHERE shared_with_user_id = $1 OR shared_by_user_id = $1;
```
No additional authorization check is needed beyond what each action already verifies (only owner/admin can call `removeMember`; a member can only `leaveFirm` themselves) — this delete is a consequence of a status change already gated by those checks, not a new privileged action.

**Reassignment:** unlike the original plan's `owner_id`-transfer question (`Beacon_Team_Multitenancy_Plan.md` §3.2/§11 item 4, still open for whole-firm-owned records), per-teammate shares need no reassignment step — deleting the grant row doesn't touch the underlying record's `owner_id` at all. If the *departing* user was the record's actual owner (not just a share recipient), that's the pre-existing whole-firm-plan concern, out of scope here.

---

## 6. Test plan — extending the existing 3-user pattern

**Decision: a new file, `tests/security/record-shares-isolation.test.ts`, parallel to `tests/security/team-firm-isolation.test.ts`**, not folded into that file — keeps the whole-firm-visibility suite and the per-teammate-share suite independently reviewable and independently gate-able, matching the original plan's "one thing at a time" rollout discipline (§8 of that plan). It reuses every existing helper unmodified: `createSignedInTestUser`, `createFirm`, `addFirmMember`, `setFirmMemberStatus` (`tests/security/_test-helpers.ts:41-114`) — zero new test infrastructure needed. Same fixture shape: `userA`/`userB` teammates in "Firm One," `userC` in "Firm Two."

Required cases:

1. **Basic grant, per entity type.** A shares property P with B (`insert record_shares`) → B can `SELECT` P; C cannot. Repeat for a contact and a deal (three variants of the same case, one per `entity_type`).
2. **View-only, not co-editable.** B's `UPDATE`/`DELETE` attempt on P returns 0 affected rows (per §3.2's decision) — regresses the *opposite* assertion from `assertVisibilityLifecycle`'s co-edit check, deliberately, since the two mechanisms behave differently by design.
3. **Revoke.** A deletes the `record_shares` row → B's subsequent `SELECT` returns empty.
4. **Cross-firm share attempt rejected at write time.** A attempts to insert a `record_shares` row naming C (different firm) as `shared_with_user_id` → `INSERT` fails (`is_firm_teammate` clause in `record_shares_owner_insert`'s `WITH CHECK`).
5. **Ownership-forgery attempt rejected.** C attempts to insert a `record_shares` row claiming `shared_by_user_id = C` on a property C does not own (e.g. A's) → `INSERT` fails (`owns_shared_record` clause) — this is the direct regression test for the vulnerability identified in §3.3 and the single most important new assertion in this file.
6. **Live revocation on departure, before any cleanup runs.** A shares P with B; B's `firm_members.status` flips to `'removed'` (via `setFirmMemberStatus`, *without* yet calling the §5 cleanup) → B's `SELECT` on P already returns empty, proving the live `is_firm_teammate()` join — not row presence — is what actually gates access.
7. **Cleanup deletes the row.** After the departure in (6), the `record_shares` row for B no longer exists in the database at all (via the raw `pg` client, bypassing RLS to check ground truth) — proving `removeMember`'s cleanup step actually ran.
8. **No silent reactivation.** B rejoins Firm One later (`setFirmMemberStatus` back to `'active'`) → B still cannot see P (no new share was made) — proving (7)'s delete, not a status-only revert, is what happened.
9. **Regression, unmodified.** The full existing `tenant-isolation.test.ts` and `team-firm-isolation.test.ts` suites stay green with zero edits — the cheapest, highest-signal gate, matching the original plan's own final test requirement (§9 item 9).

All cases follow the existing `HAS_SUPABASE_TEST_CREDS` skip-not-fail convention.

---

## 7. Phased rollout

Every phase gate, unchanged from the original plan's own bar (`Beacon_Team_Multitenancy_Plan.md` §8): `npm run migrate && npm run db:verify && npm test && npx tsc --noEmit && npm run build`, plus the full existing `tenant-isolation.test.ts`, `team-firm-isolation.test.ts`, and `account-deletion.test.ts` suites green, unmodified.

| Phase | Ships | Risk | Gate |
|---|---|---|---|
| **1 — Schema + RLS** | `record_shares` table, `is_record_shared_with_me()`, `owns_shared_record()`, the `SELECT`-only OR-clause added to `properties`/`contacts`/`deals`. New idempotent `scripts/migrate-record-shares.ts`, registered in `migrate-all.ts` (after `migrate-firms.ts`, since it depends on `is_firm_teammate()`), columns added to `verify-schema.ts`, entry added to `MIGRATIONS.md`. | **High, but bounded** — new stored-state attack surface (§3.3) | `tests/security/record-shares-isolation.test.ts` fully green + all existing suites unmodified green |
| **2 — Share UI** | "Share with…" picker (§4), `setRecordShares` server action, "Shared with you by…" badge | **Low–medium** | Manual test in browser (owner + recipient views), server-action owner check verified |
| **3 — Workspace scopes** | "Shared with me" pool defined and wired into `/crm` scope handling, without loosening what "Entire firm" already means | **Medium** — must not leak private teammate rows into a scope that shouldn't show them | Manual test plan in the PR body; smart-list/NL-search scope regression check |
| **4 — Offboarding cleanup** | `removeMember`/`leaveFirm` delete `record_shares` rows on departure (§5) | **Medium** | Remove-member test: shares gone from the DB, ex-member's `SELECT` already failed even before cleanup ran (case 6 above) |
| **5 — Follow-on entities** | `lease_abstracts`, `documents` (activities only if tied to an already-shared parent) get the same pattern, own `entity_type` CHECK widening migration, no auto-cascade | **Medium** | Same test pattern per table, existing suites still green |

Do not begin Phase 2 until Phase 1's dedicated test file is green — mirrors the original plan's per-table gating discipline (§8: "one table at a time... gated on its own dedicated test before the next table starts").
