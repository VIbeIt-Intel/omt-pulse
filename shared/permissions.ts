/**
 * Organisation permission registry.
 *
 * Permissions are granted to roles via ROLE_PERMISSIONS below.
 * Administrators implicitly receive every permission in PERMISSIONS.
 *
 * When adding a feature permission:
 * 1. Add to PERMISSIONS
 * 2. Assign to roles in ROLE_PERMISSIONS
 * 3. Guard API routes with hasPermission(role, "your.permission")
 * 4. Guard UI with the same helper (or permissions from /api/auth/me)
 */

export const PERMISSIONS = [
  "patrol.execute",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Default permissions per assignable role (administrator is implicit-all). */
export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  patrol_user: ["patrol.execute"],
  access_controller: ["patrol.execute"],
};

export function getPermissionsForRole(role: string): Permission[] {
  if (role === "administrator") return [...PERMISSIONS];
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function hasPermission(role: string, permission: Permission): boolean {
  return getPermissionsForRole(role).includes(permission);
}
