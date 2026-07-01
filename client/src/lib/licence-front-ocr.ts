import { apiRequest } from "@/lib/queryClient";
import type { ParsedLicenceFrontOcr } from "@shared/parse-sa-licence-front";
import type { ParsedSaId } from "@/lib/parse-sa-barcodes";

export type LicenceFrontOcrResult =
  | { ok: true; parsed: ParsedSaId }
  | { ok: false; message: string };

const MIN_OCR_WIDTH = 2200;
const MAX_OCR_WIDTH = 2800;

function toParsedSaId(ocr: ParsedLicenceFrontOcr): ParsedSaId | null {
  if (!ocr.personIdNumber && !ocr.personFullName) return null;
  return {
    documentType: "drivers_licence",
    personIdNumber: ocr.personIdNumber,
    personFullName: ocr.personFullName,
    driversLicenceNumber: ocr.driversLicenceNumber,
    hint: ocr.hint,
  };
}

/** Upscale and boost contrast before upload — helps OCR through plastic glare. */
async function compactLicencePhotoBase64(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not load image"));
      el.src = url;
    });

    const upscale =
      img.naturalWidth < MIN_OCR_WIDTH ? MIN_OCR_WIDTH / Math.max(img.naturalWidth, 1) : 1;
    const downscale =
      img.naturalWidth * upscale > MAX_OCR_WIDTH ? MAX_OCR_WIDTH / (img.naturalWidth * upscale) : 1;
    const scale = upscale * downscale;
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return blobToDataUrl(file);
    }

    ctx.imageSmoothingEnabled = scale > 1;
    ctx.filter = "contrast(1.35) brightness(1.08)";
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not compress image"))),
        "image/jpeg",
        0.95,
      );
    });
    return blobToDataUrl(blob);
  } catch {
    return blobToDataUrl(file);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Read the front of a SA driver's licence from a photo.
 * OCR runs on the server so the phone WebView does not load Tesseract (which crashes Android).
 */
export async function readLicenceFrontFromPhoto(file: File): Promise<LicenceFrontOcrResult> {
  try {
    const imageBase64 = await compactLicencePhotoBase64(file);
    const ocr = (await apiRequest("POST", "/api/access-control/decode-licence-front-image", {
      imageBase64,
    })) as ParsedLicenceFrontOcr;

    const parsed = toParsedSaId(ocr);
    if (parsed?.personIdNumber || parsed?.personFullName) {
      return { ok: true, parsed };
    }

    return {
      ok: false,
      message:
        ocr.hint ??
        "Could not read the front of the licence. Try brighter light, less glare on the plastic, and fill the frame with the text side.",
    };
  } catch (err) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Could not read text from this photo. Try again or type details on the form.";
    return { ok: false, message };
  }
}
