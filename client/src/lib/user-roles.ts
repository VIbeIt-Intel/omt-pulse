export {
  USER_ROLES,
  DISPATCH_STAFF_ROLES,
  ACCESS_CONTROL_ROLES,
  FIELD_REPORTER_ROLES,
  OWN_INCIDENT_ROLES,
  isDispatchStaff,
  hasAccessControlRole,
  isControlRoom,
  isAccessController,
  isFieldReporter,
  isOwnIncidentScopedRole,
  canUseLiveIncidentWorkflow,
  usesLocationAssignmentScope,
  hasPermission,
  getPermissionsForRole,
  type UserRole,
  type Permission,
} from "@shared/user-roles";

export const USER_ROLE_LABELS: Record<string, string> = {
  administrator: "Administrator",
  control_room: "Control Room",
  supervisor: "Supervisor (legacy)",
  reporter: "Reporter (Field)",
  access_controller: "Access Controller (Gate)",
  patrol_user: "Patrol User",
};
