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
