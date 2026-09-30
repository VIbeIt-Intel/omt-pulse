import { Capacitor } from "@capacitor/core";
import { ASSET_TRACKER_TOKEN_HEADER } from "@shared/assets";
import { apiUrl } from "@/lib/api-base";

const TOKEN_KEY = "omt_asset_tracker_token";
const QUEUE_KEY = "omt_asset_tracker_queue";
const MOVE_M = 40;
const HEARTBEAT_MS = 3 * 60 * 1000;

type QueuedFix = {
  latitude: number;
  longitude: number;
  batteryPercent: number | null;
  recordedAt: number;
};

type TrackerSession = {
  token: string;
  lastSent: QueuedFix | null;
  queue: QueuedFix[];
  timer: number | null;
  webWatchId: number | null;
  nativeActive: boolean;
  onSent?: (fix: QueuedFix) => void;
  onRemoved?: () => void;
};

let session: TrackerSession | null = null;

export function getAssetTrackerToken(): string | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    return token?.trim() ? token : null;
  } catch {
    return null;
  }
}

export function clearAssetTrackerToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* ignore */
  }
}

function saveQueue(queue: QueuedFix[]): void {
  try {
    if (queue.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-40)));
  } catch {
    /* ignore quota */
  }
}

function loadQueue(): QueuedFix[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedFix[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function movedEnough(next: QueuedFix, prev: QueuedFix | null): boolean {
  if (!prev) return true;
  if (next.recordedAt - prev.recordedAt >= HEARTBEAT_MS) return true;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(next.latitude - prev.latitude);
  const dLng = toRad(next.longitude - prev.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(prev.latitude)) * Math.cos(toRad(next.latitude)) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
  return meters >= MOVE_M;
}

async function readBattery(): Promise<number | null> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
  if (!nav.getBattery) return null;
  try {
    const battery = await nav.getBattery();
    if (!Number.isFinite(battery.level)) return null;
    return Math.round(battery.level * 100);
  } catch {
    return null;
  }
}

async function postFixes(token: string, points: QueuedFix[]): Promise<"ok" | "removed" | "retry"> {
  try {
    const res = await fetch(apiUrl("/api/assets/heartbeat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [ASSET_TRACKER_TOKEN_HEADER]: token,
      },
      body: JSON.stringify({
        points: points.map((p) => ({
          latitude: p.latitude,
          longitude: p.longitude,
          batteryPercent: p.batteryPercent,
          recordedAt: new Date(p.recordedAt).toISOString(),
        })),
      }),
      credentials: "omit",
      cache: "no-store",
    });
    if (res.status === 401) return "removed";
    if (!res.ok) return "retry";
    return "ok";
  } catch {
    return "retry";
  }
}

async function flush(): Promise<void> {
  if (!session || session.queue.length === 0) return;
  const current = session;
  const batch = current.queue.slice(0, 20);
  const result = await postFixes(current.token, batch);
  if (result === "removed") {
    current.onRemoved?.();
    await stopAssetTracking();
    clearAssetTrackerToken();
    return;
  }
  if (result !== "ok" || session !== current) return;
  current.queue = current.queue.slice(batch.length);
  current.lastSent = batch[batch.length - 1] ?? current.lastSent;
  saveQueue(current.queue);
  if (current.lastSent) current.onSent?.(current.lastSent);
}

function enqueue(fix: QueuedFix): void {
  if (!session) return;
  if (!movedEnough(fix, session.lastSent) && session.queue.length === 0) return;
  session.queue.push(fix);
  if (session.queue.length > 40) session.queue = session.queue.slice(-40);
  saveQueue(session.queue);
  if (session.queue.length >= 1) void flush();
}

export async function enrolAssetTracker(code: string): Promise<{ name: string; assetType: string }> {
  const res = await fetch(apiUrl("/api/assets/enrol"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim().toUpperCase() }),
    credentials: "omit",
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { message?: string; deviceToken?: string; name?: string; assetType?: string };
  if (!res.ok || !body.deviceToken || !body.name) {
    throw new Error(body.message || "Enrolment failed");
  }
  localStorage.setItem(TOKEN_KEY, body.deviceToken);
  return { name: body.name, assetType: body.assetType ?? "other" };
}

