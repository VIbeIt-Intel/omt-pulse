export type PatrolPushKind = "patrol_scheduled" | "patrol_overdue";

export type PatrolPushRequest = {
  kind: PatrolPushKind;
  organizationId: string;
  /** Patroller who received the prompt (scheduled) or who is late (overdue). */
  userId?: string;
  routeId: number;
  routeName: string;
  dispatchId?: number;
  /** Display name for overdue supervisor alerts. */
  patrollerName?: string;
};

type PatrolPushHandler = (req: PatrolPushRequest) => Promise<void>;

let handler: PatrolPushHandler | null = null;

export function registerPatrolPushHandler(fn: PatrolPushHandler): void {
  handler = fn;
}

export async function notifyPatrolPush(req: PatrolPushRequest): Promise<void> {
  if (!handler) return;
  try {
    await handler(req);
  } catch (err) {
    console.error("[patrol-schedule] push failed:", err instanceof Error ? err.message : err);
  }
}
