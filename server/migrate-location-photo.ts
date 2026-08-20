import { db } from "./storage";
import { sql } from "drizzle-orm";

/** Optional site photo on predefined locations. */
export async function migrateLocationPhoto() {
  try {
    await db.execute(sql`
      ALTER TABLE locations ADD COLUMN IF NOT EXISTS photo_url TEXT
    `);
  } catch (err) {
    console.warn(
      "[location-photo-migration] locations.photo_url:",
      err instanceof Error ? err.message : err,
    );
  }
}
