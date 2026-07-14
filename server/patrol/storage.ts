import {
  patrolRoutes,
  patrolCheckpoints,
  patrols,
  patrolCheckpointLogs,
  users,
  type PatrolRoute,
  type PatrolCheckpoint,
  type Patrol,
  type InsertPatrolRoute,
  type PatrolCheckpointLogWithCheckpoint,
} from "@shared/schema";
import { db } from "../storage";
import { eq, and, desc, asc, or, isNull, inArray, sql } from "drizzle-orm";

export type PatrolRouteWithCheckpoints = PatrolRoute & { checkpoints: PatrolCheckpoint[] };

export type PatrolDetail = Patrol & {
  routeName: string;
  checkpoints: PatrolCheckpoint[];
  logs: PatrolCheckpointLogWithCheckpoint[];
};

type CheckpointInput = {
  name: string;
  orderIndex: number;
  latitude?: number | null;
  longitude?: number | null;
  instructions?: string | null;
  photoRequired?: boolean;
};

function routeCommandFilter(commandIds: number[] | null | undefined) {
  if (commandIds == null) return undefined;
  if (commandIds.length === 0) {
    return isNull(patrolRoutes.commandId);
  }
  return or(isNull(patrolRoutes.commandId), inArray(patrolRoutes.commandId, commandIds));
}

export async function listPatrolRoutes(
  orgId: string,
  opts: { activeOnly?: boolean; commandIds?: number[] | null } = {},
): Promise<PatrolRoute[]> {
  const conditions = [eq(patrolRoutes.organizationId, orgId)];
  if (opts.activeOnly !== false) {
    conditions.push(eq(patrolRoutes.isActive, true));
  }
  const cmdFilter = routeCommandFilter(opts.commandIds);
  if (cmdFilter) conditions.push(cmdFilter);

  return db
    .select()
    .from(patrolRoutes)
    .where(and(...conditions))
    .orderBy(asc(patrolRoutes.name));
}

export async function getPatrolRouteWithCheckpoints(
  id: number,
  orgId: string,
): Promise<PatrolRouteWithCheckpoints | undefined> {
  const [route] = await db
    .select()
    .from(patrolRoutes)
    .where(and(eq(patrolRoutes.id, id), eq(patrolRoutes.organizationId, orgId)))
    .limit(1);
  if (!route) return undefined;

  const checkpoints = await db
    .select()
    .from(patrolCheckpoints)
    .where(and(eq(patrolCheckpoints.routeId, id), eq(patrolCheckpoints.organizationId, orgId)))
    .orderBy(asc(patrolCheckpoints.orderIndex));

  return { ...route, checkpoints };
}

export async function createPatrolRoute(
  data: Omit<InsertPatrolRoute, "createdByUserId">,
  orgId: string,
  userId: string,
): Promise<PatrolRoute> {
  const [row] = await db
    .insert(patrolRoutes)
    .values({
      ...data,
      organizationId: orgId,
      createdByUserId: userId,
      updatedAt: new Date(),
    })
    .returning();
  return row;
}

export async function updatePatrolRoute(
  id: number,
  data: Partial<Omit<InsertPatrolRoute, "createdByUserId">>,
  orgId: string,
): Promise<PatrolRoute | undefined> {
  const [row] = await db
    .update(patrolRoutes)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(patrolRoutes.id, id), eq(patrolRoutes.organizationId, orgId)))
    .returning();
  return row;
}

export async function routeHasPatrols(routeId: number, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ id: patrols.id })
    .from(patrols)
    .where(and(eq(patrols.routeId, routeId), eq(patrols.organizationId, orgId)))
    .limit(1);
  return rows.length > 0;
}

