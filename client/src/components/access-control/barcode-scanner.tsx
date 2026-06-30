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
import {
  isSmartIdPipePayload,
  pickBestBarcodePayload,
} from "@/lib/pick-best-barcode";
import { decodeDriversLicenceFromImageViaApi } from "@/lib/decode-drivers-licence-api";
import type { AccessIdentityScanResult } from "@/lib/parse-sa-barcodes";
import {
  captureVideoFrameAsJpeg,
  classifyLiveBarcodeHit,
  createHtml5FileScanner,
  decodeBarcodesFromFile,
  isSafeLiveBarcodeValue,
  PDF417_MANUAL_FALLBACK_MSG,
  PDF417_PHOTO_REQUIRED_MSG,
} from "@/lib/decode-barcode-image";
import { openOmtAppDetailsSettings } from "@/lib/omt-app-settings";
import {
  NativeSettings,
  AndroidSettings,
  IOSSettings,
} from "capacitor-native-settings";
import type { Html5Qrcode } from "html5-qrcode";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string; format?: string }>>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor;
  }
}

type BarcodeScannerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  scanKind?: "id" | "disc";
  /** national_id = live scan; drivers_licence = preview + photo/server only (no live PDF417 — crashes WebView). */
  identityMode?: "national_id" | "drivers_licence";
  onScan: (result: string | AccessIdentityScanResult) => void;
};

type ScanSample = { rawValue: string; format?: string; at: number };

const HIDDEN_SCANNER_ID = "ac-barcode-file-scanner";

const ID_DETECTOR_FORMATS = ["pdf417", "qr_code", "code_128", "code_39"];
const DISC_DETECTOR_FORMATS = ["pdf417", "code_128", "code_39", "qr_code"];

const LICENCE_PHOTO_HINT = PDF417_PHOTO_REQUIRED_MSG;

const FILE_INPUT_CLASS =
  "absolute left-0 top-0 h-px w-px overflow-hidden opacity-0 [clip:rect(0,0,0,0)]";

const LIVE_DETECT_MIN_INTERVAL_MS = 280;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

/** Process live hits: Smart ID / 1D auto-fill; encrypted licence → photo prompt only. */
function processLiveDetectorCodes(
  codes: Array<{ rawValue: string; format?: string }>,
): {
  safeHits: Array<{ rawValue: string; format?: string }>;
  sawEncryptedLicence: boolean;
  smartIdHit: { rawValue: string; format?: string } | null;
} {
  const safeHits: Array<{ rawValue: string; format?: string }> = [];
  let sawEncryptedLicence = false;
  let smartIdHit: { rawValue: string; format?: string } | null = null;

  for (const code of codes) {
    try {
      const { kind, raw, format } = classifyLiveBarcodeHit(code);
      if (kind === "encrypted_licence") {
        sawEncryptedLicence = true;
        continue;
      }
      if (kind === "smart_id" && raw) {
        smartIdHit = { rawValue: raw, format };
        continue;
      }
      if ((kind === "id_1d" || kind === "smart_id") && raw) {
        safeHits.push({ rawValue: raw, format });
      }
    } catch {
      sawEncryptedLicence = true;
    }
  }

  return { safeHits, sawEncryptedLicence, smartIdHit };
}

