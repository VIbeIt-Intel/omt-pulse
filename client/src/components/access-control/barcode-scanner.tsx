import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Camera, ImageIcon, ScanLine, Settings, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { isSmartIdPipePayload, pickBestBarcodePayload } from "@/lib/pick-best-barcode";
import {
  decodeDriversLicenceFromImageViaApi,
  decodeDriversLicenceViaApiFromBase64,
  sadlBytesToBase64,
} from "@/lib/decode-drivers-licence-api";
import type { AccessIdentityScanResult } from "@/lib/parse-sa-barcodes";
import { PDF417_MANUAL_FALLBACK_MSG } from "@/lib/decode-barcode-image";
import {
  decodeZxingFromFile,
  decodeZxingFromVideo,
  ZxingLiveScanner,
  type ZxingLiveHit,
  type ZxingScanMode,
} from "@/lib/zxing-live-scanner";
import { openOmtAppDetailsSettings } from "@/lib/omt-app-settings";
import { APP_CACHE_VERSION } from "@shared/cache-version";
import {
  NativeSettings,
  AndroidSettings,
  IOSSettings,
} from "capacitor-native-settings";

type BarcodeScannerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  scanKind?: "id" | "disc";
  identityMode?: "national_id" | "drivers_licence";
  onScan: (result: string | AccessIdentityScanResult) => void;
};

const FILE_INPUT_CLASS =
  "absolute left-0 top-0 h-px w-px overflow-hidden opacity-0 [clip:rect(0,0,0,0)]";

const LIVE_SCAN_TIMEOUT_MS = 4_500;
const LIVE_LICENCE_SCAN_TIMEOUT_MS = 8_000;
const LICENCE_FRAME_RETRY_MS = 700;
const ID_1D_SETTLE_MS = 1_800;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Drop stale service-worker caches and native overlay state left by old builds. */
async function purgeStaleScannerCaches(): Promise<void> {
  try {
    document.body.classList.remove("barcode-scanner-active");
  } catch {
    /* ignore */
  }
  if ("caches" in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("omt-v") && k !== APP_CACHE_VERSION)
          .map((k) => caches.delete(k)),
      );
    } catch {
      /* ignore */
    }
  }
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    } catch {
      /* ignore */
    }
  }
}

function cleanupNativeScanOverlay(): void {
  try {
    document.body.classList.remove("barcode-scanner-active");
  } catch {
    /* ignore */
  }
}

function zxingMode(
  scanKind: "id" | "disc",
  identityMode: "national_id" | "drivers_licence",
): ZxingScanMode {
  if (scanKind === "disc") return "disc";
  return identityMode === "drivers_licence" ? "drivers_licence" : "national_id";
}

async function openCameraPermissionSettings(): Promise<void> {
  try {
    if (await openOmtAppDetailsSettings()) return;
    const platform = Capacitor.getPlatform();
    if (platform === "android") {
      await NativeSettings.openAndroid({ option: AndroidSettings.ApplicationDetails });
      return;
    }
    if (platform === "ios") {
      await NativeSettings.openIOS({ option: IOSSettings.App });
    }
  } catch {
    /* ignore */
  }
}

