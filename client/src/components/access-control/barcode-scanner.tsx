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
import { looksLikeSadlEncryptedString } from "@shared/sa-drivers-licence";
import { decodeDriversLicenceFromImageViaApi, decodeDriversLicenceViaApi } from "@/lib/decode-drivers-licence-api";
import type { AccessIdentityScanResult } from "@/lib/parse-sa-barcodes";
import {
  createHtml5FileScanner,
  decodeBarcodesFromFile,
  isLikelyBinaryPdf417,
  isSafeLiveBarcodeValue,
  PDF417_MANUAL_FALLBACK_MSG,
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
  onScan: (result: string | AccessIdentityScanResult) => void;
};

type ScanSample = { rawValue: string; format?: string; at: number };

const HIDDEN_SCANNER_ID = "ac-barcode-file-scanner";

const ID_DETECTOR_FORMATS = ["pdf417", "qr_code", "code_128", "code_39"];
const DISC_DETECTOR_FORMATS = ["pdf417", "code_128", "code_39", "qr_code"];

const LICENCE_PHOTO_HINT =
  "Driver's licence PDF417 detected. Tap Take photo or Gallery to read it safely, or enter details manually below.";

const FILE_INPUT_CLASS =
  "absolute left-0 top-0 h-px w-px overflow-hidden opacity-0 [clip:rect(0,0,0,0)]";

