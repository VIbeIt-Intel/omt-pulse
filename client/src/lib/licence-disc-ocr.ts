import { apiRequest } from "@/lib/queryClient";
import type { ParsedLicenceDiscOcr } from "@shared/parse-sa-licence-disc";
import type { ParsedSaVehicleDisc } from "@/lib/parse-sa-barcodes";

export type LicenceDiscOcrResult =
  | { ok: true; parsed: ParsedSaVehicleDisc }
  | { ok: false; message: string };

const MIN_OCR_WIDTH = 1800;
const MAX_OCR_WIDTH = 2800;

function toVehicleDisc(ocr: ParsedLicenceDiscOcr): ParsedSaVehicleDisc {
  return {
    registration: ocr.registration,
    make: ocr.make,
    model: ocr.model,
    colour: ocr.colour,
    licenceDiscData: ocr.licenceNumber ?? ocr.vin ?? "",
    hint: ocr.hint,
  };
}

async function compactDiscPhotoBase64(file: File): Promise<string> {
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
    ctx.filter = "contrast(1.3) brightness(1.05)";
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not compress image"))),
        "image/jpeg",
        0.92,
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

/** Read printed licence disc fields from a photo (server OCR). */
export async function readLicenceDiscFromPhoto(file: File): Promise<LicenceDiscOcrResult> {
  try {
    const imageBase64 = await compactDiscPhotoBase64(file);
    const ocr = (await apiRequest("POST", "/api/access-control/decode-licence-disc-image", {
      imageBase64,
    })) as ParsedLicenceDiscOcr;

    const parsed = toVehicleDisc(ocr);
    if (!parsed.registration && !parsed.make && !parsed.model) {
      return {
        ok: false,
        message:
          ocr.hint ??
          "Could not read the disc. Photograph the printed text (registration, make) in good light.",
      };
    }
    return { ok: true, parsed };
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message?: string }).message)
        : "Photo scan failed";
    return { ok: false, message };
  }
}
