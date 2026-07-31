import { pruneAiSnapshots } from "../cctv/ai-snapshots";
import { runRetentionPurge } from "./purge";

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 60 * 60 * 1000; // hourly check; purge itself runs ~daily

let lastPurgeAt = 0;

export async function evaluateRetentionPurge(): Promise<void> {
  if (Date.now() - lastPurgeAt < DAY_MS) return;
  lastPurgeAt = Date.now();

  try {
    pruneAiSnapshots();
  } catch {
    /* best effort */
  }

  const stats = await runRetentionPurge();
  const total =
    stats.accessLogs +
    stats.patrolTrackPoints +
    stats.patrolCheckpointLogs +
    stats.trackerPositions +
    stats.cctvAiEvents;

  if (total > 0) {
    console.log(
      `[retention] purged access=${stats.accessLogs} tracks=${stats.patrolTrackPoints} ` +
        `checkpoints=${stats.patrolCheckpointLogs} fleet=${stats.trackerPositions} ` +
        `cctvAi=${stats.cctvAiEvents}`,
    );
  } else {
    console.log("[retention] daily purge complete (nothing expired)");
  }
}

export function startRetentionPurgeMonitor(): void {
  // Run once shortly after boot, then hourly (gated to ~daily inside).
  setTimeout(() => {
    void evaluateRetentionPurge().catch((err) => {
      console.error("[retention] initial purge failed:", err instanceof Error ? err.message : err);
    });
  }, 30_000);

  setInterval(() => {
    void evaluateRetentionPurge().catch((err) => {
      console.error("[retention] purge failed:", err instanceof Error ? err.message : err);
    });
  }, TICK_MS);

  console.log("[retention] POPIA purge monitor started");
}