export type AssetTrackerStatus = {
  name: string;
  assetType: string;
  lastLat: number | null;
  lastLng: number | null;
  lastBatteryPercent: number | null;
  lastSeenAt: string | null;
};

export async function fetchAssetTrackerStatus(token: string): Promise<AssetTrackerStatus> {
  const res = await fetch(apiUrl("/api/assets/tracker"), {
    headers: { [ASSET_TRACKER_TOKEN_HEADER]: token },
    credentials: "omit",
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as AssetTrackerStatus & { message?: string };
  if (res.status === 401) {
    clearAssetTrackerToken();
    throw new Error(body.message || "This tracker was removed");
  }
  if (!res.ok) throw new Error(body.message || "Could not load tracker");
  return body;
}

function heartbeatUrl(token: string): string {
  const path = `/api/assets/heartbeat?token=${encodeURIComponent(token)}`;
  return apiUrl(path) || path;
}

async function startNative(token: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { BackgroundGeolocation } = await import("@capgo/background-geolocation");
    const url = heartbeatUrl(token);
    try {
      await BackgroundGeolocation.requestPermissions();
    } catch {
      /* start() asks again if this call is unavailable */
    }
    await BackgroundGeolocation.start(
      {
        backgroundTitle: "OMT asset location",
        backgroundMessage: "Sharing this tablet's location",
        requestPermissions: true,
        stale: false,
        distanceFilter: MOVE_M,
        url: url.startsWith("http") ? url : `${window.location.origin}${url}`,
      },
      (location, error) => {
        if (error || !location || !session) return;
        void readBattery().then((batteryPercent) => {
          enqueue({
            latitude: location.latitude,
            longitude: location.longitude,
            batteryPercent,
            recordedAt: location.time ?? Date.now(),
          });
        });
      },
    );
    return true;
  } catch {
    return false;
  }
}

function startWebWatch(): void {
  if (!session || !navigator.geolocation) return;
  const capture = (latitude: number, longitude: number) => {
    void readBattery().then((batteryPercent) => {
      enqueue({ latitude, longitude, batteryPercent, recordedAt: Date.now() });
    });
  };
  navigator.geolocation.getCurrentPosition(
    (pos) => capture(pos.coords.latitude, pos.coords.longitude),
    () => {},
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
  );
  session.webWatchId = navigator.geolocation.watchPosition(
    (pos) => capture(pos.coords.latitude, pos.coords.longitude),
    () => {},
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
  );
}

export async function startAssetTracking(opts: {
  onSent?: (fix: QueuedFix) => void;
  onRemoved?: () => void;
} = {}): Promise<void> {
  const token = getAssetTrackerToken();
  if (!token) return;
  await stopAssetTracking();
  session = {
    token,
    lastSent: null,
    queue: loadQueue(),
    timer: null,
    webWatchId: null,
    nativeActive: false,
    onSent: opts.onSent,
    onRemoved: opts.onRemoved,
  };
  session.timer = window.setInterval(() => {
    const last = session?.lastSent;
    if (!last) return;
    enqueue({ ...last, recordedAt: Date.now() });
  }, HEARTBEAT_MS);
  const nativeOk = await startNative(token);
  if (session) session.nativeActive = nativeOk;
  if (!nativeOk) startWebWatch();
  if (session.queue.length > 0) void flush();
}

export async function stopAssetTracking(): Promise<void> {
  const current = session;
  session = null;
  if (!current) return;
  if (current.timer != null) window.clearInterval(current.timer);
  if (current.webWatchId != null) navigator.geolocation.clearWatch(current.webWatchId);
  if (current.nativeActive) {
    try {
      const { BackgroundGeolocation } = await import("@capgo/background-geolocation");
      await BackgroundGeolocation.stop();
    } catch {
      /* ignore */
    }
  }
}
