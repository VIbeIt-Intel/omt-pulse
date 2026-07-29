import type { CctvAiDetection } from "@shared/cctv";
import {
  detectObjectsFromRtspWithFrame,
  detectVehicleObjectsInJpegForRoi,
  PERSON_INSTANT_CONF,
  PERSON_MIN_CONF,
  warmupCctvAiDetector,
} from "./ai-detector";
import { saveDetectionSnapshot } from "./ai-snapshots";
import { getLatestHlsSegmentPath, touchCctvStream } from "./stream-manager";
import {
  buildRtspSource,
  insertCctvAiEvent,
  listAiEnabledCameras,
} from "./storage";

const TICK_MS = 2_500;
/** Person alerts: avoid spam when someone stays in view. */
const PERSON_ALERT_COOLDOWN_MS = 45_000;
/** Vehicle alerts: short so cars that follow each other still get separate records. */
const VEHICLE_ALERT_COOLDOWN_MS = 20_000;
const STALE_MS = 12_000;
/** Boxes with IoU below this are treated as a different vehicle. */
const DISTINCT_VEHICLE_IOU = 0.28;

type LatestState = {
  detections: CctvAiDetection[];
  at: number;
  error?: string;
};

const latestByCamera = new Map<number, LatestState>();
const lastPersonAlertAt = new Map<number, number>();
const lastVehicleAlertAt = new Map<number, number>();
/** Vehicles seen on the previous successful tick (for new-vehicle detection). */
const prevVehiclesByCamera = new Map<number, CctvAiDetection[]>();
const hadPerson = new Map<number, boolean>();
/** Low-confidence person must appear on consecutive ticks before we show/alert. */
const personConfirmPending = new Map<number, CctvAiDetection[]>();

let started = false;
let tickRunning = false;
let timer: ReturnType<typeof setInterval> | null = null;

function isVehicle(d: CctvAiDetection): boolean {
  return d.label !== "person";
}

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
  lastPersonAlertAt.delete(cameraId);
  lastVehicleAlertAt.delete(cameraId);
  prevVehiclesByCamera.delete(cameraId);
  hadPerson.delete(cameraId);
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
  const vehicles = raw.filter((d) => isVehicle(d));
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

function mergeUniqueDetections(dets: CctvAiDetection[]): CctvAiDetection[] {
  const sorted = [...dets].sort((a, b) => b.confidence - a.confidence);
  const kept: CctvAiDetection[] = [];
  for (const det of sorted) {
    const dupe = kept.some((k) => k.label === det.label && iou(k, det) >= 0.45);
    if (!dupe) kept.push(det);
  }
  return kept;
}

