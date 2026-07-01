import { Capacitor } from "@capacitor/core";
import {
  isSadlEncryptedPayload,
  latin1ToBytes,
  looksLikeSadlEncryptedString,
} from "@shared/sa-drivers-licence";
import {
  decodeDriversLicenceViaApiFromBase64,
} from "@/lib/decode-drivers-licence-api";
import type { ParsedSaId } from "@/lib/parse-sa-barcodes";

export type NativeLicenceScanFailure =
  | "cancelled"
  | "permission"
  | "unsupported"
  | "no_barcode"
  | "decode_failed";

export type NativeLicenceScanResult =
  | { ok: true; parsed: ParsedSaId }
  | { ok: false; reason: NativeLicenceScanFailure };

type MlKitBarcode = {
  bytes?: number[];
  rawValue?: string;
  format?: string;
};

export function canUseNativeLicenceScanner(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("BarcodeScanner");
}

export function sadlBytesToBase64(bytes: Uint8Array | number[]): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function sadlBytesFromMlKitBarcode(barcode: MlKitBarcode): Uint8Array | null {
  const raw = barcode.bytes;
  if (raw?.length) {
    if (raw.length === 720) {
      const u8 = new Uint8Array(raw);
      if (isSadlEncryptedPayload(u8)) return u8;
    }
    if (raw.length > 720) {
      const trimmed = new Uint8Array(raw.slice(0, 720));
      if (isSadlEncryptedPayload(trimmed)) return trimmed;
    }
    // Some devices return slightly short buffers — pad is unsafe; try exact slices.
    if (raw.length > 700 && raw.length < 720) {
      const padded = new Uint8Array(720);
      padded.set(raw);
      if (isSadlEncryptedPayload(padded)) return padded;
    }
  }

  try {
    const text = barcode.rawValue?.trim();
    if (text && text.length === 720 && looksLikeSadlEncryptedString(text)) {
      return latin1ToBytes(text);
    }
  } catch {
    /* binary rawValue can throw on some devices */
  }

  return null;
}

/** True when ML Kit reports a PDF417 we should try to decrypt on the server. */
function isPdf417Barcode(barcode: MlKitBarcode): boolean {
  const fmt = (barcode.format ?? "").toLowerCase();
  return fmt.includes("pdf417") || fmt.includes("pdf_417");
}

async function loadMlKit() {
  return import("@capacitor-mlkit/barcode-scanning");
}

async function decodeBarcode(barcode: MlKitBarcode): Promise<ParsedSaId | null> {
  const bytes = sadlBytesFromMlKitBarcode(barcode);
  if (bytes) {
    return decodeDriversLicenceViaApiFromBase64(sadlBytesToBase64(bytes));
  }

  // PDF417 read but header check failed — still try server with first 720 bytes.
  const raw = barcode.bytes;
  if (isPdf417Barcode(barcode) && raw && raw.length >= 700) {
    const u8 = new Uint8Array(720);
    u8.set(raw.subarray(0, Math.min(720, raw.length)));
    return decodeDriversLicenceViaApiFromBase64(sadlBytesToBase64(u8));
  }

  return null;
}

/** Google Play full-screen scanner (fastest — same “point and scan” feel as Smart ID). */
async function tryGoogleScanner(): Promise<MlKitBarcode | null> {
  const { BarcodeScanner, BarcodeFormat } = await loadMlKit();

  try {
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!available) {
      try {
        await BarcodeScanner.installGoogleBarcodeScannerModule();
      } catch {
        return null;
      }
    }

    const { barcodes } = await BarcodeScanner.scan({
      formats: [BarcodeFormat.Pdf417],
      autoZoom: true,
    });
    return barcodes?.[0] ?? null;
  } catch {
    return null;
  }
}

let activeListener: { remove: () => Promise<void> } | null = null;

