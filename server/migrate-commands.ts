import { db } from "./storage";
import { sql } from "drizzle-orm";

/**
 * Idempotent startup migration for the Commands feature.
 *  - Adds columns/tables if missing (additive only)
 *  - For every org without a Central Command, creates one and backfills
 *    command_id on existing incidents / categories / locations / form_fields.
 *  - Promotes the first administrator of every org to superadmin if that
 *    org has no superadmin yet.
 */
export async function migrateCommands() {
  const safe = async (label: string, stmt: ReturnType<typeof sql>) => {
    try { await db.execute(stmt); }
    catch (err) { console.warn(`[commands-migration] ${label}:`, err instanceof Error ? err.message : err); }
  };

  // --- Columns + tables ---
  await safe("users.is_superadmin", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT FALSE`);
  await safe("commands.create", sql`
    CREATE TABLE IF NOT EXISTS commands (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_central BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safe("command_users.create", sql`
    CREATE TABLE IF NOT EXISTS command_users (
      id SERIAL PRIMARY KEY,
      command_id INTEGER NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT command_user_unique UNIQUE (command_id, user_id)
    )
  `);
  await safe("command_visibility_requests.create", sql`
    CREATE TABLE IF NOT EXISTS command_visibility_requests (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      grantee_command_id INTEGER NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
      granter_command_id INTEGER NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
      requested_by_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      decided_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      decided_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safe("command_visibility_grants.create", sql`
    CREATE TABLE IF NOT EXISTS command_visibility_grants (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      grantee_command_id INTEGER NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
      granter_command_id INTEGER NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
      scope TEXT NOT NULL DEFAULT 'read',
      granted_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT command_visibility_unique UNIQUE (grantee_command_id, granter_command_id, scope)
    )
  `);
  await safe("incidents.command_id", sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS command_id INTEGER REFERENCES commands(id) ON DELETE SET NULL`);
  await safe("locations.command_id", sql`ALTER TABLE locations ADD COLUMN IF NOT EXISTS command_id INTEGER REFERENCES commands(id) ON DELETE SET NULL`);
  await safe("incident_categories.command_id", sql`ALTER TABLE incident_categories ADD COLUMN IF NOT EXISTS command_id INTEGER REFERENCES commands(id) ON DELETE SET NULL`);
  await safe("form_fields.command_id", sql`ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS command_id INTEGER REFERENCES commands(id) ON DELETE SET NULL`);
  await safe("custom_maps.command_id", sql`ALTER TABLE custom_maps ADD COLUMN IF NOT EXISTS command_id INTEGER REFERENCES commands(id) ON DELETE SET NULL`);

  // --- Per-org backfill ---
  const orgs = await db.execute<{ id: string }>(sql`SELECT id FROM organizations`);
  for (const org of orgs.rows) {
    const orgId = org.id;

    // 1. Ensure Central Command exists
    const existing = await db.execute<{ id: number }>(
      sql`SELECT id FROM commands WHERE organization_id = ${orgId} AND is_central = TRUE LIMIT 1`
    );
    let centralId: number;
    if (existing.rows.length > 0) {
      centralId = existing.rows[0].id;
    } else {
      const inserted = await db.execute<{ id: number }>(
        sql`INSERT INTO commands (organization_id, name, is_central) VALUES (${orgId}, 'Central / Head Office', TRUE) RETURNING id`
      );
      centralId = inserted.rows[0].id;
      console.log(`[commands-migration] Created Central / Head Office for org ${orgId} (id=${centralId})`);
    }

    // 2. Backfill command_id on existing rows that have none
    const backfillTables: Array<{ label: string; stmt: ReturnType<typeof sql> }> = [
      { label: "incidents",           stmt: sql`UPDATE incidents SET command_id = ${centralId} WHERE organization_id = ${orgId} AND command_id IS NULL` },
      { label: "locations",           stmt: sql`UPDATE locations SET command_id = ${centralId} WHERE organization_id = ${orgId} AND command_id IS NULL` },
      { label: "incident_categories", stmt: sql`UPDATE incident_categories SET command_id = ${centralId} WHERE organization_id = ${orgId} AND command_id IS NULL` },
      { label: "form_fields",         stmt: sql`UPDATE form_fields SET command_id = ${centralId} WHERE organization_id = ${orgId} AND command_id IS NULL` },
      { label: "custom_maps",         stmt: sql`UPDATE custom_maps SET command_id = ${centralId} WHERE organization_id = ${orgId} AND command_id IS NULL` },
    ];
    for (const { label, stmt } of backfillTables) {
      try {
        const result = await db.execute(stmt);
        const count = (result as any).rowCount ?? 0;
        if (count > 0) console.log(`[commands-migration] Backfilled ${count} ${label} row(s) to Central Command for org ${orgId}`);
      } catch (err) {
        console.warn(`[commands-migration] backfill ${label} ${orgId}:`, err instanceof Error ? err.message : err);
      }
    }

    // 3. Assign every user in this org to the Central Command (idempotent via unique constraint)
    await safe(`assign users to central ${orgId}`, sql`
      INSERT INTO command_users (command_id, user_id, organization_id)
      SELECT ${centralId}, id, ${orgId} FROM users WHERE organization_id = ${orgId}
      ON CONFLICT ON CONSTRAINT command_user_unique DO NOTHING
    `);

    // 4. Promote first administrator to superadmin if no superadmin exists yet
    const hasSuper = await db.execute<{ c: number }>(
      sql`SELECT COUNT(*)::int AS c FROM users WHERE organization_id = ${orgId} AND is_superadmin = TRUE`
    );
    if (Number(hasSuper.rows[0]?.c ?? 0) === 0) {
      const firstAdmin = await db.execute<{ id: string; email: string }>(sql`
        SELECT id, email FROM users
        WHERE organization_id = ${orgId} AND role = 'administrator' AND is_active = TRUE
        ORDER BY id ASC LIMIT 1
      `);
      if (firstAdmin.rows.length > 0) {
        const u = firstAdmin.rows[0];
        await db.execute(sql`UPDATE users SET is_superadmin = TRUE WHERE id = ${u.id}`);
        console.log(`[commands-migration] Promoted ${u.email} to superadmin for org ${orgId}`);
      }
    }
  }

  // Startup safety net: after backfill, no scoped table may hold a NULL
  // command_id. Such rows would be invisible to scoped reads (which no longer
  // NULL-fall-back), so we fail the process hard rather than ship a partial
  // rollout where some org data silently disappears.
  const scopedTables = ["incidents", "locations", "incident_categories", "form_fields", "custom_maps"];
  const orphans: Record<string, number> = {};
  for (const t of scopedTables) {
    const r = await db.execute<{ c: number }>(sql.raw(`SELECT COUNT(*)::int AS c FROM ${t} WHERE command_id IS NULL`));
    const c = Number(r.rows[0]?.c ?? 0);
    if (c > 0) orphans[t] = c;
  }
  if (Object.keys(orphans).length > 0) {
    const summary = Object.entries(orphans).map(([t, c]) => `${t}=${c}`).join(", ");
    const msg = `[commands-migration] FATAL: ${Object.values(orphans).reduce((a, b) => a + b, 0)} row(s) with NULL command_id remain after backfill (${summary}). Refusing to start — these rows would be invisible to scoped reads. Backfill manually then restart.`;
    console.error(msg);
    throw new Error(msg);
  }
}
