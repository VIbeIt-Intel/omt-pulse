import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Camera, ScanLine, Settings, X } from "lucide-react";
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
  type Html5QrcodeResult,
} from "html5-qrcode";
import { Capacitor } from "@capacitor/core";
import {
  isSmartIdPipePayload,
  pickBestBarcodePayload,
} from "@/lib/pick-best-barcode";
import { isSadlEncryptedString } from "@/lib/sa-drivers-licence";
import { openOmtAppDetailsSettings } from "@/lib/omt-app-settings";
import {
  NativeSettings,
  AndroidSettings,
  IOSSettings,
} from "capacitor-native-settings";

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
  /** id = Smart ID PDF417 on back; disc = vehicle licence disc */
  scanKind?: "id" | "disc";
  onScan: (value: string) => void;
};

type ScanSample = { rawValue: string; format?: string; at: number };

const HIDDEN_SCANNER_ID = "ac-barcode-file-scanner";

const ID_FORMATS = [
  Html5QrcodeSupportedFormats.PDF_417,
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
];

const DISC_FORMATS = [
  Html5QrcodeSupportedFormats.PDF_417,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
];

const BARCODE_DETECTOR_FORMATS = [
  "pdf417",
  "qr_code",
  "code_128",
  "code_39",
  "ean_13",
  "data_matrix",
  "aztec",
];

