import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  insertPatrolRouteSchema,
  PATROL_CHECKPOINT_LOG_STATUSES,
  PATROL_STATUSES,
  DEFAULT_PATROL_CHECKPOINT_RADIUS_M,
} from "@shared/schema";
import { hasPermission } from "@shared/permissions";
import { requirePermission } from "../permission-guard";
import { storage } from "../storage";
import {
  appendPatrolTrackPoints,
  cancelPatrol,
  clockCheckpoint,
  completePatrol,
  createPatrolRoute,
  findPatrolByTrackToken,
  getActivePatrolForUser,
  getPatrolDetail,
  getPatrolReport,
  getPatrolRouteWithCheckpoints,
  getPatrolTrackPoints,
  listPatrolHistory,
  listPatrolRoutes,
  replaceRouteCheckpoints,
  startPatrol,
  updatePatrolRoute,
} from "./storage";
import {
  getScheduleForRoute,
  listAssigneeCandidates,
  listPendingDispatchesForUser,
  upsertScheduleForRoute,
} from "./schedule-storage";

function canManagePatrolRoutes(role: string): boolean {
  return role === "administrator" || role === "supervisor";
}

/** Explicit premises assignments; empty = no restriction (same pattern as incidents). */
async function getExecutorLocationScope(
  userId: string,
  orgId: string,
): Promise<number[] | null> {
  const assigned = await storage.getUserLocationAssignments(userId, orgId);
  return assigned.length > 0 ? assigned : null;
}

function assertRouteLocationAccess(
  routeLocationId: number | null | undefined,
  locationIds: number[] | null,
): boolean {
  if (locationIds == null) return true;
  if (routeLocationId == null) return true;
  return locationIds.includes(routeLocationId);
}

async function assertLocationInOrg(locationId: number | null | undefined, orgId: string): Promise<void> {
  if (locationId == null) return;
  const loc = await storage.getLocation(locationId, orgId);
  if (!loc) throw new Error("Premises not found");
}

function requirePatrolManager(req: Request, res: Response, next: NextFunction) {
  if (!req.currentUser || !canManagePatrolRoutes(req.currentUser.role)) {
    return res.status(403).json({ message: "Administrator or supervisor only" });
  }
  next();
}

async function getUserCommandIds(req: Request): Promise<number[]> {
  const cmds = await storage.getUserCommands(req.currentUser!.id);
  return cmds.map((c) => c.id);
}

function readPatrolTrackToken(req: Request): string | null {
  const header = req.headers["x-patrol-track-token"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || null;
  }
  return null;
}

const checkpointInputSchema = z.object({
  name: z.string().min(1).max(200),
  orderIndex: z.number().int().min(0),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  geofenceRadiusM: z.number().min(15).max(500).optional().nullable(),
  instructions: z.string().max(2000).optional().nullable(),
  photoRequired: z.boolean().optional(),
});

const createRouteBodySchema = insertPatrolRouteSchema.extend({
  checkpoints: z.array(checkpointInputSchema).min(1).max(50).optional(),
});

const updateRouteBodySchema = insertPatrolRouteSchema.partial();

const replaceCheckpointsSchema = z.object({
  checkpoints: z.array(checkpointInputSchema).min(1).max(50),
});

const clockBodySchema = z.object({
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  accuracyM: z.number().positive().max(5000).optional().nullable(),
  photoUrl: z.string().max(2000).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  status: z.enum(PATROL_CHECKPOINT_LOG_STATUSES).optional(),
});

const trackBatchSchema = z.object({
  points: z
    .array(
      z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        recordedAt: z.union([z.string().min(1), z.number()]),
        accuracyM: z.number().positive().max(5000).optional().nullable(),
        heading: z.number().min(0).max(360).optional().nullable(),
        speedMps: z.number().min(0).max(100).optional().nullable(),
        altitudeM: z.number().optional().nullable(),
        seq: z.number().int().nonnegative().optional().nullable(),
      }),
    )
    .min(1)
    .max(100),
});

