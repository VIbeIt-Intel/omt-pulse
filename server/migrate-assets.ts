import { db } from "./storage";
import { sql } from "drizzle-orm";

/** Idempotent startup migration for the company asset register. */
export async function migrateAssets(): Promise<void> {
  const safe = async (label: string, stmt: ReturnType<typeof sql>) => {
    try {
      await db.execute(stmt);
    } catch (err) {
      console.warn(`[assets-migration] ${label}:`, err instanceof Error ? err.message : err);
    }
  };

  await safe("company_assets.create", sql`
    CREATE TABLE IF NOT EXISTS company_assets (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      command_id INTEGER REFERENCES commands(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      asset_type TEXT NOT NULL DEFAULT 'tablet',
      asset_tag TEXT,
      notes TEXT,
      assigned_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      last_lat DOUBLE PRECISION,
      last_lng DOUBLE PRECISION,
      last_battery_percent INTEGER,
      last_seen_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await safe("company_assets.org_idx", sql`
    CREATE INDEX IF NOT EXISTS company_assets_org_idx ON company_assets (organization_id, created_at DESC)
  `);
  await safe("company_assets.command_idx", sql`
    CREATE INDEX IF NOT EXISTS company_assets_command_idx ON company_assets (command_id)
  `);
}
