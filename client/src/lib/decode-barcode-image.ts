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

/** SA Smart ID / licence — PDF417 is usually in the upper half of the card. */
const CROP_REGIONS: CropRegion[] = [
  { x: 0.04, y: 0.02, w: 0.92, h: 0.42 },
  { x: 0.04, y: 0.02, w: 0.92, h: 0.58 },
  { x: 0, y: 0, w: 1, h: 1 },
];

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string; format?: string }>>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetector(): BarcodeDetectorLike | null {
  const ctor = (window as Window & { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!ctor) return null;
  try {
    return new ctor({ formats: BARCODE_DETECTOR_FORMATS });
  } catch {
    return null;
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

async function decodeCanvas(
  canvas: HTMLCanvasElement,
  detector: BarcodeDetectorLike | null,
  html5Scanner: Html5Qrcode | null,
): Promise<BarcodeHit[]> {
  const hits: BarcodeHit[] = [];

  if (detector) {
    try {
      const codes = await detector.detect(canvas);
      for (const code of codes) {
        const raw = code.rawValue?.trim();
        if (raw) hits.push({ rawValue: raw, format: code.format });
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
      if (raw) hits.push({ rawValue: raw, format: html5FormatName(result) });
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
): Promise<BarcodeHit[]> {
  const detector = getBarcodeDetector();
  const all: BarcodeHit[] = [];

  for (const crop of CROP_REGIONS) {
    const canvas = renderCrop(source, width, height, crop);
    const hits = await decodeCanvas(canvas, detector, html5Scanner);
    all.push(...hits);
  }

  return all;
}

export async function decodeBarcodesFromFile(
  file: File,
  html5Scanner: Html5Qrcode | null,
): Promise<BarcodeHit[]> {
  const img = await loadImageFromFile(file);
  return decodeFromImageSource(img, img.naturalWidth, img.naturalHeight, html5Scanner);
}

export async function decodeBarcodesFromVideoFrame(
  video: HTMLVideoElement,
  html5Scanner: Html5Qrcode | null,
): Promise<BarcodeHit[]> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return [];
  return decodeFromImageSource(video, width, height, html5Scanner);
}

export function createHtml5FileScanner(elementId: string): Html5Qrcode {
  return new Html5Qrcode(elementId, {
    verbose: false,
    formatsToSupport: PDF417_FORMATS,
  });
}
