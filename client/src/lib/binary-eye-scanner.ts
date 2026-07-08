import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  extractSadl720FromScan,
  type BinaryEyeScanPayload,
} from "@shared/extract-sadl-payload";
import {
  decodeDriversLicenceViaApiFromBase64,
  sadlBytesToBase64,
} from "@/lib/decode-drivers-licence-api";
import type { ParsedSaId, ParsedSaVehicleDisc } from "@/lib/parse-sa-barcodes";
import { parseSaIdentityScan, parseSaVehicleDiscBarcode } from "@/lib/parse-sa-barcodes";
import type { NativeLicenceScanFailure } from "@/lib/native-licence-barcode";

export const BINARY_EYE_PACKAGE = "de.markusfisch.android.binaryeye";
export const BINARY_EYE_PLAY_URL =
  "https://play.google.com/store/apps/details?id=de.markusfisch.android.binaryeye";

export type BinaryEyeScanKind = "national_id" | "drivers_licence" | "disc";

/** ZXing SCAN_FORMATS values for Binary Eye intent fallback. */
export const BINARY_EYE_FORMATS: Record<BinaryEyeScanKind, string> = {
  national_id: "PDF_417,CODE_39,CODE_128",
  drivers_licence: "PDF_417",
  disc: "PDF_417,CODE_128,CODE_39",
};

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
  scan(options: { formats: string }): Promise<
    BinaryEyeScanPayload & {
      format?: string;
      textLength?: number;
      bytesLength?: number;
      via?: string;
    }
  >;
  /** @deprecated Use scan({ formats }) */
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

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Text from PDF417 — Smart ID pipes, MVL percent-string, or Code39 green-book ID bytes. */
export function extractTextFromBinaryEyeScan(scan: BinaryEyeScanPayload): string | null {
  const text = scan.text?.trim();
  if (text && text.length > 0) {
    // MVL disc strings can be a few hundred chars; SADL binary as "text" is ~720 bytes — skip that path here.
    if (text.length < 700 || text.includes("%")) {
      if (looksLikePlausibleBarcodeText(text)) return text;
    }
  }

  const fromBytes = bytesToLatin1Text(scan);
  if (fromBytes) return fromBytes;

  return text && text.length > 0 && text.length < 700 ? text : null;
}

function hexToScanBytes(hex: string): Uint8Array | null {
  const cleaned = hex.replace(/\s/g, "");
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) return null;
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function latin1BytesToString(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

/** Printable barcode text: Smart ID pipes, MVL %, or green-book 13-digit ID (Code39). */
function looksLikePlausibleBarcodeText(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 700) return false;
  if (trimmed.includes("%") || trimmed.includes("|")) return true;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 13 && /^\d{13}$/.test(digits)) return true;
  // Code39 / Code128 text payloads (ID book, partial scans).
  if (/^[\x20-\x7e]+$/.test(trimmed) && trimmed.length >= 3) return true;
  return false;
}

function bytesToLatin1Text(scan: BinaryEyeScanPayload): string | null {
  const sources: Uint8Array[] = [];

  if (scan.hex) {
    const cleaned = scan.hex.replace(/\s/g, "");
    if (cleaned.length > 0 && cleaned.length < 1400 && cleaned.length % 2 === 0) {
      const bytes = hexToScanBytes(cleaned);
      if (bytes && bytes.length > 0 && bytes.length < 700) sources.push(bytes);
    }
  }

  if (scan.bytesBase64) {
    try {
      const bytes = base64ToBytes(scan.bytesBase64);
      if (bytes.length > 0 && bytes.length < 700) sources.push(bytes);
    } catch {
      /* ignore */
    }
  }

  if (scan.latin1TextBase64) {
    try {
      const bytes = base64ToBytes(scan.latin1TextBase64);
      if (bytes.length > 0 && bytes.length < 700) sources.push(bytes);
    } catch {
      /* ignore */
    }
  }

  for (const bytes of sources) {
    const trimmed = latin1BytesToString(bytes).trim();
    if (looksLikePlausibleBarcodeText(trimmed)) return trimmed;
  }

  return null;
}

