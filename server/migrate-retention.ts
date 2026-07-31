import { db } from "./storage";
import { sql } from "drizzle-orm";

/** Idempotent POPIA retention column migrations on organizations. */
export async function migrateRetention() {
  const safe = async (label: string, stmt: ReturnType<typeof sql>) => {
    try {
      await db.execute(stmt);
    } catch (err) {
      console.warn(`[retention-migration] ${label}:`, err instanceof Error ? err.message : err);
    }
  };

  await safe("organizations.retention_access_logs_days", sql`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_access_logs_days INTEGER
  `);
  await safe("organizations.retention_patrol_track_days", sql`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_patrol_track_days INTEGER
  `);
  await safe("organizations.retention_patrol_checkpoint_days", sql`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_patrol_checkpoint_days INTEGER
  `);
  await safe("organizations.retention_tracker_positions_days", sql`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_tracker_positions_days INTEGER
  `);
  await safe("organizations.retention_cctv_ai_events_days", sql`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_cctv_ai_events_days INTEGER
  `);
}
