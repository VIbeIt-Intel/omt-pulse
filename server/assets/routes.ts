import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { ASSET_TYPES } from "@shared/assets";
import { isDispatchStaff } from "@shared/user-roles";
import { isPositionUserEmail } from "@shared/workstations";
import { users } from "@shared/schema";
import { db } from "../storage";
import { createCompanyAsset, deleteCompanyAsset, getCompanyAsset, listCompanyAssets } from "./storage";

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

export function registerAssetRoutes(
  app: Express,
  getCommandScope: (req: Request) => Promise<AssetCommandScope>,
) {
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
