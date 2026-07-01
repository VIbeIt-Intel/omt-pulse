import { decodeZxingFromFile } from "@/lib/zxing-live-scanner";
import {
  decodeDriversLicenceFromImageViaApi,
  decodeDriversLicenceViaApiFromBase64,
  sadlBytesToBase64,
} from "@/lib/decode-drivers-licence-api";
import type { ParsedSaId } from "@/lib/parse-sa-barcodes";

const MIN_DECODE_WIDTH = 2400;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image"));
    };
    img.src = url;
  });
}

/** Upscale and sharpen a phone photo so PDF417 modules stay crisp through plastic glare. */
async function enhancedPhotoBlob(file: Blob): Promise<Blob> {
  try {
    const img = await loadImage(file);
    const scale = img.naturalWidth < MIN_DECODE_WIDTH
      ? MIN_DECODE_WIDTH / Math.max(img.naturalWidth, 1)
      : 1;
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.imageSmoothingEnabled = scale > 1;
    ctx.filter = "contrast(1.25) brightness(1.05)";
    ctx.drawImage(img, 0, 0, width, height);

    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.96);
    });
  } catch {
    return file;
  }
}

async function decodeBytesOnDevice(file: Blob): Promise<ParsedSaId | null> {
  const hit = await decodeZxingFromFile(file as File, "drivers_licence");
  if (hit?.kind !== "licence_bytes") return null;
  return decodeDriversLicenceViaApiFromBase64(sadlBytesToBase64(hit.bytes));
}

/**
 * Decode a photo of the back of a SA driver's licence.
 * Tries on-device ZXing first (fast, no upload), then server zxing-cpp on the original + enhanced photo.
 */
export async function decodeLicenceBackFromPhoto(file: File): Promise<ParsedSaId | null> {
  const attempts: Blob[] = [file];
  const enhanced = await enhancedPhotoBlob(file);
  if (enhanced !== file) attempts.push(enhanced);

  for (const attempt of attempts) {
    const parsed = await decodeBytesOnDevice(attempt);
    if (parsed?.personIdNumber || parsed?.personFullName) return parsed;
  }

  for (const attempt of attempts) {
    const parsed = await decodeDriversLicenceFromImageViaApi(attempt);
    if (parsed?.personIdNumber || parsed?.personFullName) return parsed;
  }

  return null;
}
