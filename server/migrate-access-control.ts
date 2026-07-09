import { db } from "./storage";
import { sql } from "drizzle-orm";

/** Idempotent startup migration for Access Control Phase 1. */
export async function migrateAccessControl() {
  const safe = async (label: string, stmt: ReturnType<typeof sql>) => {
    try {
      await db.execute(stmt);
    } catch (err) {
      console.warn(`[access-control-migration] ${label}:`, err instanceof Error ? err.message : err);
    }
  };

  await safe("destinations.create", sql`
    CREATE TABLE IF NOT EXISTS destinations (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'building',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safe("destinations.org_idx", sql`
    CREATE INDEX IF NOT EXISTS destinations_org_idx ON destinations (organization_id)
  `);

  await safe("access_logs.create", sql`
    CREATE TABLE IF NOT EXISTS access_logs (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'inside',
      person_full_name TEXT NOT NULL,
      person_id_number TEXT,
      company_name TEXT,
      contact_number TEXT,
      purpose TEXT,
      person_photo_url TEXT,
      vehicle_photo_url TEXT,
      time_in TIMESTAMP NOT NULL DEFAULT NOW(),
      time_out TIMESTAMP,
      logged_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safe("access_logs.org_status_idx", sql`
    CREATE INDEX IF NOT EXISTS access_logs_org_status_idx ON access_logs (organization_id, status)
  `);
  await safe("access_logs.time_in_idx", sql`
    CREATE INDEX IF NOT EXISTS access_logs_time_in_idx ON access_logs (time_in DESC)
  `);
  await safe("access_logs.visit_group_id", sql`
    ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS visit_group_id VARCHAR
  `);
  await safe("access_logs.party_role", sql`
    ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS party_role TEXT
  `);
  await safe("access_logs.scan_data", sql`
    ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS scan_data JSONB
  `);
  await safe("access_logs.visit_group_idx", sql`
    CREATE INDEX IF NOT EXISTS access_logs_visit_group_idx ON access_logs (organization_id, visit_group_id)
  `);

  await safe("access_log_vehicles.create", sql`
    CREATE TABLE IF NOT EXISTS access_log_vehicles (
      id SERIAL PRIMARY KEY,
      access_log_id INTEGER NOT NULL REFERENCES access_logs(id) ON DELETE CASCADE,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      registration TEXT,
      make TEXT,
      model TEXT,
      colour TEXT,
      licence_disc_data TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safe("access_log_vehicles.log_idx", sql`
    CREATE INDEX IF NOT EXISTS access_log_vehicles_log_idx ON access_log_vehicles (access_log_id)
  `);
}
