import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  insertPatrolRouteSchema,
  PATROL_CHECKPOINT_LOG_STATUSES,
  PATROL_STATUSES,
} from "@shared/schema";
import { hasPermission } from "@shared/permissions";
import { requirePermission } from "../permission-guard";
import { storage } from "../storage";
import {
  cancelPatrol,
  clockCheckpoint,
  completePatrol,
  createPatrolRoute,
  getActivePatrolForUser,
  getPatrolDetail,
  getPatrolRouteWithCheckpoints,
  listPatrolHistory,
  listPatrolRoutes,
  replaceRouteCheckpoints,
  startPatrol,
  updatePatrolRoute,
} from "./storage";

function canManagePatrolRoutes(role: string): boolean {
  return role === "administrator" || role === "supervisor";
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

const checkpointInputSchema = z.object({
  name: z.string().min(1).max(200),
  orderIndex: z.number().int().min(0),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  instructions: z.string().max(2000).optional().nullable(),
  photoRequired: z.boolean().optional(),
});

const createRouteBodySchema = insertPatrolRouteSchema.extend({
  checkpoints: z.array(checkpointInputSchema).min(1).max(50).optional(),
});

const replaceCheckpointsSchema = z.object({
  checkpoints: z.array(checkpointInputSchema).min(1).max(50),
});

const clockBodySchema = z.object({
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  photoUrl: z.string().max(2000).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  status: z.enum(PATROL_CHECKPOINT_LOG_STATUSES).optional(),
});

export function registerPatrolRoutes(app: Express) {
  // ── Routes (admin/supervisor manage; executors read scoped list) ───────────
  app.get("/api/patrol/routes", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const orgId = req.currentUser.organizationId;
    const isManager = canManagePatrolRoutes(req.currentUser.role);
    const canExecute = hasPermission(req.currentUser.role, "patrol.execute");
    if (!isManager && !canExecute) return res.status(403).json({ message: "Forbidden" });

    const commandIds = isManager ? null : await getUserCommandIds(req);
    const routes = await listPatrolRoutes(orgId, { activeOnly: !isManager, commandIds });
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
      const route = await createPatrolRoute(routeData, orgId, userId);
      if (checkpoints?.length) {
        await replaceRouteCheckpoints(route.id, checkpoints, orgId);
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

    const partial = insertPatrolRouteSchema.partial().safeParse(req.body);
    if (!partial.success) return res.status(400).json({ message: partial.error.message });

    const orgId = req.currentUser!.organizationId;
    const updated = await updatePatrolRoute(id, partial.data, orgId);
    if (!updated) return res.status(404).json({ message: "Route not found" });
    res.json(updated);
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

  // ── Patrol execution ───────────────────────────────────────────────────────
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
