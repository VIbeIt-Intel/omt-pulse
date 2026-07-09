export {
  USER_ROLES,
  DISPATCH_STAFF_ROLES,
  ACCESS_CONTROL_ROLES,
  isDispatchStaff,
  hasAccessControlRole,
  isControlRoom,
  usesLocationAssignmentScope,
  type UserRole,
} from "@shared/user-roles";

export const USER_ROLE_LABELS: Record<string, string> = {
  administrator: "Administrator",
  control_room: "Control Room",
  supervisor: "Supervisor (legacy)",
  reporter: "Reporter",
};
