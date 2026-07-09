export type PatrolCheckpointDraft = {
  name: string;
  instructions: string;
  photoRequired: boolean;
  latitude: number | null;
  longitude: number | null;
};

export function emptyPatrolCheckpoint(): PatrolCheckpointDraft {
  return {
    name: "",
    instructions: "",
    photoRequired: false,
    latitude: null,
    longitude: null,
  };
}

export function hasCheckpointCoords(cp: PatrolCheckpointDraft): boolean {
  return cp.latitude != null && cp.longitude != null;
}
