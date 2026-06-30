import { useEffect, useRef, useState, useCallback, useId } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScanLine, X } from "lucide-react";
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
  type Html5QrcodeResult,
} from "html5-qrcode";
import {
  isSmartIdPipePayload,
  pickBestBarcodePayload,
} from "@/lib/pick-best-barcode";
import { isSadlEncryptedString } from "@/lib/sa-drivers-licence";

type BarcodeScannerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** id = Smart ID PDF417 on back; disc = vehicle licence disc */
  scanKind?: "id" | "disc";
  onScan: (value: string) => void;
};

type ScanSample = { rawValue: string; format?: string; at: number };

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

function formatName(result: Html5QrcodeResult): string | undefined {
  const fmt = result.result.format;
  if (typeof fmt === "object" && fmt !== null && "formatName" in fmt) {
    return String((fmt as { formatName?: string }).formatName ?? "");
  }
  return undefined;
}

/**
 * Camera scanner — html5-qrcode for reliable PDF417 (Smart ID back).
 * Buffers frames and prefers pipe-delimited ID payloads over 13-digit-only reads.
 */
export function BarcodeScanner({
  open,
  onOpenChange,
  title,
  scanKind = "id",
  onScan,
}: BarcodeScannerProps) {
  const reactId = useId();
  const regionId = `ac-scanner-${reactId.replace(/:/g, "")}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const samplesRef = useRef<ScanSample[]>([]);
  const startedAtRef = useRef(0);
  const settledRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [scanning, setScanning] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try {
        if (scanner.isScanning) await scanner.stop();
      } catch { /* ignore */ }
      try {
        scanner.clear();
      } catch { /* ignore */ }
    }
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

  useEffect(() => {
    if (!open) {
      void stopCamera();
      setError(null);
      setManual("");
      setHint(null);
      samplesRef.current = [];
      settledRef.current = false;
      return;
    }

    let cancelled = false;
    settledRef.current = false;
    samplesRef.current = [];
    startedAtRef.current = Date.now();

    setHint(
      scanKind === "id"
        ? "Scan the large square PDF417 on the back of a Smart ID or driver's licence — not the small line barcode."
        : "Centre the licence disc barcode in the frame.",
    );

    void (async () => {
      try {
        const scanner = new Html5Qrcode(regionId, {
          verbose: false,
          formatsToSupport: scanKind === "id" ? ID_FORMATS : DISC_FORMATS,
        });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            aspectRatio: 1.333,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const width = Math.floor(Math.min(viewfinderWidth * 0.92, 380));
              const height = Math.floor(
                Math.min(viewfinderHeight * (scanKind === "id" ? 0.62 : 0.5), 260),
              );
              return { width, height };
            },
          },
          (decodedText, decodedResult) => {
            if (cancelled || settledRef.current) return;
            const raw = decodedText.trim();
            if (!raw) return;
            const now = Date.now();
            samplesRef.current.push({
              rawValue: raw,
              format: formatName(decodedResult),
              at: now,
            });
            samplesRef.current = samplesRef.current.filter((s) => now - s.at < 3_000);
            tryAcceptScan();
          },
          () => { /* per-frame miss */ },
        );
        if (!cancelled) setScanning(true);
      } catch {
        if (!cancelled) {
          setError("Camera unavailable — enter the code manually below.");
        }
      }
    })();

    const poll = window.setInterval(() => {
      if (!cancelled && !settledRef.current) tryAcceptScan();
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      void stopCamera();
    };
  }, [open, scanKind, stopCamera, tryAcceptScan]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ScanLine className="h-5 w-5" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="relative aspect-[4/3] bg-black overflow-hidden">
          <div id={regionId} className="h-full w-full" />
          {!scanning && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-sm px-6 text-center">
              Starting camera…
            </div>
          )}
        </div>
        <div className="p-4 space-y-3">
          {hint && !error && (
            <p className="text-xs text-muted-foreground">{hint}</p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
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
  );
}
