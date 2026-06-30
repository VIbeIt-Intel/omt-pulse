import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  ACCESS_ENTRY_CATEGORIES,
  insertDestinationSchema,
} from "@shared/schema";
import {
  createAccessEntry,
  createDestination,
  getCurrentlyInside,
  getDestinations,
  markAccessExit,
  updateDestination,
} from "./storage";

const ACCESS_ROLES = ["administrator", "supervisor", "reporter"] as const;

function requireAccessRole(req: Request, res: Response, next: NextFunction) {
  const role = req.currentUser?.role;
  if (!role || !ACCESS_ROLES.includes(role as (typeof ACCESS_ROLES)[number])) {
    return res.status(403).json({ message: "Access denied" });
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.currentUser?.role !== "administrator") {
    return res.status(403).json({ message: "Administrator only" });
  }
  next();
}

const vehicleInputSchema = z.object({
  registration: z.string().max(32).optional().nullable(),
  make: z.string().max(64).optional().nullable(),
  model: z.string().max(64).optional().nullable(),
  colour: z.string().max(32).optional().nullable(),
  licenceDiscData: z.string().max(512).optional().nullable(),
});

const createEntrySchema = z.object({
  category: z.enum(ACCESS_ENTRY_CATEGORIES),
  destinationId: z.number().int().positive(),
  personFullName: z.string().min(1).max(200),
  personIdNumber: z.string().max(32).optional().nullable(),
  companyName: z.string().max(200).optional().nullable(),
  contactNumber: z.string().max(32).optional().nullable(),
  purpose: z.string().max(500).optional().nullable(),
  personPhotoUrl: z.string().max(2000).optional().nullable(),
  vehiclePhotoUrl: z.string().max(2000).optional().nullable(),
  vehicle: vehicleInputSchema.optional().nullable(),
});

export function registerAccessControlRoutes(app: Express) {
  // ── Destinations ────────────────────────────────────────────────────────────
  app.get("/api/access-control/destinations", requireAccessRole, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const includeInactive = req.query.all === "1" && req.currentUser!.role === "administrator";
    res.json(await getDestinations(orgId, !includeInactive));
  });

  app.post("/api/access-control/destinations", requireAdmin, async (req, res) => {
    const parsed = insertDestinationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const orgId = req.currentUser!.organizationId;
    const dest = await createDestination(parsed.data, orgId);
    res.status(201).json(dest);
  });

  app.patch("/api/access-control/destinations/:id", requireAdmin, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const partial = insertDestinationSchema.partial().safeParse(req.body);
    if (!partial.success) return res.status(400).json({ message: partial.error.message });
    const orgId = req.currentUser!.organizationId;
    const updated = await updateDestination(id, partial.data, orgId);
    if (!updated) return res.status(404).json({ message: "Destination not found" });
    res.json(updated);
  });

  // ── Entries ─────────────────────────────────────────────────────────────────
  app.get("/api/access-control/currently-inside", requireAccessRole, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    res.json(await getCurrentlyInside(orgId));
  });

  app.post("/api/access-control/entries", requireAccessRole, async (req, res) => {
    const parsed = createEntrySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const orgId = req.currentUser!.organizationId;
    const userId = req.currentUser!.id;

    const dests = await getDestinations(orgId, true);
    if (!dests.some((d) => d.id === parsed.data.destinationId)) {
      return res.status(400).json({ message: "Select a valid active destination" });
    }

    const entry = await createAccessEntry(orgId, userId, parsed.data);
    res.status(201).json(entry);
  });

  app.post("/api/access-control/entries/:id/exit", requireAccessRole, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const orgId = req.currentUser!.organizationId;
    const updated = await markAccessExit(id, orgId);
    if (!updated) return res.status(404).json({ message: "Entry not found or already exited" });
    res.json(updated);
  });
}
