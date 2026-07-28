import type { CctvAiDetection } from "@shared/cctv";
import { detectObjectsFromRtsp, warmupCctvAiDetector } from "./ai-detector";
import {
  buildRtspSource,
  insertCctvAiEvent,
  listAiEnabledCameras,
} from "./storage";

const TICK_MS = 4_000;
const ALERT_COOLDOWN_MS = 60_000;

type LatestState = {
  detections: CctvAiDetection[];
  at: number;
  error?: string;
};

const latestByCamera = new Map<number, LatestState>();
/** Rising-edge tracker: any person/vehicle present. */
const hadTarget = new Map<number, boolean>();
const lastAlertAt = new Map<number, number>();

let started = false;
let tickRunning = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function getLatestCctvAiDetections(cameraId: number): LatestState | null {
  return latestByCamera.get(cameraId) ?? null;
}

export function clearCctvAiCameraState(cameraId: number): void {
  latestByCamera.delete(cameraId);
  hadTarget.delete(cameraId);
  lastAlertAt.delete(cameraId);
}

async function processCamera(camera: Awaited<ReturnType<typeof listAiEnabledCameras>>[number]) {
  const rtsp = buildRtspSource(camera);
  try {
    const detections = await detectObjectsFromRtsp(rtsp);
    latestByCamera.set(camera.id, { detections, at: Date.now() });

    const nowHas = detections.length > 0;
    const prevHad = hadTarget.get(camera.id) ?? false;
    hadTarget.set(camera.id, nowHas);

    if (nowHas && !prevHad) {
      const last = lastAlertAt.get(camera.id) ?? 0;
      if (Date.now() - last >= ALERT_COOLDOWN_MS) {
        const best = [...detections].sort((a, b) => b.confidence - a.confidence)[0]!;
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    latestByCamera.set(camera.id, {
      detections: latestByCamera.get(camera.id)?.detections ?? [],
      at: Date.now(),
      error: message,
    });
    // Treat grab/detect failure as clear so rising-edge can fire again after recovery.
    hadTarget.set(camera.id, false);
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
    for (const camera of cameras) {
      await processCamera(camera);
    }
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
