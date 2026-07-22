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

/** Prefer device odometer; fall back to GPS path distance when extended mileage packets are missing. */
export function preferredTodayDistanceKm(device: {
  todayDistanceKm?: number | null;
  todayOdometerDistanceKm?: number | null;
  todayGpsDistanceKm?: number | null;
}): number | null {
  if (device.todayDistanceKm != null && !Number.isNaN(device.todayDistanceKm)) {
    return device.todayDistanceKm;
  }
  if (device.todayOdometerDistanceKm != null && !Number.isNaN(device.todayOdometerDistanceKm)) {
    return device.todayOdometerDistanceKm;
  }
  if (
    device.todayGpsDistanceKm != null
    && !Number.isNaN(device.todayGpsDistanceKm)
    && device.todayGpsDistanceKm > 0
  ) {
    return device.todayGpsDistanceKm;
  }
  return null;
}

export type TripMapEvent = {
  kind: "stop" | "ignition_off";
  lat: number;
  lng: number;
  at: string;
  durationMinutes?: number;
  label: string;
};

/** Minimum parked/idle dwell to count as a stop on the route map. */
export const TRIP_STOP_MIN_MS = 3 * 60 * 1000;
const TRIP_EVENT_DEDUPE_M = 40;

function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  return haversineKm(a, b) * 1000;
}

function formatStopClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Derive stop (low-speed dwell) and ignition-off points for the daily route map.
 * Uses the same moving threshold as trip analytics.
 */
export function detectTripMapEvents(positions: TripPosition[]): TripMapEvent[] {
  const sorted = [...positions]
    .filter((p) => p.gpsValid !== false)
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  const events: TripMapEvent[] = [];

  let idleStartIdx: number | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const point = sorted[i]!;
    const speed = point.speedKph ?? 0;
    const isIdle = speed < MOVING_SPEED_KPH;

    if (isIdle) {
      if (idleStartIdx == null) idleStartIdx = i;
      continue;
    }

    if (idleStartIdx != null) {
      const start = sorted[idleStartIdx]!;
      const end = sorted[i - 1]!;
      const dwellMs =
        new Date(end.recordedAt).getTime() - new Date(start.recordedAt).getTime();
      if (dwellMs >= TRIP_STOP_MIN_MS) {
        const mid = sorted[Math.floor((idleStartIdx + i - 1) / 2)]!;
        const mins = Math.round(dwellMs / 60_000);
        events.push({
          kind: "stop",
          lat: mid.latitude,
          lng: mid.longitude,
          at: start.recordedAt,
          durationMinutes: mins,
          label: `Stop · ${formatStopClock(start.recordedAt)} · ${formatDurationMinutes(mins)}`,
        });
      }
      idleStartIdx = null;
    }
  }

  if (idleStartIdx != null) {
    const start = sorted[idleStartIdx]!;
    const end = sorted[sorted.length - 1]!;
    const dwellMs = new Date(end.recordedAt).getTime() - new Date(start.recordedAt).getTime();
    if (dwellMs >= TRIP_STOP_MIN_MS) {
      const mid = sorted[Math.floor((idleStartIdx + sorted.length - 1) / 2)]!;
      const mins = Math.round(dwellMs / 60_000);
      events.push({
        kind: "stop",
        lat: mid.latitude,
        lng: mid.longitude,
        at: start.recordedAt,
        durationMinutes: mins,
        label: `Stop · ${formatStopClock(start.recordedAt)} · ${formatDurationMinutes(mins)}`,
      });
    }
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    if (prev.ignitionOn === true && curr.ignitionOn === false) {
      events.push({
        kind: "ignition_off",
        lat: curr.latitude,
        lng: curr.longitude,
        at: curr.recordedAt,
        label: `Ignition off · ${formatStopClock(curr.recordedAt)}`,
      });
    }
  }

  // Prefer ignition-off over a nearly-colocated stop marker.
  const ignitionOffs = events.filter((e) => e.kind === "ignition_off");
  const stops = events.filter((e) => e.kind === "stop").filter((stop) => {
    return !ignitionOffs.some(
      (off) => distanceM({ lat: stop.lat, lng: stop.lng }, { lat: off.lat, lng: off.lng }) < TRIP_EVENT_DEDUPE_M,
    );
  });

  const dedupedOffs: TripMapEvent[] = [];
  for (const off of ignitionOffs) {
    const near = dedupedOffs.some(
      (kept) => distanceM({ lat: kept.lat, lng: kept.lng }, { lat: off.lat, lng: off.lng }) < TRIP_EVENT_DEDUPE_M,
    );
    if (!near) dedupedOffs.push(off);
  }

  return [...stops, ...dedupedOffs].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
}

/**
 * Heartbeats refresh lastSeenAt without a GPS fix. When signal is meaningfully newer than
 * lastPositionAt, the UI should surface GPS age separately so idle+ACC-on does not look like live track.
 */
export function trackerSignalSummary(device: {
  lastSeenAt: string | null | undefined;
  lastPositionAt: string | null | undefined;
}): {
  signalAgo: string;
  signalTier: FreshnessTier;
  gpsAgo: string | null;
  gpsTier: FreshnessTier | null;
  heartbeatOnly: boolean;
} {
  const signalTier = getFreshnessTier(device.lastSeenAt);
  const signalAgo = formatFreshnessAgo(device.lastSeenAt);
  if (!device.lastPositionAt) {
    return {
      signalAgo,
      signalTier,
      gpsAgo: null,
      gpsTier: null,
      heartbeatOnly: Boolean(device.lastSeenAt),
    };
  }
  const gpsTier = getFreshnessTier(device.lastPositionAt);
  const gpsAgo = formatFreshnessAgo(device.lastPositionAt);
  const seenMs = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0;
  const posMs = new Date(device.lastPositionAt).getTime();
  const heartbeatOnly = seenMs - posMs > 60_000;
  return { signalAgo, signalTier, gpsAgo, gpsTier, heartbeatOnly };
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
