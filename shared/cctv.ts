import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations, users } from "./schema";
import { DISPATCH_STAFF_ROLES } from "./user-roles";

/** IP cameras configured per organisation (Phase 1 — view + admin CRUD). */
export const cctvStreamRotationEnum = z.enum(["normal", "rotate180"]);
export type CctvStreamRotation = z.infer<typeof cctvStreamRotationEnum>;

/** Per-camera live encode preference (RTSP → HLS). */
export const cctvStreamQualityEnum = z.enum(["high", "medium", "low"]);
export type CctvStreamQuality = z.infer<typeof cctvStreamQualityEnum>;

export function normalizeCctvStreamQuality(value: unknown): CctvStreamQuality {
  if (value === "high" || value === "low" || value === "medium") return value;
  return "medium";
}

export const ROTATE180_OSD_HINT =
  "OMT Rotate 180° uprights the live picture. The EZVIZ timestamp/logo are burned into the video, so they will appear upside down. " +
  "To get both picture and timestamp upright, flip the image in the EZVIZ app (Image flip) until VLC/the stream looks correct, then set Orientation to Normal here. " +
  "If you only flip in OMT or only set Normal without a working camera flip, one of the two will stay inverted.";

export const cctvCameras = pgTable("cctv_cameras", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rtspUrl: text("rtsp_url").notNull(),
  username: text("username"),
  streamRotation: text("stream_rotation").notNull().default("normal"),
  streamQuality: text("stream_quality").notNull().default("medium"),
  /** When true, VPS AI worker samples frames for vehicle detection. */
  aiEnabled: boolean("ai_enabled").notNull().default(false),
  isPtz: boolean("is_ptz").notNull().default(false),
  /** VPS-side tunnel port for PTZ HTTP (default 8555 → camera :80). */
  ptzControlPort: integer("ptz_control_port").default(8555),
  /** Camera HTTP port on LAN (ISAPI), usually 80. */
  ptzCameraHttpPort: integer("ptz_camera_http_port").default(80),
  ptzChannel: integer("ptz_channel").default(1),
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
  streamRotation: cctvStreamRotationEnum.default("normal"),
  streamQuality: cctvStreamQualityEnum.default("medium"),
  aiEnabled: z.boolean().default(false),
  isPtz: z.boolean().default(false),
  ptzControlPort: z.number().int().min(1).max(65535).optional().nullable(),
  ptzCameraHttpPort: z.number().int().min(1).max(65535).optional().nullable(),
  ptzChannel: z.number().int().min(1).max(32).optional().nullable(),
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

/** Rising-edge vehicle detections (Phase 1 AI alerts). */
export const cctvAiEvents = pgTable("cctv_ai_events", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  cameraId: integer("camera_id")
    .notNull()
    .references(() => cctvCameras.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  confidence: text("confidence").notNull(),
  /** Normalized bbox JSON: { x, y, w, h } in 0–1 of the frame. */
  bboxJson: text("bbox_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CctvAiEvent = typeof cctvAiEvents.$inferSelect;

export type CctvAiDetection = {
  label: string;
  confidence: number;
  /** Normalized 0–1 relative to the source frame. */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CctvAiEventPublic = {
  id: number;
  cameraId: number;
  label: string;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number } | null;
  createdAt: string;
};

export type CctvCameraPublic = {
  id: number;
  name: string;
  rtspPreview: string;
  username: string | null;
  hasCredentials: boolean;
  streamRotation: CctvStreamRotation;
  streamQuality: CctvStreamQuality;
  aiEnabled: boolean;
  isPtz: boolean;
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

/** True for localhost / 127.x (e.g. SSH reverse tunnel terminating on the VPS). */
export function isLoopbackRtspHost(rtspUrl: string): boolean {
  try {
    const host = new URL(rtspUrl.trim()).hostname.toLowerCase();
    if (host === "localhost") return true;
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
    if (!m) return false;
    return Number(m[1]) === 127;
  } catch {
    return false;
  }
}

/** LAN/private hosts the cloud VPS cannot dial directly (excludes loopback relay). */
export function isUnreachablePrivateRtspOnCloud(rtspUrl: string): boolean {
  return isPrivateRtspHost(rtspUrl) && !isLoopbackRtspHost(rtspUrl);
}

export const PRIVATE_RTSP_SERVER_MESSAGE =
  "This camera uses a private LAN address (for example 192.168.x.x). The OMT Pulse cloud server cannot reach it directly. " +
  "Use the site VPN, a site relay, or run scripts/cctv-lan-rtsp-tunnel.ps1 on a PC on the same Wi‑Fi as the camera (SSH tunnel to this server). " +
  "Then set the camera RTSP host to 127.0.0.1 and the tunnel port.";
