import type { Express, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  canManageCctvCameras,
  canViewCctvModule,
  cctvRoiSchema,
  cctvStreamQualityEnum,
  cctvStreamRotationEnum,
  insertCctvCameraSchema,
  isUnreachablePrivateRtspOnCloud,
  normalizeCctvStreamQuality,
  PRIVATE_RTSP_SERVER_MESSAGE,
} from "@shared/cctv";
import {
  buildRtspSource,
  createCctvCamera,
  deleteCctvCamera,
  getCctvAiEventSnapshotPath,
  getCctvCamera,
  listCctvAiEvents,
  listCctvCameras,
  updateCctvCamera,
} from "./storage";
import { getAiSnapshotPath } from "./ai-snapshots";
import {
  getCctvStreamSegmentPath,
  isFfmpegAvailable,
  rewritePlaylist,
  stopCctvStream,
  touchCctvStream,
} from "./stream-manager";
import { sendCameraPtz, applyCameraImageFlip, warmupCameraPtz } from "./ptz";
import { clearCctvAiCameraState, getLatestCctvAiDetections, startCctvAiWorker } from "./ai-worker";

function requireUser(req: Request, res: Response): boolean {
  if (!req.currentUser) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }
  return true;
}

function requireView(req: Request, res: Response): boolean {
  if (!requireUser(req, res)) return false;
  if (!canViewCctvModule(req.currentUser!.role)) {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  return true;
}

function requireAdmin(req: Request, res: Response): boolean {
  if (!requireUser(req, res)) return false;
  if (!canManageCctvCameras(req.currentUser!.role, req.currentUser!.isSuperadmin)) {
    res.status(403).json({ message: "Administrator only" });
    return false;
  }
  return true;
}

const createBodySchema = insertCctvCameraSchema.extend({
  password: z.string().max(500).optional().nullable(),
});

const updateBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  rtspUrl: z
    .string()
    .min(8)
    .max(2000)
    .refine((u) => /^rtsp:\/\//i.test(u.trim()), "Must be an RTSP URL")
    .optional(),
  username: z.string().max(200).optional().nullable(),
  streamRotation: cctvStreamRotationEnum.optional(),
  streamQuality: cctvStreamQualityEnum.optional(),
  aiEnabled: z.boolean().optional(),
  vehicleRoi: cctvRoiSchema.nullable().optional(),
  isPtz: z.boolean().optional(),
  ptzControlPort: z.number().int().min(1).max(65535).optional().nullable(),
  ptzCameraHttpPort: z.number().int().min(1).max(65535).optional().nullable(),
  ptzChannel: z.number().int().min(1).max(32).optional().nullable(),
  password: z.string().max(500).optional().nullable(),
  clearPassword: z.boolean().optional(),
});

