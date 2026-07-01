import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  extractSadl720FromScan,
  type BinaryEyeScanPayload,
} from "@shared/extract-sadl-payload";
import {
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
  scanPdf417(): Promise<
    BinaryEyeScanPayload & {
      format?: string;
      textLength?: number;
      bytesLength?: number;
    }
  >;
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

async function decodeScanPayload(scan: BinaryEyeScanPayload): Promise<ParsedSaId | null> {
  const sadl = extractSadl720FromScan(scan);
  if (!sadl) return null;
  return decodeDriversLicenceViaApiFromBase64(sadlBytesToBase64(sadl));
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
    const parsed = await decodeScanPayload(scan);
    if (!parsed?.personIdNumber && !parsed?.personFullName) {
      return { ok: false, reason: "decode_failed" };
    }

    return { ok: true, parsed };
  } catch (err) {
    return { ok: false, reason: failureFromError(err) };
  }
}
