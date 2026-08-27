import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Per-teammate record sharing — Phase 1 (schema + RLS).
 * See Beacon_Per_User_Sharing_Plan.md §1-§3.
 *
 * record_shares — an explicit, per-record, per-recipient grant. Orthogonal to
 * the existing whole-firm `visibility` column (Beacon_Team_Multitenancy_Plan.md):
 * a record can be 'private' yet shared with specific teammates, or 'team' and
 * separately shared (redundant but harmless). No third visibility value —
 * that would be derived state duplicated into a stored column, an easy way
 * for the two to drift out of sync.
 *
 * entity_type/entity_id is polymorphic with no FK on entity_id, mirroring the
 * existing documents table precedent (scripts/migrate-documents.ts) — it
 * spans three different tables, so a real FK is impossible; ownership is
 * verified by owns_shared_record() below, not by the schema.
 *
 * is_record_shared_with_me() — the read-side helper every properties/
 * contacts/deals SELECT policy calls. Deliberately paired with
 * is_firm_teammate() in the same OR-clause (not just a bare row-exists
 * check): this makes a share's effect a LIVE re-check of current firm
 * membership, not just row presence, so leaving the firm revokes shared-
 * record access instantly and automatically — identical to how whole-firm
 * 'team' visibility already behaves — with no cleanup job in the security
 * loop. Per-teammate shares are read-only in v1 (not co-editable, the
 * opposite default from whole-firm sharing) — see plan §3.2 for why — so
 * only SELECT gets this clause; UPDATE/DELETE are untouched.
 *
 * owns_shared_record() — the write-side guard. Without it, nothing would
 * stop a user from inserting a record_shares row pointing at a record they
 * don't own, naming themselves as recipient, and using
 * is_record_shared_with_me() as a side door around the real table's
 * ownership check entirely. This is the single most safety-critical new
 * piece of RLS in this migration.
 */
const MIGRATION = `
-- ─── record_shares ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS record_shares (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         TEXT NOT NULL CHECK (entity_type IN ('property', 'contact', 'deal')),
  entity_id           UUID NOT NULL,
  shared_with_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_by_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS record_shares_recipient ON record_shares (shared_with_user_id, entity_type);
CREATE INDEX IF NOT EXISTS record_shares_entity ON record_shares (entity_type, entity_id);

ALTER TABLE record_shares ENABLE ROW LEVEL SECURITY;

-- ─── owns_shared_record() ────────────────────────────────────────────────────
-- Confirms p_user_id genuinely owns p_entity_id in the table p_entity_type
-- names. Gates record_shares' own INSERT policy below — see file header.
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

-- ─── is_record_shared_with_me() ──────────────────────────────────────────────
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

-- ─── RLS: record_shares ───────────────────────────────────────────────────────
-- Owner (the person who owns the underlying record) can grant/revoke;
-- recipient can read their own incoming/outgoing grants (to render "shared
-- with you" / "shared with" UI) but cannot create or delete them.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'record_shares' AND policyname = 'record_shares_owner_insert'
  ) THEN
    CREATE POLICY record_shares_owner_insert ON record_shares
      FOR INSERT WITH CHECK (
        shared_by_user_id = auth.uid()
        AND is_firm_teammate(shared_with_user_id)
        AND owns_shared_record(entity_type, entity_id, auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'record_shares' AND policyname = 'record_shares_owner_delete'
  ) THEN
    CREATE POLICY record_shares_owner_delete ON record_shares
      FOR DELETE USING (shared_by_user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'record_shares' AND policyname = 'record_shares_recipient_select'
  ) THEN
    CREATE POLICY record_shares_recipient_select ON record_shares
      FOR SELECT USING (shared_with_user_id = auth.uid() OR shared_by_user_id = auth.uid());
  END IF;
END $$;

-- ─── properties / contacts / deals: SELECT-only shared-with-me OR-clause ────
-- Additive only — UPDATE/DELETE policies are untouched (per-teammate shares
-- are read-only in v1, unlike whole-firm 'team' visibility, which stays
-- co-editable exactly as it already is).
DROP POLICY IF EXISTS properties_owner_or_teammate_select ON properties;
DROP POLICY IF EXISTS properties_owner_or_teammate_or_shared_select ON properties;
CREATE POLICY properties_owner_or_teammate_or_shared_select ON properties
  FOR SELECT USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
    OR (is_firm_teammate(owner_id) AND is_record_shared_with_me('property', id))
  );

DROP POLICY IF EXISTS contacts_owner_or_teammate_select ON contacts;
DROP POLICY IF EXISTS contacts_owner_or_teammate_or_shared_select ON contacts;
CREATE POLICY contacts_owner_or_teammate_or_shared_select ON contacts
  FOR SELECT USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
    OR (is_firm_teammate(owner_id) AND is_record_shared_with_me('contact', id))
  );

DROP POLICY IF EXISTS deals_owner_or_teammate_select ON deals;
DROP POLICY IF EXISTS deals_owner_or_teammate_or_shared_select ON deals;
CREATE POLICY deals_owner_or_teammate_or_shared_select ON deals
  FOR SELECT USING (
    auth.uid() = owner_id
    OR (visibility = 'team' AND is_firm_teammate(owner_id))
    OR (is_firm_teammate(owner_id) AND is_record_shared_with_me('deal', id))
  );
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nRunning record_shares migration...");
  await client.query(MIGRATION);
  console.log("Table + RLS + is_record_shared_with_me()/owns_shared_record() ready.");

  const { rows: colRows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'record_shares'
     ORDER BY ordinal_position`
  );
  console.log(`\n✓ record_shares (${colRows.length} columns)`);

  const { rows: fnRows } = await client.query(
    `SELECT proname FROM pg_proc WHERE proname IN ('is_record_shared_with_me', 'owns_shared_record') ORDER BY proname`
  );
  for (const fn of ["is_record_shared_with_me", "owns_shared_record"]) {
    console.log(`✓ ${fn}() ${fnRows.some((r) => r.proname === fn) ? "present" : "MISSING"}`);
  }

  for (const table of ["record_shares", "properties", "contacts", "deals"]) {
    const { rows } = await client.query(
      `SELECT policyname, cmd FROM pg_policies WHERE tablename = $1 ORDER BY policyname`,
      [table]
    );
    console.log(`\n${table}:`);
    for (const r of rows) console.log(`  ✓ ${r.policyname} (${r.cmd})`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
