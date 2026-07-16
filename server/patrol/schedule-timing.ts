/** Quiet-hour wall clock for SA sites (product default). */
export const PATROL_SCHEDULE_TZ = "Africa/Johannesburg";

export function clampScheduleMinutes(interval: number, jitter: number, startWithin: number) {
  const intervalMinutes = Math.min(180, Math.max(30, Math.round(interval)));
  const jitterMinutes = Math.min(30, Math.max(0, Math.round(jitter)));
  const startWithinMinutes = Math.min(60, Math.max(5, Math.round(startWithin)));
  return { intervalMinutes, jitterMinutes, startWithinMinutes };
}

export function normalizeQuietHour(hour: number | null | undefined): number | null {
  if (hour == null || Number.isNaN(hour)) return null;
  const h = Math.round(hour);
  if (h < 0 || h > 23) return null;
  return h;
}

function localHour(date: Date, timeZone = PATROL_SCHEDULE_TZ): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    hour12: false,
    timeZone,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value;
  return hour != null ? parseInt(hour, 10) % 24 : date.getUTCHours();
}

export function isInQuietHours(
  date: Date,
  quietStartHour: number | null,
  quietEndHour: number | null,
): boolean {
  if (quietStartHour == null || quietEndHour == null) return false;
  if (quietStartHour === quietEndHour) return false;
  const hour = localHour(date);
  if (quietStartHour < quietEndHour) {
    return hour >= quietStartHour && hour < quietEndHour;
  }
  return hour >= quietStartHour || hour < quietEndHour;
}

function advancePastQuiet(
  date: Date,
  quietStartHour: number | null,
  quietEndHour: number | null,
): Date {
  let next = new Date(date.getTime());
  let guard = 0;
  while (isInQuietHours(next, quietStartHour, quietEndHour) && guard < 48) {
    next = new Date(next.getTime() + 15 * 60_000);
    guard += 1;
  }
  return next;
}

/** Next due = now + interval ± jitter, then skip quiet hours. */
export function computeNextDueAt(
  from: Date,
  intervalMinutes: number,
  jitterMinutes: number,
  quietStartHour: number | null,
  quietEndHour: number | null,
): Date {
  const jitterMs =
    jitterMinutes <= 0 ? 0 : (Math.random() * 2 - 1) * jitterMinutes * 60_000;
  let next = new Date(from.getTime() + intervalMinutes * 60_000 + jitterMs);
  const minGapMs = Math.max(20, intervalMinutes - jitterMinutes) * 60_000;
  if (next.getTime() < from.getTime() + minGapMs) {
    next = new Date(from.getTime() + minGapMs);
  }
  return advancePastQuiet(next, quietStartHour, quietEndHour);
}