export function BarcodeScanner({
  open,
  onOpenChange,
  title,
  scanKind = "id",
  identityMode = "national_id",
  onScan,
}: BarcodeScannerProps) {
  const isLicenceOnlyMode = scanKind === "id" && identityMode === "drivers_licence";
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const lastLiveDetectRef = useRef(0);
  const fileScannerRef = useRef<Html5Qrcode | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const samplesRef = useRef<ScanSample[]>([]);
  const startedAtRef = useRef(0);
  const settledRef = useRef(false);
  const pickerActiveRef = useRef(false);
  const decodeBusyRef = useRef(false);
  const licenceHintShownRef = useRef(false);
  const openRef = useRef(open);
  const startLiveCameraRef = useRef<(() => Promise<void>) | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [scanning, setScanning] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [photoScanning, setPhotoScanning] = useState(false);
  const [licencePhotoRequired, setLicencePhotoRequired] = useState(false);
  const [showManualFallback, setShowManualFallback] = useState(false);

  openRef.current = open;

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const ensureFileScanner = useCallback(() => {
    if (fileScannerRef.current) return fileScannerRef.current;
    fileScannerRef.current = createHtml5FileScanner(HIDDEN_SCANNER_ID);
    return fileScannerRef.current;
  }, []);

  const showLicencePhotoHint = useCallback(() => {
    if (licenceHintShownRef.current) return;
    licenceHintShownRef.current = true;
    setLicencePhotoRequired(true);
    setStatus(LICENCE_PHOTO_HINT);
  }, []);

  const showManualEntryFallback = useCallback((message = PDF417_MANUAL_FALLBACK_MSG) => {
    setShowManualFallback(true);
    setError(message);
    setStatus(null);
  }, []);

  const finishDriversLicenceFromImage = useCallback(
    async (image: Blob) => {
      if (decodeBusyRef.current || settledRef.current) return;
      decodeBusyRef.current = true;
      settledRef.current = true;
      stopCamera();
      setStatus("Reading driver's licence…");
      setError(null);
      try {
        const parsed = await decodeDriversLicenceFromImageViaApi(image);
        if (!parsed?.personIdNumber && !parsed?.personFullName) {
          settledRef.current = false;
          setStatus(null);
          showManualEntryFallback();
          void startLiveCameraRef.current?.();
          return;
        }
        onScan({ kind: "parsed", parsed });
        onOpenChange(false);
      } catch {
        settledRef.current = false;
        setStatus(null);
        showManualEntryFallback();
        void startLiveCameraRef.current?.();
      } finally {
        decodeBusyRef.current = false;
      }
    },
    [onOpenChange, onScan, showManualEntryFallback, stopCamera],
  );

  const acceptSmartIdImmediately = useCallback(
    (raw: string) => {
      if (settledRef.current || decodeBusyRef.current) return;
      try {
        if (!isSmartIdPipePayload(raw)) return;
        settledRef.current = true;
        stopCamera();
        onScan({ kind: "raw", value: raw });
        onOpenChange(false);
      } catch {
        showManualEntryFallback();
      }
    },
    [onOpenChange, onScan, showManualEntryFallback, stopCamera],
  );

  const tryAcceptIdentityScan = useCallback(() => {
    if (settledRef.current || decodeBusyRef.current || scanKind !== "id") return;

    try {
      const best = pickBestBarcodePayload(
        samplesRef.current.map((s) => ({ rawValue: s.rawValue, format: s.format })),
      );
      if (!best || !isSafeLiveBarcodeValue(best)) return;

      const elapsed = Date.now() - startedAtRef.current;
      const smartId = isSmartIdPipePayload(best);

      if (smartId) {
        settledRef.current = true;
        stopCamera();
        onScan({ kind: "raw", value: best });
        onOpenChange(false);
        return;
      }

      const digitsOnly = best.replace(/\D/g, "");
      if (elapsed >= 4_000 && digitsOnly.length === 13 && best.length <= 14) {
        settledRef.current = true;
        stopCamera();
        onScan({ kind: "raw", value: best });
        onOpenChange(false);
        return;
      }
      if (elapsed >= 2_000 && digitsOnly.length === 13) {
        setStatus("Only the small barcode was read — centre the large square PDF417 on a Smart ID.");
      }
    } catch {
      showManualEntryFallback();
    }
  }, [onOpenChange, onScan, showManualEntryFallback, scanKind, stopCamera]);

  const tryAcceptDiscScan = useCallback(() => {
    if (settledRef.current) return;
    try {
      const best = pickBestBarcodePayload(
        samplesRef.current.map((s) => ({ rawValue: s.rawValue, format: s.format })),
      );
      if (!best) return;
      settledRef.current = true;
      stopCamera();
      onScan(best);
      onOpenChange(false);
    } catch {
      showManualEntryFallback();
    }
  }, [onOpenChange, onScan, showManualEntryFallback, stopCamera]);

  const recordIdentityHits = useCallback(
    (
      hits: Array<{ rawValue: string; format?: string }>,
      sawEncryptedLicence: boolean,
      smartIdHit: { rawValue: string; format?: string } | null,
    ) => {
      if (settledRef.current || decodeBusyRef.current || scanKind !== "id") return;

      if (smartIdHit) {
        acceptSmartIdImmediately(smartIdHit.rawValue);
        return;
      }

      if (sawEncryptedLicence) showLicencePhotoHint();

      try {
        const now = Date.now();
        for (const hit of hits) {
          const raw = hit.rawValue?.trim();
          if (!raw || !isSafeLiveBarcodeValue(raw)) continue;
          samplesRef.current.push({ rawValue: raw, format: hit.format, at: now });
        }
        samplesRef.current = samplesRef.current
          .filter((s) => now - s.at < 4_000)
          .slice(-12);
        tryAcceptIdentityScan();
      } catch {
        showManualEntryFallback();
      }
    },
    [acceptSmartIdImmediately, scanKind, showLicencePhotoHint, showManualEntryFallback, tryAcceptIdentityScan],
  );

  const recordDiscHits = useCallback(
    (hits: Array<{ rawValue: string; format?: string }>) => {
      if (settledRef.current) return;
      try {
        const now = Date.now();
        for (const hit of hits) {
          const raw = hit.rawValue?.trim();
          if (!raw) continue;
          samplesRef.current.push({ rawValue: raw, format: hit.format, at: now });
        }
        samplesRef.current = samplesRef.current
          .filter((s) => now - s.at < 4_000)
          .slice(-12);
        tryAcceptDiscScan();
      } catch {
        showManualEntryFallback();
      }
    },
    [showManualEntryFallback, tryAcceptDiscScan],
  );

  const tryDecodeNationalIdPhoto = useCallback(
    async (file: File): Promise<boolean> => {
      try {
        const scanner = ensureFileScanner();
        const hits = await decodeBarcodesFromFile(file, scanner, false);

        for (const hit of hits) {
          try {
            const raw = hit.rawValue?.trim();
            if (raw && isSmartIdPipePayload(raw)) {
              settledRef.current = true;
              stopCamera();
              onScan({ kind: "raw", value: raw });
              onOpenChange(false);
              return true;
            }
          } catch {
            /* next hit */
          }
        }

        recordIdentityHits(hits, false, null);
        if (samplesRef.current.length > 0) {
          tryAcceptIdentityScan();
          return settledRef.current;
        }
      } catch {
        /* fall through */
      }
      return false;
    },
    [
      ensureFileScanner,
      onOpenChange,
      onScan,
      recordIdentityHits,
      stopCamera,
      tryAcceptIdentityScan,
    ],
  );

  /** Driver's licence: server-side decode only — never run client PDF417 (crashes WebView). */
  const tryDecodeLicencePhotoServerOnly = useCallback(
    async (file: Blob): Promise<boolean> => {
      try {
        await finishDriversLicenceFromImage(file);
        return settledRef.current;
      } catch {
        return false;
      }
    },
    [finishDriversLicenceFromImage],
  );

  const tryDecodeIdentityPhoto = useCallback(
    async (file: File): Promise<boolean> => {
      if (isLicenceOnlyMode) {
        return tryDecodeLicencePhotoServerOnly(file);
      }
      return tryDecodeNationalIdPhoto(file);
    },
    [isLicenceOnlyMode, tryDecodeLicencePhotoServerOnly, tryDecodeNationalIdPhoto],
  );

  const pauseForPicker = useCallback(() => {
    pickerActiveRef.current = true;
    stopCamera();
  }, [stopCamera]);

  const scheduleResumeIfPickerCancelled = useCallback(() => {
    window.setTimeout(() => {
      if (!pickerActiveRef.current || settledRef.current || !openRef.current) return;
      pickerActiveRef.current = false;
      void startLiveCameraRef.current?.();
    }, 12_000);
  }, []);

  const openCameraPicker = useCallback(() => {
    pauseForPicker();
    cameraInputRef.current?.click();
    scheduleResumeIfPickerCancelled();
  }, [pauseForPicker, scheduleResumeIfPickerCancelled]);

  const openGalleryPicker = useCallback(() => {
    pauseForPicker();
    galleryInputRef.current?.click();
    scheduleResumeIfPickerCancelled();
  }, [pauseForPicker, scheduleResumeIfPickerCancelled]);

  const handlePhotoSelected = useCallback(
    async (file: File | undefined) => {
      pickerActiveRef.current = false;
      if (!file || settledRef.current) {
        if (openRef.current && !settledRef.current) {
          void startLiveCameraRef.current?.();
        }
        return;
      }
      setPhotoScanning(true);
      setError(null);
      setStatus(
        isLicenceOnlyMode
          ? "Sending photo to server to read driver's licence…"
          : "Reading barcode from photo…",
      );
      try {
        const ok =
          scanKind === "id"
            ? await tryDecodeIdentityPhoto(file)
            : await (async () => {
                try {
                  const scanner = ensureFileScanner();
                  const hits = await decodeBarcodesFromFile(file, scanner, true);
                  recordDiscHits(hits);
                  return hits.length > 0 && settledRef.current;
                } catch {
                  return false;
                }
              })();
        if (!ok && !settledRef.current) {
          showManualEntryFallback();
          void startLiveCameraRef.current?.();
        }
      } finally {
        setPhotoScanning(false);
      }
    },
    [ensureFileScanner, isLicenceOnlyMode, recordDiscHits, scanKind, showManualEntryFallback, tryDecodeIdentityPhoto],
  );

  useEffect(() => {
    if (!open) {
      stopCamera();
      setError(null);
      setManual("");
      setHint(null);
      setStatus(null);
      setPermissionBlocked(false);
      setPhotoScanning(false);
      setLicencePhotoRequired(false);
      setShowManualFallback(false);
      pickerActiveRef.current = false;
      licenceHintShownRef.current = false;
      samplesRef.current = [];
      settledRef.current = false;
      return;
    }

    let cancelled = false;
    settledRef.current = false;
    licenceHintShownRef.current = false;
    samplesRef.current = [];
    startedAtRef.current = Date.now();

    if (isLicenceOnlyMode) {
      setHint(
        "Photograph the back of the card so the large PDF417 barcode is sharp and well lit.",
      );
      setStatus("Tap Take photo (opens your camera app) or choose Gallery — no live scanning.");
      startLiveCameraRef.current = null;
    } else if (scanKind === "id") {
      setHint(
        "Hold a Smart ID or ID book in the green frame for 2–3 seconds. For a driver's licence, use Scan licence.",
      );
      setStatus("Scanning… hold the card steady.");
    } else {
      setHint("Centre the licence disc barcode in the frame.");
      setStatus("Hold steady for 2–3 seconds.");
    }

    let detector: BarcodeDetectorLike | null = null;
    if (!isLicenceOnlyMode) {
      try {
        const detectorFormats = scanKind === "disc" ? DISC_DETECTOR_FORMATS : ID_DETECTOR_FORMATS;
        if (typeof window.BarcodeDetector !== "undefined") {
          detector = new window.BarcodeDetector({ formats: detectorFormats });
        }
      } catch {
        detector = null;
      }
    }

    const runLiveDetect = (activeVideo: HTMLVideoElement) => {
      if (cancelled || settledRef.current || pickerActiveRef.current || decodeBusyRef.current || !detector) {
        return;
      }
      if (activeVideo.readyState < 2) return;

      const now = Date.now();
      if (now - lastLiveDetectRef.current < LIVE_DETECT_MIN_INTERVAL_MS) return;
      lastLiveDetectRef.current = now;

      void detector
        .detect(activeVideo)
        .then((codes) => {
          try {
            if (scanKind === "disc") {
              const discHits: Array<{ rawValue: string; format?: string }> = [];
              for (const code of codes) {
                try {
                  const raw = code.rawValue?.trim();
                  if (raw) discHits.push({ rawValue: raw, format: code.format });
                } catch {
                  /* skip frame */
                }
              }
              recordDiscHits(discHits);
            } else {
              const { safeHits, sawEncryptedLicence, smartIdHit } = processLiveDetectorCodes(codes);
              recordIdentityHits(safeHits, sawEncryptedLicence, smartIdHit);
            }
          } catch {
            showManualEntryFallback();
          }
        })
        .catch(() => {
          /* skip frame */
        });
    };

    const startLiveCamera = async () => {
      await delay(300);
      if (cancelled || pickerActiveRef.current) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled || pickerActiveRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        video.srcObject = stream;
        await video.play();
        if (!cancelled) setScanning(true);

        if (detector) {
          const tick = () => {
            if (cancelled || settledRef.current || pickerActiveRef.current || decodeBusyRef.current) return;
            const activeVideo = videoRef.current;
            if (!activeVideo) return;
            runLiveDetect(activeVideo);
            if (!cancelled && !settledRef.current && !decodeBusyRef.current) {
              rafRef.current = requestAnimationFrame(tick);
            }
          };
          rafRef.current = requestAnimationFrame(tick);
        }
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setPermissionBlocked(true);
          setError("Camera blocked — allow Camera in app settings, or use Take photo / Gallery.");
        } else {
          setError("Camera unavailable — use Take photo or Gallery below.");
        }
        setStatus(null);
      }
    };

    startLiveCameraRef.current = startLiveCamera;
    if (!isLicenceOnlyMode) {
      void startLiveCamera();
    }

    const poll = window.setInterval(() => {
      if (cancelled || settledRef.current || decodeBusyRef.current || isLicenceOnlyMode) return;
      try {
        if (scanKind === "disc") tryAcceptDiscScan();
        else tryAcceptIdentityScan();
      } catch {
        showManualEntryFallback();
      }
    }, 400);

    return () => {
      cancelled = true;
      startLiveCameraRef.current = null;
      window.clearInterval(poll);
      stopCamera();
    };
  }, [
    acceptSmartIdImmediately,
    isLicenceOnlyMode,
    open,
    recordDiscHits,
    recordIdentityHits,
    scanKind,
    showManualEntryFallback,
    stopCamera,
    tryAcceptDiscScan,
    tryAcceptIdentityScan,
  ]);

  useEffect(() => {
    return () => {
      const scanner = fileScannerRef.current;
      fileScannerRef.current = null;
      if (scanner) {
        try {
          scanner.clear();
        } catch { /* ignore */ }
      }
    };
  }, []);

  const closeForManualEntry = useCallback(() => {
    stopCamera();
    setShowManualFallback(true);
    onOpenChange(false);
  }, [onOpenChange, stopCamera]);

  const captureAndDecodeLicence = useCallback(async () => {
    if (photoScanning || settledRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      setError("Camera not ready — wait a moment and try again.");
      return;
    }
    setPhotoScanning(true);
    setError(null);
    setStatus("Capturing photo for decoding…");
    try {
      const frame = await captureVideoFrameAsJpeg(video);
      if (!frame) {
        showManualEntryFallback();
        return;
      }
      const ok = await tryDecodeLicencePhotoServerOnly(frame);
      if (!ok && !settledRef.current) {
        showManualEntryFallback();
      }
    } catch {
      showManualEntryFallback();
    } finally {
      if (!settledRef.current) setPhotoScanning(false);
    }
  }, [photoScanning, showManualEntryFallback, tryDecodeLicencePhotoServerOnly]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden" hideDefaultClose>
        <div id={HIDDEN_SCANNER_ID} aria-hidden className="fixed -left-[9999px] h-1 w-1" />
        <input
          ref={cameraInputRef}
          id="ac-scan-camera-input"
          type="file"
          accept="image/*"
          capture="environment"
          className={FILE_INPUT_CLASS}
          onChange={(e) => {
            try {
              const file = e.target.files?.[0];
              void handlePhotoSelected(file);
            } catch {
              showManualEntryFallback();
            }
            e.target.value = "";
          }}
        />
        <input
          ref={galleryInputRef}
          id="ac-scan-gallery-input"
          type="file"
          accept="image/*"
          className={FILE_INPUT_CLASS}
          onChange={(e) => {
            try {
              const file = e.target.files?.[0];
              void handlePhotoSelected(file);
            } catch {
              showManualEntryFallback();
            }
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
          {isLicenceOnlyMode ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-white">
              <Camera className="h-12 w-12 text-primary opacity-90" />
              <p className="text-sm font-medium">Driver&apos;s licence photo</p>
              <p className="text-xs text-white/70">
                Photograph the back of the licence with the large barcode in focus.
              </p>
              <div className="pointer-events-none absolute inset-6 border-2 border-primary rounded-lg" />
            </div>
          ) : (
            <>
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
            </>
          )}
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
            <Button
              type="button"
              variant={isLicenceOnlyMode || licencePhotoRequired ? "default" : "outline"}
              className="flex-1"
              disabled={photoScanning}
              onClick={() => {
                if (isLicenceOnlyMode) openCameraPicker();
                else if (licencePhotoRequired && scanKind === "id") void captureAndDecodeLicence();
                else openCameraPicker();
              }}
            >
              <Camera className="h-4 w-4 mr-1" />
              {photoScanning
                ? "Reading…"
                : isLicenceOnlyMode
                  ? "Take photo"
                  : licencePhotoRequired
                    ? "Take photo now"
                    : "Take photo"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={photoScanning}
              onClick={openGalleryPicker}
            >
              <ImageIcon className="h-4 w-4 mr-1" />
              Gallery
            </Button>
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
          {scanKind === "id" && showManualFallback && (
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
                Automated scan could not read this card. Enter name and ID on the form, or paste barcode text above.
              </p>
            </>
          )}
          <div className="flex gap-2">
            {scanKind === "id" && showManualFallback && (
              <Button
                type="button"
                className="flex-1"
                disabled={!manual.trim()}
                onClick={() => {
                  try {
                    const value = manual.trim();
                    onScan({ kind: "raw", value });
                    onOpenChange(false);
                  } catch {
                    showManualEntryFallback();
                  }
                }}
              >
                Use code
              </Button>
            )}
            {!showManualFallback && scanKind === "id" && !isLicenceOnlyMode && (
              <Button
                type="button"
                variant="ghost"
                className="flex-1 text-xs"
                onClick={() => setShowManualFallback(true)}
              >
                Enter manually
              </Button>
            )}
            {(showManualFallback || isLicenceOnlyMode) && (
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={closeForManualEntry}
              >
                Close — type on form
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
