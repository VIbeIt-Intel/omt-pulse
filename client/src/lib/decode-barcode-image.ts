import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
  type Html5QrcodeResult,
} from "html5-qrcode";

export type BarcodeHit = { rawValue: string; format?: string };

type CropRegion = { x: number; y: number; w: number; h: number };

const PDF417_FORMATS = [
  Html5QrcodeSupportedFormats.PDF_417,
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
];

const BARCODE_DETECTOR_FORMATS = [
  "pdf417",
  "qr_code",
  "code_128",
  "code_39",
  "ean_13",
  "data_matrix",
  "aztec",
];

/** Live ID scan only — encrypted SADL PDF417 crashes Android BarcodeDetector. */
const NATIONAL_ID_LIVE_DETECTOR_FORMATS = [
  "qr_code",
  "code_128",
  "code_39",
  "ean_13",
];

/** SA Smart ID / licence — PDF417 is usually in the upper half of the card. */
const CROP_REGIONS: CropRegion[] = [
  { x: 0.04, y: 0.02, w: 0.92, h: 0.42 },
  { x: 0.04, y: 0.02, w: 0.92, h: 0.58 },
  { x: 0, y: 0, w: 1, h: 1 },
];

export const PDF417_MANUAL_FALLBACK_MSG =
  "This barcode type could not be read automatically. Please enter the details manually.";

export const PDF417_PHOTO_REQUIRED_MSG =
  "This barcode needs to be captured as a photo for accurate reading. Tap Take photo or Gallery below.";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string; format?: string }>>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetector(formats: string[] = BARCODE_DETECTOR_FORMATS): BarcodeDetectorLike | null {
  const ctor = (window as Window & { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!ctor) return null;
  try {
    return new ctor({ formats });
  } catch {
    return null;
  }
}

/** Encrypted SA driver's licence PDF417 — never process on live camera (crashes WebView). */
export function isLikelyEncryptedDriversLicencePdf417(
  format?: string,
  rawLength?: number,
  hasPipeDelimiters = false,
): boolean {
  try {
    if (hasPipeDelimiters) return false;
    if (!rawLength || rawLength < 100) return false;
    const fmt = (format ?? "").toLowerCase();
    return fmt.includes("pdf417") || fmt.includes("pdf_417");
  } catch {
    return false;
  }
}

/** @deprecated Use isLikelyEncryptedDriversLicencePdf417 */
export function isLikelyBinaryPdf417(format?: string, rawLength?: number): boolean {
  return isLikelyEncryptedDriversLicencePdf417(format, rawLength, false);
}

/** Safe for live camera loop — pipe text (Smart ID, any length) or short 1D codes. */
export function isSafeLiveBarcodeValue(raw: string): boolean {
  try {
    if (!raw) return false;
    if (raw.includes("|")) return true;
    if (raw.length <= 64) return true;
    return false;
  } catch {
    return false;
  }
}

export type LiveBarcodeKind = "smart_id" | "id_1d" | "encrypted_licence" | "skip";

/** Classify a live detector hit without retaining unsafe binary payloads. */
export function classifyLiveBarcodeHit(code: {
  rawValue: string;
  format?: string;
}): { kind: LiveBarcodeKind; raw?: string; format?: string } {
  try {
    let raw = "";
    try {
      raw = code.rawValue?.trim() ?? "";
    } catch {
      return { kind: "encrypted_licence" };
    }
    if (!raw) return { kind: "skip" };

    const hasPipe = raw.includes("|");
    if (hasPipe) return { kind: "smart_id", raw, format: code.format };
    if (raw.length <= 64) return { kind: "id_1d", raw, format: code.format };

    const length = raw.length;
    if (isLikelyEncryptedDriversLicencePdf417(code.format, length, hasPipe)) {
      return { kind: "encrypted_licence" };
    }
    return { kind: "skip" };
  } catch {
    return { kind: "skip" };
  }
}

function html5FormatName(result: Html5QrcodeResult): string | undefined {
  const fmt = result.result.format;
  if (typeof fmt === "object" && fmt !== null && "formatName" in fmt) {
    return String((fmt as { formatName?: string }).formatName ?? "");
  }
  return undefined;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
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

function canvasToPngFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not encode image"));
        return;
      }
      resolve(new File([blob], name, { type: "image/png" }));
    }, "image/png");
  });
}

