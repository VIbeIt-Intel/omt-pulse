import { randomBytes } from "node:crypto";
import {
  patrolRoutes,
  patrolCheckpoints,
  patrols,
  patrolCheckpointLogs,
  patrolTrackPoints,
  users,
  DEFAULT_PATROL_CHECKPOINT_RADIUS_M,
  type PatrolRoute,
  type PatrolCheckpoint,
  type Patrol,
  type InsertPatrolRoute,
  type PatrolCheckpointLogWithCheckpoint,
  type PatrolTrackPoint,
} from "@shared/schema";
import {
  evaluateCheckpointProof,
  maxGapSeconds,
  minTravelSecondsBetween,
  pathDistanceM,
} from "@shared/patrol-proof";
import { db } from "../storage";
import { eq, and, desc, asc, or, isNull, inArray, sql, lt } from "drizzle-orm";
import { linkDispatchOnPatrolStart } from "./schedule-storage";

export type PatrolRouteWithCheckpoints = PatrolRoute & { checkpoints: PatrolCheckpoint[] };

export type PatrolDetail = Patrol & {
  routeName: string;
  checkpoints: PatrolCheckpoint[];
  logs: PatrolCheckpointLogWithCheckpoint[];
  /** Present only while the patrol is in progress (for the owner). */
  trackUploadToken?: string | null;
};

export type PatrolReport = PatrolDetail & {
  startedByName: string;
  trackPoints: Array<{
    id: number;
    latitude: number;
    longitude: number;
    recordedAt: string;
    accuracyM: number | null;
    speedMps: number | null;
  }>;
  warnings: string[];
};

type CheckpointInput = {
  name: string;
  orderIndex: number;
  latitude?: number | null;
  longitude?: number | null;
  geofenceRadiusM?: number | null;
  instructions?: string | null;
  photoRequired?: boolean;
};

export type TrackPointInput = {
  latitude: number;
  longitude: number;
  recordedAt: string | Date;
  accuracyM?: number | null;
  heading?: number | null;
  speedMps?: number | null;
  altitudeM?: number | null;
  seq?: number | null;
};

const TRACK_RETENTION_DAYS = 90;
const MAX_POINTS_PER_PATROL = 5000;
const MAX_BATCH = 100;

function mintTrackUploadToken(): string {
  return randomBytes(24).toString("hex");
}

function routeCommandFilter(commandIds: number[] | null | undefined) {
  if (commandIds == null) return undefined;
  if (commandIds.length === 0) {
    return isNull(patrolRoutes.commandId);
  }
  return or(isNull(patrolRoutes.commandId), inArray(patrolRoutes.commandId, commandIds));
}

/** When locationIds is null, no premises filter. Empty array = only unscoped routes. */
function routeLocationFilter(locationIds: number[] | null | undefined) {
  if (locationIds == null) return undefined;
  if (locationIds.length === 0) {
    return isNull(patrolRoutes.locationId);
  }
  return or(isNull(patrolRoutes.locationId), inArray(patrolRoutes.locationId, locationIds));
}

export async function listPatrolRoutes(
  orgId: string,
  opts: {
    activeOnly?: boolean;
    commandIds?: number[] | null;
    locationIds?: number[] | null;
  } = {},
): Promise<PatrolRoute[]> {
  const conditions = [eq(patrolRoutes.organizationId, orgId)];
  if (opts.activeOnly !== false) {
    conditions.push(eq(patrolRoutes.isActive, true));
  }
  const cmdFilter = routeCommandFilter(opts.commandIds);
  if (cmdFilter) conditions.push(cmdFilter);
  const locFilter = routeLocationFilter(opts.locationIds);
  if (locFilter) conditions.push(locFilter);

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
  data: InsertPatrolRoute,
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
  data: Partial<InsertPatrolRoute>,
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
          geofenceRadiusM: cp.geofenceRadiusM ?? DEFAULT_PATROL_CHECKPOINT_RADIUS_M,
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
  return getPatrolDetail(patrol.id, orgId, { includeUploadToken: true });
}

export async function startPatrol(routeId: number, userId: string, orgId: string): Promise<PatrolDetail> {
  const route = await getPatrolRouteWithCheckpoints(routeId, orgId);
  if (!route || !route.isActive) throw new Error("Route not found or inactive");
  if (route.checkpoints.length === 0) throw new Error("Route has no checkpoints");

  const existing = await getActivePatrolForUser(userId, orgId);
  if (existing) throw new Error("You already have a patrol in progress");

  const trackUploadToken = mintTrackUploadToken();
  const [patrol] = await db
    .insert(patrols)
    .values({
      organizationId: orgId,
      routeId,
      startedByUserId: userId,
      status: "in_progress",
      totalCheckpoints: route.checkpoints.length,
      completedCheckpoints: 0,
      trackUploadToken,
      updatedAt: new Date(),
    })
    .returning();

  await linkDispatchOnPatrolStart(routeId, userId, orgId, patrol.id).catch(() => {});

  return (await getPatrolDetail(patrol.id, orgId, { includeUploadToken: true }))!;
}

