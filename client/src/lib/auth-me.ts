import {
  cacheAuthUser,
  clearCachedAuthUser,
  isNetworkAuthFailure,
  readCachedAuthUser,
} from "@/lib/auth-cache";
import type { AuthUser } from "@/lib/auth-user";
import {
  getStoredWorkstationToken,
  openPositionSession,
  workstationAuthHeaders,
} from "@/lib/workstation-session";

/** /api/auth/me with offline fallback + dedicated-device position reopen. */
export async function fetchAuthMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch("/api/auth/me", {
      credentials: "include",
      cache: "no-store",
      headers: workstationAuthHeaders(),
    });
    if (res.status === 401) {
      if (getStoredWorkstationToken()) {
        try {
          const opened = await openPositionSession();
          cacheAuthUser(opened.user as AuthUser);
          return opened.user as AuthUser;
        } catch {
          /* fall through to logged-out */
        }
      }
      clearCachedAuthUser();
      return null;
    }
    if (!res.ok) {
      const text = await res.text();
      const cached = readCachedAuthUser();
      if (cached && typeof navigator !== "undefined" && !navigator.onLine) {
        return cached;
      }
      throw new Error(`${res.status}: ${text || res.statusText}`);
    }
    const user = (await res.json()) as AuthUser;
    cacheAuthUser(user);
    return user;
  } catch (err) {
    if (
      isNetworkAuthFailure(err) ||
      (typeof navigator !== "undefined" && !navigator.onLine)
    ) {
      const cached = readCachedAuthUser();
      if (cached) return cached;
    }
    throw err;
  }
}
