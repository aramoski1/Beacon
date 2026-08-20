import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Fixes a real bug caught by tests/security/team-firm-isolation.test.ts:
 * the `authenticated` role has no SELECT privilege on auth.users outside a
 * SECURITY DEFINER context, so any RLS policy or SECURITY INVOKER function
 * that queries `(SELECT email FROM auth.users WHERE id = auth.uid())`
 * directly fails with "permission denied for table users" for every
 * caller, not just unauthorized ones — silently breaking the whole
 * predicate (Postgres raises the permission error rather than treating it
 * as "no match").
 *
 * This affected two places from Phase 0/5, both written before this was
 * caught:
 *   - firm_invitations_invitee_select (migrate-firms.ts) — every listing
 *     of firm_invitations by anyone, admin or not, silently errored
 *     instead of RLS-filtering, because Postgres has to evaluate every
 *     permissive policy's predicate as part of the combined OR, and one
 *     erroring predicate aborts the whole query even when a different
 *     policy would have legitimately granted or denied access cleanly.
 *   - redeem_firm_invitation() (migrate-firm-invitation-redemption.ts)
 *
 * Fix: a narrow, read-only my_email() SECURITY DEFINER function — exposes
 * only the CALLER's own email (auth.uid()-scoped, never anyone else's),
 * used in place of the direct auth.users subquery everywhere it's needed.
 * The surrounding functions/policies keep their original privilege model
 * (SECURITY INVOKER for redeem_firm_invitation's writes, plain RLS for
 * the policy) — only this one narrow lookup borrows elevated read access.
 */
const MIGRATION = `
CREATE OR REPLACE FUNCTION my_email()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
  SELECT email FROM auth.users WHERE id = auth.uid();
$fn$;

GRANT EXECUTE ON FUNCTION my_email() TO authenticated;

DROP POLICY IF EXISTS firm_invitations_invitee_select ON firm_invitations;
CREATE POLICY firm_invitations_invitee_select ON firm_invitations
  FOR SELECT USING (
    lower(email) = lower(my_email())
  );

DROP POLICY IF EXISTS firm_members_join_via_invitation ON firm_members;
CREATE POLICY firm_members_join_via_invitation ON firm_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM firm_invitations i
      WHERE i.firm_id = firm_members.firm_id
        AND lower(i.email) = lower(my_email())
        AND i.accepted_at IS NULL
        AND i.revoked_at IS NULL
        AND i.expires_at > now()
    )
  );

-- The invitee needs to mark their OWN invitation accepted, but they're not
-- yet (and after joining as 'member', still aren't) admin/owner of the
-- firm, so firm_invitations_admin_all doesn't cover them. A general UPDATE
-- grant to the invitee would let them tamper with role/firm_id on their
-- own pending row before redeem_firm_invitation() reads it — a privilege-
-- escalation path. Instead: a narrow SECURITY DEFINER function that only
-- ever sets accepted_at on an already-validated row, nothing else.
CREATE OR REPLACE FUNCTION mark_invitation_accepted(p_invitation_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  UPDATE firm_invitations SET accepted_at = now()
  WHERE id = p_invitation_id AND accepted_at IS NULL;
$fn$;

CREATE OR REPLACE FUNCTION redeem_firm_invitation(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_invitation firm_invitations%ROWTYPE;
  v_caller_email text;
BEGIN
  v_caller_email := my_email();

  SELECT * INTO v_invitation
  FROM firm_invitations
  WHERE token = p_token
    AND lower(email) = lower(v_caller_email)
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid, expired, or already-used invitation';
  END IF;

  UPDATE firm_members SET status = 'removed'
  WHERE user_id = auth.uid() AND status = 'active';

  INSERT INTO firm_members (firm_id, user_id, role, status, invited_by)
  VALUES (v_invitation.firm_id, auth.uid(), v_invitation.role, 'active', v_invitation.invited_by);

  PERFORM mark_invitation_accepted(v_invitation.id);

  RETURN v_invitation.firm_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION mark_invitation_accepted(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION redeem_firm_invitation(text) TO authenticated;
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nFixing auth.users email lookups (my_email() SECURITY DEFINER helper)...");
  await client.query(MIGRATION);
  console.log("Done.");

  const { rows } = await client.query(
    `SELECT proname FROM pg_proc WHERE proname IN ('my_email', 'mark_invitation_accepted') ORDER BY proname`
  );
  for (const r of rows) console.log(`✓ ${r.proname}() present`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
