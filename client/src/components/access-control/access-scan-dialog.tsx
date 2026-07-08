import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Camera, ImageIcon, ScanLine, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  BINARY_EYE_PLAY_URL,
  binaryEyeScanHint,
  canUseBinaryEyeScanner,
  describeBinaryEyeFailure,
  isBinaryEyeInstalled,
  scanViaBinaryEye,
  type BinaryEyeScanKind,
} from "@/lib/binary-eye-scanner";
import type { AccessIdentityScanResult, ParsedSaId, ParsedSaVehicleDisc } from "@/lib/parse-sa-barcodes";
import { parseSaIdentityScan, parseSaVehicleDiscBarcode } from "@/lib/parse-sa-barcodes";
import { readLicenceFrontFromPhoto } from "@/lib/licence-front-ocr";
import { readLicenceDiscFromPhoto } from "@/lib/licence-disc-ocr";
import { BarcodeScanner } from "@/components/access-control/barcode-scanner";
import { LicenceFrontScanner } from "@/components/access-control/licence-front-scanner";
import { APP_CACHE_VERSION } from "@shared/cache-version";

type AccessScanDialogProps = {
  open: boolean;
  kind: BinaryEyeScanKind | null;
  onOpenChange: (open: boolean) => void;
  onIdScan: (parsed: ParsedSaId) => void;
  onLicenceScan: (parsed: ParsedSaId) => void;
  onDiscScan: (parsed: ParsedSaVehicleDisc, raw: string) => void;
};

const FILE_INPUT_CLASS =
  "absolute left-0 top-0 h-px w-px overflow-hidden opacity-0 [clip:rect(0,0,0,0)]";

const TITLES: Record<BinaryEyeScanKind, string> = {
  national_id: "Scan ID",
  drivers_licence: "Scan driver's licence",
  disc: "Scan licence disc",
};

