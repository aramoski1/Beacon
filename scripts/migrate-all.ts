// Runs every migration script in dependency order.
// Each script is idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS),
// so re-running is always safe.
//
// Usage:  npm run migrate
// Requires: DATABASE_URL in .env.local

import { spawnSync } from "child_process";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const SCRIPTS: { file: string; description: string }[] = [
  {
    file: "migrate.ts",
    description: "Base tables — properties, contacts, lease_abstracts + RLS",
  },
  {
    file: "migrate-contacts.ts",
    description: "Contacts — size_category, geographic_category, ownership_type columns",
  },
  {
    file: "migrate-custom-fields.ts",
    description: "Custom fields — field_definitions table + custom_fields JSONB on all entities",
  },
  {
    file: "setup-storage.ts",
    description: "Storage — leases bucket + RLS policies",
  },
  {
    file: "migrate-ingestion-errors.ts",
    description: "Ingestion errors — error log table + RLS",
  },
  {
    file: "migrate-new-fields.ts",
    description: "New fields — prospect_number, land_sqft, asset_description on properties; mailing_address on contacts",
  },
  {
    file: "migrate-owner-mailing.ts",
    description: "Properties — owner_mailing_address column (from MDPA owner record)",
  },
  {
    file: "migrate-activities.ts",
    description: "Activities — activities table with RLS (contact + property touch-point log)",
  },
  {
    file: "migrate-activities-nullable-contact.ts",
    description: "Activities — make contact_id nullable; add CHECK (contact_id OR property_id NOT NULL)",
  },
  {
    file: "migrate-contact-type.ts",
    description: "Contacts — contact_type column (owner / tenant / other)",
  },
  {
    file: "migrate-follow-ups.ts",
    description: "Follow-ups — follow_ups table with RLS (tasks/reminders with due dates)",
  },
  {
    file: "migrate-owner-contact-fields.ts",
    description: "Properties — owner_contact_name and owner_contact_address (Sunbiz on property row)",
  },
  {
    file: "migrate-owner-contacts-jsonb.ts",
    description: "Properties — owner_contacts JSONB array (multiple Sunbiz persons per property)",
  },
  {
    file: "migrate-activities-update-policy.ts",
    description: "Activities — add owner UPDATE RLS policy for CRM inline editing",
  },
  {
    file: "migrate-property-activity-fields.ts",
    description: "Properties — owner_email, last_activity_date/type/notes for CRM inline editing",
  },
  {
    file: "migrate-smart-lists.ts",
    description: "Smart lists — saved NL search segments with live filters JSONB",
  },
  {
    file: "migrate-smart-lists-entity-type.ts",
    description: "Smart lists — entity_type column (properties / contacts / leases)",
  },
  {
    file: "migrate-lease-tenant.ts",
    description: "Lease abstracts — tenant_contact_id FK to contacts (CRM tenant link)",
  },
  {
    file: "migrate-followup-source.ts",
    description: "Follow-ups — source_type, lease_id, lease_bucket columns + dedup index",
  },
  {
    file: "migrate-ownership-change.ts",
    description: "Properties — ownership_change_detected_at and ownership_change_data columns",
  },
  {
    file: "migrate-cre-contact-fields.ts",
    description: "Contacts — CRE-owner fields: title_role, phone_mobile/office, ownership_role, asset_focus, submarket, portfolio_size, relationship_stage, lead_source, notes",
  },
  {
    file: "migrate-user-settings.ts",
    description: "User settings — user_settings table with per-user brokerage profile, outreach prefs, cadence overrides, and CoStar toggle",
  },
  {
    file: "migrate-field-definitions-update-policy.ts",
    description: "Field definitions — add missing UPDATE RLS policy so editing custom field names works",
  },
  {
    file: "migrate-lease-reviews.ts",
    description: "Lease abstracts — field_reviews JSONB for per-field accept/reject/correct with corrections",
  },
  {
    file: "migrate-deals.ts",
    description: "Deals — pursuit pipeline table with stage, contact/property links, commission, RLS",
  },
  {
    file: "migrate-error-logs.ts",
    description: "Error logs — structured runtime error log table with RLS (server action failures)",
  },
  {
    file: "migrate-onboarding.ts",
    description: "User settings — onboarding_completed_at timestamptz column (first-run flow tracking)",
  },
  {
    file: "migrate-email-provider.ts",
    description: "User settings — email_provider text column (gmail / outlook / outlook365 / mailto override)",
  },
  {
    file: "migrate-entities.ts",
    description: "Entities — durable legal entities + entity_properties/entity_contacts + properties.entity_id backfill",
  },
  {
    file: "migrate-contact-properties.ts",
    description: "Contact↔property join table replacing soft linked_properties UUID[] (with backfill)",
  },
  {
    file: "migrate-deal-type.ts",
    description: "Deals — deal_type column (tenant_rep / listing / investment_sale)",
  },
  {
    file: "migrate-ownership-watch.ts",
    description: "Properties — ownership_watch_enrolled_at + ownership_last_checked_at for watch list",
  },
  {
    file: "migrate-field-sources.ts",
    description: "Properties — field_sources JSONB for per-field provenance (county/sunbiz/document/url/pasted)",
  },
  {
    file: "migrate-activities-property-cascade.ts",
    description: "Activities — property_id FK ON DELETE SET NULL -> CASCADE (fixes activities_contact_or_property violation on property delete)",
  },
  {
    file: "migrate-storage-leases-delete-policy.ts",
    description: "Storage — add owner-scoped DELETE/UPDATE RLS policies on the leases bucket so account deletion actually purges uploaded PDFs",
  },
  {
    file: "migrate-auth-pilot-autoconfirm.ts",
    description:
      "Auth pilot — auto-confirm email on signup (skip unreliable Supabase mailer) + confirm existing unconfirmed users",
  },
  {
    file: "migrate-documents.ts",
    description:
      "Documents — generic media/document attachments table (property/lease/contact) + 'documents' storage bucket with RLS",
  },
  {
    file: "migrate-documents-deal-entity.ts",
    description: "Documents — widen entity_type CHECK to allow attachments on deals",
  },
  {
    file: "migrate-custom-fields-deal-entity.ts",
    description: "Custom fields — widen field_definitions entity_type CHECK to allow deals; add custom_fields JSONB to deals",
  },
  {
    file: "migrate-deal-activity-links.ts",
    description: "Deals — deal_id FK on activities/follow_ups (replaces description-prefix soft link), with backfill",
  },
  {
    file: "migrate-deal-stages-expand.ts",
    description: "Deals — widen stage CHECK with LOI/lease/PSA milestones; add expected_close_date column",
  },
  {
    file: "migrate-firms.ts",
    description:
      "Team multi-tenancy Phase 0 — firms/firm_members/firm_invitations tables + RLS + is_firm_teammate(); backfills a personal firm per existing user",
  },
  {
    file: "migrate-firms-visibility.ts",
    description:
      "Team multi-tenancy Phase 1 — adds visibility ('private'|'team', default 'private') to properties/contacts/lease_abstracts/deals/activities/follow_ups/documents. No RLS change yet.",
  },
  {
    file: "migrate-firms-fix-recursion.ts",
    description:
      "Fixes infinite recursion in firm_members' self-referencing RLS (caught by tests/security/team-firm-isolation.test.ts) via my_active_firm_id()/my_role_in_firm() SECURITY DEFINER functions; adds ON DELETE CASCADE to firms.created_by",
  },
  {
    file: "migrate-activities-team-visibility.ts",
    description: "Team multi-tenancy Phase 2, table 1/7 — activities SELECT/UPDATE/DELETE gain the is_firm_teammate() OR-clause",
  },
  {
    file: "migrate-documents-team-visibility.ts",
    description: "Team multi-tenancy Phase 2, table 2/7 — documents SELECT/UPDATE/DELETE gain the is_firm_teammate() OR-clause (table only; bucket RLS is Phase 3)",
  },
  {
    file: "migrate-follow-ups-team-visibility.ts",
    description: "Team multi-tenancy Phase 2, table 3/7 — follow_ups SELECT/UPDATE/DELETE gain the is_firm_teammate() OR-clause",
  },
  {
    file: "migrate-lease-abstracts-team-visibility.ts",
    description: "Team multi-tenancy Phase 2, table 4/7 — lease_abstracts SELECT/UPDATE/DELETE gain the is_firm_teammate() OR-clause",
  },
  {
    file: "migrate-deals-team-visibility.ts",
    description: "Team multi-tenancy Phase 2, table 5/7 — deals SELECT/UPDATE/DELETE gain the is_firm_teammate() OR-clause",
  },
  {
    file: "migrate-contacts-team-visibility.ts",
    description: "Team multi-tenancy Phase 2, table 6/7 — contacts SELECT/UPDATE/DELETE gain the is_firm_teammate() OR-clause",
  },
  {
    file: "migrate-properties-team-visibility.ts",
    description: "Team multi-tenancy Phase 2, table 7/7 (last) — properties SELECT/UPDATE/DELETE gain the is_firm_teammate() OR-clause",
  },
  {
    file: "migrate-field-definitions-team-visibility.ts",
    description: "Team multi-tenancy — field_definitions goes firm-wide by default (resolved decision #5): SELECT/UPDATE/DELETE gain an unconditional is_firm_teammate() OR-clause, no visibility column",
  },
  {
    file: "migrate-documents-bucket-team-visibility.ts",
    description: "Team multi-tenancy Phase 3 — documents storage bucket SELECT/UPDATE/DELETE gain a join-based (storage.objects.name = documents.storage_path) team-visibility OR-clause",
  },
  {
    file: "migrate-firm-teammate-names.ts",
    description: "Team multi-tenancy Phase 4 supporting piece — firm_teammate_names() RPC, a narrow SECURITY DEFINER function exposing only {user_id, display_name} for the caller's active firm's teammates (Workspace ownership indicator)",
  },
  {
    file: "migrate-firm-invitation-redemption.ts",
    description: "Team multi-tenancy Phase 5 — firm_members_join_via_invitation INSERT policy + redeem_firm_invitation() RPC (superseded in part by the next two migrations, kept for history)",
  },
  {
    file: "migrate-firm-email-lookup-fix.ts",
    description: "Fixes 'permission denied for table users' in firm_invitations_invitee_select and redeem_firm_invitation() via a narrow my_email() SECURITY DEFINER helper; adds mark_invitation_accepted() so an invitee (not yet admin/owner) can mark their own invite accepted without a general UPDATE grant that could let them tamper with role/firm_id",
  },
  {
    file: "migrate-firm-invited-by-cascade.ts",
    description: "Fixes firm_members.invited_by / firm_invitations.invited_by to ON DELETE SET NULL — deleting a user who had ever invited a teammate previously failed with a foreign-key violation, which would have hit the real account-deletion flow",
  },
  {
    file: "migrate-firms-created-by-set-null.ts",
    description: "Fixes firms.created_by from ON DELETE CASCADE to ON DELETE SET NULL — CASCADE meant deleting a firm's owner deleted the whole firm, kicking out every other member; the firms row now survives its creator's account being deleted",
  },
  {
    file: "migrate-record-shares.ts",
    description: "Per-teammate sharing Phase 1 (Beacon_Per_User_Sharing_Plan.md) — record_shares table + RLS, is_record_shared_with_me()/owns_shared_record(); adds a SELECT-only shared-with-me OR-clause to properties/contacts/deals (read-only, not co-editable — UPDATE/DELETE untouched)",
  },
  {
    file: "migrate-zoning-fields.ts",
    description: "Properties — zoning_code/zoning_far/zoning_source/zoning_checked_at columns, persisting a broker-run zoning lookup (lib/zoning.ts) so the dashboard's zoning-opportunity signal doesn't re-query external GIS on every load",
  },
  {
    file: "migrate-zoning-data-json.ts",
    description: "Properties — zoning_data JSONB (full ZoningInfo) + zoning_geocoded boolean, so the property page shows the complete last zoning result (district name, FAR/height/density, geocoded caveat) on load, not just code+FAR",
  },
  {
    file: "migrate-dashboard-layout.ts",
    description: "User settings — nullable dashboard_layout JSONB for dashboard show/hide customization (lib/dashboard-layout.ts); null/missing keys resolve to visible, so existing accounts render identically to today's fixed layout",
  },
  {
    file: "migrate-lead-buy-boxes.ts",
    description: "lead_buy_boxes table — saved lead-finder criteria presets (lib/lead-finder.ts), owner-scoped RLS",
  },
  {
    file: "migrate-invite-only.ts",
    description: "Invite-only signup — approved_emails/access_requests tables (admin-only RLS via is_admin()), is_email_approved()/record_access_request() SECURITY DEFINER helpers for the pre-auth signup check, admin_list_accounts() for the admin accounts view, user_settings.is_admin flag seeded for the admin account",
  },
  {
    file: "migrate-admin-account-management.ts",
    description:
      "Admin — access_revoked_at/revoked_by/last_active_at on user_settings (trigger-guarded so only is_admin() can change the revoke columns), admin_set_account_revoked() RPC, activity_log table (write-your-own-row RLS, admin-only SELECT), admin_list_accounts() extended with the new columns",
  },
  {
    file: "migrate-pilot-agreement.ts",
    description:
      "User settings — nullable pilot_agreement_accepted_at; signup checkbox + /pilot-agreement gate for existing users",
  },
  {
    file: "migrate-industrial-cre.ts",
    description: "Industrial listing fields on properties, 1031/buyer criteria on contacts, rent_comps table",
  },
  {
    file: "migrate-jobs-tours-cache.ts",
    description: "background_jobs, dashboard_kpi_cache, tours",
  },
  {
    file: "migrate-oauth-connections.ts",
    description: "oauth_connections flags for Gmail/Outlook/calendar/DocuSign (no tokens until env configured)",
  },
  {
    file: "migrate-industrial-field-defs.ts",
    description: "Industrial specs as customizable field_definitions (field_group) + seed-once flag on user_settings",
  },
  {
    file: "migrate-broker-books.ts",
    description: "Lease leased_sf + landlord_name; user_settings weekly list pin",
  },
];

const hr = "─".repeat(60);

console.log(`\nBeacon — running ${SCRIPTS.length} migrations\n`);

for (let i = 0; i < SCRIPTS.length; i++) {
  const { file, description } = SCRIPTS[i];

  console.log(hr);
  console.log(`[${i + 1}/${SCRIPTS.length}] ${file}`);
  console.log(`        ${description}`);
  console.log(hr);

  const result = spawnSync("tsx", [join(__dirname, file)], {
    stdio: "inherit",
    env: process.env,
    shell: true,
  });

  if (result.error) {
    console.error(`\nFailed to spawn: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\n✗ ${file} exited with code ${result.status}. Stopping.`);
    process.exit(result.status ?? 1);
  }

  console.log(`\n✓ Done\n`);
}

console.log(hr);
console.log(`✓ All ${SCRIPTS.length} migrations complete.`);
console.log(hr + "\n");
