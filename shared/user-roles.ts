/** Assignable organisation roles (stored on users.role). */
export const USER_ROLES = ["administrator", "control_room", "supervisor", "reporter"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Live Monitor, Fleet, Analytics, dispatch dashboard — not gate access. */
export const DISPATCH_STAFF_ROLES = ["administrator", "supervisor", "control_room"] as const;

/** Gate check-in / check-out module. Control room excluded by design. */
export const ACCESS_CONTROL_ROLES = ["administrator", "supervisor", "reporter"] as const;

export function isDispatchStaff(role: string): boolean {
  return (DISPATCH_STAFF_ROLES as readonly string[]).includes(role);
}

export function hasAccessControlRole(role: string): boolean {
  return (ACCESS_CONTROL_ROLES as readonly string[]).includes(role);
}

export function isControlRoom(role: string): boolean {
  return role === "control_room";
}

export function usesLocationAssignmentScope(role: string): boolean {
  return role === "supervisor" || role === "control_room" || role === "reporter";
}