function formatName(result: Html5QrcodeResult): string | undefined {
  const fmt = result.result.format;
  if (typeof fmt === "object" && fmt !== null && "formatName" in fmt) {
    return String((fmt as { formatName?: string }).formatName ?? "");
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

function captureVideoFrameFile(video: HTMLVideoElement): File | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const base64 = dataUrl.split(",")[1];
  if (!base64) return null;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new File([bytes], "frame.jpg", { type: "image/jpeg" });
}

/**
 * Camera scanner for access control.
 * Live preview uses getUserMedia (reliable in Capacitor WebView).
 * PDF417 decode uses BarcodeDetector when available, with html5-qrcode frame/photo fallback.
 */
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
  const photoInputRef = useRef<HTMLInputElement>(null);
  const samplesRef = useRef<ScanSample[]>([]);
  const startedAtRef = useRef(0);
  const settledRef = useRef(false);
  const lastHtml5ScanRef = useRef(0);

  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [scanning, setScanning] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [photoScanning, setPhotoScanning] = useState(false);

  const formats = scanKind === "id" ? ID_FORMATS : DISC_FORMATS;

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const tryAcceptScan = useCallback(() => {
    if (settledRef.current) return;
    const best = pickBestBarcodePayload(
      samplesRef.current.map((s) => ({ rawValue: s.rawValue, format: s.format })),
    );
    if (!best) return;

    const elapsed = Date.now() - startedAtRef.current;
    const smartId = isSmartIdPipePayload(best);

    if (scanKind === "id") {
      const sadl = isSadlEncryptedString(best);
      if (smartId || sadl) {
        settledRef.current = true;
        onScan(best);
        onOpenChange(false);
        return;
      }
      if (elapsed >= 5_000 && best.replace(/\D/g, "").length === 13) {
        settledRef.current = true;
        onScan(best);
        onOpenChange(false);
      }
      return;
    }

    settledRef.current = true;
    onScan(best);
    onOpenChange(false);
  }, [onOpenChange, onScan, scanKind]);

  const recordSample = useCallback((rawValue: string, format?: string) => {
    const raw = rawValue.trim();
    if (!raw || settledRef.current) return;
    const now = Date.now();
    samplesRef.current.push({ rawValue: raw, format, at: now });
    samplesRef.current = samplesRef.current.filter((s) => now - s.at < 3_000);
    tryAcceptScan();
  }, [tryAcceptScan]);

  const ensureFileScanner = useCallback(() => {
    if (fileScannerRef.current) return fileScannerRef.current;
    const el = document.getElementById(HIDDEN_SCANNER_ID);
    if (!el) return null;
    const scanner = new Html5Qrcode(HIDDEN_SCANNER_ID, {
      verbose: false,
      formatsToSupport: formats,
    });
    fileScannerRef.current = scanner;
    return scanner;
  }, [formats]);

  const decodeImageFile = useCallback(async (file: File): Promise<boolean> => {
    const scanner = ensureFileScanner();
    if (!scanner) return false;
    try {
      const result = await scanner.scanFileV2(file, false);
      recordSample(result.decodedText, formatName(result));
      return true;
    } catch {
      return false;
    }
  }, [ensureFileScanner, recordSample]);

  const handlePhotoSelected = useCallback(async (file: File | undefined) => {
    if (!file || settledRef.current) return;
    setPhotoScanning(true);
    setError(null);
    try {
      const ok = await decodeImageFile(file);
      if (!ok && !settledRef.current) {
        setError("No barcode found in that photo — try again with the PDF417 in focus.");
      }
    } finally {
      setPhotoScanning(false);
    }
  }, [decodeImageFile]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setError(null);
      setManual("");
      setHint(null);
      setPermissionBlocked(false);
      setPhotoScanning(false);
      samplesRef.current = [];
      settledRef.current = false;
      return;
    }

    let cancelled = false;
    settledRef.current = false;
    samplesRef.current = [];
    startedAtRef.current = Date.now();
    lastHtml5ScanRef.current = 0;

    setHint(
      scanKind === "id"
        ? "Scan the large square PDF417 on the back of a Smart ID or driver's licence — not the small line barcode."
        : "Centre the licence disc barcode in the frame.",
    );

    const detector =
      typeof window.BarcodeDetector !== "undefined"
        ? new window.BarcodeDetector({ formats: BARCODE_DETECTOR_FORMATS })
        : null;

    void (async () => {
      await delay(350);
      if (cancelled) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
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

        const tick = async () => {
          if (cancelled || settledRef.current) return;
          const activeVideo = videoRef.current;
          if (!activeVideo || activeVideo.readyState < 2) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          if (detector) {
            try {
              const codes = await detector.detect(activeVideo);
              for (const code of codes) {
                recordSample(code.rawValue, code.format);
                if (settledRef.current) return;
              }
            } catch {
              /* frame skip */
            }
          }

          const now = Date.now();
          if (now - lastHtml5ScanRef.current >= 700) {
            lastHtml5ScanRef.current = now;
            const frame = captureVideoFrameFile(activeVideo);
            if (frame) {
              await decodeImageFile(frame);
            }
          }

          if (!cancelled && !settledRef.current) {
            rafRef.current = requestAnimationFrame(tick);
          }
        };

        rafRef.current = requestAnimationFrame(tick);

        if (!detector) {
          setHint("Hold the PDF417 steady. If live scan is slow, tap Scan photo.");
        }
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setPermissionBlocked(true);
          setError("Camera permission is blocked for OMT Pulse. Allow Camera in app settings, or use Scan photo.");
        } else {
          setError("Camera unavailable — tap Scan photo or enter the code manually.");
        }
      }
    })();

    const poll = window.setInterval(() => {
      if (!cancelled && !settledRef.current) tryAcceptScan();
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      stopCamera();
    };
  }, [decodeImageFile, open, recordSample, scanKind, stopCamera, tryAcceptScan]);

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
    <>
      <div id={HIDDEN_SCANNER_ID} className="sr-only" aria-hidden />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          void handlePhotoSelected(file);
          e.target.value = "";
        }}
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-4 pb-2">
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
            <div className="pointer-events-none absolute inset-8 border-2 border-primary/80 rounded-lg" />
          </div>
          <div className="p-4 space-y-3">
            {hint && !error && (
              <p className="text-xs text-muted-foreground">{hint}</p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={photoScanning}
                onClick={() => photoInputRef.current?.click()}
              >
                <Camera className="h-4 w-4 mr-1" />
                {photoScanning ? "Scanning photo…" : "Scan photo"}
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
            <input
              type="text"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder={scanKind === "id" ? "Or paste full ID barcode text" : "Type licence disc code"}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              autoComplete="off"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                className="flex-1"
                disabled={!manual.trim()}
                onClick={() => {
                  onScan(manual.trim());
                  onOpenChange(false);
                }}
              >
                Use code
              </Button>
              <Button type="button" variant="outline" size="icon" onClick={() => onOpenChange(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
