/**
 * Platform default retention windows (days) for POPIA-aligned operational data.
 * Incident evidence, audit trails, and user accounts are NOT auto-purged.
 *
 * Org columns may override these; null/undefined means use the platform default.
 */
export const DEFAULT_RETENTION_DAYS = {
  /** Visitor / access logs (ID scans, photos, vehicle details). */
  accessLogs: 180,
  /** Patrol GPS breadcrumbs. */
  patrolTrackPoints: 90,
  /** Patrol checkpoint check-ins (GPS + photos + notes). */
  patrolCheckpointLogs: 365,
  /** Fleet tracker GPS history. */
  trackerPositions: 90,
  /** CCTV AI detection event rows (+ linked snapshot files). */
  cctvAiEvents: 30,
} as const;

export type RetentionKind = keyof typeof DEFAULT_RETENTION_DAYS;

export function resolveRetentionDays(
  override: number | null | undefined,
  kind: RetentionKind,
): number {
  if (typeof override === "number" && Number.isFinite(override) && override >= 1) {
    return Math.min(Math.floor(override), 3650);
  }
  return DEFAULT_RETENTION_DAYS[kind];
}
