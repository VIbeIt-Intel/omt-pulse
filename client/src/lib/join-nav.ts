import type { LatLngPoint } from "@/lib/decode-polyline";

/** Joiner navigation style — Direct for local knowledge, Guided for turn-by-turn. */
export type JoinNavStyle = "direct" | "guided";

export const JOIN_NAV_STYLE_KEY = "omt_join_nav_style";

/** Distance from polyline before marking off-route (metres). */
export const OFF_ROUTE_POLYLINE_M = 80;
/** Consecutive off-route checks before falling back to Direct mode. */
export const OFF_ROUTE_FALLBACK_STREAK = 3;
/** Minimum gap between auto-reroutes in Guided mode (ms). */
export const GUIDED_REROUTE_COOLDOWN_MS = 12_000;
/** Step / off-route polling interval in nav mode (ms). */
export const NAV_TRACK_INTERVAL_MS = 3_000;

export function readStoredJoinNavStyle(): JoinNavStyle {
  if (typeof window === "undefined") return "direct";
  try {
    const v = localStorage.getItem(JOIN_NAV_STYLE_KEY);
    return v === "guided" ? "guided" : "direct";
  } catch {
    return "direct";
  }
}

export function storeJoinNavStyle(style: JoinNavStyle) {
  try {
    localStorage.setItem(JOIN_NAV_STYLE_KEY, style);
  } catch {
    /* ignore */
  }
}

export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sl = Math.sin(dLat / 2);
  const sln = Math.sin(dLng / 2);
  const x =
    sl * sl +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sln *
      sln;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Distance (metres) from point p to the nearest point on segment a→b. */
export function ptSegDistM(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  const lenSq = dLat * dLat + dLng * dLng;
  if (lenSq === 0) return haversineM(p, a);
  const t = Math.max(
    0,
    Math.min(1, ((p.lat - a.lat) * dLat + (p.lng - a.lng) * dLng) / lenSq),
  );
  return haversineM(p, { lat: a.lat + t * dLat, lng: a.lng + t * dLng });
}

/** Minimum distance from a point to any segment of a polyline (metres). */
export function minDistToPolylineM(
  p: { lat: number; lng: number },
  path: LatLngPoint[],
): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return haversineM(p, path[0]);
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = ptSegDistM(p, path[i], path[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

/** Initial compass bearing from `from` to `to` in degrees (0 = north, clockwise). */
export function bearingDegrees(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export function bearingCardinal(degrees: number): string {
  const idx = Math.round(degrees / 45) % 8;
  return CARDINALS[idx];
}

type StepLike = {
  start_location: { lat: () => number; lng: () => number };
  end_location: { lat: () => number; lng: () => number };
};

/** Snap step index + remaining distance from current GPS fix. */
export function seedStepIndexFromPosition(
  pos: { lat: number; lng: number },
  steps: StepLike[],
): { idx: number; stepDist: number | null } {
  if (steps.length === 0) return { idx: 0, stepDist: null };

  let idx = 0;
  while (idx < steps.length - 1) {
    const nextLoc = steps[idx + 1].start_location;
    if (haversineM(pos, { lat: nextLoc.lat(), lng: nextLoc.lng() }) <= 60) {
      idx++;
    } else {
      break;
    }
  }

  let nearestIdx = idx;
  let nearestDist = Infinity;
  for (let i = idx; i < steps.length; i++) {
    const loc = steps[i].start_location;
    const d = haversineM(pos, { lat: loc.lat(), lng: loc.lng() });
    if (d < nearestDist) {
      nearestDist = d;
      nearestIdx = i;
    }
  }
  if (nearestIdx > idx) idx = nearestIdx;

  const currStep = steps[idx];
  const stepDist = currStep
    ? Math.round(
        haversineM(pos, {
          lat: currStep.end_location.lat(),
          lng: currStep.end_location.lng(),
        }),
      )
    : null;

  return { idx, stepDist };
}
