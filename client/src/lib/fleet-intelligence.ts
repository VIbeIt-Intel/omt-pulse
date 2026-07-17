/** Shared fleet tracking helpers — status, freshness, trip analytics. */

export const TRACKER_ONLINE_MS = 30 * 60 * 1000;
export const TRACKER_FRESH_MS = 2 * 60 * 1000;
export const TRACKER_STALE_MS = 10 * 60 * 1000;
export const MOVING_SPEED_KPH = 5;
/** Gaps longer than this between pings are treated as offline gaps (not idle/driving). */
export const TRIP_GAP_MS = 15 * 60 * 1000;

export type VehicleMotionStatus = "moving" | "idle" | "offline";

export type FreshnessTier = "live" | "recent" | "stale" | "offline";

export type TripDayStats = {
  pointCount: number;
  distanceKm: number | null;
  maxSpeedKph: number | null;
  drivingMinutes: number;
  idleMinutes: number;
};

export type TripPosition = {
  latitude: number;
  longitude: number;
  speedKph: number | null;
  heading: number | null;
  ignitionOn: boolean | null;
  recordedAt: string;
  gpsValid?: boolean;
};

export const MOTION_STATUS = {
  moving: {
    label: "Moving",
    dot: "bg-emerald-400",
    pill: "text-emerald-300 bg-emerald-950/50 border-emerald-700/50",
    mapAccent: "#22c55e",
    mapGlow: "rgba(34,197,94,0.35)",
  },
  idle: {
    label: "Idle",
    dot: "bg-amber-400",
    pill: "text-amber-300 bg-amber-950/40 border-amber-700/50",
    mapAccent: "#f59e0b",
    mapGlow: "rgba(245,158,11,0.3)",
  },
  offline: {
    label: "Offline",
    dot: "bg-slate-500",
    pill: "text-slate-400 bg-slate-800/60 border-slate-600/50",
    mapAccent: "#64748b",
    mapGlow: "rgba(100,116,139,0.2)",
  },
} as const;

export function getVehicleMotionStatus(
  lastSeenAt: string | null | undefined,
  speedKph: number | null | undefined,
): VehicleMotionStatus {
  if (!lastSeenAt || Date.now() - new Date(lastSeenAt).getTime() >= TRACKER_ONLINE_MS) {
    return "offline";
  }
  if (speedKph != null && speedKph >= MOVING_SPEED_KPH) return "moving";
  return "idle";
}

export function isTrackerOnline(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < TRACKER_ONLINE_MS;
}

export function getFreshnessTier(lastSeenAt: string | null | undefined): FreshnessTier {
  if (!lastSeenAt) return "offline";
  const age = Date.now() - new Date(lastSeenAt).getTime();
  if (age >= TRACKER_ONLINE_MS) return "offline";
  if (age < TRACKER_FRESH_MS) return "live";
  if (age < TRACKER_STALE_MS) return "recent";
  return "stale";
}

export function formatFreshnessAgo(iso: string | null | undefined): string {
  if (!iso) return "No signal";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 8) return "Just now";
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function freshnessClassDark(tier: FreshnessTier): string {
  switch (tier) {
    case "live":
      return "text-emerald-400";
    case "recent":
      return "text-blue-300";
    case "stale":
      return "text-amber-400/90";
    default:
      return "text-slate-500";
  }
}

export function freshnessClassLight(tier: FreshnessTier): string {
  switch (tier) {
    case "live":
      return "text-emerald-600 dark:text-emerald-400";
    case "recent":
      return "text-blue-600 dark:text-blue-400";
    case "stale":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

export function headingLabel(heading: number | null | undefined): string {
  if (heading == null || Number.isNaN(heading)) return "—";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
  return dirs[Math.round(heading / 45) % 8];
}

export function ignitionLabel(on: boolean | null | undefined): string {
  if (on === true) return "ACC On";
  if (on === false) return "ACC Off";
  return "ACC —";
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathDistanceKm(
  path: Array<{ lat: number; lng: number }>,
): number | null {
  if (path.length < 2) return null;
  if (typeof window !== "undefined" && window.google?.maps?.geometry?.spherical) {
    const meters = google.maps.geometry.spherical.computeLength(
      path.map((p) => new google.maps.LatLng(p.lat, p.lng)),
    );
    return meters / 1000;
  }
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineKm(path[i - 1], path[i]);
  return total;
}

export function computeTripDayStats(positions: TripPosition[]): TripDayStats {
  const sorted = [...positions]
    .filter((p) => p.gpsValid !== false)
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  const speeds = sorted.map((p) => p.speedKph).filter((s): s is number => s != null);
  const maxSpeedKph = speeds.length ? Math.max(...speeds) : null;

  const path = sorted.map((p) => ({ lat: p.latitude, lng: p.longitude }));
  const distanceKm = pathDistanceKm(path);

  let drivingMs = 0;
  let idleMs = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const delta = new Date(curr.recordedAt).getTime() - new Date(prev.recordedAt).getTime();
    if (delta <= 0 || delta > TRIP_GAP_MS) continue;

    const speed = curr.speedKph ?? prev.speedKph ?? 0;
    if (speed >= MOVING_SPEED_KPH) drivingMs += delta;
    else idleMs += delta;
  }

  return {
    pointCount: sorted.length,
    distanceKm: distanceKm != null && distanceKm > 0 ? distanceKm : null,
    maxSpeedKph,
    drivingMinutes: Math.round(drivingMs / 60_000),
    idleMinutes: Math.round(idleMs / 60_000),
  };
}

export function formatDurationMinutes(mins: number): string {
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Format odometer / distance in km for fleet displays. */
export function formatMileageKm(km: number | null | undefined, opts?: { decimals?: number }): string {
  if (km == null || Number.isNaN(km)) return "—";
  const decimals = opts?.decimals ?? (km >= 100 ? 0 : 1);
  return `${km.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })} km`;
}

export function vehicleDisplayName(device: {
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  label?: string | null;
  imei: string;
}): string {
  const label = device.label?.trim();
  if (label) return label;
  const makeModel = [device.vehicleMake, device.vehicleModel].filter(Boolean).join(" ").trim();
  if (makeModel) return makeModel;
  return `Vehicle …${device.imei.slice(-4)}`;
}
