import { startVehicleTrackerListener, stopVehicleTrackerListener } from "./tcp-listener";
import { migrateTrackers } from "./migrate-trackers";
import type { TrackerListenerOptions } from "./types";

export { startVehicleTrackerListener, stopVehicleTrackerListener };
export type { TrackerListenerOptions };

const DEFAULT_PORT = 7711;

export function startVehicleTrackingFromEnv(): void {
  const enabled = process.env.VEHICLE_TRACKER_TCP_ENABLED !== "false";
  const port = parseInt(process.env.VEHICLE_TRACKER_TCP_PORT ?? String(DEFAULT_PORT), 10);
  const host = process.env.VEHICLE_TRACKER_TCP_HOST ?? "0.0.0.0";

  const options: TrackerListenerOptions = {
    enabled,
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    host,
  };

  void migrateTrackers()
    .then(() => startVehicleTrackerListener(options))
    .catch((err) => {
      console.error("[vehicle-tracker] migration failed:", err instanceof Error ? err.message : err);
      startVehicleTrackerListener(options);
    });
}