const upsertScheduleBodySchema = z.object({
  isEnabled: z.boolean(),
  intervalMinutes: z.number().int().min(30).max(180).default(60),
  jitterMinutes: z.number().int().min(0).max(30).default(12),
  startWithinMinutes: z.number().int().min(5).max(60).default(15),
  quietStartHour: z.number().int().min(0).max(23).nullable().optional(),
  quietEndHour: z.number().int().min(0).max(23).nullable().optional(),
  assigneeUserIds: z.array(z.string().min(1)).max(50).optional(),
});

export function registerPatrolRoutes(app: Express) {
  app.get("/api/patrol/routes", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const orgId = req.currentUser.organizationId;
    const isManager = canManagePatrolRoutes(req.currentUser.role);
    const canExecute = hasPermission(req.currentUser.role, "patrol.execute");
    if (!isManager && !canExecute) return res.status(403).json({ message: "Forbidden" });

    const commandIds = isManager ? null : await getUserCommandIds(req);
    const locationIds = isManager
      ? null
      : await getExecutorLocationScope(req.currentUser!.id, orgId);
    const routes = await listPatrolRoutes(orgId, {
      activeOnly: !isManager,
      commandIds,
      locationIds,
    });
    res.json(routes);
  });

  app.get("/api/patrol/routes/:id", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const route = await getPatrolRouteWithCheckpoints(id, req.currentUser.organizationId);
    if (!route) return res.status(404).json({ message: "Route not found" });

    const isManager = canManagePatrolRoutes(req.currentUser.role);
    if (!isManager) {
      if (!hasPermission(req.currentUser.role, "patrol.execute")) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (!route.isActive) return res.status(404).json({ message: "Route not found" });
      if (route.commandId != null) {
        const commandIds = await getUserCommandIds(req);
        if (!commandIds.includes(route.commandId)) {
          return res.status(403).json({ message: "Route not available for your group" });
        }
      }
      const locationIds = await getExecutorLocationScope(req.currentUser!.id, req.currentUser!.organizationId);
      if (!assertRouteLocationAccess(route.locationId, locationIds)) {
        return res.status(403).json({ message: "Route not available for your premises" });
      }
    }

    res.json(route);
  });

  app.post("/api/patrol/routes", requirePatrolManager, async (req, res) => {
    const parsed = createRouteBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const orgId = req.currentUser!.organizationId;
    const userId = req.currentUser!.id;
    const { checkpoints, ...routeData } = parsed.data;

    try {
      await assertLocationInOrg(routeData.locationId ?? null, orgId);
      const route = await createPatrolRoute(routeData, orgId, userId);
      if (checkpoints?.length) {
        await replaceRouteCheckpoints(
          route.id,
          checkpoints.map((cp) => ({
            ...cp,
            geofenceRadiusM: cp.geofenceRadiusM ?? DEFAULT_PATROL_CHECKPOINT_RADIUS_M,
          })),
          orgId,
        );
      }
      const full = await getPatrolRouteWithCheckpoints(route.id, orgId);
      res.status(201).json(full);
    } catch (err) {
      res.status(400).json({ message: err instanceof Error ? err.message : "Failed to create route" });
    }
  });

  app.patch("/api/patrol/routes/:id", requirePatrolManager, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const partial = updateRouteBodySchema.safeParse(req.body);
    if (!partial.success) return res.status(400).json({ message: partial.error.message });

    const orgId = req.currentUser!.organizationId;
    try {
      await assertLocationInOrg(partial.data.locationId, orgId);
      const updated = await updatePatrolRoute(id, partial.data, orgId);
      if (!updated) return res.status(404).json({ message: "Route not found" });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ message: err instanceof Error ? err.message : "Failed to update route" });
    }
  });

  app.put("/api/patrol/routes/:id/checkpoints", requirePatrolManager, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const parsed = replaceCheckpointsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    try {
      const checkpoints = await replaceRouteCheckpoints(id, parsed.data.checkpoints, req.currentUser!.organizationId);
      res.json(checkpoints);
    } catch (err) {
      res.status(400).json({ message: err instanceof Error ? err.message : "Failed to update checkpoints" });
    }
  });

  app.get("/api/patrol/routes/:id/schedule", requirePatrolManager, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const schedule = await getScheduleForRoute(id, req.currentUser!.organizationId);
    res.json(
      schedule ?? {
        routeId: id,
        isEnabled: false,
        intervalMinutes: 60,
        jitterMinutes: 12,
        startWithinMinutes: 15,
        quietStartHour: null,
        quietEndHour: null,
        assigneeUserIds: [],
        nextDueAt: null,
        lastDispatchedAt: null,
      },
    );
  });

  app.put("/api/patrol/routes/:id/schedule", requirePatrolManager, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const parsed = upsertScheduleBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    try {
      const schedule = await upsertScheduleForRoute(
        id,
        req.currentUser!.organizationId,
        req.currentUser!.id,
        parsed.data,
      );
      res.json(schedule);
    } catch (err) {
      res.status(400).json({ message: err instanceof Error ? err.message : "Failed to save schedule" });
    }
  });

  app.get("/api/patrol/assignee-candidates", requirePatrolManager, async (req, res) => {
    res.json(await listAssigneeCandidates(req.currentUser!.organizationId));
  });

  app.get("/api/patrol/dispatches/pending", async (req, res) => {
    if (!requirePermission(req, res, "patrol.execute")) return;
    const pending = await listPendingDispatchesForUser(
      req.currentUser!.id,
      req.currentUser!.organizationId,
    );
    res.json(pending);
  });

  app.get("/api/patrol/patrols/active", async (req, res) => {
    if (!requirePermission(req, res, "patrol.execute")) return;
    const active = await getActivePatrolForUser(req.currentUser!.id, req.currentUser!.organizationId);
    res.json(active ?? null);
  });

  app.get("/api/patrol/patrols", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    if (!canManagePatrolRoutes(req.currentUser.role)) {
      return res.status(403).json({ message: "Administrator or supervisor only" });
    }

    const status = typeof req.query.status === "string" && PATROL_STATUSES.includes(req.query.status as any)
      ? req.query.status
      : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;

    res.json(await listPatrolHistory(req.currentUser.organizationId, { status, limit }));
  });

  app.get("/api/patrol/patrols/:id", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const detail = await getPatrolDetail(id, req.currentUser.organizationId);
    if (!detail) return res.status(404).json({ message: "Patrol not found" });

    const isManager = canManagePatrolRoutes(req.currentUser.role);
    const isOwner = detail.startedByUserId === req.currentUser.id;
    const canExecute = hasPermission(req.currentUser.role, "patrol.execute");
    if (!isManager && !(canExecute && isOwner)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    res.json(detail);
  });

  app.get("/api/patrol/patrols/:id/report", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const report = await getPatrolReport(id, req.currentUser.organizationId);
    if (!report) return res.status(404).json({ message: "Patrol not found" });

    const isManager = canManagePatrolRoutes(req.currentUser.role);
    const isOwner = report.startedByUserId === req.currentUser.id;
    const canExecute = hasPermission(req.currentUser.role, "patrol.execute");
    if (!isManager && !(canExecute && isOwner)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    res.json(report);
  });

  app.get("/api/patrol/patrols/:id/track", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const detail = await getPatrolDetail(id, req.currentUser.organizationId);
    if (!detail) return res.status(404).json({ message: "Patrol not found" });

    const isManager = canManagePatrolRoutes(req.currentUser.role);
    const isOwner = detail.startedByUserId === req.currentUser.id;
    if (!isManager && !isOwner) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const points = await getPatrolTrackPoints(id, req.currentUser.organizationId);
    res.json(points);
  });

  app.post("/api/patrol/patrols/:id/track", async (req, res) => {
    const patrolId = parseInt(String(req.params.id), 10);
    if (isNaN(patrolId)) return res.status(400).json({ message: "Invalid id" });

    const parsed = trackBatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const token = readPatrolTrackToken(req);
    let orgId: string | null = null;
    let authorized = false;

    if (token) {
      const byToken = await findPatrolByTrackToken(patrolId, token);
      if (byToken && byToken.status === "in_progress") {
        orgId = byToken.organizationId;
        authorized = true;
      }
    }

    if (!authorized && req.currentUser) {
      if (!requirePermission(req, res, "patrol.execute")) return;
      const detail = await getPatrolDetail(patrolId, req.currentUser.organizationId);
      if (!detail || detail.startedByUserId !== req.currentUser.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      orgId = req.currentUser.organizationId;
      authorized = true;
    }

    if (!authorized || !orgId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const result = await appendPatrolTrackPoints(
        patrolId,
        orgId,
        parsed.data.points.map((p) => ({
          ...p,
          recordedAt: typeof p.recordedAt === "number" ? new Date(p.recordedAt) : p.recordedAt,
        })),
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ message: err instanceof Error ? err.message : "Failed to save track" });
    }
  });

  app.post("/api/patrol/patrols", async (req, res) => {
    if (!requirePermission(req, res, "patrol.execute")) return;

    const bodySchema = z.object({ routeId: z.number().int().positive() });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const orgId = req.currentUser!.organizationId;
    const userId = req.currentUser!.id;

    const route = await getPatrolRouteWithCheckpoints(parsed.data.routeId, orgId);
    if (!route || !route.isActive) return res.status(400).json({ message: "Route not found or inactive" });
    if (route.commandId != null) {
      const commandIds = await getUserCommandIds(req);
      if (!commandIds.includes(route.commandId)) {
        return res.status(403).json({ message: "Route not available for your group" });
      }
    }
    const locationIds = await getExecutorLocationScope(userId, orgId);
    if (!assertRouteLocationAccess(route.locationId, locationIds)) {
      return res.status(403).json({ message: "Route not available for your premises" });
    }

    try {
      const patrol = await startPatrol(parsed.data.routeId, userId, orgId);
      res.status(201).json(patrol);
    } catch (err) {
      res.status(400).json({ message: err instanceof Error ? err.message : "Failed to start patrol" });
    }
  });

  app.post("/api/patrol/patrols/:id/checkpoints/:checkpointId/clock", async (req, res) => {
    if (!requirePermission(req, res, "patrol.execute")) return;

    const patrolId = parseInt(String(req.params.id), 10);
    const checkpointId = parseInt(String(req.params.checkpointId), 10);
    if (isNaN(patrolId) || isNaN(checkpointId)) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const parsed = clockBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    try {
      const detail = await clockCheckpoint(
        patrolId,
        checkpointId,
        parsed.data,
        req.currentUser!.organizationId,
        req.currentUser!.id,
      );
      res.json(detail);
    } catch (err) {
      res.status(400).json({ message: err instanceof Error ? err.message : "Failed to clock checkpoint" });
    }
  });

  app.post("/api/patrol/patrols/:id/complete", async (req, res) => {
    if (!requirePermission(req, res, "patrol.execute")) return;

    const patrolId = parseInt(String(req.params.id), 10);
    if (isNaN(patrolId)) return res.status(400).json({ message: "Invalid id" });

    try {
      const patrol = await completePatrol(patrolId, req.currentUser!.organizationId, req.currentUser!.id);
      res.json(patrol);
    } catch (err) {
      res.status(400).json({ message: err instanceof Error ? err.message : "Failed to complete patrol" });
    }
  });

  app.post("/api/patrol/patrols/:id/cancel", async (req, res) => {
    if (!requirePermission(req, res, "patrol.execute")) return;

    const patrolId = parseInt(String(req.params.id), 10);
    if (isNaN(patrolId)) return res.status(400).json({ message: "Invalid id" });

    try {
      const patrol = await cancelPatrol(patrolId, req.currentUser!.organizationId, req.currentUser!.id);
      res.json(patrol);
    } catch (err) {
      res.status(400).json({ message: err instanceof Error ? err.message : "Failed to cancel patrol" });
    }
  });
}
