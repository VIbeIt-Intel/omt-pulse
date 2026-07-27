import { cctvCameras, type CctvCamera, type CctvCameraPublic } from "@shared/cctv";
import { db } from "../storage";
import { and, asc, eq } from "drizzle-orm";
import { decryptCameraPassword, encryptCameraPassword } from "./credentials";

export function rtspPreviewUrl(rtspUrl: string): string {
  try {
    const u = new URL(rtspUrl);
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return rtspUrl.replace(/\/\/[^@/]+@/i, "//***@");
  }
}

export function toPublicCamera(row: CctvCamera): CctvCameraPublic {
  return {
    id: row.id,
    name: row.name,
    rtspPreview: rtspPreviewUrl(row.rtspUrl),
    hasCredentials: !!(row.username || row.passwordEnc),
    streamRotation: row.streamRotation === "rotate180" ? "rotate180" : "normal",
    isPtz: !!row.isPtz,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function buildRtspSource(row: CctvCamera): string {
  let url = row.rtspUrl.trim();
  const user = row.username?.trim() || "";
  let pass = "";
  if (row.passwordEnc) {
    try {
      pass = decryptCameraPassword(row.passwordEnc);
    } catch (err) {
      console.error("[cctv] decrypt camera password failed:", err);
      pass = "";
    }
  }
  if (!user && !pass) return url;
  try {
    const parsed = new URL(url);
    if (user) parsed.username = user;
    if (pass) parsed.password = pass;
    return parsed.toString();
  } catch {
    return url;
  }
}

export async function listCctvCameras(orgId: string): Promise<CctvCameraPublic[]> {
  const rows = await db
    .select()
    .from(cctvCameras)
    .where(eq(cctvCameras.organizationId, orgId))
    .orderBy(asc(cctvCameras.name));
  return rows.map(toPublicCamera);
}

export async function getCctvCamera(id: number, orgId: string): Promise<CctvCamera | null> {
  const [row] = await db
    .select()
    .from(cctvCameras)
    .where(and(eq(cctvCameras.id, id), eq(cctvCameras.organizationId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function createCctvCamera(input: {
  organizationId: string;
  name: string;
  rtspUrl: string;
  username?: string | null;
  streamRotation?: "normal" | "rotate180";
  isPtz?: boolean;
  password?: string | null;
  createdByUserId: string;
}): Promise<CctvCameraPublic> {
  const now = new Date();
  const [row] = await db
    .insert(cctvCameras)
    .values({
      organizationId: input.organizationId,
      name: input.name.trim(),
      rtspUrl: input.rtspUrl.trim(),
      username: input.username?.trim() || null,
      streamRotation: input.streamRotation === "rotate180" ? "rotate180" : "normal",
      isPtz: !!input.isPtz,
      passwordEnc: input.password?.trim() ? encryptCameraPassword(input.password.trim()) : null,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toPublicCamera(row);
}

export async function updateCctvCamera(
  id: number,
  orgId: string,
  patch: {
    name?: string;
    rtspUrl?: string;
    username?: string | null;
    streamRotation?: "normal" | "rotate180";
    isPtz?: boolean;
    password?: string | null;
    clearPassword?: boolean;
  },
): Promise<CctvCameraPublic | null> {
  const existing = await getCctvCamera(id, orgId);
  if (!existing) return null;

  const updates: Partial<typeof cctvCameras.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.name != null) updates.name = patch.name.trim();
  if (patch.rtspUrl != null) updates.rtspUrl = patch.rtspUrl.trim();
  if (patch.username !== undefined) {
    updates.username = patch.username?.trim() || null;
  }
  if (patch.streamRotation != null) {
    updates.streamRotation = patch.streamRotation === "rotate180" ? "rotate180" : "normal";
  }
  if (patch.isPtz !== undefined) {
    updates.isPtz = !!patch.isPtz;
  }
  if (patch.clearPassword) {
    updates.passwordEnc = null;
  } else if (patch.password != null && patch.password.trim()) {
    updates.passwordEnc = encryptCameraPassword(patch.password.trim());
  }

  const [row] = await db
    .update(cctvCameras)
    .set(updates)
    .where(and(eq(cctvCameras.id, id), eq(cctvCameras.organizationId, orgId)))
    .returning();
  return row ? toPublicCamera(row) : null;
}

export async function deleteCctvCamera(id: number, orgId: string): Promise<boolean> {
  const result = await db
    .delete(cctvCameras)
    .where(and(eq(cctvCameras.id, id), eq(cctvCameras.organizationId, orgId)))
    .returning({ id: cctvCameras.id });
  return result.length > 0;
}
