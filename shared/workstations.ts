/** Dedicated field devices — gate desks, shared shift mobiles, patrol posts. */
export const WORKSTATION_TYPES = ["gate_desk", "mobile_shared", "patrol_post"] as const;
export type WorkstationType = (typeof WORKSTATION_TYPES)[number];

export const WORKSTATION_TYPE_LABELS: Record<WorkstationType, string> = {
  gate_desk: "Gate / access desk (fixed)",
  mobile_shared: "Shared mobile (shift handoff)",
  patrol_post: "Patrol post (fixed or shared)",
};

/** Role used by the synthetic position account (no PIN v1). */
export function defaultRoleForWorkstationType(type: string): string {
  if (type === "gate_desk") return "access_controller";
  if (type === "patrol_post") return "patrol_user";
  return "reporter";
}

/** Synthetic emails for position accounts — never shown as normal Users. */
export const POSITION_USER_EMAIL_SUFFIX = "@omt.device";

export function isPositionUserEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(POSITION_USER_EMAIL_SUFFIX);
}

export function positionUserEmail(workstationId: number, organizationId: string): string {
  const orgPart = organizationId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "org";
  return `pos.${workstationId}.${orgPart}${POSITION_USER_EMAIL_SUFFIX}`;
}

export function isGateDeskWorkstation(type: string): boolean {
  return type === "gate_desk";
}

export function workstationRequiresShiftPin(type: string): boolean {
  return type === "gate_desk" || type === "mobile_shared" || type === "patrol_post";
}

export function isKioskWorkstation(type: string, kioskMode: boolean): boolean {
  return kioskMode && type === "gate_desk";
}

export const SHIFT_PIN_MIN_LEN = 4;
export const SHIFT_PIN_MAX_LEN = 6;

export function isValidShiftPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

/** HTTP header carrying the enrolled device token (web + native). */
export const WORKSTATION_TOKEN_HEADER = "x-workstation-token";
