import { Capacitor } from "@capacitor/core";

/** Production API host for Capacitor local-shell builds. */
export const PRODUCTION_API_ORIGIN =
  (typeof import.meta !== "undefined" &&
  import.meta.env &&
  typeof import.meta.env.VITE_API_BASE_URL === "string" &&
  import.meta.env.VITE_API_BASE_URL.trim()
    ? import.meta.env.VITE_API_BASE_URL.trim()
    : "https://omtpulse.com");

/**
 * True when the WebView is serving bundled assets (not the live remote site).
 * In that mode relative `/api` must be rewritten to the production origin.
 */
export function usesLocalCapacitorShell(): boolean {
  if (typeof window === "undefined") return false;
  if (!Capacitor.isNativePlatform()) return false;
  const origin = window.location.origin;
  return !origin.includes("omtpulse.com");
}

export function getApiBase(): string {
  return usesLocalCapacitorShell() ? PRODUCTION_API_ORIGIN.replace(/\/$/, "") : "";
}

export function apiUrl(path: string): string {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  const base = getApiBase();
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Rewrite relative API/object fetches to production when on local Capacitor shell. */
export function installNativeApiBaseFetch(): void {
  if (!usesLocalCapacitorShell()) return;
  const base = getApiBase();
  if (!base) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      let url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      if (url.startsWith("/")) {
        url = `${base}${url}`;
        const nextInit: RequestInit = {
          ...init,
          credentials: init?.credentials ?? "include",
        };
        return originalFetch(url, nextInit);
      }
    } catch {
      /* fall through */
    }
    return originalFetch(input as RequestInfo, init);
  };
}
