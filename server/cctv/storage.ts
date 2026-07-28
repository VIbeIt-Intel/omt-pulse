import {
  cctvAiEvents,
  cctvCameras,
  normalizeCctvStreamQuality,
  type CctvAiDetection,
  type CctvAiEventPublic,
  type CctvCamera,
  type CctvCameraPublic,
  type CctvRoi,
  type CctvStreamQuality,
} from "@shared/cctv";
import { db } from "../storage";
import { and, asc, desc, eq, gt } from "drizzle-orm";
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

function parseVehicleRoi(raw: string | null): CctvRoi | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CctvRoi;
    if (
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y) &&
      Number.isFinite(parsed.w) &&
      Number.isFinite(parsed.h) &&
      parsed.x >= 0 &&
      parsed.y >= 0 &&
      parsed.w > 0 &&
      parsed.h > 0 &&
      parsed.x + parsed.w <= 1 &&
      parsed.y + parsed.h <= 1
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function toPublicCamera(row: CctvCamera): CctvCameraPublic {
  return {
    id: row.id,
    name: row.name,
    rtspPreview: rtspPreviewUrl(row.rtspUrl),
    username: row.username?.trim() || null,
    hasCredentials: !!(row.username || row.passwordEnc),
    streamRotation: row.streamRotation === "rotate180" ? "rotate180" : "normal",
    streamQuality: normalizeCctvStreamQuality(row.streamQuality),
    aiEnabled: !!row.aiEnabled,
    vehicleRoi: parseVehicleRoi(row.vehicleRoiJson ?? null),
    isPtz: !!row.isPtz,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPublicAiEvent(row: typeof cctvAiEvents.$inferSelect): CctvAiEventPublic {
  let bbox: CctvAiEventPublic["bbox"] = null;
  if (row.bboxJson) {
    try {
      const parsed = JSON.parse(row.bboxJson) as { x: number; y: number; w: number; h: number };
      if (
        Number.isFinite(parsed.x) &&
        Number.isFinite(parsed.y) &&
        Number.isFinite(parsed.w) &&
        Number.isFinite(parsed.h)
      ) {
        bbox = parsed;
      }
    } catch {
      bbox = null;
    }
  }
  return {
    id: row.id,
    cameraId: row.cameraId,
    label: row.label,
    confidence: Number(row.confidence) || 0,
    bbox,
    snapshotUrl: row.snapshotPath
      ? `/api/cctv/cameras/${row.cameraId}/ai/events/${row.id}/snapshot`
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function buildRtspSource(row: CctvCamera): string {
  let url = row.rtspUrl.trim();
  try {
    const embedded = new URL(url);
    // Prefer device-code credentials already in the RTSP URL so ONVIF password
    // can live in passwordEnc without breaking the live stream.
    if (embedded.username || embedded.password) {
      return url;
    }
  } catch {
    /* fall through */
  }
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

export async function listAiEnabledCameras(): Promise<CctvCamera[]> {
  return db.select().from(cctvCameras).where(eq(cctvCameras.aiEnabled, true));
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
  streamQuality?: CctvStreamQuality;
  aiEnabled?: boolean;
  vehicleRoi?: CctvRoi | null;
  isPtz?: boolean;
  ptzControlPort?: number | null;
  ptzCameraHttpPort?: number | null;
  ptzChannel?: number | null;
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
      streamQuality: normalizeCctvStreamQuality(input.streamQuality),
      aiEnabled: !!input.aiEnabled,
      vehicleRoiJson: input.vehicleRoi ? JSON.stringify(input.vehicleRoi) : null,
      isPtz: !!input.isPtz,
      ptzControlPort: input.ptzControlPort ?? 8555,
      ptzCameraHttpPort: input.ptzCameraHttpPort ?? 80,
      ptzChannel: input.ptzChannel ?? 1,
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
    streamQuality?: CctvStreamQuality;
    aiEnabled?: boolean;
    vehicleRoi?: CctvRoi | null;
    isPtz?: boolean;
    ptzControlPort?: number | null;
    ptzCameraHttpPort?: number | null;
    ptzChannel?: number | null;
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
  if (patch.streamQuality != null) {
    updates.streamQuality = normalizeCctvStreamQuality(patch.streamQuality);
  }
  if (patch.aiEnabled !== undefined) {
    updates.aiEnabled = !!patch.aiEnabled;
  }
  if (patch.vehicleRoi !== undefined) {
    updates.vehicleRoiJson = patch.vehicleRoi ? JSON.stringify(patch.vehicleRoi) : null;
  }
  if (patch.isPtz !== undefined) {
    updates.isPtz = !!patch.isPtz;
  }
  if (patch.ptzControlPort !== undefined) {
    updates.ptzControlPort = patch.ptzControlPort ?? 8555;
  }
  if (patch.ptzCameraHttpPort !== undefined) {
    updates.ptzCameraHttpPort = patch.ptzCameraHttpPort ?? 80;
  }
  if (patch.ptzChannel !== undefined) {
    updates.ptzChannel = patch.ptzChannel ?? 1;
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

export async function insertCctvAiEvent(input: {
  organizationId: string;
  cameraId: number;
  detection: CctvAiDetection;
  snapshotPath?: string | null;
}): Promise<CctvAiEventPublic> {
  const [row] = await db
    .insert(cctvAiEvents)
    .values({
      organizationId: input.organizationId,
      cameraId: input.cameraId,
      label: input.detection.label,
      confidence: String(input.detection.confidence),
      bboxJson: JSON.stringify({
        x: input.detection.x,
        y: input.detection.y,
        w: input.detection.w,
        h: input.detection.h,
      }),
      snapshotPath: input.snapshotPath ?? null,
    })
    .returning();
  return toPublicAiEvent(row);
}

export async function getCctvAiEventSnapshotPath(
  orgId: string,
  cameraId: number,
  eventId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ snapshotPath: cctvAiEvents.snapshotPath })
    .from(cctvAiEvents)
    .where(
      and(
        eq(cctvAiEvents.organizationId, orgId),
        eq(cctvAiEvents.cameraId, cameraId),
        eq(cctvAiEvents.id, eventId),
      ),
    )
    .limit(1);
  return row?.snapshotPath?.trim() || null;
}

export async function listCctvAiEvents(
  orgId: string,
  cameraId: number,
  opts?: { since?: Date; limit?: number },
): Promise<CctvAiEventPublic[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  const conditions = [eq(cctvAiEvents.organizationId, orgId), eq(cctvAiEvents.cameraId, cameraId)];
  if (opts?.since) {
    conditions.push(gt(cctvAiEvents.createdAt, opts.since));
  }
  const rows = await db
    .select()
    .from(cctvAiEvents)
    .where(and(...conditions))
    .orderBy(desc(cctvAiEvents.createdAt))
    .limit(limit);
  return rows.map(toPublicAiEvent);
}
