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
import { readLicenceFrontFromPhoto } from "@/lib/licence-front-ocr";
import { decodeDriversLicenceFromImageViaApi } from "@/lib/decode-drivers-licence-api";
import {
  BINARY_EYE_PLAY_URL,
  canUseBinaryEyeScanner,
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

/** Brief pause so the modal overlay is gone before launching Binary Eye. */
function waitForDialogToClose(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 250));
}

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
  const [showFrontOcr, setShowFrontOcr] = useState(false);
  const [binaryEyeMissing, setBinaryEyeMissing] = useState(false);

  const reset = useCallback(() => {
    setBusy(false);
    setStatus(null);
    setError(null);
    setShowFrontOcr(false);
    setBinaryEyeMissing(false);
    externalScanRef.current = false;
  }, []);

  const settle = useCallback(
    (parsed: ParsedSaId) => {
      onScan({ kind: "parsed", parsed });
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

    // Close the modal before opening Binary Eye — leaving the black overlay up
    // while the activity pauses leaves the phone stuck on a blank screen.
    onOpenChange(false);
    await waitForDialogToClose();

    try {
      const binaryEye = await scanDriversLicenceViaBinaryEye();
      if (binaryEye.ok) {
        settle(binaryEye.parsed);
        return;
      }

      if (binaryEye.reason === "cancelled") {
        toast({
          title: "Scan cancelled",
          description: "Tap Scan licence again, or take a photo of the back of the card.",
        });
        return;
      }

      toast({
        title: "Could not read licence barcode",
        description:
          "Try Binary Eye again with the PDF417 on the back right, or take a photo of the back of the card.",
        variant: "destructive",
      });
      onOpenChange(true);
    } finally {
      externalScanRef.current = false;
      setBusy(false);
    }
  }, [busy, onOpenChange, settle, toast]);

  const readBackBarcodePhoto = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setStatus("Reading PDF417 from photo…");

      const parsed = await decodeDriversLicenceFromImageViaApi(file);
      if (parsed?.personIdNumber || parsed?.personFullName) {
        setStatus("Licence barcode read");
        settle(parsed);
        return;
      }

      setError(
        "No barcode found in this photo. Fill the frame with the back of the card, PDF417 on the right, good light, then try again.",
      );
      setStatus(null);
      setBusy(false);
    },
    [settle],
  );

  const readFrontPhoto = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setStatus("Reading text from front of card…");

      const result = await readLicenceFrontFromPhoto(file);
      if (result.ok) {
        setStatus("Details captured from front");
        settle(result.parsed);
        return;
      }

      setError(result.message);
      setStatus(null);
      setBusy(false);
    },
    [settle],
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden" hideDefaultClose>
        <input
          ref={backCameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className={FILE_INPUT_CLASS}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readBackBarcodePhoto(file);
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
            if (file) void readBackBarcodePhoto(file);
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
            if (file) void readFrontPhoto(file);
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
            if (file) void readFrontPhoto(file);
            e.target.value = "";
          }}
        />

        <DialogHeader className="p-4 pb-2 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ScanLine className="h-5 w-5" />
            Scan driver&apos;s licence
          </DialogTitle>
        </DialogHeader>

        <div className="mx-4 mb-2 flex aspect-[4/3] items-center justify-center rounded-lg border-2 border-dashed border-primary/40 bg-muted/30 px-4 text-center">
          <p className="text-sm text-muted-foreground">
            Tap <strong>Scan barcode</strong> to open <strong>Binary Eye</strong> — point at the{" "}
            <strong>PDF417 on the back right</strong>. Works through plastic covers ({APP_CACHE_VERSION}).
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

          {canUseBinaryEyeScanner() && (
            <Button
              type="button"
              variant="default"
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
              variant={canUseBinaryEyeScanner() ? "outline" : "default"}
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

          {!showFrontOcr ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full text-xs"
              disabled={busy}
              onClick={() => setShowFrontOcr(true)}
            >
              Try front of card instead (read name &amp; ID)
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 text-xs"
                disabled={busy}
                onClick={() => frontCameraRef.current?.click()}
              >
                <Camera className="h-4 w-4 mr-1" />
                Photo of front
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1 text-xs"
                disabled={busy}
                onClick={() => frontGalleryRef.current?.click()}
              >
                <ImageIcon className="h-4 w-4 mr-1" />
                Front gallery
              </Button>
            </div>
          )}

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
  );
}
