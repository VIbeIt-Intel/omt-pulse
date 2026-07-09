// Server entry point
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";
import { db } from "./storage";
import { sql } from "drizzle-orm";
import { migrateCommands } from "./migrate-commands";
import { migrateAccessControl } from "./migrate-access-control";
import { migrateBillingRates } from "./migrate-billing-rates";
import { migratePatrol } from "./migrate-patrol";
import { startVehicleTrackingFromEnv } from "./vehicle-tracking";

console.log("[startup] Push subscription health check complete");

declare module "express-session" {
  interface SessionData {
    userId: string;
    archonAuthed: boolean;
    // Active command scope for the current session.
    // - number: a specific command_id the user is currently viewing
    // - "all": superadmin override — see every command in the org
    // - undefined: defaults to the user's first accessible command (typically Central)
    activeCommandId?: number | "all";
  }
}

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "25mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("FATAL: DATABASE_URL is not set — session persistence will not work. Exiting.");
    process.exit(1);
  }

  const sessionPool = new Pool({ connectionString: process.env.DATABASE_URL });

  // connect-pg-simple v10 resolves table.sql via __dirname, which breaks when the
  // server is bundled (dist/index.cjs) because __dirname becomes dist/ not node_modules/.
  // Fix: pre-create the session table with raw SQL here (awaited before the session
  // middleware is registered) so createTableIfMissing can safely be false.
  try {
    await sessionPool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
      )
    `);
    await sessionPool.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`);
  } catch (err) {
    console.warn("[session-table] setup warning:", err instanceof Error ? err.message : err);
  }

  const PgStore = connectPgSimple(session);
  app.use(
    session({
      store: new PgStore({
        pool: sessionPool,
        createTableIfMissing: false,
      }),
      secret: process.env.SESSION_SECRET || "fallback-secret-change-in-production",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );

  // Startup migrations — additive columns only, safe to run on every boot.
  // Each statement is logged on failure (instead of silently swallowed) so a
  // missing column never becomes invisible — that pattern hid the
  // destination_lat/lng/name regression that broke joiner destinations.
  const safeMigrate = async (label: string, stmt: ReturnType<typeof sql>) => {
    try { await db.execute(stmt); }
    catch (err) { console.warn(`[migration] ${label} failed:`, err instanceof Error ? err.message : err); }
  };
  await safeMigrate("incidents.user_id", sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await safeMigrate("incidents.is_escalated", sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS is_escalated BOOLEAN NOT NULL DEFAULT FALSE`);
  await safeMigrate("incident_categories.is_system", sql`ALTER TABLE incident_categories ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE`);
  await safeMigrate("incident_categories.is_system.backfill", sql`UPDATE incident_categories SET is_system = TRUE WHERE name IN ('Panic', 'Live Incident') AND is_system = FALSE`);
  await safeMigrate("incidents.panic_acknowledged_at", sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS panic_acknowledged_at TIMESTAMP`);
  await safeMigrate("incidents.panic_acknowledged_by_user_id", sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS panic_acknowledged_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await safeMigrate("incidents.closed_by_user_id", sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS closed_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await safeMigrate("incidents.responder_position_updated_at", sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS responder_position_updated_at TIMESTAMP`);
  await safeMigrate("incidents.live_end_lat", sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS live_end_lat DOUBLE PRECISION`);
  await safeMigrate("incidents.live_end_lng", sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS live_end_lng DOUBLE PRECISION`);
  // live_responders — create table (safe on existing DBs) then add optional columns
  await safeMigrate("live_responders.create", sql`
    CREATE TABLE IF NOT EXISTS live_responders (
      id SERIAL PRIMARY KEY,
      incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
      left_at TIMESTAMP,
      last_lat DOUBLE PRECISION,
      last_lng DOUBLE PRECISION,
      last_position_at TIMESTAMP,
      arrived_at TIMESTAMPTZ,
      arrival_note TEXT
    )
  `);
  await safeMigrate("live_responders.arrived_at", sql`ALTER TABLE live_responders ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ`);
  await safeMigrate("live_responders.arrival_note", sql`ALTER TABLE live_responders ADD COLUMN IF NOT EXISTS arrival_note TEXT`);
  await safeMigrate("live_responders.destination_lat", sql`ALTER TABLE live_responders ADD COLUMN IF NOT EXISTS destination_lat DOUBLE PRECISION`);
  await safeMigrate("live_responders.destination_lng", sql`ALTER TABLE live_responders ADD COLUMN IF NOT EXISTS destination_lng DOUBLE PRECISION`);
  await safeMigrate("live_responders.destination_name", sql`ALTER TABLE live_responders ADD COLUMN IF NOT EXISTS destination_name TEXT`);

  await safeMigrate("users.last_lat", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_lat DOUBLE PRECISION`);
  await safeMigrate("users.last_lng", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_lng DOUBLE PRECISION`);
  await safeMigrate("users.last_position_at", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_position_at TIMESTAMP`);

  // panic_acknowledgers — created here (not just via drizzle-kit push) so
  // every environment, including production, boots with the table present.
  // Without this, /api/panic/recent, acknowledge-panic, and the panic banner
  // all fail on fresh DBs. The unique constraint guarantees per-user idempotent acks.
  await safeMigrate("panic_acknowledgers.create", sql`
    CREATE TABLE IF NOT EXISTS panic_acknowledgers (
      id SERIAL PRIMARY KEY,
      incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      acknowledged_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT panic_ack_incident_user_unique UNIQUE (incident_id, user_id)
    )
  `);
  await safeMigrate("panic_acknowledgers.incident_idx", sql`CREATE INDEX IF NOT EXISTS panic_ack_incident_idx ON panic_acknowledgers (incident_id)`);
  await safeMigrate("panic_acknowledgers.org_idx", sql`CREATE INDEX IF NOT EXISTS panic_ack_org_idx ON panic_acknowledgers (organization_id)`);

  await safeMigrate("tracker_devices.create", sql`
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
  await safeMigrate("tracker_positions.create", sql`
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
  await safeMigrate("tracker_positions.device_idx", sql`
    CREATE INDEX IF NOT EXISTS tracker_positions_device_idx ON tracker_positions (device_id, recorded_at DESC)
  `);
  await safeMigrate("tracker_devices.command_idx", sql`
    CREATE INDEX IF NOT EXISTS tracker_devices_command_idx ON tracker_devices (command_id)
  `);
  await safeMigrate("tracker_devices.vehicle_make", sql`ALTER TABLE tracker_devices ADD COLUMN IF NOT EXISTS vehicle_make TEXT`);
  await safeMigrate("tracker_devices.vehicle_model", sql`ALTER TABLE tracker_devices ADD COLUMN IF NOT EXISTS vehicle_model TEXT`);
  await safeMigrate("tracker_devices.vehicle_registration", sql`ALTER TABLE tracker_devices ADD COLUMN IF NOT EXISTS vehicle_registration TEXT`);
  await safeMigrate("tracker_devices.assigned_user_id", sql`ALTER TABLE tracker_devices ADD COLUMN IF NOT EXISTS assigned_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await safeMigrate("tracker_devices.notes", sql`ALTER TABLE tracker_devices ADD COLUMN IF NOT EXISTS notes TEXT`);
  await safeMigrate("tracker_devices.vehicle_photo_url", sql`ALTER TABLE tracker_devices ADD COLUMN IF NOT EXISTS vehicle_photo_url TEXT`);

  await safeMigrate("incident_evidence_notes.create", sql`
    CREATE TABLE IF NOT EXISTS incident_evidence_notes (
      id SERIAL PRIMARY KEY,
      incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      author_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safeMigrate("incident_evidence_notes.incident_idx", sql`CREATE INDEX IF NOT EXISTS incident_evidence_notes_incident_idx ON incident_evidence_notes (incident_id)`);

  await safeMigrate("incident_attachments.evidence_phase", sql`ALTER TABLE incident_attachments ADD COLUMN IF NOT EXISTS evidence_phase VARCHAR(20)`);
  await safeMigrate("incident_evidence_notes.evidence_phase", sql`ALTER TABLE incident_evidence_notes ADD COLUMN IF NOT EXISTS evidence_phase VARCHAR(20)`);

  // Organizations — contract / billing config columns (Task #254)
  await safeMigrate("organizations.contract_ref", sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contract_ref VARCHAR`);
  await safeMigrate("organizations.contract_start_date", sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contract_start_date DATE`);
  await safeMigrate("organizations.contract_renewal_date", sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contract_renewal_date DATE`);
  // Coerce existing TEXT columns to DATE if they were created as TEXT on first run
  await safeMigrate("organizations.contract_start_date.retype", sql`ALTER TABLE organizations ALTER COLUMN contract_start_date TYPE DATE USING contract_start_date::DATE`);
  await safeMigrate("organizations.contract_renewal_date.retype", sql`ALTER TABLE organizations ALTER COLUMN contract_renewal_date TYPE DATE USING contract_renewal_date::DATE`);
  await safeMigrate("organizations.rate_admin", sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS rate_admin INTEGER`);
  await safeMigrate("organizations.rate_supervisor", sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS rate_supervisor INTEGER`);
  await safeMigrate("organizations.rate_reporter", sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS rate_reporter INTEGER`);
  await safeMigrate("organizations.storage_limit_gb", sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS storage_limit_gb INTEGER`);
  await safeMigrate("organizations.billing_notes", sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_notes TEXT`);

  // Contact form submissions from the public marketing landing page (Task #266)
  await safeMigrate("contact_submissions.create", sql`
    CREATE TABLE IF NOT EXISTS contact_submissions (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      organisation TEXT,
      email TEXT NOT NULL,
      phone TEXT,
      message TEXT NOT NULL,
      email_sent_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safeMigrate("contact_submissions.created_idx", sql`CREATE INDEX IF NOT EXISTS contact_submissions_created_idx ON contact_submissions (created_at DESC)`);

  await safeMigrate("fcm_tokens.create", sql`
    CREATE TABLE IF NOT EXISTS fcm_tokens (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safeMigrate("fcm_tokens.user_idx", sql`CREATE INDEX IF NOT EXISTS fcm_tokens_user_idx ON fcm_tokens (user_id)`);
  await safeMigrate("fcm_tokens.org_idx", sql`CREATE INDEX IF NOT EXISTS fcm_tokens_org_idx ON fcm_tokens (organization_id)`);

  // Chat tables
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      sender_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_reads (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
      last_read_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  // Partial unique indices for chat_reads (handles NULL recipient_id correctly)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS chat_reads_group_unique
    ON chat_reads (user_id, organization_id) WHERE recipient_id IS NULL
  `).catch(() => {});
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS chat_reads_dm_unique
    ON chat_reads (user_id, organization_id, recipient_id) WHERE recipient_id IS NOT NULL
  `).catch(() => {});

  await seedDatabase().catch((err) => console.error("Seed error:", err));
  await migrateCommands().catch((err) => console.error("Commands migration error:", err));
  await migrateAccessControl().catch((err) => console.error("Access control migration error:", err));
  await migrateBillingRates().catch((err) => console.error("Billing rates migration error:", err));
  await migratePatrol().catch((err) => console.error("Patrol migration error:", err));

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      startVehicleTrackingFromEnv();
    },
  );
})();
