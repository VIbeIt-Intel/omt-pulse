import { Capacitor } from "@capacitor/core";
import { apiUrl } from "@/lib/api-base";
import { haversineM } from "@shared/premises-geofence";

export type PatrolTrackPointLocal = {
  latitude: number;
  longitude: number;
  recordedAt: number;
  accuracyM?: number | null;
  heading?: number | null;
  speedMps?: number | null;
  altitudeM?: number | null;
  seq: number;
};

type StartPatrolTrackingOpts = {
  patrolId: number;
  trackUploadToken?: string | null;
  onPoint?: (point: PatrolTrackPointLocal) => void;
};

const MIN_MOVE_M = 10;
const MIN_INTERVAL_MS = 20_000;
const MAX_ACCURACY_M = 75;
const FLUSH_EVERY = 12;
const FLUSH_MS = 25_000;
const STORAGE_PREFIX = "omt_patrol_track_buf_";

type Session = {
  patrolId: number;
  token: string | null;
  seq: number;
  buffer: PatrolTrackPointLocal[];
  lastAccepted: PatrolTrackPointLocal | null;
  onPoint?: (point: PatrolTrackPointLocal) => void;
  flushTimer: number | null;
  webWatchId: number | null;
  nativeActive: boolean;
};

let session: Session | null = null;

function bufferKey(patrolId: number): string {
  return `${STORAGE_PREFIX}${patrolId}`;
}

function loadBuffer(patrolId: number): PatrolTrackPointLocal[] {
  try {
    const raw = localStorage.getItem(bufferKey(patrolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PatrolTrackPointLocal[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveBuffer(patrolId: number, buffer: PatrolTrackPointLocal[]): void {
  try {
    localStorage.setItem(bufferKey(patrolId), JSON.stringify(buffer.slice(-200)));
  } catch {
    /* ignore quota */
  }
}

function clearBuffer(patrolId: number): void {
  try {
    localStorage.removeItem(bufferKey(patrolId));
  } catch {
    /* ignore */
  }
}

function shouldAccept(point: PatrolTrackPointLocal, last: PatrolTrackPointLocal | null): boolean {
  if (point.accuracyM != null && point.accuracyM > MAX_ACCURACY_M) return false;
  if (!last) return true;
  const dt = point.recordedAt - last.recordedAt;
  const dist = haversineM(
    { lat: last.latitude, lng: last.longitude },
    { lat: point.latitude, lng: point.longitude },
  );
  if (dt < 2_000 && dist > 200) return false; // teleport
  if (dist < MIN_MOVE_M && dt < MIN_INTERVAL_MS) return false;
  if (dt >= MIN_INTERVAL_MS) return true;
  return dist >= MIN_MOVE_M;
}

async function flushBuffer(): Promise<void> {
  if (!session || session.buffer.length === 0) return;
  const { patrolId, token, buffer } = session;
  const batch = buffer.slice(0, 100);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["x-patrol-track-token"] = token;
    const res = await fetch(apiUrl(`/api/patrol/patrols/${patrolId}/track`), {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        points: batch.map((p) => ({
          latitude: p.latitude,
          longitude: p.longitude,
          recordedAt: p.recordedAt,
          accuracyM: p.accuracyM ?? null,
          heading: p.heading ?? null,
          speedMps: p.speedMps ?? null,
          altitudeM: p.altitudeM ?? null,
          seq: p.seq,
        })),
      }),
    });
    if (!res.ok) throw new Error(`track upload ${res.status}`);
    session.buffer = session.buffer.slice(batch.length);
    saveBuffer(patrolId, session.buffer);
  } catch {
    // Keep buffer for retry on next flush / reconnect.
  }
}

function acceptPoint(raw: {
  latitude: number;
  longitude: number;
  recordedAt: number;
  accuracyM?: number | null;
  heading?: number | null;
  speedMps?: number | null;
  altitudeM?: number | null;
}): void {
  if (!session) return;
  if (!Number.isFinite(raw.latitude) || !Number.isFinite(raw.longitude)) return;
  const candidate: PatrolTrackPointLocal = {
    ...raw,
    seq: session.seq + 1,
  };
  if (!shouldAccept(candidate, session.lastAccepted)) return;
  session.seq = candidate.seq;
  session.lastAccepted = candidate;
  session.buffer.push(candidate);
  saveBuffer(session.patrolId, session.buffer);
  session.onPoint?.(candidate);
  if (session.buffer.length >= FLUSH_EVERY) {
    void flushBuffer();
  }
}

async function startNativeTracking(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { BackgroundGeolocation } = await import("@capgo/background-geolocation");
    await BackgroundGeolocation.start(
      {
        backgroundMessage: "OMT Pulse is recording your patrol route",
        backgroundTitle: "Patrol tracking",
        requestPermissions: true,
        stale: false,
        distanceFilter: 8,
      },
      (location, error) => {
        if (error || !location) return;
        acceptPoint({
          latitude: location.latitude,
          longitude: location.longitude,
          recordedAt: location.time ?? Date.now(),
          accuracyM: location.accuracy,
          heading: location.bearing,
          speedMps: location.speed,
          altitudeM: location.altitude,
        });
      },
    );
    return true;
  } catch {
    return false;
  }
}

function startWebFallback(): void {
  if (!session || !navigator.geolocation) return;
  session.webWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      acceptPoint({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        recordedAt: pos.timestamp || Date.now(),
        accuracyM: pos.coords.accuracy,
        heading: pos.coords.heading,
        speedMps: pos.coords.speed,
        altitudeM: pos.coords.altitude,
      });
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 8_000, timeout: 15_000 },
  );
}

