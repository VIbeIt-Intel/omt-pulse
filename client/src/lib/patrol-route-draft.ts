import { DEFAULT_PATROL_CHECKPOINT_RADIUS_M } from "@shared/schema";

export type PatrolCheckpointDraft = {
  name: string;
  instructions: string;
  photoRequired: boolean;
  /** Soft geofence radius in metres for clock proof. */
  geofenceRadiusM: number;
  latitude: number | null;
  longitude: number | null;
};

export function emptyPatrolCheckpoint(): PatrolCheckpointDraft {
  return {
    name: "",
    instructions: "",
    photoRequired: false,
    geofenceRadiusM: DEFAULT_PATROL_CHECKPOINT_RADIUS_M,
    latitude: null,
    longitude: null,
  };
}

export function hasCheckpointCoords(cp: {
  latitude: number | null;
  longitude: number | null;
}): boolean {
  return cp.latitude != null && cp.longitude != null;
}

/** Clamp admin-entered radius to the server-allowed range. */
export function clampCheckpointRadiusM(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PATROL_CHECKPOINT_RADIUS_M;
  return Math.min(500, Math.max(15, Math.round(value)));
}