function renderCrop(
  source: CanvasImageSource,
  width: number,
  height: number,
  crop: CropRegion,
): HTMLCanvasElement {
  const sx = Math.floor(width * crop.x);
  const sy = Math.floor(height * crop.y);
  const sw = Math.max(1, Math.floor(width * crop.w));
  const sh = Math.max(1, Math.floor(height * crop.h));

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

function safeHitFromDetector(code: { rawValue: string; format?: string }): BarcodeHit | null {
  try {
    const raw = code.rawValue?.trim();
    if (!raw || !isSafeLiveBarcodeValue(raw)) return null;
    const hasPipe = raw.includes("|");
    if (isLikelyEncryptedDriversLicencePdf417(code.format, raw.length, hasPipe)) return null;
    return { rawValue: raw, format: code.format };
  } catch {
    return null;
  }
}

async function decodeCanvas(
  canvas: HTMLCanvasElement,
  detector: BarcodeDetectorLike | null,
  html5Scanner: Html5Qrcode | null,
  allowBinaryPdf417: boolean,
): Promise<BarcodeHit[]> {
  const hits: BarcodeHit[] = [];

  if (detector) {
    try {
      const codes = await detector.detect(canvas);
      for (const code of codes) {
        try {
          if (allowBinaryPdf417) {
            const raw = code.rawValue?.trim();
            if (raw) hits.push({ rawValue: raw, format: code.format });
          } else {
            const hit = safeHitFromDetector(code);
            if (hit) hits.push(hit);
          }
        } catch {
          /* skip single code */
        }
      }
    } catch {
      /* try html5 */
    }
  }

  if (html5Scanner) {
    try {
      const file = await canvasToPngFile(canvas, "crop.png");
      const result = await html5Scanner.scanFileV2(file, false);
      const raw = result.decodedText?.trim();
      if (raw) {
        if (allowBinaryPdf417 || isSafeLiveBarcodeValue(raw)) {
          hits.push({ rawValue: raw, format: html5FormatName(result) });
        }
      }
    } catch {
      /* next crop */
    }
  }

  return hits;
}

async function decodeFromImageSource(
  source: CanvasImageSource,
  width: number,
  height: number,
  html5Scanner: Html5Qrcode | null,
  allowBinaryPdf417: boolean,
  nationalIdLive = false,
): Promise<BarcodeHit[]> {
  const detector = getBarcodeDetector(
    nationalIdLive ? NATIONAL_ID_LIVE_DETECTOR_FORMATS : BARCODE_DETECTOR_FORMATS,
  );
  const all: BarcodeHit[] = [];

  for (const crop of CROP_REGIONS) {
    try {
      const canvas = renderCrop(source, width, height, crop);
      const hits = await decodeCanvas(canvas, detector, html5Scanner, allowBinaryPdf417);
      all.push(...hits);
    } catch {
      /* next crop */
    }
  }

  return all;
}

/** Decode barcodes from a photo. Set allowBinaryPdf417 for driver's licence (one-shot, not live). */
export async function decodeBarcodesFromFile(
  file: File,
  html5Scanner: Html5Qrcode | null,
  allowBinaryPdf417 = true,
): Promise<BarcodeHit[]> {
  try {
    const img = await loadImageFromFile(file);
    return await decodeFromImageSource(
      img,
      img.naturalWidth,
      img.naturalHeight,
      html5Scanner,
      allowBinaryPdf417,
    );
  } catch {
    return [];
  }
}

export async function decodeBarcodesFromVideoFrame(
  video: HTMLVideoElement,
  html5Scanner: Html5Qrcode | null,
  nationalIdLive = false,
): Promise<BarcodeHit[]> {
  try {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return [];
    return await decodeFromImageSource(video, width, height, html5Scanner, false, nationalIdLive);
  } catch {
    return [];
  }
}

export function createHtml5FileScanner(elementId: string): Html5Qrcode | null {
  try {
    return new Html5Qrcode(elementId, {
      verbose: false,
      formatsToSupport: PDF417_FORMATS,
    });
  } catch {
    return null;
  }
}

/** Capture the current video preview frame as JPEG (matches what the user framed). */
export function captureVideoFrameAsJpeg(
  video: HTMLVideoElement,
  quality = 0.92,
): Promise<Blob | null> {
  try {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return Promise.resolve(null);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(video, 0, 0, width, height);

    return new Promise((resolve) => {
      try {
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return Promise.resolve(null);
  }
}
