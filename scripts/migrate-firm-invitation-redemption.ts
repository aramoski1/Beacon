import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Team multi-tenancy Phase 5 — invitation redemption. Per
 * Beacon_Team_Multitenancy_Plan.md §6, this is arguably the second-most
 * safety-critical RLS in the whole plan (after the teammate-visibility
 * OR-clause): a bug here lets a stranger add themselves to any firm.
 *
 * Two pieces:
 * 1. A new firm_members INSERT policy — an invited (not-yet-member) user
 *    can insert their OWN row into a firm iff a real, unexpired,
 *    unrevoked, unaccepted invitation exists matching their authenticated
 *    email. This is a real RLS grant, not a privileged bypass — no
 *    service-role key involved anywhere in this feature.
 * 2. redeem_firm_invitation(token) — SECURITY INVOKER (deliberately, in
 *    contrast to is_firm_teammate()'s SECURITY DEFINER — this function
 *    does real writes, not a read-only lookup, so it must run under the
 *    caller's own RLS-checked privileges throughout, not bypass them).
 *    Wraps the three-step accept flow (leave any current firm, join the
 *    new one, mark the invitation accepted) in one transaction — true
 *    atomicity, still fully RLS-bounded at every step.
 */
const MIGRATION = `
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'firm_members' AND policyname = 'firm_members_join_via_invitation'
  ) THEN
    CREATE POLICY firm_members_join_via_invitation ON firm_members
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
  END IF;
END $$;

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
  SELECT email INTO v_caller_email FROM auth.users WHERE id = auth.uid();

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

  UPDATE firm_invitations SET accepted_at = now() WHERE id = v_invitation.id;

  RETURN v_invitation.firm_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION redeem_firm_invitation(text) TO authenticated;
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nCreating invitation-redemption RLS + redeem_firm_invitation()...");
  await client.query(MIGRATION);
  console.log("Done.");

  const { rows: policyRows } = await client.query(
    `SELECT policyname FROM pg_policies WHERE tablename = 'firm_members' AND policyname = 'firm_members_join_via_invitation'`
  );
  console.log(`✓ firm_members_join_via_invitation ${policyRows.length > 0 ? "present" : "MISSING"}`);

  const { rows: fnRows } = await client.query(`SELECT proname FROM pg_proc WHERE proname = 'redeem_firm_invitation'`);
  console.log(`✓ redeem_firm_invitation() ${fnRows.length > 0 ? "present" : "MISSING"}`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
