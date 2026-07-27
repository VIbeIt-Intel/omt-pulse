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
}
