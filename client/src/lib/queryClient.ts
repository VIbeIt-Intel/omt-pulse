import { QueryClient, QueryCache, MutationCache, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    cache: "no-store",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      cache: "no-store",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// Public routes where a 401 from /api/auth/me is entirely expected (the user
// is legitimately unauthenticated). We must never force-redirect away from
// these pages, even when a 401 fires.
function isPublicRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname.startsWith("/invite") ||
    pathname.startsWith("/archon") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/enable-alerts")
  );
}

// Detect a "session invalid / user deleted" error response.
// The server returns HTTP 401 with { message: "User not found" } (routes.ts:189)
// when the session references a deleted user row, so the primary trigger is a
// 401 status.  We also guard against 404 for belt-and-suspenders compatibility
// with any future variant of the same deleted-user scenario.
function isSessionInvalidError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.startsWith("401:") || error.message.startsWith("404:");
}

// When a session-invalid error fires on an authenticated route, force a clean
// client logout:
//   1. Clear the TanStack Query in-memory cache so stale user data is gone.
//   2. Navigate to /login via replace() (no back-stack entry).
//
// This handles the "deleted user with stale PWA session" scenario — the server
// already destroys the session on the first rejected API call (routes.ts:187-189);
// this makes the PWA self-recover without a manual refresh or reinstall.
//
// Same-email re-add: deleteUser() is a hard delete (storage.ts:241), so the
// email unique constraint is released immediately after deletion — admins can
// re-add the same email address without any code changes or error messages.
//
// Service-worker note: /api/* requests are explicitly excluded from the SW
// cache in sw.js (line 59), so there is no SW-cached /api/auth/me to clean up.
//
// Self-reference safety: the closures below capture `queryClient` lazily —
// they are not invoked during the constructor call, so the `const` is fully
// assigned before any handler fires.
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError(error) {
      if (!isSessionInvalidError(error)) return;
      if (typeof window === "undefined") return;
      if (isPublicRoute(window.location.pathname)) return;
      queryClient.clear();
      window.location.replace("/login");
    },
  }),
  mutationCache: new MutationCache({
    onError(error) {
      if (!isSessionInvalidError(error)) return;
      if (typeof window === "undefined") return;
      if (isPublicRoute(window.location.pathname)) return;
      queryClient.clear();
      window.location.replace("/login");
    },
  }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
