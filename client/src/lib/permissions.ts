export {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  getPermissionsForRole,
  hasPermission,
  type Permission,
} from "@shared/permissions";

export const PERMISSION_LABELS: Record<string, string> = {
  "patrol.execute": "Execute patrols",
};
