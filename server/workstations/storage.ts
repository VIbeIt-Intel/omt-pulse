import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import {
  workstations,
  locations,
  commands,
  users,
  commandUsers,
  type Workstation,
  type WorkstationWithDetails,
  type InsertWorkstation,
} from "@shared/schema";
import { WORKSTATION_TYPES } from "@shared/workstations";
import { db } from "../storage";
import { and, eq, asc, isNotNull } from "drizzle-orm";

const SALT_ROUNDS = 10;
const ENROLMENT_TTL_MS = 48 * 60 * 60 * 1000;

function generateEnrolmentCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

function generateDeviceToken(): string {
  return randomBytes(32).toString("hex");
}

function hydrateWorkstation(
  row: Workstation,
  locationName: string | null,
  commandName: string | null,
  operatorFirst: string | null,
  operatorLast: string | null,
): WorkstationWithDetails {
  const operatorName =
    operatorFirst || operatorLast
      ? `${operatorFirst ?? ""} ${operatorLast ?? ""}`.trim()
      : null;
  return {
    ...row,
    locationName,
    commandName,
    currentOperatorName: operatorName,
  };
}

async function fetchWorkstationDetails(
  where: ReturnType<typeof eq> | ReturnType<typeof and>,
): Promise<WorkstationWithDetails | undefined> {
  const [row] = await db
    .select({
      ws: workstations,
      locationName: locations.name,
      commandName: commands.name,
      operatorFirst: users.firstName,
      operatorLast: users.lastName,
    })
    .from(workstations)
    .leftJoin(locations, eq(workstations.locationId, locations.id))
    .leftJoin(commands, eq(workstations.commandId, commands.id))
    .leftJoin(users, eq(workstations.currentOperatorUserId, users.id))
    .where(where)
    .limit(1);

  if (!row) return undefined;
  return hydrateWorkstation(
    row.ws,
    row.locationName,
    row.commandName,
    row.operatorFirst,
    row.operatorLast,
  );
}

export async function getWorkstationsByOrg(orgId: string): Promise<WorkstationWithDetails[]> {
  const rows = await db
    .select({
      ws: workstations,
      locationName: locations.name,
      commandName: commands.name,
      operatorFirst: users.firstName,
      operatorLast: users.lastName,
    })
    .from(workstations)
    .leftJoin(locations, eq(workstations.locationId, locations.id))
    .leftJoin(commands, eq(workstations.commandId, commands.id))
    .leftJoin(users, eq(workstations.currentOperatorUserId, users.id))
    .where(eq(workstations.organizationId, orgId))
    .orderBy(asc(workstations.name));

  return rows.map((r) =>
    hydrateWorkstation(r.ws, r.locationName, r.commandName, r.operatorFirst, r.operatorLast),
  );
}

export async function getWorkstationById(id: number, orgId: string): Promise<WorkstationWithDetails | undefined> {
  return fetchWorkstationDetails(
    and(eq(workstations.id, id), eq(workstations.organizationId, orgId))!,
  );
}

export async function getWorkstationByDeviceToken(token: string): Promise<WorkstationWithDetails | undefined> {
  return fetchWorkstationDetails(eq(workstations.deviceToken, token));
}

export async function createWorkstation(
  data: InsertWorkstation,
  orgId: string,
): Promise<WorkstationWithDetails & { enrolmentCode: string; enrolmentExpiresAt: Date }> {
  if (!WORKSTATION_TYPES.includes(data.type as (typeof WORKSTATION_TYPES)[number])) {
    throw new Error("Invalid workstation type");
  }

  const enrolmentCode = generateEnrolmentCode();
  const enrolmentExpiresAt = new Date(Date.now() + ENROLMENT_TTL_MS);

  const [row] = await db
    .insert(workstations)
    .values({
      ...data,
      organizationId: orgId,
      enrolmentCode,
      enrolmentExpiresAt,
      kioskMode: data.type === "gate_desk" ? (data.kioskMode ?? true) : (data.kioskMode ?? false),
    })
    .returning();

  const details = await getWorkstationById(row.id, orgId);
  if (!details) throw new Error("Workstation not found after create");
  return { ...details, enrolmentCode, enrolmentExpiresAt };
}

