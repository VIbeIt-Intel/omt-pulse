/** Fleet alert types supported in MVP. */
export const FLEET_ALERT_TYPES = [
  "speeding",
  "idle",
  "offline",
  "geofence_enter",
  "geofence_leave",
] as const;

export type FleetAlertType = (typeof FLEET_ALERT_TYPES)[number];

export const DEFAULT_FLEET_SPEED_LIMIT_KPH = 120;
export const DEFAULT_FLEET_IDLE_MINUTES = 30;
export const DEFAULT_FLEET_OFFLINE_MINUTES = 30;
export const DEFAULT_FLEET_GEOFENCE_RADIUS_M = 2000;

/** Minimum gap between repeat pushes for the same alert type on one vehicle. */
export const FLEET_ALERT_COOLDOWN_MS = 15 * 60 * 1000;

export const FLEET_ALERT_NOTIFY_ROLES = ["administrator", "supervisor"] as const;

export const FLEET_ALERT_LABELS: Record<FleetAlertType, string> = {
  speeding: "Speeding",
  idle: "Long idle",
  offline: "Offline",
  geofence_enter: "Entered geofence",
  geofence_leave: "Left geofence",
};
