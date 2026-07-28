import type { CctvAiDetection } from "@shared/cctv";
import {
  detectObjectsFromRtsp,
  PERSON_INSTANT_CONF,
  PERSON_MIN_CONF,
  warmupCctvAiDetector,
} from "./ai-detector";
import { getLatestHlsSegmentPath } from "./stream-manager";
import {
  buildRtspSource,
  insertCctvAiEvent,
  listAiEnabledCameras,
} from "./storage";

const TICK_MS = 2_500;
const ALERT_COOLDOWN_MS = 60_000;
const STALE_MS = 12_000;

type LatestState = {
  detections: CctvAiDetection[];
  at: number;
  error?: string;
};

const latestByCamera = new Map<number, LatestState>();
/** Rising-edge tracker: any person/vehicle present. */
const hadTarget = new Map<number, boolean>();
const lastAlertAt = new Map<number, number>();
/** Low-confidence person must appear on consecutive ticks before we show/alert. */
const personConfirmPending = new Map<number, CctvAiDetection[]>();

let started = false;
let tickRunning = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function getLatestCctvAiDetections(cameraId: number): LatestState | null {
  const state = latestByCamera.get(cameraId);
  if (!state) return null;
  if (Date.now() - state.at > STALE_MS) {
    return { ...state, detections: [] };
  }
  return state;
}

export function clearCctvAiCameraState(cameraId: number): void {
  latestByCamera.delete(cameraId);
  hadTarget.delete(cameraId);
  lastAlertAt.delete(cameraId);
  personConfirmPending.delete(cameraId);
}

function iou(a: CctvAiDetection, b: CctvAiDetection): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

function confirmPersonDetections(
  cameraId: number,
  raw: CctvAiDetection[],
): CctvAiDetection[] {
  const vehicles = raw.filter((d) => d.label !== "person");
  const persons = raw.filter((d) => d.label === "person");
  const instant = persons.filter((p) => p.confidence >= PERSON_INSTANT_CONF);
  const needConfirm = persons.filter((p) => p.confidence < PERSON_INSTANT_CONF);

  const confirmedLow: CctvAiDetection[] = [];
  const pending = personConfirmPending.get(cameraId) ?? [];

  for (const p of needConfirm) {
    const match = pending.some((prev) => iou(prev, p) >= 0.15);
    if (match) confirmedLow.push(p);
  }

  if (needConfirm.length > 0) {
    personConfirmPending.set(cameraId, needConfirm);
  } else {
    personConfirmPending.delete(cameraId);
  }

  return [...vehicles, ...instant, ...confirmedLow];
}

async function processCamera(camera: Awaited<ReturnType<typeof listAiEnabledCameras>>[number]) {
  const rtsp = buildRtspSource(camera);
  const hlsSeg = getLatestHlsSegmentPath(camera.organizationId, camera.id);
  try {
    const raw = await detectObjectsFromRtsp(rtsp, hlsSeg);
    const detections = confirmPersonDetections(camera.id, raw);
    latestByCamera.set(camera.id, { detections, at: Date.now() });

    const nowHas = detections.length > 0;
    const prevHad = hadTarget.get(camera.id) ?? false;
    hadTarget.set(camera.id, nowHas);

    if (nowHas && !prevHad) {
      const last = lastAlertAt.get(camera.id) ?? 0;
      if (Date.now() - last >= ALERT_COOLDOWN_MS) {
        const best = [...detections].sort((a, b) => b.confidence - a.confidence)[0]!;
        if (best.label !== "person" || best.confidence >= PERSON_MIN_CONF) {
          await insertCctvAiEvent({
            organizationId: camera.organizationId,
            cameraId: camera.id,
            detection: best,
          });
          lastAlertAt.set(camera.id, Date.now());
          console.log(
            `[cctv-ai] alert camera=${camera.id} ${best.label} ${(best.confidence * 100).toFixed(0)}%`,
          );
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    latestByCamera.set(camera.id, {
      detections: latestByCamera.get(camera.id)?.detections ?? [],
      at: Date.now(),
      error: message,
    });
    hadTarget.set(camera.id, false);
    personConfirmPending.delete(camera.id);
    console.warn(`[cctv-ai] camera ${camera.id}:`, message);
  }
}

async function tick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const cameras = await listAiEnabledCameras();
    const enabledIds = new Set(cameras.map((c) => c.id));
    for (const id of [...latestByCamera.keys()]) {
      if (!enabledIds.has(id)) clearCctvAiCameraState(id);
    }
    await Promise.all(cameras.map((camera) => processCamera(camera)));
  } catch (err) {
    console.error("[cctv-ai] tick failed:", err);
  } finally {
    tickRunning = false;
  }
}

export function startCctvAiWorker(): void {
  if (started) return;
  started = true;
  void warmupCctvAiDetector()
    .then(() => console.log("[cctv-ai] YOLOv8n ready"))
    .catch((err) => console.warn("[cctv-ai] model warmup:", err instanceof Error ? err.message : err));

  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
  console.log(`[cctv-ai] worker started (every ${TICK_MS / 1000}s, cooldown ${ALERT_COOLDOWN_MS / 1000}s)`);
}

export function stopCctvAiWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