export function AccessScanDialog({
  open,
  kind,
  onOpenChange,
  onIdScan,
  onLicenceScan,
  onDiscScan,
}: AccessScanDialogProps) {
  const { toast } = useToast();
  const frontCameraRef = useRef<HTMLInputElement>(null);
  const frontGalleryRef = useRef<HTMLInputElement>(null);
  const discCameraRef = useRef<HTMLInputElement>(null);
  const discGalleryRef = useRef<HTMLInputElement>(null);
  const scanStartedRef = useRef(false);
  const externalRef = useRef(false);

  const [showFallback, setShowFallback] = useState(false);
  const [binaryEyeMissing, setBinaryEyeMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hiddenForScan, setHiddenForScan] = useState(false);

  const reset = useCallback(() => {
    scanStartedRef.current = false;
    externalRef.current = false;
    setShowFallback(false);
    setBinaryEyeMissing(false);
    setBusy(false);
    setHiddenForScan(false);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const close = useCallback(() => {
    reset();
    onOpenChange(false);
  }, [onOpenChange, reset]);

  const runBinaryEye = useCallback(async () => {
    if (!kind || externalRef.current) return;

    if (!canUseBinaryEyeScanner()) {
      setShowFallback(true);
      return;
    }

    const installed = await isBinaryEyeInstalled();
    if (!installed) {
      setBinaryEyeMissing(true);
      setShowFallback(true);
      return;
    }

    externalRef.current = true;
    setBusy(true);
    setHiddenForScan(true);
    setShowFallback(false);

    toast({
      title: "Binary Eye",
      description: binaryEyeScanHint(kind),
    });

    let resumeListener: (() => void) | null = null;
    if (Capacitor.isNativePlatform()) {
      const onVisible = () => {
        if (document.visibilityState !== "visible") return;
        toast({
          title: "Reading scan…",
          description: "One moment.",
        });
      };
      document.addEventListener("visibilitychange", onVisible);
      resumeListener = () => document.removeEventListener("visibilitychange", onVisible);
    }

    try {
      const outcome = await scanViaBinaryEye(kind);
      setHiddenForScan(false);

      if (outcome.ok) {
        if (outcome.kind === "drivers_licence") {
          onLicenceScan(outcome.parsed);
          toast({
            title: "Driver's licence captured",
            description:
              outcome.parsed.personFullName ?? outcome.parsed.personIdNumber ?? "Details filled in",
          });
        } else if (outcome.kind === "national_id") {
          onIdScan(outcome.parsed);
          toast({
            title: outcome.parsed.personFullName ? "ID captured" : "ID number captured",
            description:
              outcome.parsed.hint ??
              outcome.parsed.personFullName ??
              outcome.parsed.personIdNumber ??
              "",
          });
        } else {
          onDiscScan(outcome.parsed, outcome.raw);
          toast({
            title: "Licence disc scan",
            description: outcome.parsed.hint ?? outcome.parsed.registration ?? "Details filled in",
          });
        }
        close();
        return;
      }

      if (outcome.reason === "cancelled") {
        setShowFallback(true);
        toast({
          title: "Scan cancelled",
          description: "Tap Scan again to retry.",
        });
        return;
      }

      setShowFallback(true);
      toast({
        title: "Could not read barcode",
        description: describeBinaryEyeFailure(kind, outcome),
        variant: "destructive",
      });
    } catch {
      setHiddenForScan(false);
      setShowFallback(true);
      toast({
        title: "Scan failed",
        description: "Try again or enter details on the form.",
        variant: "destructive",
      });
    } finally {
      resumeListener?.();
      externalRef.current = false;
      setBusy(false);
    }
  }, [close, kind, onDiscScan, onIdScan, onLicenceScan, toast]);

  useEffect(() => {
    if (!open || !kind || scanStartedRef.current) return;
    scanStartedRef.current = true;
    void runBinaryEye();
  }, [open, kind, runBinaryEye]);

  const processFrontPhoto = useCallback(
    async (file: File) => {
      if (externalRef.current || kind !== "drivers_licence") return;
      externalRef.current = true;
      setBusy(true);
      setHiddenForScan(true);
      toast({ title: "Reading front of card…", description: "This may take up to half a minute." });
      try {
        const result = await readLicenceFrontFromPhoto(file);
        if (result.ok) {
          onLicenceScan(result.parsed);
          toast({
            title: "Driver's licence captured",
            description: result.parsed.personFullName ?? result.parsed.personIdNumber ?? "",
          });
          close();
          return;
        }
        toast({
          title: "Could not read front of card",
          description: result.message,
          variant: "destructive",
        });
        setHiddenForScan(false);
      } catch {
        toast({
          title: "Photo scan failed",
          description: "Try again or type on the form.",
          variant: "destructive",
        });
        setHiddenForScan(false);
      } finally {
        externalRef.current = false;
        setBusy(false);
      }
    },
    [close, kind, onLicenceScan, toast],
  );

  const processDiscPhoto = useCallback(
    async (file: File) => {
      if (externalRef.current || kind !== "disc") return;
      externalRef.current = true;
      setBusy(true);
      setHiddenForScan(true);
      toast({ title: "Reading licence disc…", description: "This may take up to half a minute." });
      try {
        const result = await readLicenceDiscFromPhoto(file);
        if (result.ok) {
          onDiscScan(result.parsed, result.parsed.licenceDiscData);
          toast({
            title: "Licence disc captured",
            description:
              result.parsed.hint ??
              [result.parsed.registration, result.parsed.make].filter(Boolean).join(" · ") ??
              "Details filled in",
          });
          close();
          return;
        }
        toast({
          title: "Could not read licence disc",
          description: result.message,
          variant: "destructive",
        });
        setHiddenForScan(false);
      } catch {
        toast({
          title: "Photo scan failed",
          description: "Try again or type on the form.",
          variant: "destructive",
        });
        setHiddenForScan(false);
      } finally {
        externalRef.current = false;
        setBusy(false);
      }
    },
    [close, kind, onDiscScan, toast],
  );

  if (!kind) return null;

  if (!canUseBinaryEyeScanner()) {
    if (kind === "drivers_licence") {
      return (
        <LicenceWebFallback
          open={open}
          onOpenChange={(o) => {
            if (!o) close();
          }}
          onScan={({ parsed }) => {
            onLicenceScan(parsed);
            close();
          }}
        />
      );
    }

    return (
      <BarcodeScanner
        open={open}
        onOpenChange={(o) => {
          if (!o) close();
        }}
        title={TITLES[kind]}
        scanKind={kind === "disc" ? "disc" : "id"}
        identityMode="national_id"
        onScan={(result) => {
          if (kind === "disc") {
            const value = typeof result === "string" ? result : result.kind === "raw" ? result.value : "";
            onDiscScan(parseSaVehicleDiscBarcode(value), value);
          } else {
            const parsed =
              typeof result === "object" && result.kind === "parsed"
                ? result.parsed
                : parseSaIdentityScan(typeof result === "string" ? result : result.value);
            onIdScan(parsed);
          }
          close();
        }}
      />
    );
  }

  return (
    <>
      <input
        ref={frontCameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className={FILE_INPUT_CLASS}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void processFrontPhoto(file);
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
          if (file) void processFrontPhoto(file);
          e.target.value = "";
        }}
      />
      <input
        ref={discCameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className={FILE_INPUT_CLASS}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void processDiscPhoto(file);
          e.target.value = "";
        }}
      />
      <input
        ref={discGalleryRef}
        type="file"
        accept="image/*"
        className={FILE_INPUT_CLASS}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void processDiscPhoto(file);
          e.target.value = "";
        }}
      />

      <Dialog
        open={open && !hiddenForScan && showFallback}
        onOpenChange={(next) => {
          if (!next && !externalRef.current) close();
        }}
      >
        <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden" hideDefaultClose>
          <DialogHeader className="p-4 pb-2 pr-12">
            <DialogTitle className="flex items-center gap-2 text-base">
              <ScanLine className="h-5 w-5" />
              {TITLES[kind]}
            </DialogTitle>
          </DialogHeader>

          <div className="mx-4 mb-2 rounded-lg border border-dashed border-primary/40 bg-muted/30 px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              All scans use <strong>Binary Eye</strong> ({APP_CACHE_VERSION}).
            </p>
            {binaryEyeMissing && (
              <p className="mt-2 text-xs text-muted-foreground">
                Install{" "}
                <a
                  href={BINARY_EYE_PLAY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Binary Eye
                </a>{" "}
                from Play Store.
              </p>
            )}
          </div>

          <div className="p-4 space-y-3">
            <Button
              type="button"
              variant="default"
              className="w-full"
              disabled={busy}
              onClick={() => {
                scanStartedRef.current = false;
                void runBinaryEye();
              }}
            >
              <ScanLine className="h-4 w-4 mr-1" />
              {busy ? "Opening Binary Eye…" : "Scan with Binary Eye"}
            </Button>

            {kind === "disc" && (
              <>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => discCameraRef.current?.click()}
                  >
                    <Camera className="h-4 w-4 mr-1" />
                    Photo of disc
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => discGalleryRef.current?.click()}
                  >
                    <ImageIcon className="h-4 w-4 mr-1" />
                    Gallery
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground text-center">
                  The square barcode is encrypted — <strong>Photo of disc</strong> reads registration, make and model from the printed face.
                </p>
              </>
            )}

            {kind === "drivers_licence" && (
              <>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
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
                    Gallery
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground text-center">
                  Through plastic sleeves, <strong>Photo of front</strong> reads name + ID from the card text.
                </p>
              </>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={close}>
                Close — type on form
              </Button>
              <Button type="button" variant="outline" size="icon" onClick={close}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Web-only licence scan: photo of front + in-app barcode fallback. */
function LicenceWebFallback({
  open,
  onOpenChange,
  onScan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (result: AccessIdentityScanResult) => void;
}) {
  return <LicenceFrontScanner open={open} onOpenChange={onOpenChange} onScan={onScan} />;
}
