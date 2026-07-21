import type {
  Patrol,
  PatrolCheckpoint,
  PatrolCheckpointLogWithCheckpoint,
  PatrolRoute,
} from "@shared/schema";

export type PatrolRouteWithCheckpoints = PatrolRoute & { checkpoints: PatrolCheckpoint[] };

export type PatrolDetail = Patrol & {
  routeName: string;
  checkpoints: PatrolCheckpoint[];
  logs: PatrolCheckpointLogWithCheckpoint[];
  trackUploadToken?: string | null;
};

export type PatrolHistoryItem = Patrol & {
  routeName: string;
  startedByName: string;
};

export type PatrolReportTrackPoint = {
  id: number;
  latitude: number;
  longitude: number;
  recordedAt: string;
  accuracyM: number | null;
  speedMps: number | null;
};

export type PatrolReport = PatrolDetail & {
  startedByName: string;
  trackPoints: PatrolReportTrackPoint[];
  warnings: string[];
};
