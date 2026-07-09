import type { WorkstationWithDetails } from "@shared/schema";
import { WORKSTATION_TOKEN_HEADER } from "@shared/workstations";

const STORAGE_KEY = "omt_workstation_device_token";

export type WorkstationSessionInfo = {
  deviceToken: string;
  workstation: Pick<
    WorkstationWithDetails,
    "id" | "name" | "type" | "locationId" | "locationName" | "commandId" | "commandName" | "kioskMode"
  >;
};

export function getStoredWorkstationToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredWorkstationToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearStoredWorkstationToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function workstationAuthHeaders(): Record<string, string> {
  const token = getStoredWorkstationToken();
  return token ? { [WORKSTATION_TOKEN_HEADER]: token } : {};
}

export async function fetchWorkstationContext(): Promise<{
  workstation: WorkstationWithDetails;
  operatorLoggedIn: boolean;
} | null> {
  const token = getStoredWorkstationToken();
  if (!token) return null;
  const res = await fetch("/api/workstations/me", {
    credentials: "include",
    headers: { [WORKSTATION_TOKEN_HEADER]: token },
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401) clearStoredWorkstationToken();
    return null;
  }
  const data = await res.json();
  return data;
}

export async function enrolWorkstation(code: string): Promise<WorkstationSessionInfo> {
  const res = await fetch("/api/workstations/enrol", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ code: code.trim().toUpperCase() }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Enrolment failed");
  }
  const data = await res.json();
  setStoredWorkstationToken(data.deviceToken);
  return {
    deviceToken: data.deviceToken,
    workstation: data.workstation,
  };
}

export async function shiftLogin(pin: string) {
  const res = await fetch("/api/workstations/shift-login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...workstationAuthHeaders(),
    },
    credentials: "include",
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Shift login failed");
  }
  return res.json();
}

export async function shiftLogout() {
  await fetch("/api/workstations/shift-logout", {
    method: "POST",
    headers: workstationAuthHeaders(),
    credentials: "include",
  });
}

export async function unenrolWorkstation() {
  await fetch("/api/workstations/unenrol", {
    method: "POST",
    headers: workstationAuthHeaders(),
    credentials: "include",
  });
  clearStoredWorkstationToken();
}
