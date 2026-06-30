import { BrowserMultiFormatReader } from "@zxing/browser";
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  RGBLuminanceSource,
  type Result,
} from "@zxing/library";
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

function buildHints(mode: ZxingScanMode): Map<DecodeHintType, unknown> {
  return new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, formatsForMode(mode)],
    [DecodeHintType.TRY_HARDER, true],
    [DecodeHintType.PURE_BARCODE, false],
  ]);
}

/** Continuous live scan from a video element (ZXing manages camera stream). */
export class ZxingLiveScanner {
  private reader: BrowserMultiFormatReader | null = null;

  async start(
    video: HTMLVideoElement,
    mode: ZxingScanMode,
    onHit: (hit: ZxingLiveHit) => void,
  ): Promise<void> {
    this.stop();
    const hints = buildHints(mode);
    this.reader = new BrowserMultiFormatReader(hints, 500);

    await this.reader.decodeFromVideoDevice(undefined, video, (result, _err, _controls) => {
      if (!result) return;
      try {
        const hit = classifyZxingResult(result, mode);
        if (hit) onHit(hit);
      } catch {
        /* never crash on bad frame */
      }
    });
  }

  stop(): void {
    try {
      this.reader?.reset();
    } catch {
      /* ignore */
    }
    this.reader = null;
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

async function decodeImageElement(
  img: HTMLImageElement,
  mode: ZxingScanMode,
): Promise<ZxingLiveHit | null> {
  const reader = new BrowserMultiFormatReader(buildHints(mode));
  try {
    const result = await reader.decodeFromImageElement(img);
    return result ? classifyZxingResult(result, mode) : null;
  } catch {
    /* try manual bitmap decode on crops */
  }

  const full = imageDataFromImage(img);
  if (!full) return null;

  const crops = [
    { x: 0.04, y: 0.02, w: 0.92, h: 0.42 },
    { x: 0.04, y: 0.02, w: 0.92, h: 0.58 },
    { x: 0, y: 0, w: 1, h: 1 },
  ];

  for (const crop of crops) {
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
  const sw = Math.max(1, Math.floor(source.width * crop.w));
  const sh = Math.max(1, Math.floor(source.height * crop.h));
  const sx = Math.floor(source.width * crop.x);
  const sy = Math.floor(source.height * crop.y);

  const rgba = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const src = ((sy + y) * source.width + (sx + x)) * 4;
      const dst = (y * sw + x) * 4;
      rgba[dst] = source.data[src] ?? 0;
      rgba[dst + 1] = source.data[src + 1] ?? 0;
      rgba[dst + 2] = source.data[src + 2] ?? 0;
      rgba[dst + 3] = 255;
    }
  }

  const luminances = new Uint8ClampedArray(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    const o = i * 4;
    luminances[i] = ((rgba[o] + rgba[o + 1] * 2 + rgba[o + 2]) / 4) & 0xff;
  }

  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminances, sw, sh)));
  const reader = new BrowserMultiFormatReader(buildHints(mode));
  try {
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

/** Capture a single frame from video and decode with ZXing. */
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

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not load frame"));
      el.src = canvas.toDataURL("image/jpeg", 0.92);
    });

    return await decodeImageElement(img, mode);
  } catch {
    return null;
  }
}