function bestOf(dets: CctvAiDetection[]): CctvAiDetection | null {
  if (!dets.length) return null;
  return [...dets].sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

/** Vehicles that don't overlap a previous tick's vehicles (new car in frame). */
function findNewVehicles(
  prev: CctvAiDetection[],
  now: CctvAiDetection[],
): CctvAiDetection[] {
  return now.filter((v) => prev.every((p) => iou(p, v) < DISTINCT_VEHICLE_IOU));
}

async function emitAlert(
  camera: Awaited<ReturnType<typeof listAiEnabledCameras>>[number],
  jpeg: Buffer,
  detection: CctvAiDetection,
): Promise<void> {
  const snapshotPath = await saveDetectionSnapshot({
    jpeg,
    detection,
    cameraId: camera.id,
  });
  await insertCctvAiEvent({
    organizationId: camera.organizationId,
    cameraId: camera.id,
    detection,
    snapshotPath,
  });
  console.log(
    `[cctv-ai] alert camera=${camera.id} ${detection.label} ${(detection.confidence * 100).toFixed(0)}%`,
  );
}

async function processCamera(camera: Awaited<ReturnType<typeof listAiEnabledCameras>>[number]) {
  const rtsp = buildRtspSource(camera);
  try {
    // Keep HLS warm even when nobody is watching — AI frame grabs use those segments.
    await touchCctvStream(
      camera.organizationId,
      camera.id,
      rtsp,
      (camera.streamRotation as "normal" | "rotate180") || "normal",
      (camera.streamQuality as "low" | "medium" | "high") || "medium",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    latestByCamera.set(camera.id, {
      detections: latestByCamera.get(camera.id)?.detections ?? [],
      at: Date.now(),
      error: message,
    });
    console.warn(`[cctv-ai] camera ${camera.id} stream:`, message);
    return;
  }

  const hlsSeg = getLatestHlsSegmentPath(camera.organizationId, camera.id);
  try {
    const { jpeg, detections: raw } = await detectObjectsFromRtspWithFrame(rtsp, hlsSeg);
    let combined = raw;
    if (camera.vehicleRoiJson) {
      try {
        const roi = JSON.parse(camera.vehicleRoiJson) as { x: number; y: number; w: number; h: number };
        // People: full frame. Vehicles: full frame + ROI crop (crop boosts distant cars in-zone).
        const fullFramePeople = raw.filter((d) => d.label === "person");
        const fullFrameVehicles = raw.filter((d) => isVehicle(d));
        const roiVehicles = await detectVehicleObjectsInJpegForRoi(jpeg, roi);
        combined = mergeUniqueDetections([
          ...fullFramePeople,
          ...fullFrameVehicles,
          ...roiVehicles,
        ]);
      } catch {
        combined = raw;
      }
    }
    const detections = confirmPersonDetections(camera.id, combined);
    latestByCamera.set(camera.id, { detections, at: Date.now() });

    const persons = detections.filter((d) => d.label === "person");
    const vehicles = detections.filter((d) => isVehicle(d));
    if (vehicles.length > 0 || persons.length > 0) {
      const bestV = bestOf(vehicles);
      const bestP = bestOf(persons);
      console.log(
        `[cctv-ai] camera ${camera.id} saw` +
          (bestP ? ` person=${(bestP.confidence * 100).toFixed(0)}%` : "") +
          (bestV ? ` vehicle=${bestV.label}:${(bestV.confidence * 100).toFixed(0)}%` : ""),
      );
    }
    const now = Date.now();

    // Person: rising edge only (nothing → person).
    const nowHasPerson = persons.length > 0;
    const prevHadPerson = hadPerson.get(camera.id) ?? false;
    hadPerson.set(camera.id, nowHasPerson);
    if (nowHasPerson && !prevHadPerson) {
      const last = lastPersonAlertAt.get(camera.id) ?? 0;
      const best = bestOf(persons);
      if (best && best.confidence >= PERSON_MIN_CONF && now - last >= PERSON_ALERT_COOLDOWN_MS) {
        await emitAlert(camera, jpeg, best);
        lastPersonAlertAt.set(camera.id, now);
      }
    }

    // Vehicle: rising edge OR a distinct new box vs previous tick (2nd car while 1st still there).
    const prevVehicles = prevVehiclesByCamera.get(camera.id) ?? [];
    const newVehicles = findNewVehicles(prevVehicles, vehicles);
    prevVehiclesByCamera.set(camera.id, vehicles);

    if (newVehicles.length > 0) {
      const last = lastVehicleAlertAt.get(camera.id) ?? 0;
      const best = bestOf(newVehicles);
      if (best && now - last >= VEHICLE_ALERT_COOLDOWN_MS) {
        await emitAlert(camera, jpeg, best);
        lastVehicleAlertAt.set(camera.id, now);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    latestByCamera.set(camera.id, {
      detections: latestByCamera.get(camera.id)?.detections ?? [],
      at: Date.now(),
      error: message,
    });
    hadPerson.set(camera.id, false);
    prevVehiclesByCamera.set(camera.id, []);
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
  console.log(`[cctv-ai] worker started (every ${TICK_MS / 1000}s, person cooldown ${PERSON_ALERT_COOLDOWN_MS / 1000}s, vehicle cooldown ${VEHICLE_ALERT_COOLDOWN_MS / 1000}s)`);
}

export function stopCctvAiWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
