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
