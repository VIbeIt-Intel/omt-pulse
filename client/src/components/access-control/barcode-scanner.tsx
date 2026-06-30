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

const FILE_INPUT_CLASS =
  "absolute left-0 top-0 h-px w-px overflow-hidden opacity-0 [clip:rect(0,0,0,0)]";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Skip long non-pipe payloads when hunting Smart ID only (pipe text is always safe). */
function isSmartIdCandidate(raw: string): boolean {
  if (raw.includes("|")) return true;
  if (raw.length <= 32) return true;
  return false;
}

async function openCameraPermissionSettings(): Promise<void> {
  if (await openOmtAppDetailsSettings()) return;
  const platform = Capacitor.getPlatform();
  if (platform === "android") {
    await NativeSettings.openAndroid({ option: AndroidSettings.ApplicationDetails });
    return;
  }
  if (platform === "ios") {
    await NativeSettings.openIOS({ option: IOSSettings.App });
  }
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
  const rafRef = useRef<number>(0);
  const fileScannerRef = useRef<Html5Qrcode | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const samplesRef = useRef<ScanSample[]>([]);
  const startedAtRef = useRef(0);
  const settledRef = useRef(false);
  const pickerActiveRef = useRef(false);
  const decodeBusyRef = useRef(false);
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
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const ensureFileScanner = useCallback(() => {
    if (fileScannerRef.current) return fileScannerRef.current;
    const el = document.getElementById(HIDDEN_SCANNER_ID);
    if (!el) return null;
    fileScannerRef.current = createHtml5FileScanner(HIDDEN_SCANNER_ID);
    return fileScannerRef.current;
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
          decodeBusyRef.current = false;
          setStatus(null);
          setError("Could not read driver's licence — hold the PDF417 sharper and try again.");
          void startLiveCameraRef.current?.();
          return;
        }
        onScan({ kind: "parsed", parsed });
        onOpenChange(false);
      } catch {
        settledRef.current = false;
        setStatus(null);
        setError("Could not read driver's licence — check your connection and try again.");
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
          decodeBusyRef.current = false;
          setStatus(null);
          setError("Could not read driver's licence — fill the frame with the PDF417 and keep it sharp.");
          void startLiveCameraRef.current?.();
          return;
        }
        onScan({ kind: "parsed", parsed });
        onOpenChange(false);
      } catch {
        settledRef.current = false;
        setStatus(null);
        setError("Could not read driver's licence — check your connection and try again.");
        void startLiveCameraRef.current?.();
      } finally {
        decodeBusyRef.current = false;
      }
    },
    [onOpenChange, onScan, stopCamera],
  );

  const tryAcceptIdentityScan = useCallback(() => {
    if (settledRef.current || decodeBusyRef.current || scanKind !== "id") return;

    const best = pickBestBarcodePayload(
      samplesRef.current.map((s) => ({ rawValue: s.rawValue, format: s.format })),
    );
    if (!best) return;

    if (looksLikeSadlEncryptedString(best)) {
      void finishDriversLicence(best);
      return;
    }

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
      setStatus("Only the small barcode was read — centre the large square PDF417.");
    }
  }, [finishDriversLicence, onOpenChange, onScan, scanKind, stopCamera]);

  const tryAcceptDiscScan = useCallback(() => {
    if (settledRef.current) return;
    const best = pickBestBarcodePayload(
      samplesRef.current.map((s) => ({ rawValue: s.rawValue, format: s.format })),
    );
    if (!best) return;
    settledRef.current = true;
    stopCamera();
    onScan(best);
    onOpenChange(false);
  }, [onOpenChange, onScan, stopCamera]);

  const recordIdentityHits = useCallback(
    (hits: Array<{ rawValue: string; format?: string }>) => {
      if (settledRef.current || decodeBusyRef.current || scanKind !== "id") return;

      for (const hit of hits) {
        const raw = hit.rawValue?.trim();
        if (raw && looksLikeSadlEncryptedString(raw)) {
          void finishDriversLicence(raw);
          return;
        }
      }

      const now = Date.now();
      for (const hit of hits) {
        const raw = hit.rawValue?.trim();
        if (!raw || !isSmartIdCandidate(raw)) continue;
        samplesRef.current.push({ rawValue: raw, format: hit.format, at: now });
      }
      samplesRef.current = samplesRef.current
        .filter((s) => now - s.at < 4_000)
        .slice(-12);
      tryAcceptIdentityScan();
    },
    [finishDriversLicence, scanKind, tryAcceptIdentityScan],
  );

  const recordDiscHits = useCallback(
    (hits: Array<{ rawValue: string; format?: string }>) => {
      if (settledRef.current) return;
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
    },
    [tryAcceptDiscScan],
  );

  const tryDecodeIdentityPhoto = useCallback(
    async (file: File): Promise<boolean> => {
      const scanner = ensureFileScanner();
      const hits = await decodeBarcodesFromFile(file, scanner);

      for (const hit of hits) {
        const raw = hit.rawValue?.trim();
        if (raw && looksLikeSadlEncryptedString(raw)) {
          await finishDriversLicence(raw);
          return settledRef.current;
        }
      }

      recordIdentityHits(hits);
      if (samplesRef.current.length > 0) {
        tryAcceptIdentityScan();
        return settledRef.current;
      }

      await finishDriversLicenceFromImage(file);
      return settledRef.current;
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
                const scanner = ensureFileScanner();
                const hits = await decodeBarcodesFromFile(file, scanner);
                recordDiscHits(hits);
                return hits.length > 0 && settledRef.current;
              })();
        if (!ok && !settledRef.current) {
          setError(
            scanKind === "id"
              ? "No barcode found — fill the frame with the large PDF417 on the back of the card."
              : "No barcode found — centre the licence disc barcode and keep it sharp.",
          );
          setStatus(null);
          void startLiveCameraRef.current?.();
        }
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
      samplesRef.current = [];
      settledRef.current = false;
      return;
    }

    let cancelled = false;
    settledRef.current = false;
    samplesRef.current = [];
    startedAtRef.current = Date.now();

    if (scanKind === "id") {
      setHint(
        "Fill the green frame with the large square PDF417 on the back of a Smart ID or driver's licence.",
      );
      setStatus("Hold the card steady for 2–3 seconds.");
    } else {
      setHint("Centre the licence disc barcode in the frame.");
      setStatus("Hold steady for 2–3 seconds.");
    }

    const detectorFormats = scanKind === "disc" ? DISC_DETECTOR_FORMATS : ID_DETECTOR_FORMATS;
    const detector =
      typeof window.BarcodeDetector !== "undefined"
        ? new window.BarcodeDetector({ formats: detectorFormats })
        : null;

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

        if (!detector) return;

        const tick = () => {
          if (cancelled || settledRef.current || pickerActiveRef.current || decodeBusyRef.current) {
            return;
          }
          const activeVideo = videoRef.current;
          if (!activeVideo || activeVideo.readyState < 2) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          void detector.detect(activeVideo).then((codes) => {
            if (scanKind === "disc") recordDiscHits(codes);
            else recordIdentityHits(codes);
          }).catch(() => { /* frame skip */ });

          if (!cancelled && !settledRef.current && !decodeBusyRef.current) {
            rafRef.current = requestAnimationFrame(tick);
          }
        };

        rafRef.current = requestAnimationFrame(tick);
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
      if (scanKind === "disc") tryAcceptDiscScan();
      else tryAcceptIdentityScan();
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
            const file = e.target.files?.[0];
            void handlePhotoSelected(file);
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
            const file = e.target.files?.[0];
            void handlePhotoSelected(file);
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
          {error && <p className="text-xs text-destructive">{error}</p>}
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
            <input
              type="text"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Or paste barcode text"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              autoComplete="off"
            />
          )}
          <div className="flex gap-2">
            {scanKind === "id" && (
              <Button
                type="button"
                className="flex-1"
                disabled={!manual.trim()}
                onClick={() => {
                  const value = manual.trim();
                  onScan({ kind: "raw", value });
                  onOpenChange(false);
                }}
              >
                Use code
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size={scanKind === "id" ? "icon" : "default"}
              className={scanKind === "disc" ? "flex-1" : ""}
              onClick={() => onOpenChange(false)}
            >
              {scanKind === "disc" ? "Cancel" : <X className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
