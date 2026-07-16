import {
  patrolRouteSchedules,
  patrolScheduleAssignees,
  patrolScheduleDispatches,
  patrolRoutes,
  patrols,
  users,
  commandUsers,
  type PatrolRouteSchedule,
  type PatrolScheduleDispatch,
} from "@shared/schema";
import { hasPermission } from "@shared/permissions";
import { db } from "../storage";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import {
  clampScheduleMinutes,
  computeNextDueAt,
  normalizeQuietHour,
} from "./schedule-timing";

export type PatrolScheduleWithAssignees = PatrolRouteSchedule & {
  assigneeUserIds: string[];
  routeName: string;
  routeIsActive: boolean;
  commandId: number | null;
};

export type UpsertScheduleInput = {
  isEnabled: boolean;
  intervalMinutes: number;
  jitterMinutes: number;
  startWithinMinutes: number;
  quietStartHour?: number | null;
  quietEndHour?: number | null;
  assigneeUserIds?: string[];
};

export async function getScheduleForRoute(
  routeId: number,
  orgId: string,
): Promise<PatrolScheduleWithAssignees | null> {
  const rows = await db
    .select({
      schedule: patrolRouteSchedules,
      routeName: patrolRoutes.name,
      routeIsActive: patrolRoutes.isActive,
      commandId: patrolRoutes.commandId,
    })
    .from(patrolRouteSchedules)
    .innerJoin(patrolRoutes, eq(patrolRouteSchedules.routeId, patrolRoutes.id))
    .where(
      and(
        eq(patrolRouteSchedules.routeId, routeId),
        eq(patrolRouteSchedules.organizationId, orgId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const assignees = await db
    .select({ userId: patrolScheduleAssignees.userId })
    .from(patrolScheduleAssignees)
    .where(eq(patrolScheduleAssignees.scheduleId, row.schedule.id));

  return {
    ...row.schedule,
    assigneeUserIds: assignees.map((a) => a.userId),
    routeName: row.routeName,
    routeIsActive: row.routeIsActive,
    commandId: row.commandId,
  };
}

export async function upsertScheduleForRoute(
  routeId: number,
  orgId: string,
  userId: string,
  input: UpsertScheduleInput,
): Promise<PatrolScheduleWithAssignees> {
  const routeRows = await db
    .select()
    .from(patrolRoutes)
    .where(and(eq(patrolRoutes.id, routeId), eq(patrolRoutes.organizationId, orgId)))
    .limit(1);
  if (!routeRows[0]) throw new Error("Route not found");

  const { intervalMinutes, jitterMinutes, startWithinMinutes } = clampScheduleMinutes(
    input.intervalMinutes,
    input.jitterMinutes,
    input.startWithinMinutes,
  );
  const quietStartHour = normalizeQuietHour(input.quietStartHour);
  const quietEndHour = normalizeQuietHour(input.quietEndHour);

  const existing = await getScheduleForRoute(routeId, orgId);
  const now = new Date();
  const nextDueAt =
    input.isEnabled && (!existing || !existing.isEnabled)
      ? computeNextDueAt(now, intervalMinutes, jitterMinutes, quietStartHour, quietEndHour)
      : existing?.nextDueAt ??
        computeNextDueAt(now, intervalMinutes, jitterMinutes, quietStartHour, quietEndHour);

  let scheduleId: number;
  if (existing) {
    const [updated] = await db
      .update(patrolRouteSchedules)
      .set({
        isEnabled: input.isEnabled,
        intervalMinutes,
        jitterMinutes,
        startWithinMinutes,
        quietStartHour,
        quietEndHour,
        nextDueAt: input.isEnabled ? nextDueAt : existing.nextDueAt,
        updatedAt: now,
      })
      .where(eq(patrolRouteSchedules.id, existing.id))
      .returning();
    scheduleId = updated.id;
  } else {
    const [created] = await db
      .insert(patrolRouteSchedules)
      .values({
        organizationId: orgId,
        routeId,
        isEnabled: input.isEnabled,
        intervalMinutes,
        jitterMinutes,
        startWithinMinutes,
        quietStartHour,
        quietEndHour,
        nextDueAt,
        createdByUserId: userId,
        updatedAt: now,
      })
      .returning();
    scheduleId = created.id;
  }

  await db
    .delete(patrolScheduleAssignees)
    .where(eq(patrolScheduleAssignees.scheduleId, scheduleId));

  const assigneeIds = [...new Set((input.assigneeUserIds ?? []).filter(Boolean))];
  if (assigneeIds.length > 0) {
    const orgUsers = await db
      .select({ id: users.id, role: users.role, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.organizationId, orgId), inArray(users.id, assigneeIds)));
    const valid = orgUsers.filter((u) => u.isActive && hasPermission(u.role, "patrol.execute"));
    if (valid.length > 0) {
      await db.insert(patrolScheduleAssignees).values(
        valid.map((u) => ({
          scheduleId,
          userId: u.id,
          organizationId: orgId,
        })),
      );
    }
  }

  const full = await getScheduleForRoute(routeId, orgId);
  if (!full) throw new Error("Failed to load schedule");
  return full;
}

export async function listDueSchedules(now = new Date()): Promise<PatrolScheduleWithAssignees[]> {
  const rows = await db
    .select({
      schedule: patrolRouteSchedules,
      routeName: patrolRoutes.name,
      routeIsActive: patrolRoutes.isActive,
      commandId: patrolRoutes.commandId,
    })
    .from(patrolRouteSchedules)
    .innerJoin(patrolRoutes, eq(patrolRouteSchedules.routeId, patrolRoutes.id))
    .where(
      and(
        eq(patrolRouteSchedules.isEnabled, true),
        eq(patrolRoutes.isActive, true),
        lte(patrolRouteSchedules.nextDueAt, now),
      ),
    );

  const result: PatrolScheduleWithAssignees[] = [];
  for (const row of rows) {
    const assignees = await db
      .select({ userId: patrolScheduleAssignees.userId })
      .from(patrolScheduleAssignees)
      .where(eq(patrolScheduleAssignees.scheduleId, row.schedule.id));
    result.push({
      ...row.schedule,
      assigneeUserIds: assignees.map((a) => a.userId),
      routeName: row.routeName,
      routeIsActive: row.routeIsActive,
      commandId: row.commandId,
    });
  }
  return result;
}

export async function resolveAssigneeCandidates(
  schedule: PatrolScheduleWithAssignees,
): Promise<Array<{ id: string; firstName: string; lastName: string }>> {
  const orgId = schedule.organizationId;

  if (schedule.assigneeUserIds.length > 0) {
    const rows = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .where(and(eq(users.organizationId, orgId), inArray(users.id, schedule.assigneeUserIds)));
    return rows
      .filter((u) => u.isActive && hasPermission(u.role, "patrol.execute"))
      .map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName }));
  }

  const allActive = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
    })
    .from(users)
    .where(and(eq(users.organizationId, orgId), eq(users.isActive, true)));

  let candidates = allActive.filter((u) => hasPermission(u.role, "patrol.execute"));

  if (schedule.commandId != null) {
    const members = await db
      .select({ userId: commandUsers.userId })
      .from(commandUsers)
      .where(
        and(
          eq(commandUsers.organizationId, orgId),
          eq(commandUsers.commandId, schedule.commandId),
        ),
      );
    const memberSet = new Set(members.map((m) => m.userId));
    candidates = candidates.filter((u) => memberSet.has(u.id));
  }

  return candidates.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName }));
}