async function decodeLicenceScanPayload(scan: BinaryEyeScanPayload): Promise<{
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

export type BinaryEyeLicenceOutcome =
  | { ok: true; kind: "drivers_licence"; parsed: ParsedSaId }
  | { ok: false; reason: NativeLicenceScanFailure; diagnostics?: BinaryEyeScanDiagnostics };

export type BinaryEyeIdOutcome =
  | { ok: true; kind: "national_id"; parsed: ParsedSaId; raw: string }
  | { ok: false; reason: NativeLicenceScanFailure; diagnostics?: BinaryEyeScanDiagnostics };

export type BinaryEyeDiscOutcome =
  | { ok: true; kind: "disc"; parsed: ParsedSaVehicleDisc; raw: string }
  | { ok: false; reason: NativeLicenceScanFailure; diagnostics?: BinaryEyeScanDiagnostics };

export type BinaryEyeScanOutcome = BinaryEyeLicenceOutcome | BinaryEyeIdOutcome | BinaryEyeDiscOutcome;

async function invokeBinaryEyeScan(formats: string): Promise<BinaryEyeScanPayload & { via?: string }> {
  try {
    return await withScanTimeout(OmtBinaryEyeScanner.scan({ formats }));
  } catch {
    return await withScanTimeout(OmtBinaryEyeScanner.scanPdf417());
  }
}

/** Opens Binary Eye — primary scanner for access control on Android. */
export async function scanViaBinaryEye(kind: BinaryEyeScanKind): Promise<BinaryEyeScanOutcome> {
  if (!canUseBinaryEyeScanner()) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    const installed = await isBinaryEyeInstalled();
    if (!installed) {
      return { ok: false, reason: "unsupported" };
    }

    const scan = await invokeBinaryEyeScan(BINARY_EYE_FORMATS[kind]);
    const diagnostics = scanDiagnostics(scan);

    if (kind === "drivers_licence") {
      const { parsed, hadSadlPayload } = await decodeLicenceScanPayload(scan);
      diagnostics.hadSadlPayload = hadSadlPayload;
      if (!parsed?.personIdNumber && !parsed?.personFullName) {
        return {
          ok: false,
          reason: hadSadlPayload ? "decode_failed" : "no_barcode",
          diagnostics,
        };
      }
      return { ok: true, kind: "drivers_licence", parsed };
    }

    const raw = extractTextFromBinaryEyeScan(scan);
    diagnostics.textLength = raw?.length;

    if (!raw) {
      return { ok: false, reason: "no_barcode", diagnostics };
    }

    if (kind === "disc") {
      const parsed = parseSaVehicleDiscBarcode(raw);
      if (!parsed.registration && !parsed.licenceDiscData) {
        return { ok: false, reason: "decode_failed", diagnostics };
      }
      return { ok: true, kind: "disc", parsed, raw };
    }

    const parsed = parseSaIdentityScan(raw);
    if (!parsed.personIdNumber && !parsed.personFullName) {
      return { ok: false, reason: "decode_failed", diagnostics };
    }
    return { ok: true, kind: "national_id", parsed, raw };
  } catch (err) {
    return { ok: false, reason: failureFromError(err) };
  }
}

/** @deprecated Use scanViaBinaryEye("drivers_licence") */
export async function scanDriversLicenceViaBinaryEye(): Promise<BinaryEyeLicenceOutcome> {
  const outcome = await scanViaBinaryEye("drivers_licence");
  if (outcome.ok) return outcome;
  return { ok: false, reason: outcome.reason, diagnostics: outcome.diagnostics };
}

export function describeBinaryEyeFailure(
  kind: BinaryEyeScanKind,
  outcome: Extract<BinaryEyeScanOutcome, { ok: false }>,
): string {
  const d = outcome.diagnostics;
  const parts: string[] = [];
  if (d?.bytesLength != null) parts.push(`${d.bytesLength} raw bytes`);
  if (d?.textLength != null) parts.push(`text ${d.textLength} chars`);
  if (d?.hexLength != null) parts.push(`hex ${d.hexLength} chars`);
  if (d?.format) parts.push(d.format);
  if (d?.via) parts.push(`via ${d.via}`);
  const detail = parts.length ? ` (${parts.join(", ")})` : "";

  if (outcome.reason === "unsupported") {
    return "Install Binary Eye from Play Store, then try again.";
  }

  if (kind === "drivers_licence") {
    if (d?.hadSadlPayload) {
      return `Barcode read but decrypt failed${detail}. Try again or use Photo of front for name + ID.`;
    }
    return `No licence barcode in scan${detail}. Point at the PDF417 on the back-right of the card.`;
  }

  if (kind === "national_id") {
    return `Could not read ID barcode${detail}. Use the large square PDF417 on a Smart ID back, or the line barcode on a green ID book.`;
  }

  return `Could not read licence disc barcode${detail}. Centre the disc barcode in good light.`;
}

export function binaryEyeScanHint(kind: BinaryEyeScanKind): string {
  if (kind === "drivers_licence") {
    return "Point Binary Eye at the PDF417 on the back-right of the card.";
  }
  if (kind === "national_id") {
    return "Smart ID: large square PDF417 on the back. Green book: line barcode on the front.";
  }
  return "Centre the licence disc barcode in the frame.";
}
