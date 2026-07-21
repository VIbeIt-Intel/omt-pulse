import { haversineM } from "./premises-geofence";
import { DEFAULT_PATROL_CHECKPOINT_RADIUS_M } from "./schema";

export type CheckpointProofInput = {
  checkpointLat: number | null | undefined;
  checkpointLng: number | null | undefined;
  geofenceRadiusM?: number | null;
  userLat: number | null | undefined;
  userLng: number | null | undefined;
  accuracyM?: number | null;
};

export type CheckpointProofResult = {
  distanceM: number | null;
  withinGeofence: boolean | null;
  /** Outside radius, missing GPS, or accuracy too poor for a reliable clock. */
  flagged: boolean;
  /** Human-readable reason when the clock should be blocked. */
  blockReason: string | null;
};

/** Conservative walking/vehicle pace used to reject impossible rapid clocks. */
export const MIN_TRAVEL_SPEED_MPS = 1.5;
/** Never require more than this wait between consecutive clocks. */
export const MAX_MIN_TRAVEL_SECONDS = 180;

export function evaluateCheckpointProof(input: CheckpointProofInput): CheckpointProofResult {
  const radius = input.geofenceRadiusM ?? DEFAULT_PATROL_CHECKPOINT_RADIUS_M;
  const hasCheckpoint =
    input.checkpointLat != null &&
    input.checkpointLng != null &&
    Number.isFinite(input.checkpointLat) &&
    Number.isFinite(input.checkpointLng);
  const hasUser =
    input.userLat != null &&
    input.userLng != null &&
    Number.isFinite(input.userLat) &&
    Number.isFinite(input.userLng);

  if (!hasCheckpoint) {
    // No pin set — allow clock, but flag missing GPS so management can see it.
    return {
      distanceM: null,
      withinGeofence: null,
      flagged: !hasUser,
      blockReason: hasUser ? null : "GPS is required to clock this checkpoint.",
    };
  }
  if (!hasUser) {
    return {
      distanceM: null,
      withinGeofence: false,
      flagged: true,
      blockReason: "GPS is required to clock this checkpoint.",
    };
  }

  const distanceM = haversineM(
    { lat: input.userLat!, lng: input.userLng! },
    { lat: input.checkpointLat!, lng: input.checkpointLng! },
  );
  const rounded = Math.round(distanceM * 10) / 10;
  const withinGeofence = distanceM <= radius;
  const inaccurate =
    input.accuracyM != null && Number.isFinite(input.accuracyM) && input.accuracyM > radius;

  let blockReason: string | null = null;
  if (!withinGeofence) {
    blockReason = `You are ${Math.round(distanceM)} m from this checkpoint — move within ${Math.round(radius)} m to clock it.`;
  } else if (inaccurate) {
    blockReason = `GPS accuracy is ±${Math.round(input.accuracyM!)} m — wait for a clearer fix (need ≤ ${Math.round(radius)} m).`;
  }

  return {
    distanceM: rounded,
    withinGeofence,
    flagged: !withinGeofence || inaccurate,
    blockReason,
  };
}

/**
 * Minimum seconds that should elapse between clocking two planned pins,
 * based on the straight-line distance between them. Blocks "tap through" abuse.
 */
export function minTravelSecondsBetween(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const dist = haversineM(from, to);
  if (dist < 25) return 0;
  const seconds = Math.ceil(dist / MIN_TRAVEL_SPEED_MPS);
  return Math.min(MAX_MIN_TRAVEL_SECONDS, Math.max(15, seconds));
}

/** Sum path length along ordered track points (metres). */
export function pathDistanceM(
  points: Array<{ latitude: number; longitude: number }>,
): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += haversineM(
      { lat: a.latitude, lng: a.longitude },
      { lat: b.latitude, lng: b.longitude },
    );
  }
  return Math.round(total * 10) / 10;
}

/** Largest gap between consecutive recorded timestamps (seconds). */
export function maxGapSeconds(
  recordedAts: Date[],
): number | null {
  if (recordedAts.length < 2) return null;
  let max = 0;
  for (let i = 1; i < recordedAts.length; i++) {
    const gap = (recordedAts[i]!.getTime() - recordedAts[i - 1]!.getTime()) / 1000;
    if (gap > max) max = gap;
  }
  return Math.round(max);
}
