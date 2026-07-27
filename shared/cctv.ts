import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations, users } from "./schema";
import { DISPATCH_STAFF_ROLES } from "./user-roles";

/** IP cameras configured per organisation (Phase 1 — view + admin CRUD). */
export const cctvCameras = pgTable("cctv_cameras", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rtspUrl: text("rtsp_url").notNull(),
  username: text("username"),
  /** AES-256-GCM encrypted password (never returned to clients). */
  passwordEnc: text("password_enc"),
  createdByUserId: varchar("created_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCctvCameraSchema = createInsertSchema(cctvCameras, {
  name: z.string().min(1).max(120),
  rtspUrl: z
    .string()
    .min(8)
    .max(2000)
    .refine((u) => /^rtsp:\/\//i.test(u.trim()), "Must be an RTSP URL (rtsp://…)"),
  username: z.string().max(200).optional().nullable(),
}).omit({
  id: true,
  organizationId: true,
  passwordEnc: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCctvCamera = z.infer<typeof insertCctvCameraSchema>;
export type CctvCamera = typeof cctvCameras.$inferSelect;

export type CctvCameraPublic = {
  id: number;
  name: string;
  rtspPreview: string;
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
};

export function canViewCctvModule(role: string): boolean {
  return (DISPATCH_STAFF_ROLES as readonly string[]).includes(role);
}

export function canManageCctvCameras(role: string, isSuperadmin?: boolean | null): boolean {
  return role === "administrator" || !!isSuperadmin;
}

/** True when hostname is RFC1918 / loopback (not reachable from a public cloud VPS). */
export function isPrivateRtspHost(rtspUrl: string): boolean {
  try {
    const host = new URL(rtspUrl.trim()).hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local")) return true;
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  } catch {
    return false;
  }
}

export const PRIVATE_RTSP_SERVER_MESSAGE =
  "This camera uses a private LAN address (for example 192.168.x.x). The OMT Pulse cloud server cannot reach it. " +
  "Run OMT on a PC on the same Wi‑Fi (npm run dev) to test, or place the camera on a monitored site network with VPN to the server. " +
  "To allow private RTSP on this host, set CCTV_ALLOW_PRIVATE_RTSP=1 on the server.";
