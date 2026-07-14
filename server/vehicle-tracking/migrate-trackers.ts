import { db } from "../storage";
import { sql } from "drizzle-orm";

/**
 * Idempotent startup migration for vehicle tracker tables.
 */
export async function migrateTrackers(): Promise<void> {
  const safe = async (label: string, stmt: ReturnType<typeof sql>) => {
    try {
      await db.execute(stmt);
    } catch (err) {
      console.warn(`[tracker-migration] ${label}:`, err instanceof Error ? err.message : err);
    }
  };

  await safe("tracker_devices.create", sql`
    CREATE TABLE IF NOT EXISTS tracker_devices (
      id SERIAL PRIMARY KEY,
      imei VARCHAR(20) NOT NULL UNIQUE,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      command_id INTEGER REFERENCES commands(id) ON DELETE SET NULL,
      protocol VARCHAR(32) NOT NULL DEFAULT 'gt06',
      label TEXT,
      last_lat DOUBLE PRECISION,
      last_lng DOUBLE PRECISION,
      last_speed_kph DOUBLE PRECISION,
      last_heading DOUBLE PRECISION,
      last_ignition_on BOOLEAN,
      last_mileage_km DOUBLE PRECISION,
      last_gps_valid BOOLEAN,
      last_position_at TIMESTAMP,
      last_seen_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await safe("tracker_positions.create", sql`
    CREATE TABLE IF NOT EXISTS tracker_positions (
      id SERIAL PRIMARY KEY,
      device_id INTEGER NOT NULL REFERENCES tracker_devices(id) ON DELETE CASCADE,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      speed_kph DOUBLE PRECISION,
      heading DOUBLE PRECISION,
      ignition_on BOOLEAN,
      mileage_km DOUBLE PRECISION,
      gps_valid BOOLEAN NOT NULL DEFAULT TRUE,
      packet_type VARCHAR(16),
      recorded_at TIMESTAMP NOT NULL,
      received_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await safe("tracker_positions.device_idx", sql`
    CREATE INDEX IF NOT EXISTS tracker_positions_device_idx ON tracker_positions (device_id, recorded_at DESC)
  `);

  await safe("tracker_devices.command_idx", sql`
    CREATE INDEX IF NOT EXISTS tracker_devices_command_idx ON tracker_devices (command_id)
  `);
}
