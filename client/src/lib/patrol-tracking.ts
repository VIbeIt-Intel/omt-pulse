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

type BufferMeta = {
  token: string | null;
  updatedAt: number;
};

const MIN_MOVE_M = 10;
const MIN_INTERVAL_MS = 20_000;
const MAX_ACCURACY_M = 75;
const FLUSH_EVERY = 12;
const FLUSH_MS = 25_000;
const STOP_FLUSH_ATTEMPTS = 5;
const STOP_FLUSH_GAP_MS = 400;
const STORAGE_PREFIX = "omt_patrol_track_buf_";
const META_PREFIX = "omt_patrol_track_meta_";

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

function metaKey(patrolId: number): string {
  return `${META_PREFIX}${patrolId}`;
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

function loadMeta(patrolId: number): BufferMeta | null {
  try {
    const raw = localStorage.getItem(metaKey(patrolId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BufferMeta;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveBuffer(patrolId: number, buffer: PatrolTrackPointLocal[], token: string | null): void {
  try {
    if (buffer.length === 0) {
      localStorage.removeItem(bufferKey(patrolId));
      localStorage.removeItem(metaKey(patrolId));
      return;
    }
    localStorage.setItem(bufferKey(patrolId), JSON.stringify(buffer.slice(-200)));
    localStorage.setItem(
      metaKey(patrolId),
      JSON.stringify({ token, updatedAt: Date.now() } satisfies BufferMeta),
    );
  } catch {
    /* ignore quota */
  }
}

function clearBuffer(patrolId: number): void {
  try {
    localStorage.removeItem(bufferKey(patrolId));
    localStorage.removeItem(metaKey(patrolId));
  } catch {
    /* ignore */
  }
}

function listPendingPatrolIds(): number[] {
  const ids: number[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      const id = parseInt(key.slice(STORAGE_PREFIX.length), 10);
      if (Number.isFinite(id)) ids.push(id);
    }
  } catch {
    /* ignore */
  }
  return ids;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Upload one batch. Returns false on network/HTTP failure (buffer kept). */
async function uploadBatch(
  patrolId: number,
  token: string | null,
  batch: PatrolTrackPointLocal[],
): Promise<boolean> {
  if (batch.length === 0) return true;
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
    return res.ok;
  } catch {
    return false;
  }
}

async function flushBuffer(): Promise<boolean> {
  if (!session || session.buffer.length === 0) return true;
  const { patrolId, token } = session;
  const batch = session.buffer.slice(0, 100);
  const ok = await uploadBatch(patrolId, token, batch);
  if (!ok) return false;
  session.buffer = session.buffer.slice(batch.length);
  saveBuffer(patrolId, session.buffer, token);
  return true;
}

/** Drain the live session buffer with retries. */
async function flushUntilEmpty(attempts = STOP_FLUSH_ATTEMPTS): Promise<boolean> {
  if (!session) return true;
  for (let i = 0; i < attempts; i++) {
    if (session.buffer.length === 0) return true;
    const ok = await flushBuffer();
    if (!ok) {
      await sleep(STOP_FLUSH_GAP_MS * (i + 1));
      continue;
    }
    // Keep draining while batches remain.
    while (session.buffer.length > 0) {
      const more = await flushBuffer();
      if (!more) break;
    }
    if (session.buffer.length === 0) return true;
    await sleep(STOP_FLUSH_GAP_MS * (i + 1));
  }
  return session.buffer.length === 0;
}

/**
 * Retry any leftover local track buffers (e.g. upload failed at complete).
 * Safe to call on Patrol page mount; server accepts a short post-end grace window.
 */
export async function flushPendingPatrolTracks(): Promise<void> {
  const ids = listPendingPatrolIds().filter((id) => !session || session.patrolId !== id);
  for (const patrolId of ids) {
    let buffer = loadBuffer(patrolId);
    if (buffer.length === 0) {
      clearBuffer(patrolId);
      continue;
    }
    const meta = loadMeta(patrolId);
    const token = meta?.token ?? null;
    let failed = false;
    while (buffer.length > 0) {
      const batch = buffer.slice(0, 100);
      const ok = await uploadBatch(patrolId, token, batch);
      if (!ok) {
        failed = true;
        break;
      }
      buffer = buffer.slice(batch.length);
      saveBuffer(patrolId, buffer, token);
    }
    if (!failed && buffer.length === 0) clearBuffer(patrolId);
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
  saveBuffer(session.patrolId, session.buffer, session.token);
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
  // Tear down prior session without wiping its unsynced buffer.
  await stopPatrolTracking({ flush: false });
  // Best-effort: push any leftover buffers from earlier runs.
  void flushPendingPatrolTracks();

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
  saveBuffer(opts.patrolId, restored, session.token);

  session.flushTimer = window.setInterval(() => {
    void flushBuffer();
  }, FLUSH_MS);

  const nativeOk = await startNativeTracking();
  session.nativeActive = nativeOk;
  if (!nativeOk) startWebFallback();

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibility);

  if (session.buffer.length > 0) {
    void flushUntilEmpty(3);
  }
}

function onOnline(): void {
  void flushBuffer();
  void flushPendingPatrolTracks();
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
    await flushUntilEmpty();
  }

  // Only drop local points after a successful full drain. Otherwise keep them
  // for flushPendingPatrolTracks / next session restore.
  if (current.buffer.length === 0) {
    clearBuffer(current.patrolId);
  } else {
    saveBuffer(current.patrolId, current.buffer, current.token);
  }
  session = null;
}

export function getLocalPatrolTrackPreview(): PatrolTrackPointLocal[] {
  if (!session) return [];
  return session.lastAccepted
    ? [...(session.buffer.length ? session.buffer : []), session.lastAccepted].slice(-200)
    : session.buffer.slice();
}