export async function replaceRouteCheckpoints(
  routeId: number,
  checkpoints: CheckpointInput[],
  orgId: string,
): Promise<PatrolCheckpoint[]> {
  const route = await getPatrolRouteWithCheckpoints(routeId, orgId);
  if (!route) throw new Error("Route not found");
  if (await routeHasPatrols(routeId, orgId)) {
    throw new Error("Cannot change checkpoints on a route that has patrol history");
  }

  const sorted = [...checkpoints].sort((a, b) => a.orderIndex - b.orderIndex);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]!.orderIndex !== i) {
      throw new Error("Checkpoint orderIndex must be sequential starting at 0");
    }
    if (!sorted[i]!.name.trim()) {
      throw new Error("Each checkpoint needs a name");
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(patrolCheckpoints)
      .where(and(eq(patrolCheckpoints.routeId, routeId), eq(patrolCheckpoints.organizationId, orgId)));

    if (sorted.length > 0) {
      await tx.insert(patrolCheckpoints).values(
        sorted.map((cp) => ({
          organizationId: orgId,
          routeId,
          name: cp.name.trim(),
          orderIndex: cp.orderIndex,
          latitude: cp.latitude ?? null,
          longitude: cp.longitude ?? null,
          instructions: cp.instructions?.trim() || null,
          photoRequired: cp.photoRequired ?? false,
        })),
      );
    }
  });

  return db
    .select()
    .from(patrolCheckpoints)
    .where(and(eq(patrolCheckpoints.routeId, routeId), eq(patrolCheckpoints.organizationId, orgId)))
    .orderBy(asc(patrolCheckpoints.orderIndex));
}

export async function getActivePatrolForUser(userId: string, orgId: string): Promise<PatrolDetail | undefined> {
  const [patrol] = await db
    .select()
    .from(patrols)
    .where(
      and(
        eq(patrols.organizationId, orgId),
        eq(patrols.startedByUserId, userId),
        eq(patrols.status, "in_progress"),
      ),
    )
    .orderBy(desc(patrols.startedAt))
    .limit(1);
  if (!patrol) return undefined;
  return getPatrolDetail(patrol.id, orgId);
}

export async function startPatrol(routeId: number, userId: string, orgId: string): Promise<PatrolDetail> {
  const route = await getPatrolRouteWithCheckpoints(routeId, orgId);
  if (!route || !route.isActive) throw new Error("Route not found or inactive");
  if (route.checkpoints.length === 0) throw new Error("Route has no checkpoints");

  const existing = await getActivePatrolForUser(userId, orgId);
  if (existing) throw new Error("You already have a patrol in progress");

  const [patrol] = await db
    .insert(patrols)
    .values({
      organizationId: orgId,
      routeId,
      startedByUserId: userId,
      status: "in_progress",
      totalCheckpoints: route.checkpoints.length,
      completedCheckpoints: 0,
      updatedAt: new Date(),
    })
    .returning();

  return (await getPatrolDetail(patrol.id, orgId))!;
}

export async function getPatrolDetail(patrolId: number, orgId: string): Promise<PatrolDetail | undefined> {
  const rows = await db
    .select({
      patrol: patrols,
      routeName: patrolRoutes.name,
    })
    .from(patrols)
    .innerJoin(patrolRoutes, eq(patrols.routeId, patrolRoutes.id))
    .where(and(eq(patrols.id, patrolId), eq(patrols.organizationId, orgId)))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;

  const checkpoints = await db
    .select()
    .from(patrolCheckpoints)
    .where(
      and(eq(patrolCheckpoints.routeId, row.patrol.routeId), eq(patrolCheckpoints.organizationId, orgId)),
    )
    .orderBy(asc(patrolCheckpoints.orderIndex));

  const logRows = await db
    .select({
      log: patrolCheckpointLogs,
      checkpointName: patrolCheckpoints.name,
      orderIndex: patrolCheckpoints.orderIndex,
    })
    .from(patrolCheckpointLogs)
    .innerJoin(patrolCheckpoints, eq(patrolCheckpointLogs.checkpointId, patrolCheckpoints.id))
    .where(
      and(eq(patrolCheckpointLogs.patrolId, patrolId), eq(patrolCheckpointLogs.organizationId, orgId)),
    )
    .orderBy(asc(patrolCheckpoints.orderIndex));

  const logs: PatrolCheckpointLogWithCheckpoint[] = logRows.map((r) => ({
    ...r.log,
    checkpointName: r.checkpointName,
    orderIndex: r.orderIndex,
  }));

  return {
    ...row.patrol,
    routeName: row.routeName,
    checkpoints,
    logs,
  };
}

export async function listPatrolHistory(
  orgId: string,
  opts: { limit?: number; status?: string } = {},
): Promise<Array<Patrol & { routeName: string; startedByName: string }>> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const conditions = [eq(patrols.organizationId, orgId)];
  if (opts.status) conditions.push(eq(patrols.status, opts.status));

  const rows = await db
    .select({
      patrol: patrols,
      routeName: patrolRoutes.name,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(patrols)
    .innerJoin(patrolRoutes, eq(patrols.routeId, patrolRoutes.id))
    .innerJoin(users, eq(patrols.startedByUserId, users.id))
    .where(and(...conditions))
    .orderBy(desc(patrols.startedAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r.patrol,
    routeName: r.routeName,
    startedByName: `${r.firstName} ${r.lastName ?? ""}`.trim(),
  }));
}

