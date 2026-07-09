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
};

export type PatrolHistoryItem = Patrol & {
  routeName: string;
  startedByName: string;
};
