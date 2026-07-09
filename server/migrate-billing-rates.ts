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
}
