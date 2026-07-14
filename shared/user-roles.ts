import { hasPermission } from "./permissions";

/** Assignable organisation roles (stored on users.role). */
export const USER_ROLES = ["administrator", "control_room", "supervisor", "reporter", "access_controller", "patrol_user"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Live Monitor, Fleet, Analytics, dispatch dashboard — not gate access. */export const DISPATCH_STAFF_ROLES = ["administrator", "supervisor", "control_room"] as const;

/** Gate check-in / check-out module. */
export const ACCESS_CONTROL_ROLES = ["administrator", "supervisor", "reporter", "access_controller"] as const;

/** Operational gate desk UI (scan & log entries). */
export const ACCESS_DESK_ROLES = ["access_controller", "reporter"] as const;

/** Management / oversight view (activity synopsis, read-only for control room). */
export const ACCESS_OVERVIEW_ROLES = ["administrator", "supervisor", "control_room"] as const;

/** Field GPS / Live Incident workflow (not gate-only staff). */
export const FIELD_REPORTER_ROLES = ["reporter"] as const;

/** OB list scoped to incidents the user created. */
export const OWN_INCIDENT_ROLES = ["reporter", "access_controller"] as const;

export function isDispatchStaff(role: string): boolean {
  return (DISPATCH_STAFF_ROLES as readonly string[]).includes(role);
}

export function hasAccessControlRole(role: string): boolean {
  return (ACCESS_CONTROL_ROLES as readonly string[]).includes(role);
}

export function usesAccessDeskUi(role: string): boolean {
  return (ACCESS_DESK_ROLES as readonly string[]).includes(role);
}

export function usesAccessOverviewUi(role: string): boolean {
  return (ACCESS_OVERVIEW_ROLES as readonly string[]).includes(role);
}

/** Sidebar + read APIs for overview (includes control room). */
export function canViewAccessControlModule(role: string): boolean {
  return hasAccessControlRole(role) || usesAccessOverviewUi(role);
}

export function isControlRoom(role: string): boolean {
  return role === "control_room";
}

export function isAccessController(role: string): boolean {
  return role === "access_controller";
}

export function isFieldReporter(role: string): boolean {
  return role === "reporter";
}

export function isOwnIncidentScopedRole(role: string): boolean {
  return (OWN_INCIDENT_ROLES as readonly string[]).includes(role);
}

/** Live Incident page, join-live, live-severity start flow. */
export function canUseLiveIncidentWorkflow(role: string): boolean {
  return isFieldReporter(role) || isDispatchStaff(role);
}

export function usesLocationAssignmentScope(role: string): boolean {
  return role === "supervisor" || role === "control_room" || role === "reporter" || role === "access_controller" || role === "patrol_user";
}

export function canManagePatrolRoutes(role: string): boolean {
  return role === "administrator" || role === "supervisor";
}

export function canAccessPatrolModule(role: string): boolean {
  return canManagePatrolRoutes(role) || hasPermission(role, "patrol.execute");
}

export { hasPermission, getPermissionsForRole, type Permission } from "./permissions";

