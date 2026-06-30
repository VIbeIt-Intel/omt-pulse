import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScanLine, X } from "lucide-react";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
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
  onScan: (value: string) => void;
};

/** Camera barcode scan — BarcodeDetector on supported Android; manual entry always available. */
export function BarcodeScanner({ open, onOpenChange, title, onScan }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [scanning, setScanning] = useState(false);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setError(null);
      setManual("");
      return;
    }

    let cancelled = false;
    const detector =
      typeof window.BarcodeDetector !== "undefined"
        ? new window.BarcodeDetector({
            formats: ["code_128", "code_39", "ean_13", "qr_code", "pdf417", "data_matrix"],
          })
        : null;

    void (async () => {
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
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setScanning(true);

        if (!detector) {
          setError("Point camera at barcode — or type the code below.");
          return;
        }

        const tick = async () => {
          if (cancelled || !videoRef.current || videoRef.current.readyState < 2) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          try {
            const codes = await detector.detect(videoRef.current);
            const hit = codes[0]?.rawValue?.trim();
            if (hit) {
              onScan(hit);
              onOpenChange(false);
              return;
            }
          } catch {
            /* frame skip */
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        setError("Camera unavailable — enter the code manually below.");
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, onOpenChange, onScan, stopCamera]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ScanLine className="h-5 w-5" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="relative aspect-[4/3] bg-black">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
          />
          {!scanning && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
              Starting camera…
            </div>
          )}
          <div className="pointer-events-none absolute inset-8 border-2 border-primary/80 rounded-lg" />
        </div>
        <div className="p-4 space-y-3">
          {error && <p className="text-xs text-muted-foreground">{error}</p>}
          <input
            type="text"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Type ID or licence disc number"
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
