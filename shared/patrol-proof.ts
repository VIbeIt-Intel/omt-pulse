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
  /** Soft fail: outside radius, missing GPS, or very inaccurate fix. */
  flagged: boolean;
};

/** Soft geofence: clock is always allowed; management sees a red flag when outside. */
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
    return { distanceM: null, withinGeofence: null, flagged: !hasUser };
  }
  if (!hasUser) {
    return { distanceM: null, withinGeofence: false, flagged: true };
  }

  const distanceM = haversineM(
    { lat: input.userLat!, lng: input.userLng! },
    { lat: input.checkpointLat!, lng: input.checkpointLng! },
  );
  const withinGeofence = distanceM <= radius;
  const inaccurate = input.accuracyM != null && input.accuracyM > Math.max(radius, 100);
  return {
    distanceM: Math.round(distanceM * 10) / 10,
    withinGeofence,
    flagged: !withinGeofence || inaccurate,
  };
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
