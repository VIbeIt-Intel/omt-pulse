import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  prepareZXingModule,
  readBarcodes,
  type ReaderOptions,
} from "zxing-wasm/reader";
import { findSadl720InBuffer, latin1BytesFromText } from "./extract-sadl-payload";
import { isSadlEncryptedPayload } from "./sa-drivers-licence";

type CropRegion = { x: number; y: number; w: number; h: number };

/** PDF417 on the SA driver's licence back sits along the right edge. */
const CROP_REGIONS: CropRegion[] = [
  { x: 0.62, y: 0.04, w: 0.36, h: 0.92 },
  { x: 0.5, y: 0.03, w: 0.47, h: 0.94 },
  { x: 0.38, y: 0.03, w: 0.6, h: 0.94 },
  { x: 0.22, y: 0.03, w: 0.76, h: 0.94 },
  { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
];

const ROTATIONS = [0, 90, 180, 270] as const;

type PreprocessMode = "default" | "grayscale" | "high_contrast" | "threshold" | "linear" | "gamma";

const PREPROCESS_MODES: PreprocessMode[] = [
  "grayscale",
  "high_contrast",
  "linear",
  "default",
  "gamma",
  "threshold",
];

const READER_OPTIONS: ReaderOptions = {
  formats: ["PDF417"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 4,
};

const MAX_DECODE_WIDTH = 3200;
const MIN_UPSCALE_WIDTH = 1600;

let wasmConfigured = false;
let wasmLoadError: string | null = null;

function moduleDir(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

function wasmCandidates(): string[] {
  const cwd = process.cwd();
  const here = moduleDir();
  return [
    path.join(cwd, "dist", "zxing_reader.wasm"),
    path.join(here, "zxing_reader.wasm"),
    path.join(here, "..", "zxing_reader.wasm"),
    path.join(cwd, "node_modules", "zxing-wasm", "dist", "reader", "zxing_reader.wasm"),
    path.join(
      cwd,
      "node_modules",
      ".pnpm",
      "node_modules",
      "zxing-wasm",
      "dist",
      "reader",
      "zxing_reader.wasm",
    ),
  ];
}

/** Load the WASM binary from the installed package (works in bundled CJS server). */
function ensureZxingWasm(): void {
  if (wasmConfigured) return;
  wasmConfigured = true;

  let wasmPath: string | undefined;
  for (const candidate of wasmCandidates()) {
    try {
      if (existsSync(candidate)) {
        wasmPath = candidate;
        break;
      }
    } catch {
      /* try next */
    }
  }

  if (!wasmPath) {
    wasmLoadError = `zxing_reader.wasm not found (checked ${wasmCandidates().join(", ")})`;
    console.error(`[sadl-image] ${wasmLoadError}`);
    return;
  }

  try {
    const wasmBinary = readFileSync(wasmPath);
    prepareZXingModule({
      overrides: {
        wasmBinary: wasmBinary.buffer.slice(
          wasmBinary.byteOffset,
          wasmBinary.byteOffset + wasmBinary.byteLength,
        ) as ArrayBuffer,
        instantiateWasm(imports, successCallback) {
          void WebAssembly.instantiate(wasmBinary, imports).then(({ instance }) =>
            successCallback(instance),
          );
          return {};
        },
      },
    });
  } catch (err) {
    wasmLoadError = err instanceof Error ? err.message : String(err);
    console.error("[sadl-image] WASM init failed:", wasmLoadError);
  }
}

type ZxingReadResult = {
  text?: string;
  bytes?: Uint8Array;
};

function sadlFromZxingResults(results: ZxingReadResult[]): Uint8Array | null {
  for (const result of results) {
    if (result.bytes?.length) {
      const found = findSadl720InBuffer(result.bytes);
      if (found) return found;
    }

    const text = result.text ?? "";
    if (text.length >= 700) {
      const latin1 = latin1BytesFromText(text);
      if (latin1) {
        const found = findSadl720InBuffer(latin1);
        if (found) return found;
      }
    }
  }
  return null;
}

async function readPdf417FromBuffer(imageBuffer: Buffer): Promise<Uint8Array | null> {
  if (wasmLoadError) return null;
  try {
    const results = await readBarcodes(imageBuffer, READER_OPTIONS);
    return sadlFromZxingResults(results);
  } catch {
    return null;
  }
}

async function rgbaForCrop(
  imageBuffer: Buffer,
  crop: CropRegion,
  mode: PreprocessMode,
): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  const meta = await sharp(imageBuffer).metadata();
  const fullW = meta.width ?? 0;
  const fullH = meta.height ?? 0;
  if (fullW < 4 || fullH < 4) return null;

  const left = Math.min(fullW - 1, Math.max(0, Math.floor(fullW * crop.x)));
  const top = Math.min(fullH - 1, Math.max(0, Math.floor(fullH * crop.y)));
  const width = Math.max(1, Math.min(fullW - left, Math.floor(fullW * crop.w)));
  const height = Math.max(1, Math.min(fullH - top, Math.floor(fullH * crop.h)));

  let pipeline = sharp(imageBuffer).extract({ left, top, width, height });

  const targetWidth = Math.max(
    width,
    Math.min(MAX_DECODE_WIDTH, Math.round(Math.max(width, MIN_UPSCALE_WIDTH) * 1.2)),
  );
  if (width < targetWidth) {
    pipeline = pipeline.resize({
      width: targetWidth,
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    });
  }

  if (mode === "grayscale") {
    pipeline = pipeline.grayscale().normalize().sharpen({ sigma: 1.2 });
  } else if (mode === "high_contrast") {
    pipeline = pipeline.grayscale().normalize().sharpen().linear(1.5, -55);
  } else if (mode === "linear") {
    pipeline = pipeline.grayscale().normalize().linear(1.8, -70);
  } else if (mode === "gamma") {
    pipeline = pipeline.grayscale().normalize().gamma(1.35).sharpen();
  } else if (mode === "threshold") {
    pipeline = pipeline.grayscale().normalize().median(1).threshold(132);
  } else {
    pipeline = pipeline.normalize().sharpen();
  }

  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

async function decodeCropJpeg(imageBuffer: Buffer, crop: CropRegion): Promise<Uint8Array | null> {
  const meta = await sharp(imageBuffer).metadata();
  const fullW = meta.width ?? 0;
  const fullH = meta.height ?? 0;
  if (fullW < 4 || fullH < 4) return null;

  const left = Math.min(fullW - 1, Math.max(0, Math.floor(fullW * crop.x)));
  const top = Math.min(fullH - 1, Math.max(0, Math.floor(fullH * crop.y)));
  const width = Math.max(1, Math.min(fullW - left, Math.floor(fullW * crop.w)));
  const height = Math.max(1, Math.min(fullH - top, Math.floor(fullH * crop.h)));

  const targetWidth = Math.max(
    width,
    Math.min(MAX_DECODE_WIDTH, Math.round(Math.max(width, MIN_UPSCALE_WIDTH) * 1.2)),
  );

  for (const mode of ["grayscale", "high_contrast", "linear", "gamma", "threshold"] as const) {
    try {
      let pipeline = sharp(imageBuffer).extract({ left, top, width, height });
      if (width < targetWidth) {
        pipeline = pipeline.resize({ width: targetWidth, withoutEnlargement: false });
      }
      if (mode === "grayscale") pipeline = pipeline.grayscale().normalize().sharpen({ sigma: 1.2 });
      else if (mode === "high_contrast") pipeline = pipeline.grayscale().normalize().sharpen().linear(1.5, -55);
      else if (mode === "linear") pipeline = pipeline.grayscale().normalize().linear(1.8, -70);
      else if (mode === "gamma") pipeline = pipeline.grayscale().normalize().gamma(1.35).sharpen();
      else pipeline = pipeline.grayscale().normalize().median(1).threshold(132);

      const jpeg = await pipeline.jpeg({ quality: 98, mozjpeg: true }).toBuffer();
      const sadl = await readPdf417FromBuffer(jpeg);
      if (sadl) return sadl;
    } catch {
      /* next mode */
    }
  }
  return null;
}

async function decodeCropRgba(imageBuffer: Buffer, crop: CropRegion): Promise<Uint8Array | null> {
  for (const mode of PREPROCESS_MODES) {
    try {
      const rgba = await rgbaForCrop(imageBuffer, crop, mode);
      if (!rgba) continue;

      const results = await readBarcodes(
        { data: rgba.data, width: rgba.width, height: rgba.height },
        READER_OPTIONS,
      );
      const sadl = sadlFromZxingResults(results);
      if (sadl) return sadl;
    } catch {
      /* try next mode */
    }
  }
  return null;
}

async function decodeCrop(imageBuffer: Buffer, crop: CropRegion): Promise<Uint8Array | null> {
  const fromJpeg = await decodeCropJpeg(imageBuffer, crop);
  if (fromJpeg) return fromJpeg;
  return decodeCropRgba(imageBuffer, crop);
}

async function decodeOrientedBuffer(working: Buffer): Promise<Uint8Array | null> {
  const fullJpeg = await sharp(working)
    .resize({
      width: MAX_DECODE_WIDTH,
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
    .jpeg({ quality: 98, mozjpeg: true })
    .toBuffer()
    .catch(() => null);
  if (fullJpeg) {
    const fromFull = await readPdf417FromBuffer(fullJpeg);
    if (fromFull) return fromFull;
  }

  const direct = await readPdf417FromBuffer(working);
  if (direct) return direct;

  for (const crop of CROP_REGIONS) {
    try {
      const bytes = await decodeCrop(working, crop);
      if (bytes) return bytes;
    } catch {
      /* next crop */
    }
  }

  return null;
}

/** Extract the 720-byte encrypted SADL payload from a JPEG/PNG/WebP image buffer. */
export async function decodeSadlBytesFromImageBuffer(
  imageBuffer: Buffer,
): Promise<Uint8Array | null> {
  ensureZxingWasm();
  if (wasmLoadError) {
    throw new Error(wasmLoadError);
  }

  const oriented = await sharp(imageBuffer).rotate().toBuffer();

  for (const rot of ROTATIONS) {
    let working = oriented;
    if (rot !== 0) {
      try {
        working = await sharp(oriented).rotate(rot).toBuffer();
      } catch {
        continue;
      }
    }

    const bytes = await decodeOrientedBuffer(working);
    if (bytes) return bytes;
  }

  return null;
}

/** @internal test helper */
export function sadlBytesFromZxingResultsForTest(results: ZxingReadResult[]): Uint8Array | null {
  return sadlFromZxingResults(results);
}

export function looksLikeSadlPayload(bytes: Uint8Array): boolean {
  return isSadlEncryptedPayload(bytes);
}