async function usersWithActivePatrol(orgId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: patrols.startedByUserId })
    .from(patrols)
    .where(
      and(
        eq(patrols.organizationId, orgId),
        eq(patrols.status, "in_progress"),
        inArray(patrols.startedByUserId, userIds),
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

async function usersWithOpenDispatch(
  scheduleId: number,
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: patrolScheduleDispatches.userId })
    .from(patrolScheduleDispatches)
    .where(
      and(
        eq(patrolScheduleDispatches.scheduleId, scheduleId),
        inArray(patrolScheduleDispatches.status, ["pending", "overdue"]),
        inArray(patrolScheduleDispatches.userId, userIds),
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

/** Round-robin: least recently pushed eligible user. */
export async function pickDispatchUser(
  schedule: PatrolScheduleWithAssignees,
): Promise<{ id: string; firstName: string; lastName: string } | null> {
  const candidates = await resolveAssigneeCandidates(schedule);
  if (candidates.length === 0) return null;

  const ids = candidates.map((c) => c.id);
  const busy = await usersWithActivePatrol(schedule.organizationId, ids);
  const open = await usersWithOpenDispatch(schedule.id, ids);
  const eligible = candidates.filter((c) => !busy.has(c.id) && !open.has(c.id));
  if (eligible.length === 0) return null;

  const recent = await db
    .select({
      userId: patrolScheduleDispatches.userId,
      pushedAt: patrolScheduleDispatches.pushedAt,
    })
    .from(patrolScheduleDispatches)
    .where(
      and(
        eq(patrolScheduleDispatches.scheduleId, schedule.id),
        inArray(
          patrolScheduleDispatches.userId,
          eligible.map((e) => e.id),
        ),
      ),
    )
    .orderBy(desc(patrolScheduleDispatches.pushedAt));

  const lastByUser = new Map<string, Date>();
  for (const row of recent) {
    if (!lastByUser.has(row.userId)) lastByUser.set(row.userId, row.pushedAt);
  }

  eligible.sort((a, b) => {
    const aAt = lastByUser.get(a.id)?.getTime() ?? 0;
    const bAt = lastByUser.get(b.id)?.getTime() ?? 0;
    return aAt - bAt;
  });

  return eligible[0] ?? null;
}

export async function createDispatch(input: {
  organizationId: string;
  scheduleId: number;
  routeId: number;
  userId: string;
  startWithinMinutes: number;
}): Promise<PatrolScheduleDispatch> {
  const pushedAt = new Date();
  const startByAt = new Date(pushedAt.getTime() + input.startWithinMinutes * 60_000);
  const [row] = await db
    .insert(patrolScheduleDispatches)
    .values({
      organizationId: input.organizationId,
      scheduleId: input.scheduleId,
      routeId: input.routeId,
      userId: input.userId,
      status: "pending",
      pushedAt,
      startByAt,
    })
    .returning();
  return row;
}

export async function advanceScheduleAfterDispatch(
  schedule: PatrolScheduleWithAssignees,
  now = new Date(),
): Promise<void> {
  const nextDueAt = computeNextDueAt(
    now,
    schedule.intervalMinutes,
    schedule.jitterMinutes,
    schedule.quietStartHour,
    schedule.quietEndHour,
  );
  await db
    .update(patrolRouteSchedules)
    .set({
      nextDueAt,
      lastDispatchedAt: now,
      updatedAt: now,
    })
    .where(eq(patrolRouteSchedules.id, schedule.id));
}

/** Defer nextDue when nobody was available — retry sooner than full interval. */
export async function deferScheduleRetry(scheduleId: number, minutes = 10): Promise<void> {
  const now = new Date();
  await db
    .update(patrolRouteSchedules)
    .set({
      nextDueAt: new Date(now.getTime() + minutes * 60_000),
      updatedAt: now,
    })
    .where(eq(patrolRouteSchedules.id, scheduleId));
}

export async function listOverdueDispatches(now = new Date()): Promise<
  Array<PatrolScheduleDispatch & { routeName: string; userName: string }>
> {
  const rows = await db
    .select({
      dispatch: patrolScheduleDispatches,
      routeName: patrolRoutes.name,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(patrolScheduleDispatches)
    .innerJoin(patrolRoutes, eq(patrolScheduleDispatches.routeId, patrolRoutes.id))
    .innerJoin(users, eq(patrolScheduleDispatches.userId, users.id))
    .where(
      and(
        eq(patrolScheduleDispatches.status, "pending"),
        lte(patrolScheduleDispatches.startByAt, now),
      ),
    );

  return rows.map((r) => ({
    ...r.dispatch,
    routeName: r.routeName,
    userName: `${r.firstName} ${r.lastName}`.trim(),
  }));
}

export async function markDispatchOverdue(dispatchId: number): Promise<void> {
  const now = new Date();
  await db
    .update(patrolScheduleDispatches)
    .set({ status: "overdue", overdueNotifiedAt: now })
    .where(
      and(
        eq(patrolScheduleDispatches.id, dispatchId),
        eq(patrolScheduleDispatches.status, "pending"),
      ),
    );
}

export async function linkDispatchOnPatrolStart(
  routeId: number,
  userId: string,
  orgId: string,
  patrolId: number,
): Promise<void> {
  const open = await db
    .select()
    .from(patrolScheduleDispatches)
    .where(
      and(
        eq(patrolScheduleDispatches.organizationId, orgId),
        eq(patrolScheduleDispatches.routeId, routeId),
        eq(patrolScheduleDispatches.userId, userId),
        inArray(patrolScheduleDispatches.status, ["pending", "overdue"]),
      ),
    )
    .orderBy(desc(patrolScheduleDispatches.pushedAt))
    .limit(1);

  const row = open[0];
  if (!row) return;

  await db
    .update(patrolScheduleDispatches)
    .set({ status: "started", patrolId })
    .where(eq(patrolScheduleDispatches.id, row.id));
}

export async function listPendingDispatchesForUser(
  userId: string,
  orgId: string,
): Promise<Array<PatrolScheduleDispatch & { routeName: string }>> {
  const rows = await db
    .select({
      dispatch: patrolScheduleDispatches,
      routeName: patrolRoutes.name,
    })
    .from(patrolScheduleDispatches)
    .innerJoin(patrolRoutes, eq(patrolScheduleDispatches.routeId, patrolRoutes.id))
    .where(
      and(
        eq(patrolScheduleDispatches.organizationId, orgId),
        eq(patrolScheduleDispatches.userId, userId),
        inArray(patrolScheduleDispatches.status, ["pending", "overdue"]),
      ),
    )
    .orderBy(asc(patrolScheduleDispatches.startByAt));

  return rows.map((r) => ({ ...r.dispatch, routeName: r.routeName }));
}

export async function listAssigneeCandidates(orgId: string): Promise<
  Array<{ id: string; firstName: string; lastName: string; role: string }>
> {
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
    })
    .from(users)
    .where(and(eq(users.organizationId, orgId), eq(users.isActive, true)))
    .orderBy(asc(users.firstName), asc(users.lastName));

  return rows.filter((u) => hasPermission(u.role, "patrol.execute"));
}

/** Expire very old overdue prompts so they stop blocking round-robin. */
export async function expireStaleDispatches(now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - 6 * 60 * 60_000);
  await db
    .update(patrolScheduleDispatches)
    .set({ status: "missed" })
    .where(
      and(
        inArray(patrolScheduleDispatches.status, ["pending", "overdue"]),
        lte(patrolScheduleDispatches.startByAt, cutoff),
      ),
    );
}
