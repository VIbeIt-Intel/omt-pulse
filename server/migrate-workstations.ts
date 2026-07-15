import { db } from "./storage";
import { sql } from "drizzle-orm";

/** Idempotent startup migration for dedicated workstations / field devices. */
export async function migrateWorkstations() {
  const safe = async (label: string, stmt: ReturnType<typeof sql>) => {
    try {
      await db.execute(stmt);
    } catch (err) {
      console.warn(`[workstations-migration] ${label}:`, err instanceof Error ? err.message : err);
    }
  };

  await safe("users.shift_pin_hash", sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS shift_pin_hash TEXT
  `);

  await safe("destinations.location_id", sql`
    ALTER TABLE destinations ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL
  `);

  await safe("workstations.create", sql`
    CREATE TABLE IF NOT EXISTS workstations (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'gate_desk',
      location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
      command_id INTEGER REFERENCES commands(id) ON DELETE SET NULL,
      device_token TEXT UNIQUE,
      enrolment_code TEXT,
      enrolment_expires_at TIMESTAMP,
      enrolled_at TIMESTAMP,
      last_seen_at TIMESTAMP,
      last_lat DOUBLE PRECISION,
      last_lng DOUBLE PRECISION,
      kiosk_mode BOOLEAN NOT NULL DEFAULT TRUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      current_operator_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      operator_session_started_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safe("workstations.org_idx", sql`
    CREATE INDEX IF NOT EXISTS workstations_org_idx ON workstations (organization_id)
  `);
  await safe("workstations.enrolment_code_idx", sql`
    CREATE INDEX IF NOT EXISTS workstations_enrolment_code_idx ON workstations (enrolment_code)
  `);

  await safe("access_logs.workstation_id", sql`
    ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS workstation_id INTEGER REFERENCES workstations(id) ON DELETE SET NULL
  `);

  await safe("workstations.position_user_id", sql`
    ALTER TABLE workstations ADD COLUMN IF NOT EXISTS position_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL
  `);
}
