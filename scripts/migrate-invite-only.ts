import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

const ADMIN_EMAIL = process.env.BEACON_ADMIN_EMAIL ?? "alecramoski@gmail.com";

// Invite-only signup + a single-admin management view.
//
// approved_emails / access_requests are locked down by RLS to admins only
// (via is_admin()) — no anon/authenticated policy grants any access to the
// raw tables. The pre-auth signup check and the access-request log both go
// through narrow SECURITY DEFINER functions instead (is_email_approved,
// record_access_request) so an anonymous signup attempt can check/record
// against these tables without ever being granted table-level access —
// same shape as this codebase's other SECURITY DEFINER helpers
// (is_firm_teammate, owns_shared_record, my_email).
//
// admin_list_accounts() reads auth.users directly (email, created_at) plus
// user_settings/firms for name/company — this requires SECURITY DEFINER
// (regular RLS-scoped queries can never see other users' auth.users rows),
// so it re-checks is_admin() internally and returns zero rows for anyone
// else, rather than trusting the caller.
const SQL = `
-- ─── Admin flag ───────────────────────────────────────────────────────────────
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE((SELECT is_admin FROM user_settings WHERE owner_id = auth.uid()), false);
$$;

-- ─── Approved emails ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approved_emails (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT        NOT NULL UNIQUE,
  added_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE approved_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approved_emails_admin_all ON approved_emails;
CREATE POLICY approved_emails_admin_all ON approved_emails
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE OR REPLACE FUNCTION is_email_approved(check_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM approved_emails WHERE email = lower(trim(check_email))
  );
$$;

GRANT EXECUTE ON FUNCTION is_email_approved(text) TO anon, authenticated;

-- ─── Access requests (captured when a non-approved email tries to sign up) ────
CREATE TABLE IF NOT EXISTS access_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT        NOT NULL UNIQUE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);

ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS access_requests_admin_all ON access_requests;
CREATE POLICY access_requests_admin_all ON access_requests
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE OR REPLACE FUNCTION record_access_request(requested_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO access_requests (email)
  VALUES (lower(trim(requested_email)))
  ON CONFLICT (email) DO UPDATE SET requested_at = now(), reviewed_at = NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION record_access_request(text) TO anon, authenticated;

-- ─── Admin account listing ──────────────────────────────────────────────────────
-- Read-only: email/signup-date/name/firm only, never business data
-- (properties/contacts/deals aren't touched here).
CREATE OR REPLACE FUNCTION admin_list_accounts()
RETURNS TABLE (
  user_id    uuid,
  email      text,
  created_at timestamptz,
  display_name text,
  company    text,
  firm_name  text
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
    f.name
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

  await client.query(
    `INSERT INTO user_settings (owner_id, is_admin)
     SELECT id, true FROM auth.users WHERE email = $1
     ON CONFLICT (owner_id) DO UPDATE SET is_admin = true`,
    [ADMIN_EMAIL],
  );

  const { rows } = await client.query(
    `SELECT u.email, us.is_admin FROM auth.users u
     JOIN user_settings us ON us.owner_id = u.id
     WHERE u.email = $1`,
    [ADMIN_EMAIL],
  );
  console.log("Admin seeded:", rows);

  const cols = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='approved_emails' ORDER BY ordinal_position",
  );
  console.log("approved_emails columns:", cols.rows.map((r: { column_name: string }) => r.column_name).join(", "));

  await client.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
