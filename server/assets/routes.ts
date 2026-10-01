import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { ASSET_TRACKER_TOKEN_HEADER, ASSET_TYPES } from "@shared/assets";
import { isDispatchStaff } from "@shared/user-roles";
import { isPositionUserEmail } from "@shared/workstations";
import { users } from "@shared/schema";
import { db } from "../storage";
import {
  createCompanyAsset,
  deleteCompanyAsset,
  enrolAssetByCode,
  getAssetByDeviceToken,
  getCompanyAsset,
  issueAssetEnrolmentCode,
  listCompanyAssets,
  recordAssetFix,
  unlinkAssetTracker,
} from "./storage";

type AssetCommandScope = {
  commandFilter: number[] | undefined;
  writeAccessCommandIds: number[];
  defaultStampCommandId: number | null;
};

const createAssetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  assetType: z.enum(ASSET_TYPES),
  assetTag: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  assignedUserId: z.string().trim().min(1).optional().nullable(),
  commandId: z.number().int().positive().optional().nullable(),
});

function requireDispatch(req: Request, res: Response): boolean {
  const role = req.currentUser?.role;
  if (!role || !isDispatchStaff(role)) {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  return true;
}

function readAssetToken(req: Request): string | null {
  const header = req.get(ASSET_TRACKER_TOKEN_HEADER);
  if (header?.trim()) return header.trim();
  const query = typeof req.query.token === "string" ? req.query.token.trim() : "";
  return query || null;
}

const fixSchema = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  batteryPercent: z.number().int().min(0).max(100).nullable().optional(),
  recordedAt: z.union([z.string(), z.number()]).optional(),
  time: z.number().optional(),
});

function latestFix(body: unknown): z.infer<typeof fixSchema> | null {
  const many = z.object({ points: z.array(fixSchema).min(1).max(50) }).safeParse(body);
  if (many.success) return many.data.points[many.data.points.length - 1]!;
  const one = fixSchema.safeParse(body);
  return one.success ? one.data : null;
}

function trackerAppPath(): string | null {
  const candidates = [
    path.resolve(__dirname, "public", "omt-tracker.apk"),
    path.resolve(process.cwd(), "dist", "public", "omt-tracker.apk"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function registerAssetRoutes(
  app: Express,
  getCommandScope: (req: Request) => Promise<AssetCommandScope>,
) {
  app.get("/api/assets/tracker-app", (_req, res) => {
    const file = trackerAppPath();
    if (!file) return res.status(404).json({ message: "Tracker app is not available" });
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", 'attachment; filename="omt-tracker.apk"');
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(file);
  });

  app.get("/api/assets", async (req, res) => {
    if (!requireDispatch(req, res)) return;
    const { organizationId } = req.currentUser!;
    const { commandFilter } = await getCommandScope(req);
    const assets = await listCompanyAssets(organizationId, commandFilter);
    res.json(assets);
  });

  app.post("/api/assets", async (req, res) => {
    if (!requireDispatch(req, res)) return;
    const parsed = createAssetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Enter a name and asset type" });
    }

    const { organizationId } = req.currentUser!;
    const scope = await getCommandScope(req);
    const requestedCommandId = parsed.data.commandId ?? null;
    const commandId = requestedCommandId ?? scope.defaultStampCommandId;
    if (commandId == null || !scope.writeAccessCommandIds.includes(commandId)) {
      return res.status(403).json({ message: "You cannot add assets in this group" });
    }

    const assignedUserId = parsed.data.assignedUserId || null;
    if (assignedUserId) {
      const [assignee] = await db
        .select({
          id: users.id,
          email: users.email,
          isActive: users.isActive,
          organizationId: users.organizationId,
        })
        .from(users)
        .where(and(eq(users.id, assignedUserId), eq(users.organizationId, organizationId)));
      if (!assignee || !assignee.isActive || isPositionUserEmail(assignee.email)) {
        return res.status(400).json({ message: "Assignee is not available" });
      }
    }

    const created = await createCompanyAsset({
      organizationId,
      commandId,
      name: parsed.data.name,
      assetType: parsed.data.assetType,
      assetTag: parsed.data.assetTag?.trim() || null,
      notes: parsed.data.notes?.trim() || null,
      assignedUserId,
    });
    res.status(201).json(created);
  });

  app.post("/api/assets/:id/enrolment-code", async (req, res) => {
    if (!requireDispatch(req, res)) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const { organizationId } = req.currentUser!;
    const existing = await getCompanyAsset(id, organizationId);
    if (!existing) return res.status(404).json({ message: "Not found" });
    const scope = await getCommandScope(req);
    if (existing.commandId == null || !scope.writeAccessCommandIds.includes(existing.commandId)) {
      return res.status(403).json({ message: "You cannot enrol a tracker in this group" });
    }
    const issued = await issueAssetEnrolmentCode(id, organizationId);
    if (!issued) return res.status(404).json({ message: "Not found" });
    res.json(issued);
  });

  app.post("/api/assets/:id/unlink-tracker", async (req, res) => {
    if (!requireDispatch(req, res)) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const { organizationId } = req.currentUser!;
    const existing = await getCompanyAsset(id, organizationId);
    if (!existing) return res.status(404).json({ message: "Not found" });
    const scope = await getCommandScope(req);
    if (existing.commandId == null || !scope.writeAccessCommandIds.includes(existing.commandId)) {
      return res.status(403).json({ message: "You cannot unlink a tracker in this group" });
    }
    await unlinkAssetTracker(id, organizationId);
    res.json({ ok: true });
  });

  app.post("/api/assets/enrol", async (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    try {
      const enrolled = await enrolAssetByCode(code);
      res.json(enrolled);
    } catch (err) {
      res.status(400).json({ message: err instanceof Error ? err.message : "Enrolment failed" });
    }
  });

  app.get("/api/assets/tracker", async (req, res) => {
    const token = readAssetToken(req);
    if (!token) return res.status(401).json({ message: "Tracker not enrolled" });
    const asset = await getAssetByDeviceToken(token);
    if (!asset) return res.status(401).json({ message: "This tracker was removed" });
    res.json({
      name: asset.name,
      assetType: asset.assetType,
      lastLat: asset.lastLat,
      lastLng: asset.lastLng,
      lastBatteryPercent: asset.lastBatteryPercent,
      lastSeenAt: asset.lastSeenAt,
    });
  });

  app.post("/api/assets/heartbeat", async (req, res) => {
    const token = readAssetToken(req);
    if (!token) return res.status(401).json({ message: "Tracker not enrolled" });
    const fix = latestFix(req.body);
    if (!fix) return res.status(400).json({ message: "A location is required" });
    const saved = await recordAssetFix(token, {
      latitude: fix.latitude,
      longitude: fix.longitude,
      batteryPercent: fix.batteryPercent ?? null,
    });
    if (!saved) return res.status(401).json({ message: "This tracker was removed" });
    res.json({ ok: true, name: saved.name, lastSeenAt: saved.lastSeenAt });
  });

  app.delete("/api/assets/:id", async (req, res) => {
    if (!requireDispatch(req, res)) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });

    const { organizationId } = req.currentUser!;
    const existing = await getCompanyAsset(id, organizationId);
    if (!existing) return res.status(404).json({ message: "Not found" });

    const scope = await getCommandScope(req);
    if (existing.commandId == null || !scope.writeAccessCommandIds.includes(existing.commandId)) {
      return res.status(403).json({ message: "You cannot remove assets in this group" });
    }

    await deleteCompanyAsset(id, organizationId);
    res.json({ ok: true });
  });
}