export async function updateWorkstation(
  id: number,
  orgId: string,
  data: Partial<InsertWorkstation> & { isActive?: boolean },
): Promise<WorkstationWithDetails | undefined> {
  if (data.type && !WORKSTATION_TYPES.includes(data.type as (typeof WORKSTATION_TYPES)[number])) {
    throw new Error("Invalid workstation type");
  }

  const [row] = await db
    .update(workstations)
    .set(data)
    .where(and(eq(workstations.id, id), eq(workstations.organizationId, orgId)))
    .returning();

  if (!row) return undefined;
  return getWorkstationById(id, orgId);
}

export async function regenerateWorkstationEnrolmentCode(
  id: number,
  orgId: string,
): Promise<{ enrolmentCode: string; enrolmentExpiresAt: Date } | undefined> {
  const enrolmentCode = generateEnrolmentCode();
  const enrolmentExpiresAt = new Date(Date.now() + ENROLMENT_TTL_MS);

  const [row] = await db
    .update(workstations)
    .set({
      enrolmentCode,
      enrolmentExpiresAt,
      deviceToken: null,
      enrolledAt: null,
      currentOperatorUserId: null,
      operatorSessionStartedAt: null,
    })
    .where(and(eq(workstations.id, id), eq(workstations.organizationId, orgId)))
    .returning();

  if (!row) return undefined;
  return { enrolmentCode, enrolmentExpiresAt };
}

export async function enrolWorkstationByCode(code: string): Promise<{
  deviceToken: string;
  workstation: WorkstationWithDetails;
}> {
  const normalized = code.trim().toUpperCase();
  const [ws] = await db
    .select()
    .from(workstations)
    .where(and(eq(workstations.enrolmentCode, normalized), eq(workstations.isActive, true)))
    .limit(1);

  if (!ws) throw new Error("Invalid or expired enrolment code");
  if (!ws.enrolmentExpiresAt || ws.enrolmentExpiresAt.getTime() < Date.now()) {
    throw new Error("Enrolment code has expired — ask your administrator for a new code");
  }

  const deviceToken = generateDeviceToken();
  const now = new Date();

  await db
    .update(workstations)
    .set({
      deviceToken,
      enrolledAt: now,
      enrolmentCode: null,
      enrolmentExpiresAt: null,
      lastSeenAt: now,
    })
    .where(eq(workstations.id, ws.id));

  const workstation = await getWorkstationByDeviceToken(deviceToken);
  if (!workstation) throw new Error("Enrolment failed");
  return { deviceToken, workstation };
}

export async function touchWorkstation(
  workstationId: number,
  patch?: { lat?: number; lng?: number },
): Promise<void> {
  const update: Partial<Workstation> = { lastSeenAt: new Date() };
  if (patch?.lat != null && patch?.lng != null && Number.isFinite(patch.lat) && Number.isFinite(patch.lng)) {
    update.lastLat = patch.lat;
    update.lastLng = patch.lng;
  }
  await db.update(workstations).set(update).where(eq(workstations.id, workstationId));
}

export async function setWorkstationOperator(
  workstationId: number,
  userId: string | null,
): Promise<void> {
  await db
    .update(workstations)
    .set({
      currentOperatorUserId: userId,
      operatorSessionStartedAt: userId ? new Date() : null,
      lastSeenAt: new Date(),
    })
    .where(eq(workstations.id, workstationId));
}

export async function findUserByShiftPin(orgId: string, pin: string): Promise<typeof users.$inferSelect | null> {
  const candidates = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.organizationId, orgId),
        eq(users.isActive, true),
        isNotNull(users.shiftPinHash),
      ),
    );

  for (const user of candidates) {
    if (!user.shiftPinHash) continue;
    const match = await bcrypt.compare(pin, user.shiftPinHash);
    if (match) return user;
  }
  return null;
}

export async function hashShiftPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

export async function userCanOperateWorkstation(
  userId: string,
  workstation: Workstation,
): Promise<boolean> {
  if (workstation.type === "gate_desk") {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const role = user?.role;
    if (role !== "access_controller" && role !== "administrator" && role !== "reporter") {
      return false;
    }
  }

  if (workstation.commandId != null) {
    const [membership] = await db
      .select()
      .from(commandUsers)
      .where(
        and(
          eq(commandUsers.userId, userId),
          eq(commandUsers.commandId, workstation.commandId),
        ),
      )
      .limit(1);
    if (!membership && workstation.type !== "gate_desk") {
      return false;
    }
  }

  return true;
}