export function registerCctvRoutes(app: Express): void {
  startCctvAiWorker();

  app.get("/api/cctv/status", (req, res) => {
    if (!requireView(req, res)) return;
    res.json({ ffmpegAvailable: isFfmpegAvailable() });
  });

  app.get("/api/cctv/cameras", async (req, res) => {
    if (!requireView(req, res)) return;
    try {
      const orgId = req.currentUser!.organizationId;
      const cameras = await listCctvCameras(orgId);
      res.json(cameras);
    } catch (err) {
      console.error("[cctv] list:", err);
      res.status(500).json({ message: "Failed to list cameras" });
    }
  });

  app.post("/api/cctv/cameras", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const parsed = createBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    const { password, ...rest } = parsed.data;
    try {
      const created = await createCctvCamera({
        organizationId: req.currentUser!.organizationId,
        createdByUserId: req.currentUser!.id,
        ...rest,
        password,
      });
      res.status(201).json(created);
    } catch (err) {
      console.error("[cctv] create:", err);
      res.status(500).json({ message: "Failed to create camera" });
    }
  });

  app.patch("/api/cctv/cameras/:id", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid camera id" });
    const parsed = updateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const updated = await updateCctvCamera(id, req.currentUser!.organizationId, parsed.data);
      if (!updated) return res.status(404).json({ message: "Camera not found" });
      stopCctvStream(req.currentUser!.organizationId, id);
      if (parsed.data.aiEnabled === false) clearCctvAiCameraState(id);
      res.json(updated);
    } catch (err) {
      console.error("[cctv] update:", err);
      res.status(500).json({ message: "Failed to update camera" });
    }
  });

  app.delete("/api/cctv/cameras/:id", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid camera id" });
    try {
      const orgId = req.currentUser!.organizationId;
      const ok = await deleteCctvCamera(id, orgId);
      if (!ok) return res.status(404).json({ message: "Camera not found" });
      stopCctvStream(orgId, id);
      clearCctvAiCameraState(id);
      res.status(204).end();
    } catch (err) {
      console.error("[cctv] delete:", err);
      res.status(500).json({ message: "Failed to delete camera" });
    }
  });

  app.get("/api/cctv/cameras/:id/playlist.m3u8", async (req, res) => {
    if (!requireView(req, res)) return;
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid camera id" });
    if (!isFfmpegAvailable()) {
      return res.status(503).json({ message: "Video transcoding is not available on this server" });
    }
    try {
      const orgId = req.currentUser!.organizationId;
      const camera = await getCctvCamera(id, orgId);
      if (!camera) return res.status(404).json({ message: "Camera not found" });
      const rtsp = buildRtspSource(camera);
      const allowPrivate = process.env.CCTV_ALLOW_PRIVATE_RTSP === "1";
      if (
        !allowPrivate &&
        process.env.NODE_ENV === "production" &&
        isUnreachablePrivateRtspOnCloud(rtsp)
      ) {
        return res.status(503).json({ message: PRIVATE_RTSP_SERVER_MESSAGE });
      }
      const playlistPath = await touchCctvStream(
        orgId,
        id,
        rtsp,
        camera.streamRotation === "rotate180" ? "rotate180" : "normal",
        normalizeCctvStreamQuality(camera.streamQuality),
      );
      const body = rewritePlaylist(playlistPath, id);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-store");
      res.send(body);
    } catch (err) {
      console.error("[cctv] playlist:", err);
      const msg = err instanceof Error ? err.message : "Failed to start stream";
      res.status(502).json({ message: msg });
    }
  });

  app.get("/api/cctv/cameras/:id/ai/detections", async (req, res) => {
    if (!requireView(req, res)) return;
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid camera id" });
    try {
      const orgId = req.currentUser!.organizationId;
      const camera = await getCctvCamera(id, orgId);
      if (!camera) return res.status(404).json({ message: "Camera not found" });
      if (!camera.aiEnabled) {
        return res.json({ aiEnabled: false, detections: [], updatedAt: null, error: null });
      }
      const latest = getLatestCctvAiDetections(id);
      res.json({
        aiEnabled: true,
        detections: latest?.detections ?? [],
        updatedAt: latest ? new Date(latest.at).toISOString() : null,
        error: latest?.error ?? null,
      });
    } catch (err) {
      console.error("[cctv] ai detections:", err);
      res.status(500).json({ message: "Failed to load detections" });
    }
  });

  app.get("/api/cctv/cameras/:id/ai/events", async (req, res) => {
    if (!requireView(req, res)) return;
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid camera id" });
    try {
      const orgId = req.currentUser!.organizationId;
      const camera = await getCctvCamera(id, orgId);
      if (!camera) return res.status(404).json({ message: "Camera not found" });
      const sinceRaw = typeof req.query.since === "string" ? req.query.since : undefined;
      const since = sinceRaw ? new Date(sinceRaw) : undefined;
      if (since && Number.isNaN(since.getTime())) {
        return res.status(400).json({ message: "Invalid since timestamp" });
      }
      const events = await listCctvAiEvents(orgId, id, {
        since: since && !Number.isNaN(since.getTime()) ? since : undefined,
        limit: since ? 50 : 20,
      });
      res.json(events);
    } catch (err) {
      console.error("[cctv] ai events:", err);
      res.status(500).json({ message: "Failed to load AI events" });
    }
  });

  app.get("/api/cctv/cameras/:id/ai/events/:eventId/snapshot", async (req, res) => {
    if (!requireView(req, res)) return;
    const id = parseInt(String(req.params.id), 10);
    const eventId = parseInt(String(req.params.eventId), 10);
    if (!Number.isFinite(id) || !Number.isFinite(eventId)) {
      return res.status(400).json({ message: "Invalid event id" });
    }
    try {
      const orgId = req.currentUser!.organizationId;
      const camera = await getCctvCamera(id, orgId);
      if (!camera) return res.status(404).json({ message: "Camera not found" });
      const fileName = await getCctvAiEventSnapshotPath(orgId, id, eventId);
      if (!fileName) return res.status(404).json({ message: "Snapshot not found" });
      const full = getAiSnapshotPath(fileName);
      if (!fs.existsSync(full)) return res.status(404).json({ message: "Snapshot missing" });
      res.setHeader("Content-Type", "image/webp");
      res.setHeader("Cache-Control", "private, max-age=300");
      fs.createReadStream(full).pipe(res);
    } catch (err) {
      console.error("[cctv] ai snapshot:", err);
      res.status(500).json({ message: "Failed to load snapshot" });
    }
  });

  const ptzBodySchema = z.object({
    action: z.enum(["stop", "left", "right", "up", "down", "zoom_in", "zoom_out"]),
  });

  app.post("/api/cctv/cameras/:id/ptz", async (req, res) => {
    if (!requireView(req, res)) return;
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid camera id" });
    const parsed = ptzBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid PTZ action" });
    }
    try {
      const orgId = req.currentUser!.organizationId;
      const camera = await getCctvCamera(id, orgId);
      if (!camera) return res.status(404).json({ message: "Camera not found" });
      const result = await sendCameraPtz(camera, parsed.data.action);
      if (!result.ok) return res.status(502).json({ message: result.message ?? "PTZ failed" });
      res.json({ ok: true });
    } catch (err) {
      console.error("[cctv] ptz:", err);
      res.status(500).json({ message: "PTZ command failed" });
    }
  });

  app.post("/api/cctv/cameras/:id/ptz/warmup", async (req, res) => {
    if (!requireView(req, res)) return;
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid camera id" });
    try {
      const orgId = req.currentUser!.organizationId;
      const camera = await getCctvCamera(id, orgId);
      if (!camera) return res.status(404).json({ message: "Camera not found" });
      if (camera.isPtz) {
        void warmupCameraPtz(camera).catch((err) => console.warn("[cctv] ptz warmup:", err));
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("[cctv] ptz warmup:", err);
      res.status(500).json({ message: "PTZ warmup failed" });
    }
  });

  app.post("/api/cctv/cameras/:id/fix-timestamp", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid camera id" });
    try {
      const orgId = req.currentUser!.organizationId;
      const camera = await getCctvCamera(id, orgId);
      if (!camera) return res.status(404).json({ message: "Camera not found" });
      const flip = await applyCameraImageFlip(camera);
      const updated = await updateCctvCamera(id, orgId, { streamRotation: "normal" });
      stopCctvStream(orgId, id);
      if (!flip.ok) {
        return res.status(502).json({
          message: `${flip.message} Orientation was set to Normal — refresh the stream after enabling flip in the EZVIZ app.`,
          streamRotation: "normal",
        });
      }
      res.json({
        ok: true,
        message: "Camera flip applied. Refresh the live stream.",
        camera: updated,
      });
    } catch (err) {
      console.error("[cctv] fix-timestamp:", err);
      res.status(500).json({ message: "Failed to fix timestamp orientation" });
    }
  });

  app.get("/api/cctv/cameras/:id/hls/:file", async (req, res) => {
    if (!requireView(req, res)) return;
    const id = parseInt(String(req.params.id), 10);
    const file = String(req.params.file ?? "");
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid camera id" });
    const orgId = req.currentUser!.organizationId;
    const camera = await getCctvCamera(id, orgId);
    if (!camera) return res.status(404).json({ message: "Camera not found" });

    const segmentPath = getCctvStreamSegmentPath(orgId, id, file);
    if (!segmentPath) {
      return res.status(404).json({ message: "Segment not found — refresh the stream" });
    }
    const ext = path.extname(segmentPath).toLowerCase();
    const type = ext === ".m3u8" ? "application/vnd.apple.mpegurl" : "video/mp2t";
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(segmentPath).pipe(res);
  });
}