const LIVE_DETECT_INTERVAL_MS = 350;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function safeLooksLikeSadl(raw: string): boolean {
  try {
    return looksLikeSadlEncryptedString(raw);
  } catch {
    return false;
  }
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

/** Process live detector results without touching encrypted PDF417 payloads (WebView crash). */
function processLiveDetectorCodes(
  codes: Array<{ rawValue: string; format?: string }>,
): {
  safeHits: Array<{ rawValue: string; format?: string }>;
  sawBinaryPdf417: boolean;
} {
  const safeHits: Array<{ rawValue: string; format?: string }> = [];
  let sawBinaryPdf417 = false;

  for (const code of codes) {
    try {
      const format = code.format;
      let length = 0;
      try {
        length = code.rawValue?.length ?? 0;
      } catch {
        sawBinaryPdf417 = true;
        continue;
      }

      if (isLikelyBinaryPdf417(format, length)) {
        sawBinaryPdf417 = true;
        continue;
      }

      const raw = code.rawValue?.trim();
      if (raw && isSafeLiveBarcodeValue(raw)) {
        safeHits.push({ rawValue: raw, format });
      }
    } catch {
      sawBinaryPdf417 = true;
    }
  }

  return { safeHits, sawBinaryPdf417 };
}

export function BarcodeScanner({
  open,
  onOpenChange,
  title,
  scanKind = "id",
  onScan,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveDetectTimerRef = useRef<number>(0);
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

  openRef.current = open;

  const stopCamera = useCallback(() => {
    if (liveDetectTimerRef.current) window.clearInterval(liveDetectTimerRef.current);
    liveDetectTimerRef.current = 0;
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
    setStatus(LICENCE_PHOTO_HINT);
  }, []);

  const finishDriversLicence = useCallback(
    async (rawLatin1: string) => {
      if (decodeBusyRef.current || settledRef.current) return;
      decodeBusyRef.current = true;
      settledRef.current = true;
      stopCamera();
      setStatus("Reading driver's licence…");
      setError(null);
      try {
        const parsed = await decodeDriversLicenceViaApi(rawLatin1);
        if (!parsed?.personIdNumber && !parsed?.personFullName) {
          settledRef.current = false;
          setStatus(null);
          setError(PDF417_MANUAL_FALLBACK_MSG);
          void startLiveCameraRef.current?.();
          return;
        }
        onScan({ kind: "parsed", parsed });
        onOpenChange(false);
      } catch {
        settledRef.current = false;
        setStatus(null);
        setError(PDF417_MANUAL_FALLBACK_MSG);
        void startLiveCameraRef.current?.();
      } finally {
        decodeBusyRef.current = false;
      }
    },
    [onOpenChange, onScan, stopCamera],
  );

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
          setError(PDF417_MANUAL_FALLBACK_MSG);
          void startLiveCameraRef.current?.();
          return;
        }
        onScan({ kind: "parsed", parsed });
        onOpenChange(false);
      } catch {
        settledRef.current = false;
        setStatus(null);
        setError(PDF417_MANUAL_FALLBACK_MSG);
        void startLiveCameraRef.current?.();
      } finally {
        decodeBusyRef.current = false;
      }
    },
    [onOpenChange, onScan, stopCamera],
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
      setError(PDF417_MANUAL_FALLBACK_MSG);
    }
  }, [onOpenChange, onScan, scanKind, stopCamera]);

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
      setError(PDF417_MANUAL_FALLBACK_MSG);
    }
  }, [onOpenChange, onScan, stopCamera]);

  const recordIdentityHits = useCallback(
    (hits: Array<{ rawValue: string; format?: string }>, sawBinaryPdf417: boolean) => {
      if (settledRef.current || decodeBusyRef.current || scanKind !== "id") return;

      if (sawBinaryPdf417) showLicencePhotoHint();

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
        setError(PDF417_MANUAL_FALLBACK_MSG);
      }
    },
    [scanKind, showLicencePhotoHint, tryAcceptIdentityScan],
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
        setError(PDF417_MANUAL_FALLBACK_MSG);
      }
    },
    [tryAcceptDiscScan],
  );

  const tryDecodeIdentityPhoto = useCallback(
    async (file: File): Promise<boolean> => {
      try {
        await finishDriversLicenceFromImage(file);
        if (settledRef.current) return true;
      } catch {
        /* fall through */
      }

      try {
        const scanner = ensureFileScanner();
        const hits = await decodeBarcodesFromFile(file, scanner, true);

        for (const hit of hits) {
          try {
            const raw = hit.rawValue?.trim();
            if (raw && safeLooksLikeSadl(raw)) {
              await finishDriversLicence(raw);
              return settledRef.current;
            }
          } catch {
            /* try next hit */
          }
        }

        const safeHits = hits.filter((h) => isSafeLiveBarcodeValue(h.rawValue?.trim() ?? ""));
        recordIdentityHits(safeHits, false);
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
      finishDriversLicence,
      finishDriversLicenceFromImage,
      recordIdentityHits,
      tryAcceptIdentityScan,
    ],
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
      setStatus("Reading barcode from photo…");
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
          setError(PDF417_MANUAL_FALLBACK_MSG);
          setStatus(null);
          void startLiveCameraRef.current?.();
        }
      } catch {
        setError(PDF417_MANUAL_FALLBACK_MSG);
        setStatus(null);
        void startLiveCameraRef.current?.();
      } finally {
        setPhotoScanning(false);
      }
    },
    [ensureFileScanner, recordDiscHits, scanKind, tryDecodeIdentityPhoto],
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

    if (scanKind === "id") {
      setHint(
        "Smart ID: hold the large PDF417 in the green frame for 2–3 seconds. Driver's licence: use Take photo (live scan cannot read encrypted PDF417 safely).",
      );
      setStatus("Hold a Smart ID steady for 2–3 seconds.");
    } else {
      setHint("Centre the licence disc barcode in the frame.");
      setStatus("Hold steady for 2–3 seconds.");
    }

    let detector: BarcodeDetectorLike | null = null;
    try {
      const detectorFormats = scanKind === "disc" ? DISC_DETECTOR_FORMATS : ID_DETECTOR_FORMATS;
      if (typeof window.BarcodeDetector !== "undefined") {
        detector = new window.BarcodeDetector({ formats: detectorFormats });
      }
    } catch {
      detector = null;
    }

    const runLiveDetect = () => {
      if (cancelled || settledRef.current || pickerActiveRef.current || decodeBusyRef.current || !detector) {
        return;
      }
      const activeVideo = videoRef.current;
      if (!activeVideo || activeVideo.readyState < 2) return;

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
              const { safeHits, sawBinaryPdf417 } = processLiveDetectorCodes(codes);
              recordIdentityHits(safeHits, sawBinaryPdf417);
            }
          } catch {
            setError(PDF417_MANUAL_FALLBACK_MSG);
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
          liveDetectTimerRef.current = window.setInterval(runLiveDetect, LIVE_DETECT_INTERVAL_MS);
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
    void startLiveCamera();

    const poll = window.setInterval(() => {
      if (cancelled || settledRef.current || decodeBusyRef.current) return;
      try {
        if (scanKind === "disc") tryAcceptDiscScan();
        else tryAcceptIdentityScan();
      } catch {
        setError(PDF417_MANUAL_FALLBACK_MSG);
      }
    }, 400);

    return () => {
      cancelled = true;
      startLiveCameraRef.current = null;
      window.clearInterval(poll);
      stopCamera();
    };
  }, [
    open,
    recordDiscHits,
    recordIdentityHits,
    scanKind,
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
    onOpenChange(false);
  }, [onOpenChange, stopCamera]);

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
              setError(PDF417_MANUAL_FALLBACK_MSG);
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
              setError(PDF417_MANUAL_FALLBACK_MSG);
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
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={photoScanning}
              onClick={openCameraPicker}
            >
              <Camera className="h-4 w-4 mr-1" />
              {photoScanning ? "Reading…" : "Take photo"}
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
          {scanKind === "id" && (
            <>
              <input
                type="text"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Or paste Smart ID barcode text"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Driver&apos;s licence or scan failed? Enter name and ID on the form manually.
              </p>
            </>
          )}
          <div className="flex gap-2">
            {scanKind === "id" && (
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
                    setError(PDF417_MANUAL_FALLBACK_MSG);
                  }
                }}
              >
                Use code
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={closeForManualEntry}
            >
              Enter manually
            </Button>
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
