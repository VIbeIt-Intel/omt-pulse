/** Dedicated field devices — gate desks, shared shift mobiles, patrol posts. */
export const WORKSTATION_TYPES = ["gate_desk", "mobile_shared", "patrol_post"] as const;
export type WorkstationType = (typeof WORKSTATION_TYPES)[number];

export const WORKSTATION_TYPE_LABELS: Record<WorkstationType, string> = {
  gate_desk: "Gate / access desk (fixed)",
  mobile_shared: "Shared mobile (shift handoff)",
  patrol_post: "Patrol post (fixed or shared)",
};

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
