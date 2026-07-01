import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  isSadlEncryptedPayload,
  latin1ToBytes,
  looksLikeSadlEncryptedString,
} from "@shared/sa-drivers-licence";
import {
  decodeDriversLicenceViaApi,
  decodeDriversLicenceViaApiFromBase64,
  sadlBytesToBase64,
} from "@/lib/decode-drivers-licence-api";
import type { ParsedSaId } from "@/lib/parse-sa-barcodes";
import type { NativeLicenceScanFailure, NativeLicenceScanResult } from "@/lib/native-licence-barcode";

export const BINARY_EYE_PACKAGE = "de.markusfisch.android.binaryeye";
export const BINARY_EYE_PLAY_URL =
  "https://play.google.com/store/apps/details?id=de.markusfisch.android.binaryeye";

export interface OmtBinaryEyeScannerPlugin {
  isAvailable(): Promise<{ installed: boolean }>;
  scanPdf417(): Promise<{
    text?: string;
    bytesBase64?: string;
    format?: string;
  }>;
}

const OmtBinaryEyeScanner = registerPlugin<OmtBinaryEyeScannerPlugin>("OmtBinaryEyeScanner");

export function canUseBinaryEyeScanner(): boolean {
  return (
    Capacitor.getPlatform() === "android" &&
    Capacitor.isNativePlatform() &&
    Capacitor.isPluginAvailable("OmtBinaryEyeScanner")
  );
}

export async function isBinaryEyeInstalled(): Promise<boolean> {
  if (!canUseBinaryEyeScanner()) return false;
  try {
    const { installed } = await OmtBinaryEyeScanner.isAvailable();
    return installed;
  } catch {
    return false;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function sadlBytesFromScanResult(text?: string, bytesBase64?: string): Uint8Array | null {
  if (bytesBase64) {
    const raw = base64ToBytes(bytesBase64);
    if (raw.length === 720 && isSadlEncryptedPayload(raw)) return raw;
    if (raw.length > 720) {
      const trimmed = raw.subarray(0, 720);
      if (isSadlEncryptedPayload(trimmed)) return trimmed;
    }
    if (raw.length >= 700 && raw.length < 720) {
      const padded = new Uint8Array(720);
      padded.set(raw);
      if (isSadlEncryptedPayload(padded)) return padded;
    }
  }

  const trimmed = text?.trim();
  if (trimmed && trimmed.length === 720 && looksLikeSadlEncryptedString(trimmed)) {
    return latin1ToBytes(trimmed);
  }

  return null;
}

async function decodeScanPayload(text?: string, bytesBase64?: string): Promise<ParsedSaId | null> {
  const bytes = sadlBytesFromScanResult(text, bytesBase64);
  if (bytes) {
    return decodeDriversLicenceViaApiFromBase64(sadlBytesToBase64(bytes));
  }

  const trimmed = text?.trim();
  if (trimmed && looksLikeSadlEncryptedString(trimmed)) {
    return decodeDriversLicenceViaApi(trimmed);
  }

  if (bytesBase64) {
    const raw = base64ToBytes(bytesBase64);
    if (raw.length >= 700) {
      const slice = new Uint8Array(720);
      slice.set(raw.subarray(0, Math.min(720, raw.length)));
      return decodeDriversLicenceViaApiFromBase64(sadlBytesToBase64(slice));
    }
  }

  return null;
}

function failureFromError(err: unknown): NativeLicenceScanFailure {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: string }).code ?? "")
      : "";
  if (code === "cancelled") return "cancelled";
  if (code === "timeout") return "cancelled";
  if (code === "not_installed") return "unsupported";
  if (code === "no_result") return "no_barcode";
  return "decode_failed";
}

const BINARY_EYE_SCAN_TIMEOUT_MS = 120_000;

function withScanTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(Object.assign(new Error("Binary Eye scan timed out"), { code: "timeout" }));
    }, BINARY_EYE_SCAN_TIMEOUT_MS);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Opens Binary Eye directly — same scanner the user confirmed works through plastic. */
export async function scanDriversLicenceViaBinaryEye(): Promise<NativeLicenceScanResult> {
  if (!canUseBinaryEyeScanner()) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    const installed = await isBinaryEyeInstalled();
    if (!installed) {
      return { ok: false, reason: "unsupported" };
    }

    const scan = await withScanTimeout(OmtBinaryEyeScanner.scanPdf417());
    const parsed = await decodeScanPayload(scan.text, scan.bytesBase64);
    if (!parsed?.personIdNumber && !parsed?.personFullName) {
      return { ok: false, reason: "decode_failed" };
    }

    return { ok: true, parsed };
  } catch (err) {
    return { ok: false, reason: failureFromError(err) };
  }
}
