import { useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Camera, ImageIcon, ScanLine, X } from "lucide-react";
import type { AccessIdentityScanResult, ParsedSaId } from "@/lib/parse-sa-barcodes";
import type { AccessScanMethod } from "@shared/access-scan-data";
import { readLicenceFrontFromPhoto } from "@/lib/licence-front-ocr";
import { decodeLicenceBackFromPhoto } from "@/lib/decode-licence-back-photo";
import {
  BINARY_EYE_PLAY_URL,
  canUseBinaryEyeScanner,
  describeBinaryEyeFailure,
  isBinaryEyeInstalled,
  scanDriversLicenceViaBinaryEye,
} from "@/lib/binary-eye-scanner";
import { useToast } from "@/hooks/use-toast";
import { APP_CACHE_VERSION } from "@shared/cache-version";

type LicenceFrontScannerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (result: AccessIdentityScanResult) => void;
};

const FILE_INPUT_CLASS =
  "absolute left-0 top-0 h-px w-px overflow-hidden opacity-0 [clip:rect(0,0,0,0)]";

/** Brief pause so the modal overlay is gone before camera / heavy work. */
function waitForDialogToClose(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 250));
}

type PhotoKind = "back" | "front";

export function LicenceFrontScanner({
  open,
  onOpenChange,
  onScan,
}: LicenceFrontScannerProps) {
  const backCameraRef = useRef<HTMLInputElement>(null);
  const backGalleryRef = useRef<HTMLInputElement>(null);
  const frontCameraRef = useRef<HTMLInputElement>(null);
  const frontGalleryRef = useRef<HTMLInputElement>(null);
  const externalScanRef = useRef(false);

  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [binaryEyeMissing, setBinaryEyeMissing] = useState(false);

  const reset = useCallback(() => {
    setBusy(false);
    setStatus(null);
    setError(null);
    setBinaryEyeMissing(false);
    externalScanRef.current = false;
  }, []);

  const settle = useCallback(
    (parsed: ParsedSaId, scanMethod?: AccessScanMethod) => {
      onScan({ kind: "parsed", parsed, scanMethod });
      onOpenChange(false);
      reset();
    },
    [onOpenChange, onScan, reset],
  );

  const runLiveBarcodeScan = useCallback(async () => {
    if (busy || externalScanRef.current) return;

    if (!canUseBinaryEyeScanner()) {
      setError(
        "Live barcode scan needs the latest OMT Pulse app. Install Binary Eye from Play Store, or take a photo of the back of the card.",
      );
      return;
    }

    const installed = await isBinaryEyeInstalled();
    if (!installed) {
      setBinaryEyeMissing(true);
      setError(
        "Install Binary Eye from Play Store to scan the licence barcode, or take a photo of the back of the card.",
      );
      return;
    }

    externalScanRef.current = true;
    setBusy(true);
    setError(null);
    setBinaryEyeMissing(false);

    onOpenChange(false);
    await waitForDialogToClose();

    try {
      const binaryEye = await scanDriversLicenceViaBinaryEye();
      if (binaryEye.ok) {
        settle(binaryEye.parsed, "barcode");
        return;
      }

      if (binaryEye.reason === "cancelled") {
        toast({
          title: "Scan cancelled",
          description: "Tap Scan licence again, or use Photo of front for name + ID.",
        });
        onOpenChange(true);
        return;
      }

      toast({
        title: "Could not read licence barcode",
        description: describeBinaryEyeFailure(binaryEye),
        variant: "destructive",
      });
      onOpenChange(true);
    } finally {
      externalScanRef.current = false;
      setBusy(false);
    }
  }, [busy, onOpenChange, settle, toast]);

  const processPhotoFile = useCallback(
    async (file: File, kind: PhotoKind) => {
      if (externalScanRef.current) return;

      externalScanRef.current = true;
      setBusy(true);
      setError(null);

      // Close the modal before camera return / OCR — Tesseract in WebView crashed Android.
      onOpenChange(false);
      await waitForDialogToClose();

      const toastTitle = kind === "front" ? "Reading front of card…" : "Reading back barcode…";
      const toastDescription =
        kind === "back"
          ? "Up to about a minute — hold steady with the PDF417 on the right in bright light."
          : "This may take up to half a minute.";
      toast({ title: toastTitle, description: toastDescription });

      try {
        if (kind === "back") {
          const parsed = await decodeLicenceBackFromPhoto(file);
          if (parsed?.personIdNumber || parsed?.personFullName) {
            settle(parsed, "ocr_back");
            return;
          }
          toast({
            title: "No barcode in photo",
            description:
              "Fill the frame with the back of the card, PDF417 barcode on the right, bright light, minimal glare. Or use Photo of front for name + ID.",
            variant: "destructive",
          });
        } else {
          const result = await readLicenceFrontFromPhoto(file);
          if (result.ok) {
            settle(result.parsed, "ocr_front");
            return;
          }
          toast({
            title: "Could not read front of card",
            description: result.message,
            variant: "destructive",
          });
        }

        onOpenChange(true);
      } catch {
        toast({
          title: "Photo scan failed",
          description: "Try again or type the details on the form.",
          variant: "destructive",
        });
        onOpenChange(true);
      } finally {
        externalScanRef.current = false;
        setBusy(false);
        setStatus(null);
      }
    },
    [onOpenChange, settle, toast],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (externalScanRef.current) return;
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset],
  );

  return (
    <>
      {/* Inputs live outside the dialog so they stay mounted when the modal closes. */}
      <input
        ref={backCameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className={FILE_INPUT_CLASS}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void processPhotoFile(file, "back");
          e.target.value = "";
        }}
      />
      <input
        ref={backGalleryRef}
        type="file"
        accept="image/*"
        className={FILE_INPUT_CLASS}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void processPhotoFile(file, "back");
          e.target.value = "";
        }}
      />
      <input
        ref={frontCameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className={FILE_INPUT_CLASS}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void processPhotoFile(file, "front");
          e.target.value = "";
        }}
      />
      <input
        ref={frontGalleryRef}
        type="file"
        accept="image/*"
        className={FILE_INPUT_CLASS}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void processPhotoFile(file, "front");
          e.target.value = "";
        }}
      />

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden" hideDefaultClose>
          <DialogHeader className="p-4 pb-2 pr-12">
            <DialogTitle className="flex items-center gap-2 text-base">
              <ScanLine className="h-5 w-5" />
              Scan driver&apos;s licence
            </DialogTitle>
          </DialogHeader>

          <div className="mx-4 mb-2 flex aspect-[4/3] items-center justify-center rounded-lg border-2 border-dashed border-primary/40 bg-muted/30 px-4 text-center">
            <p className="text-sm text-muted-foreground">
              Through plastic sleeves, use <strong>Photo of front</strong> for the ID number, or{" "}
              <strong>Binary Eye</strong> for the back barcode ({APP_CACHE_VERSION}).
            </p>
          </div>

          <div className="p-4 space-y-3">
            {status && !error && (
              <p className="text-xs text-primary font-medium">{status}</p>
            )}
            {error && (
              <p className="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                {error}
              </p>
            )}

            {binaryEyeMissing && (
              <p className="text-xs text-muted-foreground rounded-md border px-3 py-2">
                Install{" "}
                <a
                  href={BINARY_EYE_PLAY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Binary Eye
                </a>{" "}
                from Play Store for the most reliable scan through plastic sleeves.
              </p>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="default"
                className="flex-1"
                disabled={busy}
                onClick={() => frontCameraRef.current?.click()}
              >
                <Camera className="h-4 w-4 mr-1" />
                Photo of front
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={busy}
                onClick={() => frontGalleryRef.current?.click()}
              >
                <ImageIcon className="h-4 w-4 mr-1" />
                Front gallery
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground text-center px-1">
              Best option through plastic — reads the <strong>ID number</strong> from the text on the front.
            </p>

            {canUseBinaryEyeScanner() && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={() => void runLiveBarcodeScan()}
              >
                <ScanLine className="h-4 w-4 mr-1" />
                {busy ? "Opening Binary Eye…" : "Scan barcode (Binary Eye)"}
              </Button>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={busy}
                onClick={() => backCameraRef.current?.click()}
              >
                <Camera className="h-4 w-4 mr-1" />
                Photo of back
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={busy}
                onClick={() => backGalleryRef.current?.click()}
              >
                <ImageIcon className="h-4 w-4 mr-1" />
                Gallery
              </Button>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => handleOpenChange(false)}
              >
                Close — type on form
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => handleOpenChange(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
