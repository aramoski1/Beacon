import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

// Admin: revoke/restore account access + per-account activity log.
//
// Revocation is an app-level soft block, not a Supabase Auth ban — no
// service-role key involved (see Beacon_Team_Multitenancy_Plan.md for why
// this codebase has deliberately avoided that so far). It's enforced in
// app code (app/login/actions.ts, lib/auth.ts's requireUser()), not RLS on
// business tables — this migration only adds the state and the admin-only
// write path for it.
//
// user_settings_owner_all is FOR ALL USING(owner_id = auth.uid()) with no
// column-level restriction, so without a guard a user could revoke/
// un-revoke themself with a direct table update. The trigger below closes
// that for the two new columns specifically.
const SQL = `
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS access_revoked_at TIMESTAMPTZ;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION guard_user_settings_revoke_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.access_revoked_at IS DISTINCT FROM OLD.access_revoked_at
      OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by)
     AND NOT is_admin() THEN
    NEW.access_revoked_at := OLD.access_revoked_at;
    NEW.revoked_by := OLD.revoked_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_settings_guard_revoke_columns ON user_settings;
CREATE TRIGGER user_settings_guard_revoke_columns
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION guard_user_settings_revoke_columns();

-- ─── Revoke / restore (admin only) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_set_account_revoked(target_user uuid, revoked boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Not authorized.';
  END IF;
  IF target_user = auth.uid() THEN
    RAISE EXCEPTION 'Cannot revoke your own access.';
  END IF;

  UPDATE user_settings
  SET access_revoked_at = CASE WHEN revoked THEN now() ELSE NULL END,
      revoked_by = CASE WHEN revoked THEN auth.uid() ELSE NULL END
  WHERE owner_id = target_user;

  IF NOT FOUND THEN
    INSERT INTO user_settings (owner_id, access_revoked_at, revoked_by)
    VALUES (
      target_user,
      CASE WHEN revoked THEN now() ELSE NULL END,
      CASE WHEN revoked THEN auth.uid() ELSE NULL END
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_set_account_revoked(uuid, boolean) TO authenticated;

-- ─── Activity log ────────────────────────────────────────────────────────────────
-- Page-view log written by each user's own RLS-authenticated client (proxy.ts).
-- Write-only for the user who generated it (no SELECT-for-self) — only the
-- admin can read it back, matching the "identity only, admin-only" shape
-- already used for admin_list_accounts().
CREATE TABLE IF NOT EXISTS activity_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  path       TEXT        NOT NULL,
  method     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_user_created_idx ON activity_log (user_id, created_at DESC);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_log_insert_own ON activity_log;
CREATE POLICY activity_log_insert_own ON activity_log
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS activity_log_admin_select ON activity_log;
CREATE POLICY activity_log_admin_select ON activity_log
  FOR SELECT USING (is_admin());

-- ─── admin_list_accounts() — add status/activity columns ────────────────────────
-- Widening the return type: plain CREATE OR REPLACE rejects that, so drop first.
DROP FUNCTION IF EXISTS admin_list_accounts();

CREATE FUNCTION admin_list_accounts()
RETURNS TABLE (
  user_id          uuid,
  email            text,
  created_at       timestamptz,
  display_name     text,
  company          text,
  firm_name        text,
  access_revoked_at timestamptz,
  revoked_by       uuid,
  last_active_at   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    u.id,
    u.email,
    u.created_at,
    us.display_name,
    us.company,
    f.name,
    us.access_revoked_at,
    us.revoked_by,
    us.last_active_at
  FROM auth.users u
  LEFT JOIN user_settings us ON us.owner_id = u.id
  LEFT JOIN firm_members fm ON fm.user_id = u.id AND fm.status = 'active'
  LEFT JOIN firms f ON f.id = fm.firm_id
  WHERE is_admin()
  ORDER BY u.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION admin_list_accounts() TO authenticated;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);

  const cols = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='user_settings' ORDER BY ordinal_position",
  );
  console.log("user_settings columns:", cols.rows.map((r: { column_name: string }) => r.column_name).join(", "));

  const activityCols = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='activity_log' ORDER BY ordinal_position",
  );
  console.log("activity_log columns:", activityCols.rows.map((r: { column_name: string }) => r.column_name).join(", "));

  await client.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