/** ML Kit live camera behind a transparent WebView overlay. */
async function tryMlKitLiveScan(
  signal: { cancelled: boolean },
): Promise<MlKitBarcode | null> {
  const { BarcodeScanner, BarcodeFormat, Resolution, LensFacing } = await loadMlKit();

  const { supported } = await BarcodeScanner.isSupported();
  if (!supported) return null;

  const perm = await BarcodeScanner.checkPermissions();
  if (perm.camera !== "granted") {
    const req = await BarcodeScanner.requestPermissions();
    if (req.camera !== "granted") return null;
  }

  document.body.classList.add("barcode-scanner-active");

  const handleBarcode = (bc: MlKitBarcode): boolean => {
    if (signal.cancelled) return false;
    if (sadlBytesFromMlKitBarcode(bc)) return true;
    // Accept any PDF417 hit — bytes may only validate after server decrypt.
    return isPdf417Barcode(bc) && (bc.bytes?.length ?? 0) >= 700;
  };

  return new Promise((resolve) => {
    let settled = false;
    const finish = async (barcode: MlKitBarcode | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      document.body.classList.remove("barcode-scanner-active");
      try {
        if (activeListener) {
          await activeListener.remove();
          activeListener = null;
        }
        if (legacyListener) {
          await legacyListener.remove();
          legacyListener = null;
        }
        await BarcodeScanner.removeAllListeners();
        await BarcodeScanner.stopScan();
      } catch {
        /* ignore */
      }
      resolve(barcode);
    };

    let legacyListener: { remove: () => Promise<void> } | null = null;
    const timeout = window.setTimeout(() => void finish(null), 30_000);

    void (async () => {
      try {
        const onBarcodes = (barcodes: MlKitBarcode[] | undefined) => {
          for (const bc of barcodes ?? []) {
            if (handleBarcode(bc)) {
              void finish(bc);
              return;
            }
          }
        };

        activeListener = await BarcodeScanner.addListener("barcodesScanned", (event) => {
          onBarcodes(event.barcodes);
        });

        // Older plugin builds emit the singular event.
        legacyListener = await BarcodeScanner.addListener(
          "barcodeScanned" as "barcodesScanned",
          (event: { barcode?: MlKitBarcode }) => {
            if (event.barcode && handleBarcode(event.barcode)) {
              void finish(event.barcode);
            }
          },
        );

        await BarcodeScanner.addListener("scanError", (event) => {
          console.warn("[mlkit-licence] scanError:", event.message);
        });

        await BarcodeScanner.startScan({
          formats: [BarcodeFormat.Pdf417],
          resolution: Resolution["1920x1080"],
          lensFacing: LensFacing.Back,
        });

        // Torch off by default — on plastic sleeves it causes glare, not clarity.
      } catch (err) {
        console.warn(
          "[mlkit-licence] startScan failed:",
          err instanceof Error ? err.message : err,
        );
        void finish(null);
      }
    })();
  });
}

export async function stopNativeDriversLicenceScan(): Promise<void> {
  document.body.classList.remove("barcode-scanner-active");
  try {
    const { BarcodeScanner } = await loadMlKit();
    if (activeListener) {
      await activeListener.remove();
      activeListener = null;
    }
    await BarcodeScanner.removeAllListeners();
    await BarcodeScanner.stopScan();
  } catch {
    /* ignore */
  }
}

/**
 * Live native scan for SA driver's licence PDF417.
 * mode "google" — full-screen Google scanner UI.
 * mode "live" / "auto" — ML Kit camera behind WebView (never opens Google UI).
 */
export async function scanDriversLicenceNative(
  mode: "auto" | "google" | "live" = "auto",
): Promise<NativeLicenceScanResult> {
  if (!canUseNativeLicenceScanner()) {
    return { ok: false, reason: "unsupported" };
  }

  const signal = { cancelled: false };

  let barcode: MlKitBarcode | null = null;
  if (mode === "google") {
    barcode = await tryGoogleScanner();
  } else if (mode === "live") {
    barcode = await tryMlKitLiveScan(signal);
  } else if (mode === "auto") {
    barcode = await tryMlKitLiveScan(signal);
    if (!barcode && !signal.cancelled) {
      barcode = await tryGoogleScanner();
    }
  }

  if (signal.cancelled) {
    return { ok: false, reason: "cancelled" };
  }
  if (!barcode) {
    return { ok: false, reason: "no_barcode" };
  }

  const parsed = await decodeBarcode(barcode);
  if (!parsed?.personIdNumber && !parsed?.personFullName) {
    return { ok: false, reason: "decode_failed" };
  }

  return { ok: true, parsed };
}
