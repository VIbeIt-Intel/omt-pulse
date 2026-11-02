import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Siren, MapPin, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  buildPanicSentToast,
  panicLocationOffBody,
  panicLocationOffTitle,
  postPanicAlert,
  probePanicLocation,
  probePanicLocationForSend,
} from "@/lib/panic-send";
import { acquirePanicLocation, hasPanicCoordinates, type PanicLocationResult } from "@/lib/panic-location";
import { enqueueOutboxJob } from "@/lib/offline-outbox";
import { LocationPermissionGuide } from "@/components/location-permission-guide";
import { openLocationSettings, preloadLocationSettingsModule } from "@/lib/open-location-settings";

type PanicLabels = {
  title: string;
  before: string;
  emphasis: string;
  after: string;
  confirm: string;
  sending: string;
  cancel: string;
  gpsReady: string;
  locationOff: string;
  sendWithoutGps: string;
  goBack: string;
  whereHelp?: string;
  whereButton?: string;
  whereWait?: string;
};

const ENGLISH_PANIC: PanicLabels = {
  title: "Send PANIC Alert?",
  before: "This will immediately alert ",
  emphasis: "everyone",
  after: " in your organisation. Your GPS location will be shared.",
  confirm: "CONFIRM — Send Alert",
  sending: "Sending alert…",
  cancel: "Cancel",
  gpsReady: "GPS ready — your position will be included.",
  locationOff: "Location is off or unavailable. Turn on GPS below (no app update needed).",
  sendWithoutGps: "Send alert anyway (no GPS)",
  goBack: "Go back",
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  confirmTestId: string;
  /** Extra line for org-specific copy (e.g. occurrence book). */
  notifyHint?: string;
  labels?: PanicLabels;
  /** Farmer phone uses a light page. Control room keeps the dark confirm. */
  light?: boolean;
};

