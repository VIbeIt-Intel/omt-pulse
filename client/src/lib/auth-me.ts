import {
  cacheAuthUser,
  clearCachedAuthUser,
  isNetworkAuthFailure,
  readCachedAuthUser,
} from "@/lib/auth-cache";
import type { AuthUser } from "@/lib/auth-user";

/** /api/auth/me with offline fallback to the last successful session. */
export async function fetchAuthMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch("/api/auth/me", {
      credentials: "include",
      cache: "no-store",
    });
    if (res.status === 401) {
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
