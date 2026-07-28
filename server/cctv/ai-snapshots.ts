import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { CctvAiDetection } from "@shared/cctv";

const SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Large enough to open cleanly; still a small WebP crop, not a full frame. */
const SNAPSHOT_MAX_SIZE = 512;
/** Upscale tiny distant crops so the preview isn't a postage stamp. */
const SNAPSHOT_MIN_SIZE = 320;

function snapshotsDir(): string {
  const dir = path.join(os.tmpdir(), "omt-cctv", "ai-snapshots");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function getAiSnapshotPath(fileName: string): string {
  return path.join(snapshotsDir(), path.basename(fileName));
}

export function pruneAiSnapshots(now = Date.now()): void {
  try {
    for (const name of fs.readdirSync(snapshotsDir())) {
      const full = getAiSnapshotPath(name);
      const st = fs.statSync(full);
      if (now - st.mtimeMs > SNAPSHOT_RETENTION_MS) {
        fs.rmSync(full, { force: true });
      }
    }
  } catch {
    /* best effort */
  }
}

export async function saveDetectionSnapshot(input: {
  jpeg: Buffer;
  detection: CctvAiDetection;
  cameraId: number;
}): Promise<string | null> {
  try {
    const image = sharp(input.jpeg, { failOn: "none" }).rotate();
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) return null;

    // Extra context around the box so distant cars/people are readable when opened.
    const pad = 0.35;
    const x1 = clamp01(input.detection.x - input.detection.w * pad);
    const y1 = clamp01(input.detection.y - input.detection.h * pad);
    const x2 = clamp01(input.detection.x + input.detection.w * (1 + pad));
    const y2 = clamp01(input.detection.y + input.detection.h * (1 + pad));

    const left = Math.max(0, Math.floor(x1 * width));
    const top = Math.max(0, Math.floor(y1 * height));
    const extractWidth = Math.max(1, Math.ceil((x2 - x1) * width));
    const extractHeight = Math.max(1, Math.ceil((y2 - y1) * height));

    const fileName = `cam-${input.cameraId}-${Date.now()}.webp`;
    const full = getAiSnapshotPath(fileName);

    const cropped = image.extract({
      left,
      top,
      width: Math.min(extractWidth, width - left),
      height: Math.min(extractHeight, height - top),
    });

    const cropMeta = await cropped.metadata();
    const cropW = cropMeta.width ?? extractWidth;
    const cropH = cropMeta.height ?? extractHeight;
    const longest = Math.max(cropW, cropH);
    const target =
      longest < SNAPSHOT_MIN_SIZE
        ? SNAPSHOT_MIN_SIZE
        : Math.min(SNAPSHOT_MAX_SIZE, Math.max(longest, SNAPSHOT_MIN_SIZE));

    await cropped
      .resize(target, target, { fit: "inside" })
      .webp({ quality: 78, effort: 4 })
      .toFile(full);

    pruneAiSnapshots();
    return fileName;
  } catch (err) {
    console.warn("[cctv-ai] snapshot save failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
