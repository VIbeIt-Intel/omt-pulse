import { db } from "./storage";
import { sql } from "drizzle-orm";

/** Idempotent billing column migrations. */
export async function migrateBillingRates() {
  const safe = async (label: string, stmt: ReturnType<typeof sql>) => {
    try {
      await db.execute(stmt);
    } catch (err) {
      console.warn(`[billing-migration] ${label}:`, err instanceof Error ? err.message : err);
    }
  };

  await safe("organizations.rate_access_controller", sql`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS rate_access_controller INTEGER
  `);
  await safe("organizations.rate_control_room", sql`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS rate_control_room INTEGER
  `);
  await safe("organizations.rate_patrol_user", sql`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS rate_patrol_user INTEGER
  `);
  await safe("organizations.company_registration_number", sql`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS company_registration_number TEXT
  `);
  await safe("organizations.vat_number", sql`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS vat_number TEXT
  `);
  await safe("organizations.primary_contact_first_name", sql`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS primary_contact_first_name TEXT
  `);
  await safe("organizations.primary_contact_last_name", sql`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS primary_contact_last_name TEXT
  `);
  await safe("organizations.primary_contact_email", sql`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS primary_contact_email TEXT
  `);
  await safe("organizations.primary_contact_phone", sql`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS primary_contact_phone TEXT
  `);
}
