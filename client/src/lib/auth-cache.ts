import type { AuthUser } from "@/lib/auth-user";

const USER_CACHE_KEY = "omt_cached_auth_user";

export function cacheAuthUser(user: AuthUser): void {
  try {
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify({ user, cachedAt: Date.now() }));
  } catch {
    /* ignore quota */
  }
}

export function readCachedAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: AuthUser };
    if (!parsed?.user?.id) return null;
    return parsed.user;
  } catch {
    return null;
  }
}

export function clearCachedAuthUser(): void {
  try {
    localStorage.removeItem(USER_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function isNetworkAuthFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("internet") ||
    msg.includes("offline") ||
    msg.includes("err_internet")
  );
}
