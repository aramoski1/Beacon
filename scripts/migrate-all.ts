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
