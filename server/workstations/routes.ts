import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { insertWorkstationSchema, workstations } from "@shared/schema";
import { getPermissionsForRole } from "@shared/permissions";
import { isValidShiftPin, WORKSTATION_TOKEN_HEADER } from "@shared/workstations";
import { db } from "../storage";
import { eq } from "drizzle-orm";
import {
  createWorkstation,
  enrolWorkstationByCode,
  findUserByShiftPin,
  getWorkstationByDeviceToken,
  getWorkstationsByOrg,
  regenerateWorkstationEnrolmentCode,
  setWorkstationOperator,
  touchWorkstation,
  updateWorkstation,
  userCanOperateWorkstation,
} from "./storage";

export { WORKSTATION_TOKEN_HEADER } from "@shared/workstations";

export function readWorkstationToken(req: Request): string | null {
  const raw = req.headers[WORKSTATION_TOKEN_HEADER];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

declare global {
  namespace Express {
    interface Request {
      currentWorkstation?: NonNullable<Awaited<ReturnType<typeof getWorkstationByDeviceToken>>>;
    }
  }
}

export async function attachWorkstation(req: Request, _res: Response, next: NextFunction) {
  const token = readWorkstationToken(req);
  if (!token) return next();
  const ws = await getWorkstationByDeviceToken(token);
  if (ws?.isActive && ws.deviceToken) {
    req.currentWorkstation = ws;
    void touchWorkstation(ws.id);
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.currentUser?.role !== "administrator") {
    return res.status(403).json({ message: "Administrator only" });
  }
  next();
}

function requireWorkstationToken(req: Request, res: Response, next: NextFunction) {
  if (!req.currentWorkstation) {
    return res.status(401).json({ message: "Workstation not enrolled on this device" });
  }
  next();
}

const createWorkstationBodySchema = insertWorkstationSchema.extend({
  locationId: z.number().int().positive(),
  commandId: z.number().int().positive().optional().nullable(),
});

export function registerWorkstationRoutes(app: Express) {
  app.get("/api/workstations", requireAdmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    res.json(await getWorkstationsByOrg(orgId));
  });

  app.post("/api/workstations", requireAdmin, async (req, res) => {
    const parsed = createWorkstationBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    const orgId = req.currentUser!.organizationId;
    const created = await createWorkstation(parsed.data, orgId);
    res.status(201).json(created);
  });

  app.patch("/api/workstations/:id", requireAdmin, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const partial = insertWorkstationSchema.partial().extend({
      isActive: z.boolean().optional(),
    }).safeParse(req.body);
    if (!partial.success) return res.status(400).json({ message: partial.error.message });
    const orgId = req.currentUser!.organizationId;
    const updated = await updateWorkstation(id, orgId, partial.data);
    if (!updated) return res.status(404).json({ message: "Workstation not found" });
    res.json(updated);
  });

  app.post("/api/workstations/:id/regenerate-code", requireAdmin, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const orgId = req.currentUser!.organizationId;
    const result = await regenerateWorkstationEnrolmentCode(id, orgId);
    if (!result) return res.status(404).json({ message: "Workstation not found" });
    res.json(result);
  });

  app.post("/api/workstations/enrol", async (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    if (!code.trim()) return res.status(400).json({ message: "Enrolment code is required" });
    try {
      const result = await enrolWorkstationByCode(code);
      res.json(result);
    } catch (err) {
      res.status(400).json({ message: err instanceof Error ? err.message : "Enrolment failed" });
    }
  });

  app.get("/api/workstations/me", requireWorkstationToken, async (req, res) => {
    const ws = req.currentWorkstation!;
    res.json({
      workstation: ws,
      operatorLoggedIn: !!req.session.userId,
      sessionWorkstationId: req.session.workstationId ?? null,
    });
  });

  app.post("/api/workstations/shift-login", requireWorkstationToken, async (req, res) => {
    const pin = typeof req.body?.pin === "string" ? req.body.pin.trim() : "";
    if (!isValidShiftPin(pin)) {
      return res.status(400).json({ message: "PIN must be 4–6 digits" });
    }

    const ws = req.currentWorkstation!;
    const operator = await findUserByShiftPin(ws.organizationId, pin);
    if (!operator) {
      return res.status(401).json({ message: "Incorrect PIN" });
    }

    const allowed = await userCanOperateWorkstation(operator.id, ws);
    if (!allowed) {
      return res.status(403).json({ message: "You are not assigned to operate this device" });
    }

    req.session.userId = operator.id;
    req.session.workstationId = ws.id;
    await setWorkstationOperator(ws.id, operator.id);

    const { password: _pw, shiftPinHash: _pin, ...safeUser } = operator;
    res.json({
      user: {
        ...safeUser,
        permissions: getPermissionsForRole(operator.role),
      },
      workstation: await getWorkstationByDeviceToken(ws.deviceToken!),
    });
  });

  app.post("/api/workstations/shift-logout", requireWorkstationToken, async (req, res) => {
    const ws = req.currentWorkstation!;
    if (req.session.workstationId === ws.id) {
      req.session.userId = undefined;
      req.session.workstationId = undefined;
    }
    await setWorkstationOperator(ws.id, null);
    req.session.save((err) => {
      if (err) return res.status(500).json({ message: "Logout failed" });
      res.json({ ok: true });
    });
  });

  app.post("/api/workstations/heartbeat", requireWorkstationToken, async (req, res) => {
    const ws = req.currentWorkstation!;
    const lat = typeof req.body?.lat === "number" ? req.body.lat : undefined;
    const lng = typeof req.body?.lng === "number" ? req.body.lng : undefined;
    await touchWorkstation(ws.id, lat != null && lng != null ? { lat, lng } : undefined);
    res.json({ ok: true });
  });

  app.post("/api/workstations/unenrol", requireWorkstationToken, async (req, res) => {
    const ws = req.currentWorkstation!;
    if (req.session.workstationId === ws.id) {
      req.session.userId = undefined;
      req.session.workstationId = undefined;
    }
    await db
      .update(workstations)
      .set({
        deviceToken: null,
        enrolledAt: null,
        currentOperatorUserId: null,
        operatorSessionStartedAt: null,
      })
      .where(eq(workstations.id, ws.id));
    req.session.save((err) => {
      if (err) return res.status(500).json({ message: "Unenrol failed" });
      res.json({ ok: true });
    });
  });
}
