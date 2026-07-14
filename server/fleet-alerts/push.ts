import type { FleetAlertSummary } from "@shared/schema";

export type FleetAlertPushContext = {
  alert: FleetAlertSummary;
  commandId: number | null;
};

type FleetAlertPushHandler = (ctx: FleetAlertPushContext) => Promise<void>;

let handler: FleetAlertPushHandler | null = null;

export function registerFleetAlertPushHandler(fn: FleetAlertPushHandler): void {
  handler = fn;
}

export async function notifyFleetAlertPush(ctx: FleetAlertPushContext): Promise<void> {
  if (!handler) return;
  try {
    await handler(ctx);
  } catch (err) {
    console.error("[fleet-alerts] push failed:", err instanceof Error ? err.message : err);
  }
}
