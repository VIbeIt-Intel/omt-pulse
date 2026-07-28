import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";
import * as ort from "onnxruntime-node";
import type { CctvAiDetection } from "@shared/cctv";

const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.25;
const IOU_THRESHOLD = 0.45;

/** COCO class ids we alert on: person + common vehicles. */
const DETECT_CLASS_IDS = new Set([0, 2, 3, 5, 7]); // person, car, motorcycle, bus, truck
const DETECT_LABELS: Record<number, string> = {
  0: "person",
  2: "car",
  3: "motorcycle",
  5: "bus",
  7: "truck",
};

const MODEL_URLS = [
  "https://huggingface.co/Kalray/yolov8/resolve/main/yolov8n.onnx",
];

function modelsDir(): string {
  const preferred = path.join(process.cwd(), "server", "cctv", "models");
  fs.mkdirSync(preferred, { recursive: true });
  return preferred;
}

function modelPath(): string {
  return path.join(modelsDir(), "yolov8n.onnx");
}

let sessionPromise: Promise<ort.InferenceSession> | null = null;

async function downloadModel(dest: string): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr: Error | null = null;
  for (const url of MODEL_URLS) {
    try {
      console.log(`[cctv-ai] downloading YOLOv8n ONNX from ${url}`);
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1_000_000) throw new Error(`unexpected model size ${buf.length}`);
      const tmp = `${dest}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
      console.log(`[cctv-ai] model saved (${(buf.length / 1e6).toFixed(1)} MB)`);
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      console.warn(`[cctv-ai] model download failed:`, lastErr.message);
    }
  }
  throw lastErr ?? new Error("Failed to download YOLOv8n ONNX model");
}

async function ensureModel(): Promise<string> {
  const dest = modelPath();
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) return dest;
  await downloadModel(dest);
  return dest;
}

async function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const model = await ensureModel();
      return ort.InferenceSession.create(model, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
      });
    })().catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

export async function grabRtspJpeg(rtspUrl: string, timeoutMs = 12_000): Promise<Buffer> {
  const bin = ffmpegStatic && typeof ffmpegStatic === "string" ? ffmpegStatic : null;
  if (!bin) throw new Error("FFmpeg is not available");

  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-rtsp_transport",
      "tcp",
      "-i",
      rtspUrl,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-q:v",
      "3",
      "pipe:1",
    ];
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new Error("Frame grab timed out"));
    }, timeoutMs);

    proc.stdout?.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr?.on("data", (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-2000);
    });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (code === 0 && buf.length > 100) {
        resolve(buf);
        return;
      }
      reject(new Error(`Frame grab failed${stderr ? `: ${stderr.trim()}` : ` (code ${code})`}`));
    });
  });
}

type LetterboxMeta = {
  scale: number;
  padX: number;
  padY: number;
  origW: number;
  origH: number;
};

async function letterbox(jpeg: Buffer): Promise<{ tensor: ort.Tensor; meta: LetterboxMeta }> {
  const image = sharp(jpeg, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  const origW = meta.width ?? 0;
  const origH = meta.height ?? 0;
  if (!origW || !origH) throw new Error("Invalid frame dimensions");

  const scale = Math.min(INPUT_SIZE / origW, INPUT_SIZE / origH);
  const newW = Math.round(origW * scale);
  const newH = Math.round(origH * scale);
  const padX = Math.floor((INPUT_SIZE - newW) / 2);
  const padY = Math.floor((INPUT_SIZE - newH) / 2);

  const { data, info } = await image
    .resize(newW, newH, { fit: "fill" })
    .extend({
      top: padY,
      bottom: INPUT_SIZE - newH - padY,
      left: padX,
      right: INPUT_SIZE - newW - padX,
      background: { r: 114, g: 114, b: 114 },
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== INPUT_SIZE || info.height !== INPUT_SIZE || info.channels !== 3) {
    throw new Error(`Unexpected preprocess shape ${info.width}x${info.height}x${info.channels}`);
  }

  const float = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const plane = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < plane; i++) {
    const o = i * 3;
    float[i] = data[o]! / 255;
    float[plane + i] = data[o + 1]! / 255;
    float[2 * plane + i] = data[o + 2]! / 255;
  }

  return {
    tensor: new ort.Tensor("float32", float, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    meta: { scale, padX, padY, origW, origH },
  };
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

function nms(dets: CctvAiDetection[]): CctvAiDetection[] {
  const sorted = [...dets].sort((a, b) => b.confidence - a.confidence);
  const kept: CctvAiDetection[] = [];
  for (const det of sorted) {
    if (kept.every((k) => iou(k, det) < IOU_THRESHOLD)) kept.push(det);
  }
  return kept;
}

function parseYoloOutput(output: ort.Tensor, meta: LetterboxMeta): CctvAiDetection[] {
  const dims = output.dims;
  // YOLOv8 export: [1, 84, N] where 84 = 4 box + 80 classes
  let data = output.data as Float32Array;
  let numPred = 0;
  let numFeat = 0;
  let transposed = false;

  if (dims.length === 3 && dims[1] === 84) {
    numFeat = 84;
    numPred = dims[2] ?? 0;
  } else if (dims.length === 3 && dims[2] === 84) {
    numFeat = 84;
    numPred = dims[1] ?? 0;
    transposed = true;
  } else {
    throw new Error(`Unexpected YOLO output shape ${dims.join("x")}`);
  }

  const raw: CctvAiDetection[] = [];
  for (let i = 0; i < numPred; i++) {
    let bestScore = 0;
    let bestCls = -1;
    for (const cls of DETECT_CLASS_IDS) {
      const score = transposed
        ? data[i * numFeat + (4 + cls)]!
        : data[(4 + cls) * numPred + i]!;
      if (score > bestScore) {
        bestScore = score;
        bestCls = cls;
      }
    }
    if (bestScore < CONF_THRESHOLD || bestCls < 0) continue;

    const cx = transposed ? data[i * numFeat]! : data[0 * numPred + i]!;
    const cy = transposed ? data[i * numFeat + 1]! : data[1 * numPred + i]!;
    const bw = transposed ? data[i * numFeat + 2]! : data[2 * numPred + i]!;
    const bh = transposed ? data[i * numFeat + 3]! : data[3 * numPred + i]!;

    // Undo letterbox → absolute pixels → normalized 0–1
    const x1 = (cx - bw / 2 - meta.padX) / meta.scale;
    const y1 = (cy - bh / 2 - meta.padY) / meta.scale;
    const x2 = (cx + bw / 2 - meta.padX) / meta.scale;
    const y2 = (cy + bh / 2 - meta.padY) / meta.scale;

    const nx1 = Math.max(0, Math.min(1, x1 / meta.origW));
    const ny1 = Math.max(0, Math.min(1, y1 / meta.origH));
    const nx2 = Math.max(0, Math.min(1, x2 / meta.origW));
    const ny2 = Math.max(0, Math.min(1, y2 / meta.origH));
    const w = nx2 - nx1;
    const h = ny2 - ny1;
    if (w < 0.002 || h < 0.002) continue;

    raw.push({
      label: DETECT_LABELS[bestCls] ?? "object",
      confidence: bestScore,
      x: nx1,
      y: ny1,
      w,
      h,
    });
  }

  return nms(raw);
}

/** Run person + vehicle detection on a JPEG frame. */
export async function detectObjectsInJpeg(jpeg: Buffer): Promise<CctvAiDetection[]> {
  const session = await getSession();
  const { tensor, meta } = await letterbox(jpeg);
  const inputName = session.inputNames[0] ?? "images";
  const results = await session.run({ [inputName]: tensor });
  const outName = session.outputNames[0];
  if (!outName || !results[outName]) throw new Error("YOLO produced no output");
  return parseYoloOutput(results[outName], meta);
}

/** Grab one RTSP frame and detect people / vehicles. */
export async function detectObjectsFromRtsp(rtspUrl: string): Promise<CctvAiDetection[]> {
  const jpeg = await grabRtspJpeg(rtspUrl);
  return detectObjectsInJpeg(jpeg);
}

/** @deprecated Use detectObjectsFromRtsp */
export const detectVehiclesFromRtsp = detectObjectsFromRtsp;
/** @deprecated Use detectObjectsInJpeg */
export const detectVehiclesInJpeg = detectObjectsInJpeg;

export async function warmupCctvAiDetector(): Promise<void> {
  await getSession();
}
