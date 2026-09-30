import { and, desc, eq, inArray } from "drizzle-orm";
import { companyAssets, commands, users } from "@shared/schema";
import type { AssetType } from "@shared/assets";
import { db } from "../storage";

export type CompanyAssetSummary = {
  id: number;
  name: string;
  assetType: AssetType;
  assetTag: string | null;
  notes: string | null;
  commandId: number | null;
  commandName: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastBatteryPercent: number | null;
  lastSeenAt: Date | null;
  createdAt: Date;
};

export async function listCompanyAssets(
  organizationId: string,
  commandFilter?: number[],
): Promise<CompanyAssetSummary[]> {
  const conditions = [eq(companyAssets.organizationId, organizationId)];
  if (commandFilter) {
    conditions.push(inArray(companyAssets.commandId, commandFilter));
  }

  const rows = await db
    .select({
      id: companyAssets.id,
      name: companyAssets.name,
      assetType: companyAssets.assetType,
      assetTag: companyAssets.assetTag,
      notes: companyAssets.notes,
      commandId: companyAssets.commandId,
      commandName: commands.name,
      assignedUserId: companyAssets.assignedUserId,
      assignedFirstName: users.firstName,
      assignedLastName: users.lastName,
      lastLat: companyAssets.lastLat,
      lastLng: companyAssets.lastLng,
      lastBatteryPercent: companyAssets.lastBatteryPercent,
      lastSeenAt: companyAssets.lastSeenAt,
      createdAt: companyAssets.createdAt,
    })
    .from(companyAssets)
    .leftJoin(users, eq(companyAssets.assignedUserId, users.id))
    .leftJoin(commands, eq(companyAssets.commandId, commands.id))
    .where(and(...conditions))
    .orderBy(desc(companyAssets.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    assetType: row.assetType,
    assetTag: row.assetTag,
    notes: row.notes,
    commandId: row.commandId,
    commandName: row.commandName,
    assignedUserId: row.assignedUserId,
    assignedUserName:
      row.assignedFirstName && row.assignedLastName
        ? `${row.assignedFirstName} ${row.assignedLastName}`
        : null,
    lastLat: row.lastLat,
    lastLng: row.lastLng,
    lastBatteryPercent: row.lastBatteryPercent,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
  }));
}

export async function getCompanyAsset(id: number, organizationId: string) {
  const [row] = await db
    .select()
    .from(companyAssets)
    .where(and(eq(companyAssets.id, id), eq(companyAssets.organizationId, organizationId)));
  return row ?? null;
}

export async function createCompanyAsset(values: {
  organizationId: string;
  commandId: number;
  name: string;
  assetType: AssetType;
  assetTag: string | null;
  notes: string | null;
  assignedUserId: string | null;
}) {
  const [row] = await db.insert(companyAssets).values(values).returning();
  return row!;
}

export async function deleteCompanyAsset(id: number, organizationId: string) {
  const [row] = await db
    .delete(companyAssets)
    .where(and(eq(companyAssets.id, id), eq(companyAssets.organizationId, organizationId)))
    .returning({ id: companyAssets.id });
  return row ?? null;
}
