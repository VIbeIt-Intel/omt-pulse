import { BrowserMultiFormatReader, HTMLCanvasElementLuminanceSource } from "@zxing/browser";
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  type Result,
} from "@zxing/library";
import type { IScannerControls } from "@zxing/browser";
import {
  decodeBarcodesFromVideoFrame,
  type BarcodeHit,
} from "@/lib/decode-barcode-image";
import { isSmartIdPipePayload } from "@/lib/pick-best-barcode";
import {
  isSadlEncryptedPayload,
  latin1ToBytes,
  looksLikeSadlEncryptedString,
} from "@shared/sa-drivers-licence";

export type ZxingScanMode = "national_id" | "drivers_licence" | "disc";

export type ZxingLiveHit =
  | { kind: "smart_id"; text: string }
  | { kind: "id_1d"; text: string }
  | { kind: "licence_bytes"; bytes: Uint8Array }
  | { kind: "disc"; text: string };

const REAR_CAMERA: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920, min: 640 },
    height: { ideal: 1080, min: 480 },
  },
};

function formatsForMode(mode: ZxingScanMode): BarcodeFormat[] {
  if (mode === "drivers_licence") return [BarcodeFormat.PDF_417];
  if (mode === "disc") {
    return [
      BarcodeFormat.PDF_417,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.QR_CODE,
    ];
  }
  return [
    BarcodeFormat.PDF_417,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.QR_CODE,
  ];
}

function sadlBytesFromResult(result: Result): Uint8Array | null {
  try {
    const raw = result.getRawBytes();
    if (raw?.length) {
      const slice = raw.length >= 720 ? raw.subarray(0, 720) : raw;
      if (slice.length === 720 && isSadlEncryptedPayload(slice)) {
        return new Uint8Array(slice);
      }
    }
  } catch {
    /* raw bytes unavailable */
  }

  try {
    const text = result.getText();
    if (text?.length === 720 && looksLikeSadlEncryptedString(text)) {
      return latin1ToBytes(text);
    }
  } catch {
    /* binary text unsafe */
  }

  return null;
}

/** Classify a ZXing decode result without throwing. */
export function classifyZxingResult(
  result: Result,
  mode: ZxingScanMode,
): ZxingLiveHit | null {
  try {
    const licenceBytes = sadlBytesFromResult(result);
    if (licenceBytes) {
      if (mode === "national_id" || mode === "drivers_licence") {
        return { kind: "licence_bytes", bytes: licenceBytes };
      }
      return null;
    }

    const text = result.getText()?.trim() ?? "";
    if (!text) return null;

    if (text.includes("|") && isSmartIdPipePayload(text)) {
      return { kind: "smart_id", text };
    }

    if (mode === "disc") {
      return { kind: "disc", text };
    }

    if (text.length <= 64) {
      return { kind: "id_1d", text };
    }
  } catch {
    return null;
  }

  return null;
}

function hitFromDetector(barcode: BarcodeHit, mode: ZxingScanMode): ZxingLiveHit | null {
  try {
    const text = barcode.rawValue?.trim() ?? "";
    if (!text) return null;
    if (text.includes("|") && isSmartIdPipePayload(text)) {
      return { kind: "smart_id", text };
    }
    if (mode === "disc") return { kind: "disc", text };
    if (text.length <= 64) return { kind: "id_1d", text };
  } catch {
    return null;
  }
  return null;
}

function buildHints(mode: ZxingScanMode): Map<DecodeHintType, unknown> {
  return new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, formatsForMode(mode)],
    [DecodeHintType.TRY_HARDER, true],
    [DecodeHintType.PURE_BARCODE, false],
  ]);
}

function scanOptions(mode: ZxingScanMode) {
  return {
    delayBetweenScanAttempts: mode === "drivers_licence" ? 150 : 250,
    delayBetweenScanSuccess: 400,
    tryPlayVideoTimeout: 8000,
  };
}

function cropsForMode(mode: ZxingScanMode): Array<{ x: number; y: number; w: number; h: number }> {
  if (mode === "drivers_licence") {
    return [
      { x: 0.5, y: 0.03, w: 0.47, h: 0.94 },
      { x: 0.38, y: 0.03, w: 0.6, h: 0.94 },
      { x: 0.22, y: 0.03, w: 0.76, h: 0.94 },
      { x: 0, y: 0, w: 1, h: 1 },
    ];
  }
  return [
    { x: 0.04, y: 0.02, w: 0.92, h: 0.45 },
    { x: 0.04, y: 0.02, w: 0.92, h: 0.62 },
    { x: 0, y: 0, w: 1, h: 1 },
  ];
}

async function waitForVideoDimensions(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener("loadeddata", done);
      resolve();
    };
    video.addEventListener("loadeddata", done);
    window.setTimeout(done, 2000);
  });
}

/** Continuous live scan — rear camera + ZXing + (for ID) native BarcodeDetector. */
export class ZxingLiveScanner {
  private reader: BrowserMultiFormatReader | null = null;
  private controls: IScannerControls | null = null;
  private frameTimer = 0;
  private stream: MediaStream | null = null;

