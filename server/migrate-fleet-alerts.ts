import { db } from "./storage";
import { sql } from "drizzle-orm";

/** Idempotent startup migration for fleet alert tables. */
export async function migrateFleetAlerts(): Promise<void> {
  const safe = async (label: string, stmt: ReturnType<typeof sql>) => {
    try {
      await db.execute(stmt);
    } catch (err) {
      console.warn(`[fleet-alerts-migration] ${label}:`, err instanceof Error ? err.message : err);
    }
  };

  await safe("fleet_alert_defaults.create", sql`
    CREATE TABLE IF NOT EXISTS fleet_alert_defaults (
      organization_id VARCHAR PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      speed_limit_kph DOUBLE PRECISION NOT NULL DEFAULT 120,
      idle_minutes INTEGER NOT NULL DEFAULT 30,
      offline_minutes INTEGER NOT NULL DEFAULT 30,
      geofence_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      geofence_lat DOUBLE PRECISION,
      geofence_lng DOUBLE PRECISION,
      geofence_radius_m DOUBLE PRECISION DEFAULT 2000,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await safe("fleet_device_alert_rules.create", sql`
    CREATE TABLE IF NOT EXISTS fleet_device_alert_rules (
      device_id INTEGER PRIMARY KEY REFERENCES tracker_devices(id) ON DELETE CASCADE,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      speed_limit_kph DOUBLE PRECISION,
      idle_minutes INTEGER,
      offline_minutes INTEGER,
      geofence_enabled BOOLEAN,
      geofence_lat DOUBLE PRECISION,
      geofence_lng DOUBLE PRECISION,
      geofence_radius_m DOUBLE PRECISION,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await safe("fleet_alerts.create", sql`
    CREATE TABLE IF NOT EXISTS fleet_alerts (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      device_id INTEGER NOT NULL REFERENCES tracker_devices(id) ON DELETE CASCADE,
      alert_type VARCHAR(32) NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      speed_kph DOUBLE PRECISION,
      triggered_at TIMESTAMP NOT NULL DEFAULT NOW(),
      push_sent BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  await safe("fleet_alerts.device_idx", sql`
    CREATE INDEX IF NOT EXISTS fleet_alerts_device_idx ON fleet_alerts (device_id, triggered_at DESC)
  `);
  await safe("fleet_alerts.org_idx", sql`
    CREATE INDEX IF NOT EXISTS fleet_alerts_org_idx ON fleet_alerts (organization_id, triggered_at DESC)
  `);
}
