import { db } from "../storage";
import { sql } from "drizzle-orm";

/** Idempotent startup migration for CCTV cameras (Phase 1). */
export async function migrateCctv() {
  const safe = async (label: string, stmt: ReturnType<typeof sql>) => {
    try {
      await db.execute(stmt);
    } catch (err) {
      console.warn(`[cctv-migration] ${label}:`, err instanceof Error ? err.message : err);
    }
  };

  await safe("cctv_cameras.create", sql`
    CREATE TABLE IF NOT EXISTS cctv_cameras (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      rtsp_url TEXT NOT NULL,
      username TEXT,
      stream_rotation TEXT NOT NULL DEFAULT 'normal',
      is_ptz BOOLEAN NOT NULL DEFAULT FALSE,
      vehicle_roi_json TEXT,
      password_enc TEXT,
      created_by_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safe("cctv_cameras.stream_rotation", sql`
    ALTER TABLE cctv_cameras
    ADD COLUMN IF NOT EXISTS stream_rotation TEXT NOT NULL DEFAULT 'normal'
  `);
  await safe("cctv_cameras.stream_quality", sql`
    ALTER TABLE cctv_cameras
    ADD COLUMN IF NOT EXISTS stream_quality TEXT NOT NULL DEFAULT 'medium'
  `);
  await safe("cctv_cameras.ai_enabled", sql`
    ALTER TABLE cctv_cameras
    ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await safe("cctv_cameras.vehicle_roi_json", sql`
    ALTER TABLE cctv_cameras
    ADD COLUMN IF NOT EXISTS vehicle_roi_json TEXT
  `);
  await safe("cctv_cameras.is_ptz", sql`
    ALTER TABLE cctv_cameras
    ADD COLUMN IF NOT EXISTS is_ptz BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await safe("cctv_cameras.ptz_control_port", sql`
    ALTER TABLE cctv_cameras
    ADD COLUMN IF NOT EXISTS ptz_control_port INTEGER DEFAULT 8555
  `);
  await safe("cctv_cameras.ptz_camera_http_port", sql`
    ALTER TABLE cctv_cameras
    ADD COLUMN IF NOT EXISTS ptz_camera_http_port INTEGER DEFAULT 80
  `);
  await safe("cctv_cameras.ptz_channel", sql`
    ALTER TABLE cctv_cameras
    ADD COLUMN IF NOT EXISTS ptz_channel INTEGER DEFAULT 1
  `);
  await safe("cctv_cameras.org_idx", sql`
    CREATE INDEX IF NOT EXISTS cctv_cameras_org_idx ON cctv_cameras (organization_id, name)
  `);
  await safe("cctv_ai_events.create", sql`
    CREATE TABLE IF NOT EXISTS cctv_ai_events (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      camera_id INTEGER NOT NULL REFERENCES cctv_cameras(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      confidence TEXT NOT NULL,
      bbox_json TEXT,
      snapshot_path TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safe("cctv_ai_events.snapshot_path", sql`
    ALTER TABLE cctv_ai_events
    ADD COLUMN IF NOT EXISTS snapshot_path TEXT
  `);
  await safe("cctv_ai_events.camera_idx", sql`
    CREATE INDEX IF NOT EXISTS cctv_ai_events_camera_idx
    ON cctv_ai_events (camera_id, created_at DESC)
  `);
  await safe("cctv_ai_events.org_idx", sql`
    CREATE INDEX IF NOT EXISTS cctv_ai_events_org_idx
    ON cctv_ai_events (organization_id, created_at DESC)
  `);
}
