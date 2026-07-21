import { notifyPatrolPush } from "./push";
import {
  advanceScheduleAfterDispatch,
  createDispatch,
  deferScheduleRetry,
  expireStaleDispatches,
  listDueSchedules,
  listOverdueDispatches,
  markDispatchOverdue,
  pickDispatchUser,
} from "./schedule-storage";
import { isInQuietHours } from "./schedule-timing";
import { purgeOldPatrolTrackPoints } from "./storage";

let lastTrackPurgeAt = 0;

export async function evaluatePatrolSchedules(): Promise<void> {
  const now = new Date();
  await expireStaleDispatches(now);

  // Purge breadcrumb GPS older than retention (~daily).
  if (Date.now() - lastTrackPurgeAt > 24 * 60 * 60 * 1000) {
    lastTrackPurgeAt = Date.now();
    const n = await purgeOldPatrolTrackPoints().catch(() => 0);
    if (n > 0) console.log(`[patrol-schedule] purged ${n} old track points`);
  }

  const due = await listDueSchedules(now);
  for (const schedule of due) {
    if (isInQuietHours(now, schedule.quietStartHour, schedule.quietEndHour)) {
      await deferScheduleRetry(schedule.id, 15);
      continue;
    }

    const user = await pickDispatchUser(schedule);
    if (!user) {
      await deferScheduleRetry(schedule.id, 10);
      continue;
    }

    const dispatch = await createDispatch({
      organizationId: schedule.organizationId,
      scheduleId: schedule.id,
      routeId: schedule.routeId,
      userId: user.id,
      startWithinMinutes: schedule.startWithinMinutes,
    });

    await notifyPatrolPush({
      kind: "patrol_scheduled",
      organizationId: schedule.organizationId,
      userId: user.id,
      routeId: schedule.routeId,
      routeName: schedule.routeName,
      dispatchId: dispatch.id,
    });

    await advanceScheduleAfterDispatch(schedule, now);
  }

  const overdue = await listOverdueDispatches(now);
  for (const d of overdue) {
    await markDispatchOverdue(d.id);
    await notifyPatrolPush({
      kind: "patrol_overdue",
      organizationId: d.organizationId,
      userId: d.userId,
      routeId: d.routeId,
      routeName: d.routeName,
      dispatchId: d.id,
      patrollerName: d.userName,
    });
  }
}

export function startPatrolScheduleMonitor(): void {
  const intervalMs = 60_000;
  setInterval(() => {
    void evaluatePatrolSchedules().catch((err) => {
      console.error(
        "[patrol-schedule] scan failed:",
        err instanceof Error ? err.message : err,
      );
    });
  }, intervalMs);
  console.log(`[patrol-schedule] monitor started (every ${intervalMs / 1000}s)`);
}