  async start(
    video: HTMLVideoElement,
    mode: ZxingScanMode,
    onHit: (hit: ZxingLiveHit) => void,
  ): Promise<void> {
    this.stop();

    const hints = buildHints(mode);
    this.reader = new BrowserMultiFormatReader(hints, scanOptions(mode));

    this.controls = await this.reader.decodeFromConstraints(
      REAR_CAMERA,
      video,
      (result) => {
        if (!result) return;
        try {
          const hit = classifyZxingResult(result, mode);
          if (hit) onHit(hit);
        } catch {
          /* never crash on bad frame */
        }
      },
    );

    this.stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
    await waitForVideoDimensions(video);

    const useDetector = mode === "national_id" || mode === "disc";
    this.frameTimer = window.setInterval(() => {
      void (async () => {
        try {
          if (video.readyState < 2) return;

          if (useDetector) {
            const detectorHits = await decodeBarcodesFromVideoFrame(video, null);
            for (const barcode of detectorHits) {
              const hit = hitFromDetector(barcode, mode);
              if (hit) onHit(hit);
            }
          }

          const zxingHit = await decodeZxingFromVideo(video, mode);
          if (zxingHit) onHit(zxingHit);
        } catch {
          /* ignore frame errors */
        }
      })();
    }, mode === "drivers_licence" ? 350 : 300);
  }

  stop(): void {
    window.clearInterval(this.frameTimer);
    this.frameTimer = 0;
    try {
      this.controls?.stop();
    } catch {
      /* ignore */
    }
    this.controls = null;
    try {
      this.reader?.reset();
    } catch {
      /* ignore */
    }
    this.reader = null;
    try {
      this.stream?.getTracks().forEach((track) => track.stop());
    } catch {
      /* ignore */
    }
    this.stream = null;
  }
}

function imageDataFromImage(img: HTMLImageElement): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width < 1 || canvas.height < 1) return null;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function cropImageData(
  source: ImageData,
  crop: { x: number; y: number; w: number; h: number },
): ImageData | null {
  const sw = Math.max(1, Math.floor(source.width * crop.w));
  const sh = Math.max(1, Math.floor(source.height * crop.h));
  const sx = Math.floor(source.width * crop.x);
  const sy = Math.floor(source.height * crop.y);

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const cropData = ctx.createImageData(sw, sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const src = ((sy + y) * source.width + (sx + x)) * 4;
      const dst = (y * sw + x) * 4;
      cropData.data[dst] = source.data[src] ?? 0;
      cropData.data[dst + 1] = source.data[src + 1] ?? 0;
      cropData.data[dst + 2] = source.data[src + 2] ?? 0;
      cropData.data[dst + 3] = 255;
    }
  }
  ctx.putImageData(cropData, 0, 0);
  return cropData;
}

async function decodeImageElement(
  img: HTMLImageElement,
  mode: ZxingScanMode,
): Promise<ZxingLiveHit | null> {
  const reader = new BrowserMultiFormatReader(buildHints(mode), scanOptions(mode));
  try {
    const result = await reader.decodeFromImageElement(img);
    return result ? classifyZxingResult(result, mode) : null;
  } catch {
    /* try manual bitmap decode on crops */
  }

  const full = imageDataFromImage(img);
  if (!full) return null;

  for (const crop of cropsForMode(mode)) {
    try {
      const hit = await decodeImageDataCrop(full, crop, mode);
      if (hit) return hit;
    } catch {
      /* next crop */
    }
  }

  return null;
}

async function decodeImageDataCrop(
  source: ImageData,
  crop: { x: number; y: number; w: number; h: number },
  mode: ZxingScanMode,
): Promise<ZxingLiveHit | null> {
  const cropData = cropImageData(source, crop);
  if (!cropData) return null;

  const canvas = document.createElement("canvas");
  canvas.width = cropData.width;
  canvas.height = cropData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(cropData, 0, 0);

  const reader = new BrowserMultiFormatReader(buildHints(mode), scanOptions(mode));
  try {
    const sourceLuminance = new HTMLCanvasElementLuminanceSource(canvas);
    const bitmap = new BinaryBitmap(new HybridBinarizer(sourceLuminance));
    const result = reader.decodeBitmap(bitmap);
    return result ? classifyZxingResult(result, mode) : null;
  } catch {
    return null;
  }
}

/** Decode barcodes from a still image file (photo fallback). */
export async function decodeZxingFromFile(
  file: File,
  mode: ZxingScanMode,
): Promise<ZxingLiveHit | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not load image"));
      el.src = url;
    });
    return await decodeImageElement(img, mode);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Capture a single frame from video and decode with ZXing (crop retries for licence PDF417). */
export async function decodeZxingFromVideo(
  video: HTMLVideoElement,
  mode: ZxingScanMode,
): Promise<ZxingLiveHit | null> {
  try {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    const full = ctx.getImageData(0, 0, width, height);

    for (const crop of cropsForMode(mode)) {
      try {
        const hit = await decodeImageDataCrop(full, crop, mode);
        if (hit) return hit;
      } catch {
        /* next crop */
      }
    }

    return null;
  } catch {
    return null;
  }
}
