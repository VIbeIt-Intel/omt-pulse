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

/** Who receives fleet alert push + in-app notification feed entries (matches Fleet UI access). */
export const FLEET_ALERT_NOTIFY_ROLES = ["administrator", "supervisor", "control_room"] as const;

export const FLEET_ALERT_LABELS: Record<FleetAlertType, string> = {
  speeding: "Speeding",
  idle: "Long idle",
  offline: "Offline",
  geofence_enter: "Entered geofence",
  geofence_leave: "Left geofence",
};

/** Short uppercase type codes for compact UI badges. */
export const FLEET_ALERT_TYPE_CODES: Record<FleetAlertType, string> = {
  speeding: "SPEEDING",
  idle: "IDLE",
  offline: "OFFLINE",
  geofence_enter: "GEOFENCE",
  geofence_leave: "GEOFENCE",
};

/** Derived severity for display (not stored on alerts yet). */
export const FLEET_ALERT_SEVERITIES = ["high", "medium", "info"] as const;
export type FleetAlertSeverity = (typeof FLEET_ALERT_SEVERITIES)[number];

export const FLEET_ALERT_SEVERITY: Record<FleetAlertType, FleetAlertSeverity> = {
  speeding: "high",
  idle: "medium",
  offline: "medium",
  geofence_enter: "info",
  geofence_leave: "medium",
};

export const FLEET_ALERT_SEVERITY_LABELS: Record<FleetAlertSeverity, string> = {
  high: "High",
  medium: "Medium",
  info: "Info",
};

export function isFleetAlertType(value: string | null | undefined): value is FleetAlertType {
  return !!value && (FLEET_ALERT_TYPES as readonly string[]).includes(value);
}

export function getFleetAlertTypeCode(alertType: string | null | undefined): string | null {
  if (!isFleetAlertType(alertType)) return null;
  return FLEET_ALERT_TYPE_CODES[alertType];
}

export function getFleetAlertSeverity(alertType: string | null | undefined): FleetAlertSeverity | null {
  if (!isFleetAlertType(alertType)) return null;
  return FLEET_ALERT_SEVERITY[alertType];
}
