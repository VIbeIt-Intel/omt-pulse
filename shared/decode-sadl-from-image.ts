import sharp from "sharp";
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  PDF417Reader,
  RGBLuminanceSource,
} from "@zxing/library";
import { isSadlEncryptedPayload } from "./sa-drivers-licence";

type CropRegion = { x: number; y: number; w: number; h: number };

/** PDF417 on SA driver's licence is usually in the upper portion of the card photo. */
const CROP_REGIONS: CropRegion[] = [
  { x: 0.02, y: 0.01, w: 0.96, h: 0.38 },
  { x: 0.04, y: 0.02, w: 0.92, h: 0.42 },
  { x: 0.04, y: 0.02, w: 0.92, h: 0.58 },
  { x: 0, y: 0, w: 1, h: 1 },
];

const PDF417_HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.PDF_417]],
  [DecodeHintType.TRY_HARDER, true],
  [DecodeHintType.PURE_BARCODE, false],
]);

function rgbaToLuminance(rgba: Uint8Array, pixelCount: number): Uint8ClampedArray {
  const luminances = new Uint8ClampedArray(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    luminances[i] = ((rgba[o] + rgba[o + 1] * 2 + rgba[o + 2]) / 4) & 0xff;
  }
  return luminances;
}

function sadlBytesFromZxingText(text: string): Uint8Array | null {
  if (text.length !== 720) return null;
  const bytes = new Uint8Array(720);
  for (let i = 0; i < 720; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return isSadlEncryptedPayload(bytes) ? bytes : null;
}

function decodePdf417FromRgba(rgba: Buffer, width: number, height: number): Uint8Array | null {
  const pixelCount = width * height;
  if (pixelCount <= 0) return null;

  const luminances = rgbaToLuminance(new Uint8Array(rgba), pixelCount);
  const source = new RGBLuminanceSource(luminances, width, height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  const reader = new PDF417Reader();

  try {
    const result = reader.decode(bitmap, PDF417_HINTS);
    const raw = result.getRawBytes();
    if (raw && raw.length === 720 && isSadlEncryptedPayload(raw)) {
      return new Uint8Array(raw);
    }
    const text = result.getText();
    return sadlBytesFromZxingText(text);
  } catch {
    return null;
  }
}

type PreprocessMode = "default" | "grayscale" | "high_contrast";

async function extractRgba(
  imageBuffer: Buffer,
  crop: CropRegion,
  mode: PreprocessMode,
): Promise<{ data: Buffer; width: number; height: number } | null> {
  const meta = await sharp(imageBuffer).rotate().metadata();
  const fullW = meta.width ?? 1;
  const fullH = meta.height ?? 1;

  const left = Math.floor(fullW * crop.x);
  const top = Math.floor(fullH * crop.y);
  const width = Math.max(1, Math.floor(fullW * crop.w));
  const height = Math.max(1, Math.floor(fullH * crop.h));

  let pipeline = sharp(imageBuffer)
    .rotate()
    .extract({ left, top, width, height });

  if (width < 900) {
    pipeline = pipeline.resize({ width: Math.min(1600, width * 2) });
  }

  if (mode === "grayscale") {
    pipeline = pipeline.grayscale().normalize();
  } else if (mode === "high_contrast") {
    pipeline = pipeline.grayscale().normalize().sharpen({ sigma: 1.2 }).linear(1.35, -40);
  } else {
    pipeline = pipeline.normalize().sharpen();
  }

  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function decodeCrop(imageBuffer: Buffer, crop: CropRegion): Promise<Uint8Array | null> {
  const modes: PreprocessMode[] = ["default", "grayscale", "high_contrast"];
  for (const mode of modes) {
    try {
      const rgba = await extractRgba(imageBuffer, crop, mode);
      if (!rgba) continue;
      const bytes = decodePdf417FromRgba(rgba.data, rgba.width, rgba.height);
      if (bytes) return bytes;
    } catch {
      /* try next mode */
    }
  }
  return null;
}

/** Extract 720-byte SADL payload from a JPEG/PNG/WebP image buffer. */
export async function decodeSadlBytesFromImageBuffer(imageBuffer: Buffer): Promise<Uint8Array | null> {
  for (const crop of CROP_REGIONS) {
    try {
      const bytes = await decodeCrop(imageBuffer, crop);
      if (bytes) return bytes;
    } catch {
      /* try next crop */
    }
  }
  return null;
}