export function BarcodeScanner({
  open,
  onOpenChange,
  title,
  scanKind = "id",
  identityMode = "national_id",
  onScan,
}: BarcodeScannerProps) {
  const isLicenceMode = scanKind === "id" && identityMode === "drivers_licence";
  const mode = zxingMode(scanKind, identityMode);

  const videoRef = useRef<HTMLVideoElement>(null);
  const zxingRef = useRef<ZxingLiveScanner | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);
  const busyRef = useRef(false);
  const samplesRef = useRef<Array<{ text: string; at: number }>>([]);
  const startedAtRef = useRef(0);

  const [scanning, setScanning] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoOffered, setPhotoOffered] = useState(false);
  const [showManualFallback, setShowManualFallback] = useState(false);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const stopLiveScan = useCallback(() => {
    try {
      zxingRef.current?.stop();
    } catch {
      /* ignore */
    }
    zxingRef.current = null;
    setScanning(false);
  }, []);

  const showManualEntry = useCallback((message = PDF417_MANUAL_FALLBACK_MSG) => {
    setShowManualFallback(true);
    setPhotoOffered(true);
    setError(message);
    setStatus(null);
  }, []);

  const settleSuccess = useCallback(
    (result: string | AccessIdentityScanResult) => {
      if (settledRef.current) return;
      settledRef.current = true;
      stopLiveScan();
      cleanupNativeScanOverlay();
      onScan(result);
      onOpenChange(false);
    },
    [onOpenChange, onScan, stopLiveScan],
  );

  const finishLicenceBytes = useCallback(
    async (bytes: Uint8Array) => {
      if (busyRef.current || settledRef.current) return;
      busyRef.current = true;
      setStatus("Barcode detected — reading licence…");
      setError(null);
      try {
        const parsed = await decodeDriversLicenceViaApiFromBase64(sadlBytesToBase64(bytes));
        if (parsed?.personIdNumber || parsed?.personFullName) {
          settleSuccess({ kind: "parsed", parsed });
          return;
        }
        setStatus("Having trouble reading this barcode — try Take photo.");
        setPhotoOffered(true);
      } catch {
        setStatus("Having trouble reading this barcode — try Take photo.");
        setPhotoOffered(true);
      } finally {
        busyRef.current = false;
      }
    },
    [settleSuccess],
  );

  const handleZxingHit = useCallback(
    async (hit: ZxingLiveHit) => {
      if (settledRef.current || busyRef.current) return;

      try {
        if (hit.kind === "licence_bytes") {
          if (isLicenceMode || identityMode === "national_id") {
            await finishLicenceBytes(hit.bytes);
          }
          return;
        }

        if (hit.kind === "smart_id") {
          setStatus("Barcode detected");
          settleSuccess({ kind: "raw", value: hit.text });
          return;
        }

        if (hit.kind === "disc") {
          setStatus("Barcode detected");
          settleSuccess(hit.text);
          return;
        }

        if (hit.kind === "id_1d") {
          const now = Date.now();
          samplesRef.current.push({ text: hit.text, at: now });
          samplesRef.current = samplesRef.current
            .filter((s) => now - s.at < 3_000)
            .slice(-8);

          const best = pickBestBarcodePayload(
            samplesRef.current.map((s) => ({ rawValue: s.text })),
          );
          if (!best) return;

          const elapsed = now - startedAtRef.current;
          if (isSmartIdPipePayload(best)) {
            setStatus("Barcode detected");
            settleSuccess({ kind: "raw", value: best });
            return;
          }

          const digits = best.replace(/\D/g, "");
          if (digits.length === 13 && elapsed >= ID_1D_SETTLE_MS) {
            setStatus("Barcode detected");
            settleSuccess({ kind: "raw", value: best });
            return;
          }

          if (elapsed >= 2_000 && digits.length === 13) {
            setStatus("Centre the large square PDF417 on a Smart ID.");
          }
        }
      } catch {
        /* never crash the app on a bad frame */
      }
    },
    [finishLicenceBytes, identityMode, isLicenceMode, settleSuccess],
  );

  const startZxingLive = useCallback(async () => {
    const video = videoRef.current;
    if (!video || settledRef.current) return;

    stopLiveScan();
    const scanner = new ZxingLiveScanner();
    zxingRef.current = scanner;

    try {
      setScanning(true);
      setStatus(
        isLicenceMode
          ? "ZXing live scan — hold the back of the card steady."
          : "Scanning… hold the card steady.",
      );
      await scanner.start(video, mode, (hit) => {
        void handleZxingHit(hit);
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setPermissionBlocked(true);
        setError("Camera blocked — allow Camera in app settings.");
      } else {
        setError("Camera unavailable — use Take photo below.");
        setPhotoOffered(true);
      }
      setStatus(null);
    }
  }, [handleZxingHit, isLicenceMode, mode, stopLiveScan]);

  const decodePhotoFile = useCallback(
    async (file: File) => {
      if (busyRef.current || settledRef.current) return;
      busyRef.current = true;
      setPhotoBusy(true);
      setError(null);
      setStatus("Reading barcode from photo…");

      try {
        if (isLicenceMode) {
          const hit = await decodeZxingFromFile(file, mode);
          if (hit?.kind === "licence_bytes") {
            await finishLicenceBytes(hit.bytes);
            return;
          }
          const parsed = await decodeDriversLicenceFromImageViaApi(file);
          if (parsed?.personIdNumber || parsed?.personFullName) {
            settleSuccess({ kind: "parsed", parsed });
            return;
          }
        } else {
          const hit = await decodeZxingFromFile(file, mode);
          if (hit?.kind === "licence_bytes") {
            await finishLicenceBytes(hit.bytes);
            return;
          }
          if (hit?.kind === "smart_id" || hit?.kind === "id_1d") {
            settleSuccess({ kind: "raw", value: hit.text });
            return;
          }
          if (hit?.kind === "disc") {
            settleSuccess(hit.text);
            return;
          }
        }

        showManualEntry("Could not read the barcode from this photo. Try again or enter manually.");
        void startZxingLive();
      } catch {
        showManualEntry();
        void startZxingLive();
      } finally {
        busyRef.current = false;
        setPhotoBusy(false);
      }
    },
    [finishLicenceBytes, isLicenceMode, mode, settleSuccess, showManualEntry, startZxingLive],
  );

  const captureAndDecode = useCallback(async () => {
    const video = videoRef.current;
    if (!video || busyRef.current || settledRef.current) return;

    busyRef.current = true;
    setPhotoBusy(true);
    setStatus("Capturing frame…");
    try {
      const hit = await decodeZxingFromVideo(video, mode);
      if (hit?.kind === "licence_bytes") {
        await finishLicenceBytes(hit.bytes);
        return;
      }
      if (hit?.kind === "smart_id" || hit?.kind === "id_1d") {
        settleSuccess({ kind: "raw", value: hit.text });
        return;
      }
      if (hit?.kind === "disc") {
        settleSuccess(hit.text);
        return;
      }
      showManualEntry("Could not read the barcode. Adjust lighting and try again.");
    } catch {
      showManualEntry();
    } finally {
      busyRef.current = false;
      setPhotoBusy(false);
    }
  }, [finishLicenceBytes, mode, settleSuccess, showManualEntry]);

  useEffect(() => {
    if (!open) {
      stopLiveScan();
      cleanupNativeScanOverlay();
      settledRef.current = false;
      busyRef.current = false;
      samplesRef.current = [];
      setError(null);
      setHint(null);
      setStatus(null);
      setManual("");
      setPhotoOffered(false);
      setShowManualFallback(false);
      setPermissionBlocked(false);
      setPhotoBusy(false);
      return;
    }

    cleanupNativeScanOverlay();
    if (isLicenceMode) {
      void purgeStaleScannerCaches();
    }
    settledRef.current = false;
    busyRef.current = false;
    samplesRef.current = [];
    startedAtRef.current = Date.now();
    setPhotoOffered(false);
    setShowManualFallback(false);
    setError(null);

    if (isLicenceMode) {
      setHint(
        `ZXing live scan (${APP_CACHE_VERSION}) — centre the large PDF417 on the back of the card.`,
      );
    } else if (scanKind === "id") {
      setHint("Hold a Smart ID or ID book in the green frame for 2–3 seconds.");
    } else {
      setHint("Centre the licence disc barcode in the frame.");
    }

    let cancelled = false;

    void (async () => {
      await delay(250);
      if (!cancelled) await startZxingLive();
    })();

    const frameRetry = isLicenceMode
      ? window.setInterval(() => {
          if (cancelled || settledRef.current || busyRef.current) return;
          const video = videoRef.current;
          if (!video || video.readyState < 2) return;
          void (async () => {
            try {
              const hit = await decodeZxingFromVideo(video, "drivers_licence");
              if (hit?.kind === "licence_bytes") {
                await finishLicenceBytes(hit.bytes);
              }
            } catch {
              /* ignore frame errors */
            }
          })();
        }, LICENCE_FRAME_RETRY_MS)
      : 0;

    const timeout = window.setTimeout(
      () => {
        if (cancelled || settledRef.current) return;
        setPhotoOffered(true);
        setStatus("Having trouble reading this barcode — try Take photo.");
      },
      isLicenceMode ? LIVE_LICENCE_SCAN_TIMEOUT_MS : LIVE_SCAN_TIMEOUT_MS,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      if (frameRetry) window.clearInterval(frameRetry);
      stopLiveScan();
      cleanupNativeScanOverlay();
    };
  }, [
    finishLicenceBytes,
    isLicenceMode,
    open,
    scanKind,
    startZxingLive,
    stopLiveScan,
  ]);

  const closeForManualEntry = useCallback(() => {
    stopLiveScan();
    onOpenChange(false);
  }, [onOpenChange, stopLiveScan]);

  const showPhotoActions = photoOffered || showManualFallback || permissionBlocked;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden" hideDefaultClose>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className={FILE_INPUT_CLASS}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void decodePhotoFile(file);
            e.target.value = "";
          }}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className={FILE_INPUT_CLASS}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void decodePhotoFile(file);
            e.target.value = "";
          }}
        />

        <DialogHeader className="p-4 pb-2 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ScanLine className="h-5 w-5" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="relative aspect-[4/3] bg-black overflow-hidden">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
            autoPlay
          />
          {!scanning && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-sm px-6 text-center">
              Starting camera…
            </div>
          )}
          <div className="pointer-events-none absolute inset-6 border-2 border-primary rounded-lg" />
        </div>

        <div className="p-4 space-y-3">
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          {status && !error && (
            <p className="text-xs text-primary font-medium">{status}</p>
          )}
          {error && (
            <p className="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            {showPhotoActions ? (
              <>
                <Button
                  type="button"
                  variant="default"
                  className="flex-1"
                  disabled={photoBusy}
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <Camera className="h-4 w-4 mr-1" />
                  {photoBusy ? "Reading…" : "Take photo"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={photoBusy}
                  onClick={() => galleryInputRef.current?.click()}
                >
                  <ImageIcon className="h-4 w-4 mr-1" />
                  Gallery
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={photoBusy || !scanning}
                onClick={() => void captureAndDecode()}
              >
                <Camera className="h-4 w-4 mr-1" />
                Capture frame
              </Button>
            )}
            {permissionBlocked && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void openCameraPermissionSettings()}
                title="Open camera settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
            )}
          </div>

          {showManualFallback && scanKind === "id" && identityMode === "national_id" && (
            <>
              <input
                type="text"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Paste Smart ID barcode text"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Last resort — paste barcode text or type on the form.
              </p>
            </>
          )}

          <div className="flex gap-2">
            {showManualFallback && scanKind === "id" && identityMode === "national_id" && (
              <Button
                type="button"
                className="flex-1"
                disabled={!manual.trim()}
                onClick={() => {
                  try {
                    settleSuccess({ kind: "raw", value: manual.trim() });
                  } catch {
                    showManualEntry();
                  }
                }}
              >
                Use code
              </Button>
            )}
            {!showManualFallback && (
              <Button
                type="button"
                variant="ghost"
                className="flex-1 text-xs"
                onClick={() => showManualEntry()}
              >
                Enter manually
              </Button>
            )}
            <Button type="button" variant="outline" className="flex-1" onClick={closeForManualEntry}>
              Close — type on form
            </Button>
            <Button type="button" variant="outline" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
