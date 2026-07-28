import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { CctvAiDetection } from "@shared/cctv";

const SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Final saved longest edge — WebP keeps files small. */
const SNAPSHOT_OUT_MAX = 640;
/**
 * Expand the crop in the *source* frame until the longest side is at least this many
 * pixels (or we hit the frame edge). Avoids upscaling a tiny postage-stamp crop.
 */
const SNAPSHOT_SOURCE_MIN = 560;

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

    const det = input.detection;
    const cx = det.x + det.w / 2;
    const cy = det.y + det.h / 2;

    // Start with padded box, then grow in source pixels until we have enough detail.
    let halfW = Math.max(det.w * 0.5 * 1.45, 0.04);
    let halfH = Math.max(det.h * 0.5 * 1.45, 0.04);

    for (let i = 0; i < 12; i++) {
      const pxW = halfW * 2 * width;
      const pxH = halfH * 2 * height;
      if (Math.max(pxW, pxH) >= SNAPSHOT_SOURCE_MIN) break;
      halfW = Math.min(0.5, halfW * 1.22);
      halfH = Math.min(0.5, halfH * 1.22);
      // Can't grow further if already near full frame.
      if (halfW >= 0.49 && halfH >= 0.49) break;
    }

    const x1 = clamp01(cx - halfW);
    const y1 = clamp01(cy - halfH);
    const x2 = clamp01(cx + halfW);
    const y2 = clamp01(cy + halfH);

    const left = Math.max(0, Math.floor(x1 * width));
    const top = Math.max(0, Math.floor(y1 * height));
    const extractWidth = Math.max(1, Math.min(width - left, Math.ceil((x2 - x1) * width)));
    const extractHeight = Math.max(1, Math.min(height - top, Math.ceil((y2 - y1) * height)));

    const fileName = `cam-${input.cameraId}-${Date.now()}.webp`;
    const full = getAiSnapshotPath(fileName);

    await image
      .extract({ left, top, width: extractWidth, height: extractHeight })
      .resize(SNAPSHOT_OUT_MAX, SNAPSHOT_OUT_MAX, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toFile(full);

    pruneAiSnapshots();
    return fileName;
  } catch (err) {
    console.warn("[cctv-ai] snapshot save failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
