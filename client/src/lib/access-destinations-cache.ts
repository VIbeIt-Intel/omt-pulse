import type { Destination } from "@shared/schema";

const KEY = "omt_cached_access_destinations";

export function cacheAccessDestinations(destinations: Destination[]): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ destinations, cachedAt: Date.now() }),
    );
  } catch {
    /* ignore quota */
  }
}

export function readCachedAccessDestinations(): Destination[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { destinations?: Destination[] };
    if (!Array.isArray(parsed?.destinations)) return null;
    return parsed.destinations;
  } catch {
    return null;
  }
}
