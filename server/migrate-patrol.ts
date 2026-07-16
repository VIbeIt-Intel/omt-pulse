import { db } from "./storage";
import { sql } from "drizzle-orm";

/** Idempotent startup migration for Patrolling MVP tables. */
export async function migratePatrol() {
  const safe = async (label: string, stmt: ReturnType<typeof sql>) => {
    try {
      await db.execute(stmt);
    } catch (err) {
      console.warn(`[patrol-migration] ${label}:`, err instanceof Error ? err.message : err);
    }
  };

  await safe("patrol_routes.create", sql`
    CREATE TABLE IF NOT EXISTS patrol_routes (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      command_id INTEGER REFERENCES commands(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_by_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT patrol_routes_org_name_unique UNIQUE (organization_id, name)
    )
  `);
  await safe("patrol_routes.org_active_idx", sql`
    CREATE INDEX IF NOT EXISTS patrol_routes_org_active_idx ON patrol_routes (organization_id, is_active)
  `);
  await safe("patrol_routes.command_idx", sql`
    CREATE INDEX IF NOT EXISTS patrol_routes_command_idx ON patrol_routes (command_id)
      WHERE command_id IS NOT NULL
  `);

  await safe("patrol_checkpoints.create", sql`
    CREATE TABLE IF NOT EXISTS patrol_checkpoints (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      route_id INTEGER NOT NULL REFERENCES patrol_routes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      instructions TEXT,
      photo_required BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT patrol_checkpoints_route_order_unique UNIQUE (route_id, order_index)
    )
  `);
  await safe("patrol_checkpoints.route_idx", sql`
    CREATE INDEX IF NOT EXISTS patrol_checkpoints_route_idx ON patrol_checkpoints (route_id, order_index)
  `);

  await safe("patrols.create", sql`
    CREATE TABLE IF NOT EXISTS patrols (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      route_id INTEGER NOT NULL REFERENCES patrol_routes(id) ON DELETE RESTRICT,
      started_by_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'in_progress',
      total_checkpoints INTEGER NOT NULL,
      completed_checkpoints INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safe("patrols.org_status_started_idx", sql`
    CREATE INDEX IF NOT EXISTS patrols_org_status_started_idx
      ON patrols (organization_id, status, started_at DESC)
  `);
  await safe("patrols.route_idx", sql`
    CREATE INDEX IF NOT EXISTS patrols_route_idx ON patrols (route_id)
  `);
  await safe("patrols.started_by_idx", sql`
    CREATE INDEX IF NOT EXISTS patrols_started_by_idx ON patrols (started_by_user_id, started_at DESC)
  `);
  await safe("patrols.in_progress_guard_idx", sql`
    CREATE INDEX IF NOT EXISTS patrols_in_progress_guard_idx
      ON patrols (organization_id, started_by_user_id)
      WHERE status = 'in_progress'
  `);

  await safe("patrol_checkpoint_logs.create", sql`
    CREATE TABLE IF NOT EXISTS patrol_checkpoint_logs (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patrol_id INTEGER NOT NULL REFERENCES patrols(id) ON DELETE CASCADE,
      checkpoint_id INTEGER NOT NULL REFERENCES patrol_checkpoints(id) ON DELETE RESTRICT,
      clocked_at TIMESTAMP NOT NULL DEFAULT NOW(),
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      photo_url TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT patrol_checkpoint_logs_patrol_checkpoint_unique UNIQUE (patrol_id, checkpoint_id)
    )
  `);
  await safe("patrol_checkpoint_logs.patrol_idx", sql`
    CREATE INDEX IF NOT EXISTS patrol_checkpoint_logs_patrol_idx
      ON patrol_checkpoint_logs (patrol_id, clocked_at)
  `);
  await safe("patrol_checkpoint_logs.org_clocked_idx", sql`
    CREATE INDEX IF NOT EXISTS patrol_checkpoint_logs_org_clocked_idx
      ON patrol_checkpoint_logs (organization_id, clocked_at DESC)
  `);

  await safe("patrol_route_schedules.create", sql`
    CREATE TABLE IF NOT EXISTS patrol_route_schedules (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      route_id INTEGER NOT NULL REFERENCES patrol_routes(id) ON DELETE CASCADE,
      is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      interval_minutes INTEGER NOT NULL DEFAULT 60,
      jitter_minutes INTEGER NOT NULL DEFAULT 12,
      start_within_minutes INTEGER NOT NULL DEFAULT 15,
      quiet_start_hour INTEGER,
      quiet_end_hour INTEGER,
      next_due_at TIMESTAMP NOT NULL,
      last_dispatched_at TIMESTAMP,
      created_by_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT patrol_route_schedules_route_unique UNIQUE (route_id)
    )
  `);
  await safe("patrol_route_schedules.due_idx", sql`
    CREATE INDEX IF NOT EXISTS patrol_route_schedules_due_idx
      ON patrol_route_schedules (is_enabled, next_due_at)
  `);

  await safe("patrol_schedule_assignees.create", sql`
    CREATE TABLE IF NOT EXISTS patrol_schedule_assignees (
      schedule_id INTEGER NOT NULL REFERENCES patrol_route_schedules(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      CONSTRAINT patrol_schedule_assignees_pk UNIQUE (schedule_id, user_id)
    )
  `);
  await safe("patrol_schedule_assignees.user_idx", sql`
    CREATE INDEX IF NOT EXISTS patrol_schedule_assignees_user_idx
      ON patrol_schedule_assignees (user_id)
  `);

  await safe("patrol_schedule_dispatches.create", sql`
    CREATE TABLE IF NOT EXISTS patrol_schedule_dispatches (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      schedule_id INTEGER NOT NULL REFERENCES patrol_route_schedules(id) ON DELETE CASCADE,
      route_id INTEGER NOT NULL REFERENCES patrol_routes(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      pushed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      start_by_at TIMESTAMP NOT NULL,
      patrol_id INTEGER REFERENCES patrols(id) ON DELETE SET NULL,
      overdue_notified_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safe("patrol_schedule_dispatches.pending_idx", sql`
    CREATE INDEX IF NOT EXISTS patrol_schedule_dispatches_pending_idx
      ON patrol_schedule_dispatches (status, start_by_at)
  `);
  await safe("patrol_schedule_dispatches.user_pending_idx", sql`
    CREATE INDEX IF NOT EXISTS patrol_schedule_dispatches_user_pending_idx
      ON patrol_schedule_dispatches (user_id, status, route_id)
  `);
}