export async function startPatrolTracking(opts: StartPatrolTrackingOpts): Promise<void> {
  await stopPatrolTracking({ flush: false });

  const restored = loadBuffer(opts.patrolId);
  const lastSeq = restored.reduce((m, p) => Math.max(m, p.seq), 0);
  session = {
    patrolId: opts.patrolId,
    token: opts.trackUploadToken ?? null,
    seq: lastSeq,
    buffer: restored,
    lastAccepted: restored.length > 0 ? restored[restored.length - 1]! : null,
    onPoint: opts.onPoint,
    flushTimer: null,
    webWatchId: null,
    nativeActive: false,
  };

  session.flushTimer = window.setInterval(() => {
    void flushBuffer();
  }, FLUSH_MS);

  const nativeOk = await startNativeTracking();
  session.nativeActive = nativeOk;
  if (!nativeOk) startWebFallback();

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibility);
}

function onOnline(): void {
  void flushBuffer();
}

function onVisibility(): void {
  if (document.visibilityState === "hidden") void flushBuffer();
}

export async function stopPatrolTracking(opts: { flush?: boolean } = {}): Promise<void> {
  const flush = opts.flush !== false;
  if (!session) return;
  const current = session;

  window.removeEventListener("online", onOnline);
  document.removeEventListener("visibilitychange", onVisibility);
  if (current.flushTimer != null) window.clearInterval(current.flushTimer);
  if (current.webWatchId != null) navigator.geolocation.clearWatch(current.webWatchId);

  if (current.nativeActive) {
    try {
      const { BackgroundGeolocation } = await import("@capgo/background-geolocation");
      await BackgroundGeolocation.stop();
    } catch {
      /* ignore */
    }
  }

  if (flush) {
    session = current;
    await flushBuffer();
  }

  clearBuffer(current.patrolId);
  session = null;
}

export function getLocalPatrolTrackPreview(): PatrolTrackPointLocal[] {
  if (!session) return [];
  return session.lastAccepted ? [...(session.buffer.length ? session.buffer : []), session.lastAccepted].slice(-200) : session.buffer.slice();
}
