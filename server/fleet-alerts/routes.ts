import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { isDispatchStaff } from "@shared/user-roles";
import type { ResolvedFleetAlertRules } from "@shared/schema";
import {
  getActiveFleetAlertCountsByDevice,
  getFleetAlertDefaults,
  getFleetAlerts,
  getResolvedFleetAlertRules,
  upsertFleetAlertDefaults,
  upsertFleetDeviceAlertRules,
} from "./storage";
import { storage } from "../storage";

function requireFleetAccess(req: Request, res: Response, next: NextFunction) {
  const role = req.currentUser?.role;
  if (!role || (role !== "administrator" && !isDispatchStaff(role))) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
}

function requireFleetAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.currentUser?.role !== "administrator") {
    return res.status(403).json({ message: "Administrator only" });
  }
  next();
}

const rulesPatchSchema = z.object({
  alertsEnabled: z.boolean().optional(),
  speedLimitKph: z.number().min(1).max(300).optional().nullable(),
  idleMinutes: z.number().int().min(1).max(24 * 60).optional().nullable(),
  offlineMinutes: z.number().int().min(1).max(24 * 60).optional().nullable(),
  geofenceEnabled: z.boolean().optional().nullable(),
  geofenceLat: z.number().min(-90).max(90).optional().nullable(),
  geofenceLng: z.number().min(-180).max(180).optional().nullable(),
  geofenceRadiusM: z.number().min(50).max(100_000).optional().nullable(),
});

type RulesPatchInput = z.infer<typeof rulesPatchSchema>;

function normalizeRulesPatch(
  data: RulesPatchInput,
): Partial<ResolvedFleetAlertRules> & { alertsEnabled?: boolean } {
  const patch: Partial<ResolvedFleetAlertRules> & { alertsEnabled?: boolean } = {};
  if (data.alertsEnabled !== undefined) patch.alertsEnabled = data.alertsEnabled;
  if (data.speedLimitKph !== undefined && data.speedLimitKph !== null) patch.speedLimitKph = data.speedLimitKph;
  if (data.idleMinutes !== undefined && data.idleMinutes !== null) patch.idleMinutes = data.idleMinutes;
  if (data.offlineMinutes !== undefined && data.offlineMinutes !== null) patch.offlineMinutes = data.offlineMinutes;
  if (data.geofenceEnabled !== undefined && data.geofenceEnabled !== null) {
    patch.geofenceEnabled = data.geofenceEnabled;
  }
  if (data.geofenceLat !== undefined) patch.geofenceLat = data.geofenceLat;
  if (data.geofenceLng !== undefined) patch.geofenceLng = data.geofenceLng;
  if (data.geofenceRadiusM !== undefined && data.geofenceRadiusM !== null) {
    patch.geofenceRadiusM = data.geofenceRadiusM;
  }
  return patch;
}

export function registerFleetAlertRoutes(app: Express) {
  app.get("/api/fleet-alerts", requireFleetAccess, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const deviceId = req.query.deviceId ? parseInt(String(req.query.deviceId), 10) : undefined;
    const hours = parseInt(String(req.query.hours ?? "168"), 10);
    const limit = parseInt(String(req.query.limit ?? "50"), 10);
    if (deviceId != null && !Number.isFinite(deviceId)) {
      return res.status(400).json({ message: "Invalid deviceId" });
    }
    res.json(
      await getFleetAlerts(orgId, {
        deviceId,
        hours: Number.isFinite(hours) ? hours : 168,
        limit: Number.isFinite(limit) ? limit : 50,
      }),
    );
  });

  app.get("/api/fleet-alerts/counts", requireFleetAccess, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const hours = parseInt(String(req.query.hours ?? "24"), 10);
    res.json(await getActiveFleetAlertCountsByDevice(orgId, Number.isFinite(hours) ? hours : 24));
  });

  app.get("/api/fleet-alerts/rules/defaults", requireFleetAccess, async (req, res) => {
    res.json(await getFleetAlertDefaults(req.currentUser!.organizationId));
  });

  app.patch("/api/fleet-alerts/rules/defaults", requireFleetAdmin, async (req, res) => {
    const parsed = rulesPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const orgId = req.currentUser!.organizationId;
    res.json(await upsertFleetAlertDefaults(orgId, normalizeRulesPatch(parsed.data)));
  });

  app.get("/api/fleet-alerts/rules/:deviceId", requireFleetAccess, async (req, res) => {
    const deviceId = parseInt(String(req.params.deviceId), 10);
    if (!Number.isFinite(deviceId)) return res.status(400).json({ message: "Invalid deviceId" });
    const orgId = req.currentUser!.organizationId;
    const device = await storage.getTrackerDeviceById(deviceId, orgId);
    if (!device) return res.status(404).json({ message: "Not found" });
    res.json(await getResolvedFleetAlertRules(orgId, deviceId));
  });

  app.patch("/api/fleet-alerts/rules/:deviceId", requireFleetAdmin, async (req, res) => {
    const deviceId = parseInt(String(req.params.deviceId), 10);
    if (!Number.isFinite(deviceId)) return res.status(400).json({ message: "Invalid deviceId" });
    const parsed = rulesPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const orgId = req.currentUser!.organizationId;
    const device = await storage.getTrackerDeviceById(deviceId, orgId);
    if (!device) return res.status(404).json({ message: "Not found" });
    res.json(await upsertFleetDeviceAlertRules(orgId, deviceId, normalizeRulesPatch(parsed.data)));
  });
}