export function PanicConfirmOverlay({ open, onOpenChange, confirmTestId, notifyHint, labels = ENGLISH_PANIC, light = false }: Props) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [sending, setSending] = useState(false);
  const [finding, setFinding] = useState(false);
  const [locationProbe, setLocationProbe] = useState<PanicLocationResult | null>(null);
  const [pendingLoc, setPendingLoc] = useState<PanicLocationResult | null>(null);
  const [showLocationGate, setShowLocationGate] = useState(false);

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
      return;
    }
    preloadLocationSettingsModule();
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("gps") === "off") {
      setLocationProbe({ issue: "denied" });
      return;
    }
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

  async function finishSend(loc: PanicLocationResult) {
    setSending(true);
    try {
      if (!navigator.onLine) {
        await enqueueOutboxJob({
          type: "sos",
          lat: hasPanicCoordinates(loc) ? loc.lat : undefined,
          lng: hasPanicCoordinates(loc) ? loc.lng : undefined,
        });
        onOpenChange(false);
        toast({
          title: "🆘 Panic queued offline",
          description:
            "No signal — alert is saved on this phone and will send automatically when you’re back online.",
        });
        return;
      }
      const outcome = await postPanicAlert(loc);
      onOpenChange(false);
      const t = buildPanicSentToast(outcome);
      toast({ title: t.title, description: t.description, variant: t.variant });
      await queryClient.refetchQueries({ queryKey: ["/api/incidents/live"] });
      const rows = queryClient.getQueryData<Array<{ id: number; userId: string | null; isLive: boolean }>>(["/api/incidents/live"]) ?? [];
      const me = queryClient.getQueryData<{ id: string }>(["/api/auth/me"]);
      const mine = rows.filter((row) => row.isLive && me && row.userId === me.id);
      const opened = (outcome.incidentId != null ? mine.find((row) => row.id === outcome.incidentId) : null)
        ?? mine.reduce<{ id: number } | null>((best, row) => (best == null || row.id > best.id ? row : best), null);
      if (opened) {
        try { localStorage.setItem("omt_live_incident_id", String(opened.id)); } catch { /* ignore */ }
      }
      navigate("/live-incident");
    } catch (e: unknown) {
      // Network blip after navigator.onLine true — still queue rather than lose SOS.
      const msg = e instanceof Error ? e.message : "";
      if (/fetch|network|failed|offline|timeout/i.test(msg) || !navigator.onLine) {
        try {
          await enqueueOutboxJob({
            type: "sos",
            lat: hasPanicCoordinates(loc) ? loc.lat : undefined,
            lng: hasPanicCoordinates(loc) ? loc.lng : undefined,
          });
          onOpenChange(false);
          toast({
            title: "🆘 Panic queued offline",
            description:
              "Could not reach the server — alert is saved on this phone and will send when you’re online.",
          });
          return;
        } catch {
          /* fall through */
        }
      }
      toast({
        title: "Failed to send panic alert",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
      setShowLocationGate(false);
      setPendingLoc(null);
    }
  }

  async function showWhereIAm() {
    setFinding(true);
    try {
      const loc = await acquirePanicLocation();
      setLocationProbe(loc);
      if (hasPanicCoordinates(loc)) return;
      await openLocationSettings();
    } finally {
      setFinding(false);
    }
  }

  async function onConfirmSend() {
    setSending(true);
    const loc = await probePanicLocationForSend();
    setSending(false);
    if (hasPanicCoordinates(loc) || labels.whereButton) {
      await finishSend(loc);
      return;
    }
    setPendingLoc(loc);
    setShowLocationGate(true);
  }

  if (!open) return null;

  if (showLocationGate && pendingLoc) {
    return (
      <div
        className={light
          ? "fixed inset-0 z-[310] flex flex-col items-center justify-center bg-[#f4f1ea] px-6 text-zinc-900"
          : "fixed inset-0 z-[310] flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm px-6"}
        data-testid="overlay-panic-location-off"
      >
        <div className="w-full max-w-sm flex flex-col items-center gap-5 text-center">
          <AlertTriangle className="h-14 w-14 text-amber-400" />
          <div className="space-y-2">
            <h2 className={light ? "text-xl font-bold text-zinc-900" : "text-xl font-bold text-white"}>{panicLocationOffTitle(pendingLoc.issue)}</h2>
            <p className={light ? "text-sm text-zinc-600 leading-relaxed" : "text-sm text-white/80 leading-relaxed"}>{panicLocationOffBody(pendingLoc.issue)}</p>
            <p className={light ? "text-xs text-zinc-500" : "text-xs text-white/60"}>
              Follow the steps below — works with your current app, no Play Store update.
            </p>
          </div>
          <div className="w-full space-y-3 pt-2">
            <LocationPermissionGuide
              variant={light ? "light" : "dark"}
              testIdPrefix={`${confirmTestId}-gate`}
              onLocationUpdated={(loc) => {
                setPendingLoc(loc);
                setLocationProbe(loc);
              }}
            />
            <button
              type="button"
              onClick={() => finishSend(pendingLoc)}
              disabled={sending}
              className="w-full h-12 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm transition-all disabled:opacity-60"
              data-testid={`${confirmTestId}-send-without-location`}
            >
              {sending ? labels.sending : labels.sendWithoutGps}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowLocationGate(false);
                setPendingLoc(null);
              }}
              disabled={sending}
              className={light
                ? "w-full h-12 rounded-2xl border border-zinc-300 bg-white text-zinc-800 font-medium text-sm"
                : "w-full h-12 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-medium text-sm"}
            >
              {labels.goBack}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={light
        ? "fixed inset-0 z-[300] flex flex-col items-center justify-start overflow-y-auto bg-[#f4f1ea] px-6 py-8 text-zinc-900"
        : "fixed inset-0 z-[300] flex flex-col items-center justify-start overflow-y-auto bg-black/85 backdrop-blur-sm px-6 py-8"}
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
          <h2 className={light ? "text-2xl font-bold tracking-tight text-zinc-900" : "text-2xl font-bold text-white tracking-tight"}>{labels.title}</h2>
          <p className={light ? "text-sm leading-relaxed text-zinc-600" : "text-sm text-white/70 leading-relaxed"}>
            {labels.before}<strong className={light ? "text-zinc-900" : "text-white"}>{labels.emphasis}</strong>{labels.after}
          </p>
        </div>
        {locationProbe != null && !locationReady && labels.whereButton && (
          <div className="w-full space-y-3">
            <div className={light
              ? "rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-left text-sm text-red-800"
              : "rounded-xl border border-red-500/50 bg-red-500/20 px-4 py-3 text-sm text-white text-left"}>
              {labels.locationOff}
            </div>
            <p className={light ? "text-left text-sm text-zinc-700" : "text-sm text-white/80 text-left"}>{labels.whereHelp}</p>
            <button
              type="button"
              onClick={() => void showWhereIAm()}
              disabled={finding || sending}
              className="w-full h-12 rounded-2xl bg-emerald-600 text-white font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60"
              data-testid={`${confirmTestId}-where`}
            >
              <MapPin className="h-4 w-4" />
              {finding ? (labels.whereWait ?? "…") : labels.whereButton}
            </button>
          </div>
        )}
        {locationProbe != null && !locationReady && !labels.whereButton && (
          <div className="w-full space-y-3">
            <div className={light
              ? "flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-left text-xs text-red-800"
              : "flex items-start gap-2 rounded-xl bg-red-500/20 border border-red-500/50 px-4 py-3 text-xs text-red-100 text-left"}>
              <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                <strong className={light ? "text-red-900" : "text-white"}>{labels.locationOff}</strong>
              </span>
            </div>
            <LocationPermissionGuide
              variant={light ? "light" : "dark"}
              testIdPrefix={`${confirmTestId}-preview`}
              onLocationUpdated={(loc) => {
                setLocationProbe(loc);
              }}
            />
          </div>
        )}
        {locationReady && (
          <div className={light
            ? "flex w-full items-start gap-2 rounded-xl border border-green-600/30 bg-green-600/10 px-4 py-3 text-left text-xs text-green-800"
            : "w-full flex items-start gap-2 rounded-xl bg-green-500/15 border border-green-500/40 px-4 py-3 text-xs text-green-100 text-left"}>
            <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{labels.gpsReady}</span>
          </div>
        )}
        {typeof Notification !== "undefined" && Notification.permission !== "granted" && (
          <div className={light
            ? "flex w-full items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-left text-xs text-amber-900"
            : "w-full flex items-start gap-2 rounded-xl bg-amber-500/15 border border-amber-500/40 px-4 py-3 text-xs text-amber-300 text-left"}>
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
            {sending ? labels.sending : labels.confirm}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={sending}
            className={light
              ? "w-full h-12 rounded-2xl border border-zinc-300 bg-white text-zinc-800 font-medium text-sm transition-all touch-manipulation"
              : "w-full h-12 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-medium text-sm transition-all touch-manipulation"}
          >
            {labels.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
