import { and, eq, inArray, lt } from "drizzle-orm";
import { resolveRetentionDays } from "@shared/retention";
import {
  accessLogs,
  organizations,
  patrolCheckpointLogs,
  patrolTrackPoints,
  trackerPositions,
} from "@shared/schema";
import { cctvAiEvents } from "@shared/cctv";
import { db } from "../storage";
import { getAiSnapshotPath } from "../cctv/ai-snapshots";
import { tryDeleteStoredObject } from "./object-cleanup";
import fs from "node:fs";

const BATCH = 200;

export type RetentionPurgeStats = {
  accessLogs: number;
  patrolTrackPoints: number;
  patrolCheckpointLogs: number;
  trackerPositions: number;
  cctvAiEvents: number;
};

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function purgeAccessLogsForOrg(orgId: string, days: number): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await db
      .select({
        id: accessLogs.id,
        personPhotoUrl: accessLogs.personPhotoUrl,
        vehiclePhotoUrl: accessLogs.vehiclePhotoUrl,
      })
      .from(accessLogs)
      .where(and(eq(accessLogs.organizationId, orgId), lt(accessLogs.timeIn, cutoff(days))))
      .limit(BATCH);

    if (rows.length === 0) break;

    for (const row of rows) {
      await tryDeleteStoredObject(row.personPhotoUrl);
      await tryDeleteStoredObject(row.vehiclePhotoUrl);
    }

    const ids = rows.map((r) => r.id);
    await db.delete(accessLogs).where(inArray(accessLogs.id, ids));
    total += ids.length;
    if (rows.length < BATCH) break;
  }
  return total;
}

async function purgePatrolTracksForOrg(orgId: string, days: number): Promise<number> {
  const deleted = await db
    .delete(patrolTrackPoints)
    .where(
      and(
        eq(patrolTrackPoints.organizationId, orgId),
        lt(patrolTrackPoints.recordedAt, cutoff(days)),
      ),
    )
    .returning({ id: patrolTrackPoints.id });
  return deleted.length;
}

async function purgeCheckpointLogsForOrg(orgId: string, days: number): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await db
      .select({ id: patrolCheckpointLogs.id, photoUrl: patrolCheckpointLogs.photoUrl })
      .from(patrolCheckpointLogs)
      .where(
        and(
          eq(patrolCheckpointLogs.organizationId, orgId),
          lt(patrolCheckpointLogs.clockedAt, cutoff(days)),
        ),
      )
      .limit(BATCH);

    if (rows.length === 0) break;

    for (const row of rows) {
      await tryDeleteStoredObject(row.photoUrl);
    }

    const ids = rows.map((r) => r.id);
    await db.delete(patrolCheckpointLogs).where(inArray(patrolCheckpointLogs.id, ids));
    total += ids.length;
    if (rows.length < BATCH) break;
  }
  return total;
}

async function purgeTrackerPositionsForOrg(orgId: string, days: number): Promise<number> {
  const deleted = await db
    .delete(trackerPositions)
    .where(
      and(
        eq(trackerPositions.organizationId, orgId),
        lt(trackerPositions.recordedAt, cutoff(days)),
      ),
    )
    .returning({ id: trackerPositions.id });
  return deleted.length;
}

async function purgeCctvAiEventsForOrg(orgId: string, days: number): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await db
      .select({ id: cctvAiEvents.id, snapshotPath: cctvAiEvents.snapshotPath })
      .from(cctvAiEvents)
      .where(
        and(eq(cctvAiEvents.organizationId, orgId), lt(cctvAiEvents.createdAt, cutoff(days))),
      )
      .limit(BATCH);

    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row.snapshotPath) continue;
      try {
        fs.rmSync(getAiSnapshotPath(row.snapshotPath), { force: true });
      } catch {
        /* best effort */
      }
    }

    const ids = rows.map((r) => r.id);
    await db.delete(cctvAiEvents).where(inArray(cctvAiEvents.id, ids));
    total += ids.length;
    if (rows.length < BATCH) break;
  }
  return total;
}

/** Run POPIA retention purge across all organisations. */
export async function runRetentionPurge(): Promise<RetentionPurgeStats> {
  const stats: RetentionPurgeStats = {
    accessLogs: 0,
    patrolTrackPoints: 0,
    patrolCheckpointLogs: 0,
    trackerPositions: 0,
    cctvAiEvents: 0,
  };

  const orgs = await db
    .select({
      id: organizations.id,
      retentionAccessLogsDays: organizations.retentionAccessLogsDays,
      retentionPatrolTrackDays: organizations.retentionPatrolTrackDays,
      retentionPatrolCheckpointDays: organizations.retentionPatrolCheckpointDays,
      retentionTrackerPositionsDays: organizations.retentionTrackerPositionsDays,
      retentionCctvAiEventsDays: organizations.retentionCctvAiEventsDays,
    })
    .from(organizations);

  for (const org of orgs) {
    stats.accessLogs += await purgeAccessLogsForOrg(
      org.id,
      resolveRetentionDays(org.retentionAccessLogsDays, "accessLogs"),
    );
    stats.patrolTrackPoints += await purgePatrolTracksForOrg(
      org.id,
      resolveRetentionDays(org.retentionPatrolTrackDays, "patrolTrackPoints"),
    );
    stats.patrolCheckpointLogs += await purgeCheckpointLogsForOrg(
      org.id,
      resolveRetentionDays(org.retentionPatrolCheckpointDays, "patrolCheckpointLogs"),
    );
    stats.trackerPositions += await purgeTrackerPositionsForOrg(
      org.id,
      resolveRetentionDays(org.retentionTrackerPositionsDays, "trackerPositions"),
    );
    stats.cctvAiEvents += await purgeCctvAiEventsForOrg(
      org.id,
      resolveRetentionDays(org.retentionCctvAiEventsDays, "cctvAiEvents"),
    );
  }

  return stats;
}