async function getNextCheckpoint(patrolId: number, orgId: string): Promise<PatrolCheckpoint | undefined> {
  const detail = await getPatrolDetail(patrolId, orgId);
  if (!detail) return undefined;
  const loggedIds = new Set(detail.logs.map((l) => l.checkpointId));
  return detail.checkpoints.find((cp) => !loggedIds.has(cp.id));
}

export async function clockCheckpoint(
  patrolId: number,
  checkpointId: number,
  data: {
    latitude?: number | null;
    longitude?: number | null;
    photoUrl?: string | null;
    notes?: string | null;
    status?: "completed" | "missed";
  },
  orgId: string,
  userId: string,
): Promise<PatrolDetail> {
  const [patrol] = await db
    .select()
    .from(patrols)
    .where(and(eq(patrols.id, patrolId), eq(patrols.organizationId, orgId)))
    .limit(1);
  if (!patrol) throw new Error("Patrol not found");
  if (patrol.status !== "in_progress") throw new Error("Patrol is not in progress");
  if (patrol.startedByUserId !== userId) throw new Error("Only the guard who started this patrol can clock checkpoints");

  const [checkpoint] = await db
    .select()
    .from(patrolCheckpoints)
    .where(
      and(
        eq(patrolCheckpoints.id, checkpointId),
        eq(patrolCheckpoints.routeId, patrol.routeId),
        eq(patrolCheckpoints.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!checkpoint) throw new Error("Checkpoint not found on this route");

  const existingLog = await db
    .select({ id: patrolCheckpointLogs.id })
    .from(patrolCheckpointLogs)
    .where(
      and(eq(patrolCheckpointLogs.patrolId, patrolId), eq(patrolCheckpointLogs.checkpointId, checkpointId)),
    )
    .limit(1);
  if (existingLog.length > 0) throw new Error("Checkpoint already logged");

  const next = await getNextCheckpoint(patrolId, orgId);
  if (!next || next.id !== checkpointId) {
    throw new Error("Checkpoints must be clocked in order");
  }

  const logStatus = data.status ?? "completed";
  if (logStatus === "completed" && checkpoint.photoRequired && !data.photoUrl?.trim()) {
    throw new Error("Photo required for this checkpoint");
  }

  await db.transaction(async (tx) => {
    await tx.insert(patrolCheckpointLogs).values({
      organizationId: orgId,
      patrolId,
      checkpointId,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      photoUrl: data.photoUrl?.trim() || null,
      notes: data.notes?.trim() || null,
      status: logStatus,
    });

    if (logStatus === "completed") {
      await tx
        .update(patrols)
        .set({
          completedCheckpoints: sql`${patrols.completedCheckpoints} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(patrols.id, patrolId));
    }
  });

  return (await getPatrolDetail(patrolId, orgId))!;
}

export async function completePatrol(patrolId: number, orgId: string, userId: string): Promise<Patrol> {
  const [patrol] = await db
    .select()
    .from(patrols)
    .where(and(eq(patrols.id, patrolId), eq(patrols.organizationId, orgId)))
    .limit(1);
  if (!patrol) throw new Error("Patrol not found");
  if (patrol.status !== "in_progress") throw new Error("Patrol is not in progress");
  if (patrol.startedByUserId !== userId) throw new Error("Only the guard who started this patrol can complete it");

  const [updated] = await db
    .update(patrols)
    .set({ status: "completed", endedAt: new Date(), updatedAt: new Date() })
    .where(eq(patrols.id, patrolId))
    .returning();
  return updated;
}

export async function cancelPatrol(patrolId: number, orgId: string, userId: string): Promise<Patrol> {
  const [patrol] = await db
    .select()
    .from(patrols)
    .where(and(eq(patrols.id, patrolId), eq(patrols.organizationId, orgId)))
    .limit(1);
  if (!patrol) throw new Error("Patrol not found");
  if (patrol.status !== "in_progress") throw new Error("Patrol is not in progress");
  if (patrol.startedByUserId !== userId) throw new Error("Only the guard who started this patrol can cancel it");

  const [updated] = await db
    .update(patrols)
    .set({ status: "cancelled", endedAt: new Date(), updatedAt: new Date() })
    .where(eq(patrols.id, patrolId))
    .returning();
  return updated;
}
