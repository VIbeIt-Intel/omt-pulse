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
import type { NativeLicenceScanFailure } from "@/lib/native-licence-barcode";

export const BINARY_EYE_PACKAGE = "de.markusfisch.android.binaryeye";
export const BINARY_EYE_PLAY_URL =
  "https://play.google.com/store/apps/details?id=de.markusfisch.android.binaryeye";

export type BinaryEyeScanDiagnostics = {
  via?: string;
  format?: string;
  textLength?: number;
  bytesLength?: number;
  hexLength?: number;
  hadSadlPayload?: boolean;
};

export interface OmtBinaryEyeScannerPlugin {
  isAvailable(): Promise<{ installed: boolean }>;
  scanPdf417(): Promise<
    BinaryEyeScanPayload & {
      format?: string;
      textLength?: number;
      bytesLength?: number;
      via?: string;
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

function scanDiagnostics(scan: BinaryEyeScanPayload & { via?: string }): BinaryEyeScanDiagnostics {
  return {
    via: scan.via,
    format: scan.format,
    textLength: scan.text?.length,
    bytesLength: scan.bytesBase64
      ? Math.floor((scan.bytesBase64.length * 3) / 4)
      : undefined,
    hexLength: scan.hex?.replace(/\s/g, "").length,
  };
}

async function decodeScanPayload(scan: BinaryEyeScanPayload): Promise<{
  parsed: ParsedSaId | null;
  hadSadlPayload: boolean;
}> {
  const sadl = extractSadl720FromScan(scan);
  if (!sadl) {
    return { parsed: null, hadSadlPayload: false };
  }
  const parsed = await decodeDriversLicenceViaApiFromBase64(sadlBytesToBase64(sadl));
  return { parsed, hadSadlPayload: true };
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

export type BinaryEyeScanOutcome =
  | { ok: true; parsed: ParsedSaId }
  | {
      ok: false;
      reason: NativeLicenceScanFailure;
      diagnostics?: BinaryEyeScanDiagnostics;
    };

/** Opens Binary Eye directly — same scanner the user confirmed works through plastic. */
export async function scanDriversLicenceViaBinaryEye(): Promise<BinaryEyeScanOutcome> {
  if (!canUseBinaryEyeScanner()) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    const installed = await isBinaryEyeInstalled();
    if (!installed) {
      return { ok: false, reason: "unsupported" };
    }

    const scan = await withScanTimeout(OmtBinaryEyeScanner.scanPdf417());
    const diagnostics = scanDiagnostics(scan);
    const { parsed, hadSadlPayload } = await decodeScanPayload(scan);
    diagnostics.hadSadlPayload = hadSadlPayload;

    if (!parsed?.personIdNumber && !parsed?.personFullName) {
      return {
        ok: false,
        reason: hadSadlPayload ? "decode_failed" : "no_barcode",
        diagnostics,
      };
    }

    return { ok: true, parsed };
  } catch (err) {
    return { ok: false, reason: failureFromError(err) };
  }
}

export function describeBinaryEyeFailure(
  outcome: Extract<BinaryEyeScanOutcome, { ok: false }>,
): string {
  const d = outcome.diagnostics;
  if (!d) {
    return "Try Binary Eye again with the PDF417 on the back right, or take a photo of the back of the card.";
  }

  const parts: string[] = [];
  if (d.bytesLength != null) parts.push(`${d.bytesLength} raw bytes`);
  if (d.textLength != null) parts.push(`text ${d.textLength} chars`);
  if (d.hexLength != null) parts.push(`hex ${d.hexLength} chars`);
  if (d.format) parts.push(d.format);
  if (d.via) parts.push(`via ${d.via}`);

  const detail = parts.length ? ` (${parts.join(", ")})` : "";
  if (!d.hadSadlPayload) {
    return `No 720-byte licence payload in scan result${detail}. Hold the back-right PDF417 steady in good light, or take a photo of the back.`;
  }
  return `Barcode read but decrypt failed${detail}. Try again or take a photo of the back of the card.`;
}