export async function getPatrolDetail(
  patrolId: number,
  orgId: string,
  opts: { includeUploadToken?: boolean } = {},
): Promise<PatrolDetail | undefined> {
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

  const { trackUploadToken, ...patrolRest } = row.patrol;
  return {
    ...patrolRest,
    routeName: row.routeName,
    checkpoints,
    logs,
    ...(opts.includeUploadToken ? { trackUploadToken } : {}),
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

  return rows.map((r) => {
    const { trackUploadToken: _t, ...patrolRest } = r.patrol;
    return {
      ...patrolRest,
      trackUploadToken: null,
      routeName: r.routeName,
      startedByName: `${r.firstName} ${r.lastName ?? ""}`.trim(),
    };
  });
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
    accuracyM?: number | null;
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

  const proof =
    logStatus === "completed"
      ? evaluateCheckpointProof({
          checkpointLat: checkpoint.latitude,
          checkpointLng: checkpoint.longitude,
          geofenceRadiusM: checkpoint.geofenceRadiusM,
          userLat: data.latitude,
          userLng: data.longitude,
          accuracyM: data.accuracyM,
        })
      : { distanceM: null, withinGeofence: null, flagged: false, blockReason: null };

  // Hard geofence: completed clocks must be at the pin with a usable GPS fix.
  if (logStatus === "completed" && proof.blockReason) {
    throw new Error(proof.blockReason);
  }

  // Reject impossible "tap-through" clocks when planned pins are far apart.
  if (logStatus === "completed") {
    const [prevLog] = await db
      .select({
        clockedAt: patrolCheckpointLogs.clockedAt,
        checkpointId: patrolCheckpointLogs.checkpointId,
      })
      .from(patrolCheckpointLogs)
      .where(eq(patrolCheckpointLogs.patrolId, patrolId))
      .orderBy(desc(patrolCheckpointLogs.clockedAt))
      .limit(1);

    if (prevLog) {
      const [prevCp] = await db
        .select()
        .from(patrolCheckpoints)
        .where(eq(patrolCheckpoints.id, prevLog.checkpointId))
        .limit(1);
      if (
        prevCp?.latitude != null &&
        prevCp.longitude != null &&
        checkpoint.latitude != null &&
        checkpoint.longitude != null
      ) {
        const requiredSec = minTravelSecondsBetween(
          { lat: prevCp.latitude, lng: prevCp.longitude },
          { lat: checkpoint.latitude, lng: checkpoint.longitude },
        );
        const elapsedSec =
          (Date.now() - new Date(prevLog.clockedAt).getTime()) / 1000;
        if (requiredSec > 0 && elapsedSec < requiredSec) {
          const wait = Math.ceil(requiredSec - elapsedSec);
          throw new Error(
            `Too soon after the previous checkpoint — wait about ${wait}s more (or walk to the next pin).`,
          );
        }
      }
    }
  }

  await db.transaction(async (tx) => {
    await tx.insert(patrolCheckpointLogs).values({
      organizationId: orgId,
      patrolId,
      checkpointId,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      accuracyM: data.accuracyM ?? null,
      distanceM: proof.distanceM,
      withinGeofence: proof.withinGeofence,
      photoUrl: data.photoUrl?.trim() || null,
      notes: data.notes?.trim() || null,
      status: logStatus,
    });

    const passInc = logStatus === "completed" && proof.withinGeofence === true ? 1 : 0;
    const failInc =
      logStatus === "completed" && (proof.withinGeofence === false || proof.flagged) ? 1 : 0;

    await tx
      .update(patrols)
      .set({
        ...(logStatus === "completed"
          ? { completedCheckpoints: sql`${patrols.completedCheckpoints} + 1` }
          : {}),
        geofencePassCount: sql`${patrols.geofencePassCount} + ${passInc}`,
        geofenceFailCount: sql`${patrols.geofenceFailCount} + ${failInc}`,
        updatedAt: new Date(),
      })
      .where(eq(patrols.id, patrolId));
  });

  return (await getPatrolDetail(patrolId, orgId, { includeUploadToken: true }))!;
}

async function finalizePatrolRollups(patrolId: number, orgId: string): Promise<void> {
  const points = await db
    .select({
      latitude: patrolTrackPoints.latitude,
      longitude: patrolTrackPoints.longitude,
      recordedAt: patrolTrackPoints.recordedAt,
    })
    .from(patrolTrackPoints)
    .where(and(eq(patrolTrackPoints.patrolId, patrolId), eq(patrolTrackPoints.organizationId, orgId)))
    .orderBy(asc(patrolTrackPoints.recordedAt), asc(patrolTrackPoints.seq));

  const distance = pathDistanceM(points);
  const gap = maxGapSeconds(points.map((p) => p.recordedAt));

  await db
    .update(patrols)
    .set({
      trackPointCount: points.length,
      distanceM: points.length > 0 ? distance : 0,
      maxGapSeconds: gap,
      trackUploadToken: null,
      updatedAt: new Date(),
    })
    .where(eq(patrols.id, patrolId));
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

  await finalizePatrolRollups(patrolId, orgId);
  const [final] = await db.select().from(patrols).where(eq(patrols.id, patrolId)).limit(1);
  return final ?? updated;
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

  await db
    .update(patrols)
    .set({ status: "cancelled", endedAt: new Date(), updatedAt: new Date() })
    .where(eq(patrols.id, patrolId));

  await finalizePatrolRollups(patrolId, orgId);
  const [final] = await db.select().from(patrols).where(eq(patrols.id, patrolId)).limit(1);
  return final!;
}

export async function findPatrolByTrackToken(
  patrolId: number,
  token: string,
): Promise<{
  id: number;
  organizationId: string;
  startedByUserId: string;
  status: string;
  endedAt: Date | null;
} | undefined> {
  if (!token) return undefined;
  const [row] = await db
    .select({
      id: patrols.id,
      organizationId: patrols.organizationId,
      startedByUserId: patrols.startedByUserId,
      status: patrols.status,
      endedAt: patrols.endedAt,
    })
    .from(patrols)
    .where(and(eq(patrols.id, patrolId), eq(patrols.trackUploadToken, token)))
    .limit(1);
  return row;
}

/** Allow late GPS batches for a short window after complete/cancel. */
export const TRACK_UPLOAD_GRACE_MS = 30 * 60_000;

export function canAcceptPatrolTrackUpload(patrol: {
  status: string;
  endedAt: Date | null;
}): boolean {
  if (patrol.status === "in_progress") return true;
  if (
    (patrol.status === "completed" || patrol.status === "cancelled") &&
    patrol.endedAt != null
  ) {
    return Date.now() - patrol.endedAt.getTime() <= TRACK_UPLOAD_GRACE_MS;
  }
  return false;
}

export async function appendPatrolTrackPoints(
  patrolId: number,
  orgId: string,
  points: TrackPointInput[],
): Promise<{ inserted: number; skippedDuplicates: number; lastSeq: number | null }> {
  if (points.length === 0) return { inserted: 0, skippedDuplicates: 0, lastSeq: null };
  if (points.length > MAX_BATCH) throw new Error(`Batch limited to ${MAX_BATCH} points`);

  const [patrol] = await db
    .select()
    .from(patrols)
    .where(and(eq(patrols.id, patrolId), eq(patrols.organizationId, orgId)))
    .limit(1);
  if (!patrol) throw new Error("Patrol not found");
  if (!canAcceptPatrolTrackUpload(patrol)) {
    throw new Error("Patrol is not accepting track points");
  }

  if ((patrol.trackPointCount ?? 0) >= MAX_POINTS_PER_PATROL) {
    throw new Error("Track point limit reached for this patrol");
  }

  const startedAt = patrol.startedAt.getTime() - 2 * 60_000;
  const now = Date.now() + 2 * 60_000;
  const values: Array<{
    organizationId: string;
    patrolId: number;
    recordedAt: Date;
    latitude: number;
    longitude: number;
    accuracyM: number | null;
    heading: number | null;
    speedMps: number | null;
    altitudeM: number | null;
    source: string;
    seq: number | null;
  }> = [];

  for (const p of points) {
    const recordedAt = p.recordedAt instanceof Date ? p.recordedAt : new Date(p.recordedAt);
    if (Number.isNaN(recordedAt.getTime())) continue;
    const t = recordedAt.getTime();
    if (t < startedAt || t > now) continue;
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    if (p.latitude < -90 || p.latitude > 90 || p.longitude < -180 || p.longitude > 180) continue;
    values.push({
      organizationId: orgId,
      patrolId,
      recordedAt,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracyM: p.accuracyM ?? null,
      heading: p.heading ?? null,
      speedMps: p.speedMps ?? null,
      altitudeM: p.altitudeM ?? null,
      source: "device",
      seq: p.seq ?? null,
    });
  }

  if (values.length === 0) return { inserted: 0, skippedDuplicates: 0, lastSeq: null };

  const remaining = MAX_POINTS_PER_PATROL - (patrol.trackPointCount ?? 0);
  const toInsert = values.slice(0, remaining);

  let inserted = 0;
  let skippedDuplicates = 0;

  // Insert one-by-one / small chunks so ON CONFLICT can skip duplicate seq cleanly.
  for (const row of toInsert) {
    try {
      if (row.seq == null) {
        await db.insert(patrolTrackPoints).values(row);
        inserted++;
      } else {
        const result = await db
          .insert(patrolTrackPoints)
          .values(row)
          .onConflictDoNothing({ target: [patrolTrackPoints.patrolId, patrolTrackPoints.seq] })
          .returning({ id: patrolTrackPoints.id });
        if (result.length > 0) inserted++;
        else skippedDuplicates++;
      }
    } catch {
      skippedDuplicates++;
    }
  }

  if (inserted > 0) {
    await db
      .update(patrols)
      .set({
        trackPointCount: sql`${patrols.trackPointCount} + ${inserted}`,
        updatedAt: new Date(),
      })
      .where(eq(patrols.id, patrolId));
  }

  const lastSeq = toInsert.reduce<number | null>((acc, r) => {
    if (r.seq == null) return acc;
    if (acc == null || r.seq > acc) return r.seq;
    return acc;
  }, null);

  return { inserted, skippedDuplicates, lastSeq };
}

export async function getPatrolTrackPoints(
  patrolId: number,
  orgId: string,
  opts: { limit?: number } = {},
): Promise<PatrolTrackPoint[]> {
  const limit = Math.min(opts.limit ?? 2000, 5000);
  return db
    .select()
    .from(patrolTrackPoints)
    .where(and(eq(patrolTrackPoints.patrolId, patrolId), eq(patrolTrackPoints.organizationId, orgId)))
    .orderBy(asc(patrolTrackPoints.recordedAt), asc(patrolTrackPoints.seq))
    .limit(limit);
}

export async function getPatrolReport(patrolId: number, orgId: string): Promise<PatrolReport | undefined> {
  const detail = await getPatrolDetail(patrolId, orgId);
  if (!detail) return undefined;

  const [starter] = await db
    .select({ firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(eq(users.id, detail.startedByUserId))
    .limit(1);

  const trackRows = await getPatrolTrackPoints(patrolId, orgId);
  const warnings: string[] = [];

  const missed = detail.logs.filter((l) => l.status === "missed").length;
  if (missed > 0) warnings.push(`${missed} checkpoint(s) marked missed`);

  const outside = detail.logs.filter((l) => l.status === "completed" && l.withinGeofence === false).length;
  if (outside > 0) warnings.push(`${outside} checkpoint(s) clocked outside the allowed radius`);

  const noGps = detail.logs.filter(
    (l) => l.status === "completed" && (l.latitude == null || l.longitude == null),
  ).length;
  if (noGps > 0) warnings.push(`${noGps} checkpoint(s) recorded without GPS`);

  const durationSec =
    detail.endedAt && detail.startedAt
      ? (detail.endedAt.getTime() - detail.startedAt.getTime()) / 1000
      : null;
  const distance = detail.distanceM ?? pathDistanceM(trackRows);
  if (durationSec != null && durationSec > 5 * 60 && distance < 25 && trackRows.length >= 3) {
    warnings.push("Patrol appears stationary — little movement recorded");
  }
  if ((detail.maxGapSeconds ?? 0) > 10 * 60) {
    warnings.push("Long GPS gap during patrol — tracking may have paused");
  }
  if (trackRows.length === 0) {
    warnings.push("No GPS track recorded for this patrol");
  }

  return {
    ...detail,
    startedByName: starter ? `${starter.firstName} ${starter.lastName ?? ""}`.trim() : "Unknown",
    trackPoints: trackRows.map((p) => ({
      id: p.id,
      latitude: p.latitude,
      longitude: p.longitude,
      recordedAt: p.recordedAt.toISOString(),
      accuracyM: p.accuracyM,
      speedMps: p.speedMps,
    })),
    warnings,
  };
}

/** Delete breadcrumb points older than retention window (checkpoint logs kept). */
export async function purgeOldPatrolTrackPoints(): Promise<number> {
  const cutoff = new Date(Date.now() - TRACK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(patrolTrackPoints)
    .where(lt(patrolTrackPoints.recordedAt, cutoff))
    .returning({ id: patrolTrackPoints.id });
  return deleted.length;
}
