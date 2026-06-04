import { useEffect, useRef, useState } from "react";
import { Siren, MapPin, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  buildPanicSentToast,
  panicLocationOffBody,
  panicLocationOffTitle,
  postPanicAlert,
  probePanicLocation,
  probePanicLocationForSend,
} from "@/lib/panic-send";
import { hasPanicCoordinates, type PanicLocationResult } from "@/lib/panic-location";
import { LocationPermissionGuide } from "@/components/location-permission-guide";
import { preloadLocationSettingsModule } from "@/lib/open-location-settings";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  confirmTestId: string;
  notifyHint?: string;
};

type SendPhase = "idle" | "gps" | "sending";

export function PanicConfirmOverlay({ open, onOpenChange, confirmTestId, notifyHint }: Props) {
  const { toast } = useToast();
  const [sendPhase, setSendPhase] = useState<SendPhase>("idle");
  const [locationProbe, setLocationProbe] = useState<PanicLocationResult | null>(null);
  const [pendingLoc, setPendingLoc] = useState<PanicLocationResult | null>(null);
  const [showLocationGate, setShowLocationGate] = useState(false);
  const sendLockRef = useRef(false);

  const sending = sendPhase !== "idle";

  async function refreshLocationProbe() {
    const loc = await probePanicLocation();
    setLocationProbe(loc);
    if (showLocationGate) setPendingLoc(loc);
    return loc;
  }

  useEffect(() => {
    if (!open) {
      setLocationProbe(null);
      setPendingLoc(null);
      setShowLocationGate(false);
      setSendPhase("idle");
      sendLockRef.current = false;
      return;
    }
    preloadLocationSettingsModule();
    let cancelled = false;
    void probePanicLocation().then((loc) => {
      if (!cancelled) setLocationProbe(loc);
    });
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void probePanicLocation().then((loc) => {
        if (!cancelled) {
          setLocationProbe(loc);
          if (showLocationGate) setPendingLoc(loc);
        }
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [open, showLocationGate]);

  const locationReady = locationProbe != null && hasPanicCoordinates(locationProbe);

  function confirmButtonLabel(): string {
    if (sendPhase === "gps") return "Getting GPS — wait…";
    if (sendPhase === "sending") return "Sending — do not tap again";
    return "CONFIRM — Send Alert";
  }

  async function finishSend(loc: PanicLocationResult) {
    sendLockRef.current = true;
    setSendPhase("sending");
    try {
      const outcome = await postPanicAlert(loc);
      onOpenChange(false);
      const t = buildPanicSentToast(outcome);
      toast({ title: t.title, description: t.description, variant: t.variant });
    } catch (e: unknown) {
      sendLockRef.current = false;
      toast({
        title: "Failed to send panic alert",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSendPhase("idle");
      setShowLocationGate(false);
      setPendingLoc(null);
    }
  }

  async function onConfirmSend() {
    if (sendLockRef.current || sending) return;
    sendLockRef.current = true;
    setSendPhase("gps");
    try {
      const loc = await probePanicLocationForSend();
      if (hasPanicCoordinates(loc)) {
        await finishSend(loc);
        return;
      }
      sendLockRef.current = false;
      setSendPhase("idle");
      setPendingLoc(loc);
      setShowLocationGate(true);
    } catch {
      sendLockRef.current = false;
      setSendPhase("idle");
    }
  }

  if (!open) return null;

  if (showLocationGate && pendingLoc) {
    return (
      <div
        className="fixed inset-0 z-[310] flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm px-6"
        data-testid="overlay-panic-location-off"
      >
        <div className="w-full max-w-sm flex flex-col items-center gap-5 text-center">
          <AlertTriangle className="h-14 w-14 text-amber-400" />
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white">{panicLocationOffTitle(pendingLoc.issue)}</h2>
            <p className="text-sm text-white/80 leading-relaxed">{panicLocationOffBody(pendingLoc.issue)}</p>
            <p className="text-xs text-white/60">
              Follow the steps below — works with your current app, no Play Store update.
            </p>
          </div>
          <div className="w-full space-y-3 pt-2">
            <LocationPermissionGuide
              variant="dark"
              testIdPrefix={`${confirmTestId}-gate`}
              onLocationUpdated={(loc) => {
                setPendingLoc(loc);
                setLocationProbe(loc);
              }}
            />
            <button
              type="button"
              onClick={() => void finishSend(pendingLoc)}
              disabled={sending}
              className="w-full h-12 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm transition-all disabled:opacity-60 touch-manipulation"
              data-testid={`${confirmTestId}-send-without-location`}
            >
              {sendPhase === "sending" ? "Sending — do not tap again" : "Send alert anyway (no GPS)"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (sending) return;
                setShowLocationGate(false);
                setPendingLoc(null);
              }}
              disabled={sending}
              className="w-full h-12 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-medium text-sm"
            >
              Go back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm px-6"
      data-testid="overlay-panic-confirm"
    >
      <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
        <div className="relative flex items-center justify-center">
          <span className="absolute h-28 w-28 rounded-full bg-red-600/20 animate-ping" />
          <span className="absolute h-20 w-20 rounded-full bg-red-600/30" />
          <div className="relative h-24 w-24 rounded-full bg-red-600 flex items-center justify-center shadow-lg">
            <Siren className="h-12 w-12 text-white" />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-white tracking-tight">Send PANIC Alert?</h2>
          <p className="text-sm text-white/70 leading-relaxed">
            This will immediately alert <strong className="text-white">everyone</strong> in your organisation.
            Your GPS location will be shared.
          </p>
          {sending && (
            <p className="text-xs text-amber-300 font-medium">
              One tap only — please wait until you see confirmation.
            </p>
          )}
        </div>
        {locationProbe != null && !locationReady && !sending && (
          <div className="w-full space-y-3">
            <div className="flex items-start gap-2 rounded-xl bg-red-500/20 border border-red-500/50 px-4 py-3 text-xs text-red-100 text-left">
              <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Location is off or unavailable.</strong> Turn on GPS below (no app update needed).
              </span>
            </div>
            <LocationPermissionGuide
              variant="dark"
              testIdPrefix={`${confirmTestId}-preview`}
              onLocationUpdated={(loc) => {
                setLocationProbe(loc);
              }}
            />
          </div>
        )}
        {locationReady && (
          <div className="w-full flex items-start gap-2 rounded-xl bg-green-500/15 border border-green-500/40 px-4 py-3 text-xs text-green-100 text-left">
            <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
            <span>GPS ready — your position will be included.</span>
          </div>
        )}
        {typeof Notification !== "undefined" && Notification.permission !== "granted" && (
          <div className="w-full flex items-start gap-2 rounded-xl bg-amber-500/15 border border-amber-500/40 px-4 py-3 text-xs text-amber-300 text-left">
            <Siren className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{notifyHint ?? "Push notifications are not enabled — alerts may be delayed."}</span>
          </div>
        )}
        <div className="w-full space-y-3 pt-2">
          <button
            type="button"
            onClick={() => void onConfirmSend()}
            disabled={sending}
            data-testid={confirmTestId}
            className="w-full h-14 rounded-2xl bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white font-bold text-base tracking-wide shadow-lg transition-all touch-manipulation disabled:opacity-60"
          >
            {confirmButtonLabel()}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={sending}
            className="w-full h-12 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-medium text-sm transition-all touch-manipulation"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
