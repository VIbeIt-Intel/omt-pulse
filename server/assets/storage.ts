import { randomBytes } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { companyAssets, commands, users } from "@shared/schema";
import type { AssetType } from "@shared/assets";
import { db } from "../storage";

const ENROLMENT_TTL_MS = 48 * 60 * 60 * 1000;

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
  trackerLinked: boolean;
  enrolledAt: Date | null;
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
      deviceToken: companyAssets.deviceToken,
      enrolledAt: companyAssets.enrolledAt,
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
    trackerLinked: !!row.deviceToken,
    enrolledAt: row.enrolledAt,
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

function generateEnrolmentCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

function generateDeviceToken(): string {
  return randomBytes(32).toString("hex");
}

export async function issueAssetEnrolmentCode(id: number, organizationId: string) {
  const existing = await getCompanyAsset(id, organizationId);
  if (!existing) return null;
  const enrolmentCode = generateEnrolmentCode();
  const enrolmentExpiresAt = new Date(Date.now() + ENROLMENT_TTL_MS);
  await db
    .update(companyAssets)
    .set({ enrolmentCode, enrolmentExpiresAt })
    .where(and(eq(companyAssets.id, id), eq(companyAssets.organizationId, organizationId)));
  return { enrolmentCode, enrolmentExpiresAt, trackerLinked: !!existing.deviceToken };
}

export async function enrolAssetByCode(rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-F0-9]{8}$/.test(code)) {
    throw new Error("Enter the 8-character code from Assets");
  }
  const [existing] = await db
    .select()
    .from(companyAssets)
    .where(eq(companyAssets.enrolmentCode, code));
  if (!existing || !existing.enrolmentExpiresAt || existing.enrolmentExpiresAt.getTime() <= Date.now()) {
    throw new Error("That code is invalid or expired");
  }
  const deviceToken = generateDeviceToken();
  const enrolledAt = new Date();
  await db
    .update(companyAssets)
    .set({
      deviceToken,
      enrolledAt,
      enrolmentCode: null,
      enrolmentExpiresAt: null,
    })
    .where(eq(companyAssets.id, existing.id));
  return { deviceToken, name: existing.name, assetType: existing.assetType };
}

export async function getAssetByDeviceToken(deviceToken: string) {
  const [row] = await db.select().from(companyAssets).where(eq(companyAssets.deviceToken, deviceToken));
  return row ?? null;
}

export async function recordAssetFix(
  deviceToken: string,
  fix: { latitude: number; longitude: number; batteryPercent: number | null },
) {
  const [row] = await db
    .update(companyAssets)
    .set({
      lastLat: fix.latitude,
      lastLng: fix.longitude,
      lastSeenAt: new Date(),
      ...(fix.batteryPercent != null ? { lastBatteryPercent: fix.batteryPercent } : {}),
    })
    .where(eq(companyAssets.deviceToken, deviceToken))
    .returning({
      id: companyAssets.id,
      name: companyAssets.name,
      lastSeenAt: companyAssets.lastSeenAt,
    });
  return row ?? null;
}

export async function unlinkAssetTracker(id: number, organizationId: string) {
  const existing = await getCompanyAsset(id, organizationId);
  if (!existing) return null;
  await db
    .update(companyAssets)
    .set({
      deviceToken: null,
      enrolmentCode: null,
      enrolmentExpiresAt: null,
      enrolledAt: null,
    })
    .where(and(eq(companyAssets.id, id), eq(companyAssets.organizationId, organizationId)));
  return { ok: true as const };
}

export async function deleteCompanyAsset(id: number, organizationId: string) {
  const [row] = await db
    .delete(companyAssets)
    .where(and(eq(companyAssets.id, id), eq(companyAssets.organizationId, organizationId)))
    .returning({ id: companyAssets.id });
  return row ?? null;
}
