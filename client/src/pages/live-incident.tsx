import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Navigation, MapPin, Radio, CheckCircle2, Loader2, Search, RotateCcw, RotateCw, ChevronRight, ExternalLink, Camera, ImageIcon, X, WifiOff, LogOut, Mic, Square, AlertTriangle, HelpCircle, Gauge, ArrowUp, ArrowUpRight, ArrowUpLeft, ArrowRight, CornerUpRight, CornerUpLeft, Merge, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { usePermissionStatus } from "@/hooks/use-permission-status";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { Capacitor } from '@capacitor/core';
import CapacitorMap, { type CapacitorMapHandle } from '@/components/CapacitorMap';
import MapDebugOverlay, { type MapDebugSnapshot } from '@/components/MapDebugOverlay';
import type { Incident, Category } from "@shared/schema";

const LIVE_INCIDENT_KEY = "omt_live_incident_id";
const JOINED_INCIDENT_KEY = "omt_joined_incident_id";
const ARRIVAL_QUEUE_KEY = "omt_arrival_queue";
const NAV_STARTED_KEY = "omt_nav_started";
// Accuracy thresholds for PATCH sends:
//   First send (or stale >60 s): accept anything under 500 m — get SOMETHING to admin quickly
//   Ongoing: only accept under 200 m — avoids spamming with cell-tower approximations
const GPS_ACCURACY_FIRST = 500;    // metres
const GPS_ACCURACY_ONGOING = 200;  // metres

type PlaceSuggestion = { place_id: string; description: string };
type ArrivalMedia = { id: string; url: string; filename: string; mimeType: string };
const MAX_ARRIVAL_MEDIA = 5;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024; // 10 MB per item

function fmtDist(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
function fmtDur(s: number) {
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}min`;
}
function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, "");
}
// Map a Google Directions maneuver string to a Lucide icon. Falls back to a
// straight-up arrow when the field is missing (typical for the first "head"
// step or simple segments).
function ManeuverIcon({ maneuver, className }: { maneuver?: string | null; className?: string }) {
  const cls = className ?? "h-10 w-10";
  switch (maneuver) {
    case "turn-right":
      return <ArrowRight className={cls} strokeWidth={2.5} />;
    case "turn-left":
      return <ArrowRight className={cls} strokeWidth={2.5} style={{ transform: "scaleX(-1)" }} />;
    case "turn-slight-right":
    case "ramp-right":
    case "fork-right":
    case "keep-right":
      return <ArrowUpRight className={cls} strokeWidth={2.5} />;
    case "turn-slight-left":
    case "ramp-left":
    case "fork-left":
    case "keep-left":
      return <ArrowUpLeft className={cls} strokeWidth={2.5} />;
    case "turn-sharp-right":
      return <CornerUpRight className={cls} strokeWidth={2.5} />;
    case "turn-sharp-left":
      return <CornerUpLeft className={cls} strokeWidth={2.5} />;
    case "uturn-right":
      return <RotateCw className={cls} strokeWidth={2.5} />;
    case "uturn-left":
      return <RotateCcw className={cls} strokeWidth={2.5} />;
    case "merge":
      return <Merge className={cls} strokeWidth={2.5} />;
    case "roundabout-right":
    case "roundabout-left":
      return <RotateCw className={cls} strokeWidth={2.5} />;
    case "straight":
    default:
      return <ArrowUp className={cls} strokeWidth={2.5} />;
  }
}
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sl = Math.sin(dLat / 2), sln = Math.sin(dLng / 2);
  const x = sl * sl + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sln * sln;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
/** Distance (metres) from point p to the nearest point on segment a→b (planar approximation). */
function ptSegDistM(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = b.lat - a.lat, dLng = b.lng - a.lng;
  const lenSq = dLat * dLat + dLng * dLng;
  if (lenSq === 0) return haversineM(p, a);
  const t = Math.max(0, Math.min(1, ((p.lat - a.lat) * dLat + (p.lng - a.lng) * dLng) / lenSq));
  return haversineM(p, { lat: a.lat + t * dLat, lng: a.lng + t * dLng });
}

async function compressImageToBlob(file: File, maxPx = 1024, quality = 0.75): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          // Allow canvas to be GC'd immediately after toBlob fires
          canvas.width = 0; canvas.height = 0;
          if (blob) resolve(blob); else reject(new Error("Compression failed"));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error("Image load failed")); };
    img.src = blobUrl;
  });
}

function openGoogleMapsNav(lat: number, lng: number) {
  try { localStorage.setItem("omt_return_url", window.location.pathname + window.location.search); } catch { /* ignore */ }
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  window.open(url, "_blank");
}

export default function LiveIncidentPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { acquire: acquireWakeLock, release: releaseWakeLock, lost: wakeLockLost, supported: wakeLockSupported } = useWakeLock();
  const wakeLockDeniedToastShownRef = useRef(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  // ── Native map (Capacitor Android) ──────────────────────────────────────────
  const isNative = Capacitor.isNativePlatform();
  const [nativeMapFailed, setNativeMapFailed] = useState(false);
  // useWebMap = true whenever we should use the Google Maps JS API instead of Capacitor native
  const useWebMap = !isNative || nativeMapFailed;
  const capMapRef = useRef<CapacitorMapHandle | null>(null);
  const capDestMarkerIdRef = useRef<string>('');
  // ────────────────────────────────────────────────────────────────────────────
  const originMarkerRef = useRef<google.maps.Marker | null>(null);
  const destMarkerRef = useRef<google.maps.Marker | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const autocompleteRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const stepCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsFallbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastSentRef = useRef<number>(0);
  // Updated ONLY when a PATCH returns res.ok — used for gpsLost detection so
  // continuous PATCH failures don't mask the absence of successful sends.
  const lastSuccessRef = useRef<number>(0);
  // Timestamp of the most recent startTracking() call; reset to 0 in
  // stopTracking(). Used as the fallback baseline for gpsLost detection
  // when no successful send has occurred yet in the current session.
  const trackingStartedAtRef = useRef<number>(0);
  const consecutiveFailuresRef = useRef<number>(0);
  // Tracks which incidentId startTracking was last called for, so the
  // tracking useEffect can skip a redundant re-call when startLive() already
  // kicked off tracking for the same incident.
  const trackingIncidentIdRef = useRef<number | null>(null);
  const searchDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepsRef = useRef<google.maps.DirectionsStep[]>([]);
  const announcedStepRef = useRef<number>(-1);       // step-advance voice (fires on index change)
  const approachingTurnAnnouncedRef = useRef<number>(-1); // 200 m "In X m, turn …" voice (per step)
  const arrivedAnnouncedRef = useRef<boolean>(false);
  const lastHeadingRef = useRef<number | null>(null); // last valid GPS heading — persisted through brief null gaps (e.g. mid-turn)
  const arrivalCameraRef = useRef<HTMLInputElement>(null);
  const arrivalFileRef = useRef<HTMLInputElement>(null);
  // Holds offline image blobs or in-memory audio blobs.
  // Never persisted to localStorage; lost if the app is closed before upload.
  // Keyed by stable item ID — immune to array mutations such as removes or concurrent adds
  const arrivalMediaBlobsRef = useRef<Map<string, { blob: Blob; filename: string; mimeType: string }>>(new Map());
  // Mirror of arrivalMedia state used by the unmount cleanup so it can revoke blob: URLs
  const arrivalMediaStateRef = useRef<ArrivalMedia[]>([]);
  // Voice recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const destPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  // Stable ref so the sendPosition closure inside startTracking() can check
  // isPanicIncident without stale-closure issues (React state is not readable
  // inside a watchPosition callback).
  const isPanicIncidentRef = useRef<boolean>(false);
  const arrivalTimeRef = useRef<Date>(new Date());
  const gpsEndpointRef = useRef<"responder-position" | "joiner-position">("responder-position");

  const locationPermission = usePermissionStatus().location;

  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  // ── Diagnostic state (consumed by MapDebugOverlay) ──────────────────────────
  const [mapsErrorMsg, setMapsErrorMsg] = useState<string | null>(null);
  const [geocoderReady, setGeocoderReady] = useState(false);
  const [autocompleteReady, setAutocompleteReady] = useState(false);
  const [nativeMapStatus, setNativeMapStatus] = useState<"idle" | "creating" | "ready" | "timeout" | "error">("idle");
  const [nativeMapErrorMsg, setNativeMapErrorMsg] = useState<string | null>(null);
  const [nativeMapCreateAt, setNativeMapCreateAt] = useState<number | null>(null);
  const [nativeMapReadyAt, setNativeMapReadyAt] = useState<number | null>(null);
  const [debugErrors, setDebugErrors] = useState<string[]>([]);
  const [debugVisible, setDebugVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).has("debug");
  });
  const titlePressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Capture window errors and unhandled rejections for the debug overlay.
  // Kept small (last 5) to avoid memory growth.
  useEffect(() => {
    const push = (msg: string) => {
      setDebugErrors((prev) => [...prev.slice(-4), `${new Date().toLocaleTimeString()} ${msg}`.slice(0, 240)]);
    };
    const onErr = (e: ErrorEvent) => push(`error: ${e.message}${e.filename ? ` @ ${e.filename}:${e.lineno}` : ""}`);
    const onRej = (e: PromiseRejectionEvent) => push(`reject: ${(e.reason as any)?.message ?? String(e.reason)}`);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  // Mark native map as "creating" the moment we mount <CapacitorMap>.
  useEffect(() => {
    if (!useWebMap && nativeMapStatus === "idle") {
      setNativeMapStatus("creating");
      setNativeMapCreateAt(Date.now());
    }
  }, [useWebMap, nativeMapStatus]);
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loadingSugg, setLoadingSugg] = useState(false);
  const [destination, setDestination] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number } | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepDist, setStepDist] = useState<number | null>(null);
  const [hasRoute, setHasRoute] = useState(false);
  const [isOffRoute, setIsOffRoute] = useState(false);
  const [navMode, setNavMode] = useState(false);
  const [speedKmh, setSpeedKmh] = useState<number | null>(null);
  // Mirrors navMode so interval callbacks (startStepTracking) always read the latest value.
  const navModeRef = useRef(false);
  // Tracks responder userIds we've already announced so we only flash on genuinely new joiners.
  const knownResponderIdsRef = useRef<Set<string>>(new Set());
  // Name to flash briefly when a new responder joins while in nav mode (auto-clears after 5s).
  const [newJoinerFlash, setNewJoinerFlash] = useState<string | null>(null);
  // Timestamp of the last auto-reroute, for 30-second rate-limiting.
  const lastRerouteRef = useRef<number>(0);
  // Mirrors currentStepIndex so the step-tracking interval can read the current value.
  const currentStepIndexRef = useRef(0);
  // Scrollable content container — scrolled to top when nav mode is entered.
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Arrival form state
  const [showArrivalForm, setShowArrivalForm] = useState(false);
  const [arrivalCategoryId, setArrivalCategoryId] = useState<number | null>(null);
  const [arrivalOtherType, setArrivalOtherType] = useState("");
  const [arrivalDescription, setArrivalDescription] = useState("");
  const [arrivalMedia, setArrivalMedia] = useState<ArrivalMedia[]>([]);
  const [arrivalUploading, setArrivalUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [arrivalSubmitting, setArrivalSubmitting] = useState(false);
  const [isNearDestination, setIsNearDestination] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [wakeLockUnsupportedDismissed, setWakeLockUnsupportedDismissed] = useState(false);

  type GpsStatus = "idle" | "acquiring" | "tracking" | "stationary" | "denied" | "unavailable" | "timeout" | "stopped" | "session_expired";
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("idle");
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsLastSentAt, setGpsLastSentAt] = useState<number | null>(null);
  // True when 30+ seconds have elapsed since the last successful GPS PATCH
  // while an incident is active. Cleared as soon as a successful send occurs.
  const [gpsLost, setGpsLost] = useState(false);
  // "idle" | "sending" | "ok" | "fail:404" | "fail:500" | "error" etc.
  const [patchState, setPatchState] = useState<string>("idle");

  const storedId = typeof window !== "undefined" ? Number(localStorage.getItem(LIVE_INCIDENT_KEY)) || null : null;
  const [liveId, setLiveId] = useState<number | null>(storedId);
  const storedJoinedId = typeof window !== "undefined" ? Number(localStorage.getItem(JOINED_INCIDENT_KEY)) || null : null;
  const [joinedId, setJoinedId] = useState<number | null>(storedJoinedId);
  // Tracks whether this page session should redirect home when both IDs drop to null.
  // Set to true if we mounted with a stored ID (stale-key reopen) OR once we've
  // actually had an active incident in this session (normal start → end).
  const hadIncidentRef = useRef<boolean>((storedId !== null) || (storedJoinedId !== null));
  // True once the responder has tapped "Open Google Maps" — persisted in
  // localStorage so the red arrived-button survives app switches / PWA reloads.
  const [navStarted, setNavStarted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const navId = localStorage.getItem(NAV_STARTED_KEY);
    if (navId === null) return false;
    const liveIncId = localStorage.getItem(LIVE_INCIDENT_KEY);
    const joinedIncId = localStorage.getItem(JOINED_INCIDENT_KEY);
    return navId === liveIncId || navId === joinedIncId;
  });
  // Holds the just-created incident so the UI switches instantly before the
  // liveIncidents query has a chance to refetch and include the new record.
  const [pendingActive, setPendingActive] = useState<Incident | null>(null);

  const { data: me } = useQuery<{ id: string }>({ queryKey: ["/api/auth/me"] });

  type LiveIncidentWithResponders = Incident & {
    responders?: Array<{ id: number; userId: string; firstName: string; lastName: string; lastLat: number | null; lastLng: number | null; lastPositionAt: string | null; joinedAt: string }>;
    responderFirstName?: string | null;
    responderLastName?: string | null;
  };

  const { data: liveIncidents = [], isSuccess: liveQueryLoaded } = useQuery<LiveIncidentWithResponders[]>({
    queryKey: ["/api/incidents/live"],
    refetchInterval: 15000,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  // pendingActive is set immediately on startLive() success so the render
  // branch flips before the query refetch arrives. Once liveIncidents contains
  // the real record, the find() result takes over seamlessly.
  const active = pendingActive ?? (liveId ? liveIncidents.find((i) => i.id === liveId && i.isLive) ?? null : null);

  // Joinable incidents: live incidents not created by me, that I haven't already joined
  const joinedIncident = joinedId ? liveIncidents.find((i) => i.id === joinedId && i.isLive) ?? null : null;
  const joinableIncidents = liveId === null && joinedId === null
    ? liveIncidents.filter(i => i.isLive && i.userId !== me?.id && !(i.responders ?? []).some(r => r.userId === me?.id))
    : [];

  // Unified view — works for both creator and joiner
  const currentIncident: LiveIncidentWithResponders | null = active ?? joinedIncident;
  const currentIncidentId: number | null = liveId ?? joinedId;
  // Other-people responders on this incident (excludes self) — used for the nav-mode "en route" chip.
  const navResponders = (currentIncident?.responders ?? []).filter(r => r.userId !== me?.id);
  const isJoinerMode = joinedId !== null && active === null;

  // Screen Wake Lock — keep the screen on for the full duration of any live
  // incident (creator or joiner). Released automatically when the incident ends
  // or the user leaves. Re-acquired on tab visibility restore (browsers drop
  // the lock when the tab is hidden).
  // If the API is supported but the lock is denied at incident start, show a
  // one-time toast so the user knows to keep the screen on manually.
  useEffect(() => {
    if (currentIncidentId !== null) {
      acquireWakeLock().then((granted) => {
        if (!granted && wakeLockSupported && !wakeLockDeniedToastShownRef.current) {
          wakeLockDeniedToastShownRef.current = true;
          toast({
            title: "Screen may turn off",
            description: "Your device couldn't keep the screen on. You may need to keep it on manually during this incident.",
            variant: "destructive",
            duration: 7000,
          });
        }
      });
    } else {
      void releaseWakeLock();
    }
    return () => { void releaseWakeLock(); };
  }, [currentIncidentId, acquireWakeLock, releaseWakeLock, wakeLockSupported, toast]);

  // GPS lost detection — poll every 5 s; if the last successful PATCH is >60 s
  // old while an incident is active, raise the gpsLost flag. The flag is
  // cleared as soon as a successful send fires (inside sendPosition) or when
  // startTracking() is called (tracking restart). Covers both creator and joiner.
  useEffect(() => {
    if (currentIncidentId === null) {
      setGpsLost(false);
      return;
    }
    const id = setInterval(() => {
      // Not tracking at all — skip (stopTracking resets trackingStartedAtRef to 0)
      if (trackingStartedAtRef.current === 0) return;
      // Baseline is the last SUCCESSFUL send time if one has occurred, otherwise
      // the time tracking was started. This ensures the banner fires both when:
      //   (a) GPS was working but then stopped (lastSuccessRef > 0)
      //   (b) GPS has been failing since the session began (lastSuccessRef === 0)
      const baseline = lastSuccessRef.current > 0
        ? lastSuccessRef.current
        : trackingStartedAtRef.current;
      if (Date.now() - baseline > 60_000) {
        setGpsLost(true);
      }
    }, 5000);
    return () => {
      clearInterval(id);
      setGpsLost(false);
    };
  }, [currentIncidentId]);

  // Auto-retry GPS once, 10 s after signal is lost. If signal recovers via a
  // successful sendPosition, gpsLost clears and this effect re-runs cleanly.
  useEffect(() => {
    if (!gpsLost || currentIncidentId === null) return;
    const t = setTimeout(() => {
      console.log("[GPS] auto-retry after signal loss");
      if (joinedId) { gpsEndpointRef.current = "joiner-position"; startTracking(joinedId); }
      else if (liveId) { gpsEndpointRef.current = "responder-position"; startTracking(liveId); }
    }, 10_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsLost, currentIncidentId]);

  function stopStepTracking() {
    if (stepCheckIntervalRef.current !== null) {
      clearInterval(stepCheckIntervalRef.current);
      stepCheckIntervalRef.current = null;
    }
  }

  function stopGpsFallbackTracking() {
    if (gpsFallbackIntervalRef.current !== null) {
      clearInterval(gpsFallbackIntervalRef.current);
      gpsFallbackIntervalRef.current = null;
    }
  }

  function startStepTracking() {
    stopStepTracking();
    stepCheckIntervalRef.current = setInterval(() => {
      const pos = lastPosRef.current;
      const steps = stepsRef.current;
      if (!pos || steps.length === 0) {
        setIsOffRoute(false);
        return;
      }

      // --- Route-deviation: minimum distance from pos to nearest point on any step segment ---
      let minRouteDistM = Infinity;
      for (const step of steps) {
        const a = { lat: step.start_location.lat(), lng: step.start_location.lng() };
        const b = { lat: step.end_location.lat(), lng: step.end_location.lng() };
        const d = ptSegDistM(pos, a, b);
        if (d < minRouteDistM) minRouteDistM = d;
      }
      setIsOffRoute(minRouteDistM > 150);

      // Auto-reroute in nav mode when off-course, rate-limited to once per 30 s.
      if (navModeRef.current && minRouteDistM > 150 && destPositionRef.current) {
        const now = Date.now();
        if (now - lastRerouteRef.current > 30_000) {
          lastRerouteRef.current = now;
          drawRoute(destPositionRef.current.lat, destPositionRef.current.lng, pos ?? undefined, navModeRef.current);
        }
      }

      // --- Step advancement: forward-only snap at 30 m, then nearest-start fallback for initial fix ---
      let idx = currentStepIndexRef.current;
      // Advance forward when within 60 m of the next step's start (wider radius handles
      // urban GPS accuracy of 30–50 m without jumping steps on straight roads).
      while (idx < steps.length - 1) {
        const nextLoc = steps[idx + 1].start_location;
        if (haversineM(pos, { lat: nextLoc.lat(), lng: nextLoc.lng() }) <= 60) {
          idx++;
        } else {
          break;
        }
      }
      // Initial-placement fallback: if still on step 0, jump to nearest start (handles GPS warm-up).
      if (idx === 0) {
        let nearestIdx = 0;
        let nearestDist = Infinity;
        for (let i = 0; i < steps.length; i++) {
          const loc = steps[i].start_location;
          const d = haversineM(pos, { lat: loc.lat(), lng: loc.lng() });
          if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
        }
        if (nearestIdx > idx) idx = nearestIdx;
      }

      // Voice announcement when step index advances (announce the newly entered step instruction).
      if (idx !== currentStepIndexRef.current && steps[idx]) {
        const advancedStep = steps[idx];
        if (idx !== announcedStepRef.current) {
          announcedStepRef.current = idx;
          try {
            const utt = new SpeechSynthesisUtterance(stripHtml(advancedStep.instructions));
            utt.lang = "en-US";
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utt);
          } catch { /* TTS unavailable — silently skip */ }
        }
      }
      currentStepIndexRef.current = idx;
      setCurrentStepIndex(idx);

      // --- Step distance + 200 m approaching-turn warning (separate voice gate) ---
      const currStep = steps[idx];
      if (currStep) {
        const endLoc = currStep.end_location;
        const dist = Math.round(haversineM(pos, { lat: endLoc.lat(), lng: endLoc.lng() }));
        setStepDist(dist);
        // Approaching-turn announcement uses its OWN ref so it doesn't interfere with
        // the step-advance announcement and always fires once per step when within 200 m.
        if (dist <= 200 && idx !== approachingTurnAnnouncedRef.current) {
          approachingTurnAnnouncedRef.current = idx;
          try {
            const utt = new SpeechSynthesisUtterance(`In ${fmtDist(dist)}, ${stripHtml(currStep.instructions)}`);
            utt.lang = "en-US";
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utt);
          } catch { /* TTS unavailable — silently skip */ }
        }
      }
    }, 5000);
  }

  function stopTracking() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    stopStepTracking();
    stopGpsFallbackTracking();
    lastPosRef.current = null;
    trackingStartedAtRef.current = 0;
  }

  function startTracking(incidentId: number) {
    // Record which incident we are tracking BEFORE stopTracking so the useEffect
    // guard can skip a redundant call for the same id.
    trackingIncidentIdRef.current = incidentId;
    // Clear any stale lost-GPS warning immediately when a tracking restart is
    // requested — the user has tapped Retry or the incident just became active.
    setGpsLost(false);
    stopTracking();
    if (!navigator.geolocation) {
      setGpsStatus("unavailable");
      return;
    }
    consecutiveFailuresRef.current = 0;
    lastSentRef.current = 0;
    lastSuccessRef.current = 0;
    trackingStartedAtRef.current = Date.now();
    setGpsLastSentAt(null);
    setPatchState("idle");
    setGpsStatus("acquiring");
    console.log("[GPS] startTracking for incident", incidentId);

    // sessionExpiredRef lets watch callbacks skip status updates once session expires
    const sessionExpiredRef = { current: false };
    const sendPosition = async (pos: GeolocationPosition) => {
      if (sessionExpiredRef.current) return;
      const accuracy = pos.coords.accuracy;
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      lastPosRef.current = p;
      // Speed from Geolocation API — only valid when positive; null indoors / on first fix.
      const speedMs = pos.coords.speed;
      setSpeedKmh(speedMs != null && speedMs >= 0 ? Math.round(speedMs * 3.6) : null);

      // --- BULLETPROOF PANIC GUARD ---
      // Panic incidents set destinationLat/Lng to the panicker's own coords.
      // We must NEVER trigger arrival logic (speech, UI, or server push) for them.
      const catName = (currentIncident?.categoryName ?? "").toLowerCase();
      const isPanic = catName.includes("panic");
      console.log("[ARRIVAL] isPanicIncident =", isPanic, "categoryName =", currentIncident?.categoryName);
      if (isPanic) {
        console.log("[ARRIVAL] Panic detected — blocking arrival notification/push entirely");
        setIsNearDestination(false);
        // Do NOT null destPositionRef here — it is still needed for route rerouting in nav mode.
        // Arrival logic is already suppressed via isPanicIncidentRef.current in the else-if below.
        arrivedAnnouncedRef.current = false;
      } else if (destPositionRef.current && !isPanicIncidentRef.current) {
        const nearDest = haversineM(p, destPositionRef.current) <= 150;
        setIsNearDestination(nearDest);
        if (nearDest && !arrivedAnnouncedRef.current) {
          arrivedAnnouncedRef.current = true;
          try {
            const utt = new SpeechSynthesisUtterance("You have arrived at your destination.");
            utt.lang = "en-US";
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utt);
          } catch { /* TTS unavailable — silently skip */ }
        }
      }
      originMarkerRef.current?.setPosition(p);
      if (isNative && capMapRef.current) {
        // ── Native camera + user marker ────────────────────────────────────────
        // Place/update the blue "you are here" dot on the native map. The
        // originMarkerRef above is a JS-API Marker and does nothing on native.
        // Skip user-marker remove+add cycle while in nav mode. v66 diagnostic
        // confirmed that addMarker churn on every GPS fix (~1 Hz) clobbers
        // the camera tilt on Android — every marker mutation triggers a
        // native camera-state refresh that snaps tilt back to 0. In nav mode
        // the camera follows the user (they're always centered on screen)
        // so the "you are here" dot is redundant anyway. Outside nav mode
        // (initial dispatch view) the marker updates as normal — there's no
        // tilt to clobber so the churn is harmless visually.
        if (!navModeRef.current) {
          capMapRef.current.setUserLocation(p.lat, p.lng).catch(() => {});
        }
        const hdg = pos.coords.heading;
        if (hdg != null && !isNaN(hdg)) lastHeadingRef.current = hdg;
        // Retry route draw on first GPS fix — handles the race where drawRoute was
        // called at mapsReady time but had no origin yet (lastPosRef was null).
        if (stepsRef.current.length === 0 && destPositionRef.current && !navModeRef.current) {
          drawRoute(destPositionRef.current.lat, destPositionRef.current.lng, p);
        }
        if (navModeRef.current) {
          // Nav mode: camera follows the user with 45° tilt and bearing
          // toward direction of travel. animate:true with duration:0 routes
          // through animateCamera (not moveCamera); v67 testing confirmed
          // moveCamera silently drops the tilt component on this Android
          // Maps SDK version, while animateCamera honours all CameraPosition
          // fields. Duration:0 keeps it visually instantaneous.
          capMapRef.current.setCamera({
            lat: p.lat, lng: p.lng, zoom: 17, tilt: 45,
            bearing: lastHeadingRef.current ?? 0,
            animate: true,
          }).catch(() => {});
        }
        // No else branch — outside nav mode we let the user pan/zoom freely
        // and rely on the blue user-location dot (above) to indicate where
        // they are. Forcing tilt:0 every fix would fight a pinch-zoom or
        // gesture-rotate the user initiates on the dispatch view.
      } else if (mapInstanceRef.current) {
        if (navModeRef.current) {
          // Navigation perspective: tilt 45° and rotate map to face direction of travel.
          // Use moveCamera for an atomic update — individual setCenter/setHeading/setOptions
          // calls can partially reset each other on vector maps.
          const hdg = pos.coords.heading;
          if (hdg != null && !isNaN(hdg)) {
            lastHeadingRef.current = hdg;
          }
          (mapInstanceRef.current as any).moveCamera({
            center: p,
            tilt: 45,
            zoom: 17,
            ...(lastHeadingRef.current != null ? { heading: lastHeadingRef.current } : {}),
          });
        } else {
          mapInstanceRef.current.setCenter(p);
        }
      }
      setGpsAccuracy(Math.round(accuracy));

      // Accuracy gate — ALWAYS send on the very first position regardless of accuracy.
      // After that: stale (>60 s since last send) → 500 m; ongoing → 200 m.
      // Heartbeat override: if >25 s have passed with no send (e.g. reporter is
      // stationary and GPS accuracy has degraded indoors), bypass both the accuracy
      // gate and the 5-second throttle so the admin always gets a ping ≤25 s old.
      const isFirstSend = lastSentRef.current === 0;
      const now = Date.now();
      // 25 s heartbeat — keeps the gap between successful sends below the
      // 30 s GPS-lost detection threshold even in stationary indoor mode.
      const isHeartbeat = !isFirstSend && (now - lastSentRef.current) > 25000;

      if (!isFirstSend && !isHeartbeat) {
        const isStale = (now - lastSentRef.current) > 60000;
        const threshold = isStale ? GPS_ACCURACY_FIRST : GPS_ACCURACY_ONGOING;
        if (accuracy > threshold) {
          setGpsStatus("acquiring");
          return;
        }
      }

      // Throttle to one send every 5 seconds for movement updates.
      // Heartbeat and first sends always bypass the throttle.
      if (!isFirstSend && !isHeartbeat && (now - lastSentRef.current < 5000)) return;
      lastSentRef.current = now;

      console.log(`[GPS] → PATCH incident=${incidentId} lat=${p.lat.toFixed(5)} lng=${p.lng.toFixed(5)} acc=${Math.round(accuracy)}m first=${isFirstSend}`);
      setPatchState("sending");

      try {
        const endpoint = gpsEndpointRef.current;
        const res = await fetch(`/api/incidents/${incidentId}/${endpoint}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(p),
          credentials: "include",
        });
        console.log(`[GPS] ← PATCH HTTP ${res.status} incident=${incidentId}`);
        if (res.ok) {
          setGpsStatus(isHeartbeat ? "stationary" : "tracking");
          setGpsLastSentAt(Date.now());
          lastSuccessRef.current = Date.now();
          setPatchState("ok");
          setGpsLost(false);
          consecutiveFailuresRef.current = 0;
        } else if (res.status === 401) {
          sessionExpiredRef.current = true;
          setPatchState("fail:401");
          setGpsStatus("session_expired");
          stopTracking();
        } else if (res.status === 403 || res.status === 404) {
          // 403 from joiner-position: server says we are no longer an active
          // joiner (left, arrived, or were removed). 404: incident no longer
          // live. Either way, retrying is pointless and produces the orange
          // "PATCH failed" loop the user reported. Clear state once.
          setPatchState(`fail:${res.status}`);
          console.warn(`[GPS] PATCH HTTP ${res.status} for incident ${incidentId} — clearing stale tracking session`);
          if (endpoint === "joiner-position") {
            resetAfterLeave();
            toast({
              title: "Joiner session ended",
              description: res.status === 403
                ? "You are no longer part of this incident."
                : "This incident is no longer live.",
            });
          } else {
            // Creator's responder-position 404 — incident ended elsewhere
            stopTracking();
            setGpsStatus("stopped");
          }
        } else {
          setPatchState(`fail:${res.status}`);
          console.warn(`[GPS] PATCH failed HTTP ${res.status} for incident ${incidentId}`);
          consecutiveFailuresRef.current++;
          // Do NOT stop tracking on transient HTTP errors (5xx, 408, etc.) —
          // keep retrying silently so a temporary server hiccup doesn't
          // permanently kill GPS for the session.
        }
      } catch (err) {
        console.error("[GPS] PATCH network error for incident", incidentId, err);
        setPatchState("error");
        // Network error (offline, DNS, etc.) — keep trying silently
      }
    };

    function startWatch() {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => { void sendPosition(pos); },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            setGpsStatus("denied");
            stopTracking();
          } else {
            // TIMEOUT / POSITION_UNAVAILABLE are normal on Android Chrome —
            // the hardware briefly loses signal, then recovers on its own.
            // Never stop tracking for these; the 9-second fallback keeps
            // positions flowing while watchPosition waits for a better fix.
            setGpsStatus("acquiring");
          }
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
      );
      startStepTracking();
      stopGpsFallbackTracking();
      gpsFallbackIntervalRef.current = setInterval(() => {
        navigator.geolocation.getCurrentPosition(
          (pos) => { void sendPosition(pos); },
          () => {
            // Ignore fallback probe failures; watchPosition may still recover.
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );
      }, 9000);
    }

    // Explicit permission probe — reliably triggers the browser's location
    // prompt and gives us the first position to send immediately.
    // watchPosition is only started after probe succeeds so we don't race
    // the permission dialog with a silent parallel watch.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void sendPosition(pos);
        // Always start continuous watch regardless of probe accuracy
        startWatch();
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGpsStatus("denied");
        }
        else {
          // Unavailable/timeout on probe — still try watch; it may recover
          setGpsStatus("unavailable");
          startWatch();
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // Restart GPS for creator (active) OR joiner (joinedIncident), even if
      // tracking had already auto-stopped (e.g. after screen-lock on iOS/Android).
      if (active) {
        startTracking(active.id);
      } else if (joinedIncident) {
        startTracking(joinedIncident.id);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [active?.id, joinedIncident?.id]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (lastSentRef.current > 0) setGpsLastSentAt(lastSentRef.current);
    }, 1000);
    return () => clearInterval(t);
  }, [active?.id]);

  function resetAfterEnd() {
    trackingIncidentIdRef.current = null;
    stopTracking();
    gpsEndpointRef.current = "responder-position";
    setGpsStatus("idle");
    setGpsAccuracy(null);
    setGpsLost(false);
    localStorage.removeItem(LIVE_INCIDENT_KEY);
    localStorage.removeItem(NAV_STARTED_KEY);
    setNavStarted(false);
    setPendingActive(null);
    setLiveId(null);
    stepsRef.current = [];
    announcedStepRef.current = -1;
    approachingTurnAnnouncedRef.current = -1;
    arrivedAnnouncedRef.current = false;
    setNavMode(false);
    setHasRoute(false);
    setCurrentStepIndex(0);
    setStepDist(null);
    setIsOffRoute(false);
    setShowArrivalForm(false);
    setIsNearDestination(false);
    setArrivalCategoryId(null);
    setArrivalOtherType("");
    setArrivalDescription("");
    setArrivalMedia((prev) => {
      prev.forEach((m) => { if (m.url.startsWith("blob:")) URL.revokeObjectURL(m.url); });
      return [];
    });
    arrivalMediaBlobsRef.current.clear();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setRecordingSeconds(0);
    setDestination(null);
    setSearch("");
    queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
    queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
  }

  function resetAfterLeave() {
    trackingIncidentIdRef.current = null;
    stopTracking();
    gpsEndpointRef.current = "responder-position";
    setGpsStatus("idle");
    setGpsAccuracy(null);
    setGpsLost(false);
    // Clear all nav/arrival state so a subsequent creator session starts clean
    localStorage.removeItem(JOINED_INCIDENT_KEY);
    localStorage.removeItem(NAV_STARTED_KEY);
    setJoinedId(null);
    setNavStarted(false);
    announcedStepRef.current = -1;
    approachingTurnAnnouncedRef.current = -1;
    arrivedAnnouncedRef.current = false;
    setNavMode(false);
    setDestination(null);
    setSearch("");
    setSuggestions([]);
    setShowArrivalForm(false);
    setArrivalCategoryId(null);
    setArrivalOtherType("");
    setArrivalDescription("");
    setArrivalMedia((prev) => {
      prev.forEach((m) => { if (m.url.startsWith("blob:")) URL.revokeObjectURL(m.url); });
      return [];
    });
    arrivalMediaBlobsRef.current.clear();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setRecordingSeconds(0);
    queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
  }

  const joinLiveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/incidents/${id}/join-live`, {}),
    onSuccess: (_, id) => {
      localStorage.setItem(JOINED_INCIDENT_KEY, String(id));
      setJoinedId(id);
      gpsEndpointRef.current = "joiner-position";
      startTracking(id);
      queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
      toast({ title: "Joined incident", description: "Your GPS position is now being shared with the team." });
    },
    onError: () => toast({ title: "Error", description: "Could not join the incident.", variant: "destructive" }),
  });

  const leaveLiveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/incidents/${id}/leave-live`, {}),
    onSuccess: () => {
      resetAfterLeave();
      toast({ title: "Left incident", description: "You have left the live incident response." });
    },
    onError: () => toast({ title: "Error", description: "Could not leave the incident.", variant: "destructive" }),
  });

  async function submitArrival() {
    if (!liveId) return;

    // Build final description here so it is used by both online and offline paths
    const finalDescription = (() => {
      const otherTrimmed = arrivalOtherType.trim();
      const descTrimmed = arrivalDescription.trim();
      if (otherTrimmed) return descTrimmed ? `${otherTrimmed}: ${descTrimmed}` : otherTrimmed;
      return descTrimmed;
    })();

    // If data is off, queue the arrival locally and submit when connectivity returns
    if (!navigator.onLine) {
      const otherNoteTrimmedQ = arrivalOtherType.trim();
      const queuedLocationName = (() => {
        if (active?.destinationName?.trim()) return active.destinationName.trim();
        const pos = lastPosRef.current;
        if (pos) return `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`;
        if (active?.liveStartLat != null && active?.liveStartLng != null) {
          return `${active.liveStartLat.toFixed(4)}, ${active.liveStartLng.toFixed(4)}`;
        }
        return null;
      })();
      // Only persist media items whose URLs are already GCS-hosted (not blob:).
      // Offline blobs stay in arrivalMediaBlobsRef and are uploaded on replay.
      const queuedMedia = arrivalMedia.filter((m) => !m.url.startsWith("blob:"));
      const queued = { incidentId: liveId, categoryId: arrivalCategoryId, otherCategoryNote: otherNoteTrimmedQ || null, description: finalDescription, locationName: queuedLocationName, media: queuedMedia };
      localStorage.setItem(ARRIVAL_QUEUE_KEY, JSON.stringify(queued));
      toast({
        title: "No data connection",
        description: "Your arrival report is saved on this device. It will be submitted automatically when your data is restored.",
      });
      return;
    }

    setArrivalSubmitting(true);
    try {
      // 1. Patch the incident with arrival details (location, time, category, notes)
      const at = arrivalTimeRef.current;
      const otherNoteTrimmed = arrivalOtherType.trim();
      // Resolve final location: destination name > last GPS fix > liveStart coords > null
      const liveLocationName = (() => {
        if (active?.destinationName?.trim()) return active.destinationName.trim();
        const pos = lastPosRef.current;
        if (pos) return `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`;
        if (active?.liveStartLat != null && active?.liveStartLng != null) {
          return `${active.liveStartLat.toFixed(4)}, ${active.liveStartLng.toFixed(4)}`;
        }
        return null;
      })();
      const arrivalPos = lastPosRef.current ?? (
        active?.liveStartLat != null && active?.liveStartLng != null
          ? { lat: active.liveStartLat, lng: active.liveStartLng }
          : null
      );
      await apiRequest("PATCH", `/api/incidents/${liveId}`, {
        ...(arrivalCategoryId ? { categoryId: arrivalCategoryId } : {}),
        ...(otherNoteTrimmed ? { otherCategoryNote: otherNoteTrimmed } : {}),
        description: finalDescription || "",
        locationName: liveLocationName,
        incidentDate: at.toISOString().slice(0, 10),
        incidentTime: at.toTimeString().slice(0, 5),
        ...(arrivalPos ? { latitude: arrivalPos.lat, longitude: arrivalPos.lng } : {}),
      });
      // 2. Save all media attachments (upload any pending blobs first)
      for (const mediaRecord of arrivalMedia) {
        let record = mediaRecord;
        if (record.url.startsWith("blob:")) {
          const blobEntry = arrivalMediaBlobsRef.current.get(record.id);
          if (!blobEntry) throw new Error(`A media item blob is no longer available — please retake it.`);
          const uploadResp = await fetch("/api/uploads", {
            method: "POST",
            headers: { "Content-Type": blobEntry.mimeType },
            body: blobEntry.blob,
            credentials: "include",
          });
          if (!uploadResp.ok) throw new Error(`A media upload failed — please check your connection.`);
          const { objectUrl } = await uploadResp.json();
          URL.revokeObjectURL(record.url);
          arrivalMediaBlobsRef.current.delete(record.id);
          record = { ...record, url: objectUrl };
        }
        if (!record.url.startsWith("blob:")) {
          await apiRequest("POST", `/api/incidents/${liveId}/attachments`, { url: record.url, filename: record.filename, mimeType: record.mimeType });
        }
      }
      // 3. Capture closure GPS coords (best-effort, 5 s timeout)
      const closureCoords = await new Promise<{ liveConvertLat: number; liveConvertLng: number } | null>((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ liveConvertLat: pos.coords.latitude, liveConvertLng: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
      });
      // 4. End the live session
      await apiRequest("POST", `/api/incidents/${liveId}/end-live`, closureCoords ?? {});
      localStorage.removeItem(ARRIVAL_QUEUE_KEY);
      resetAfterEnd();
      toast({ title: "Incident recorded", description: "Safe return. Incident saved to the Occurrence Book." });
      navigate("/");
    } catch (e: unknown) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Could not record arrival.", variant: "destructive" });
    } finally {
      setArrivalSubmitting(false);
    }
  }

  function removeMedia(id: string) {
    setArrivalMedia((prev) => {
      const item = prev.find((m) => m.id === id);
      if (item?.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
      arrivalMediaBlobsRef.current.delete(id);
      return prev.filter((m) => m.id !== id);
    });
  }

  async function handleAddImage(file: File) {
    if (arrivalMedia.length >= MAX_ARRIVAL_MEDIA) {
      toast({ title: "Limit reached", description: `You can attach up to ${MAX_ARRIVAL_MEDIA} media items per arrival report.`, variant: "destructive" });
      return;
    }
    if (file.size > MAX_MEDIA_BYTES) {
      toast({ title: "File too large", description: "Each photo must be under 10 MB.", variant: "destructive" });
      return;
    }
    const id = crypto.randomUUID();
    setArrivalUploading(true);
    try {
      const blob = await compressImageToBlob(file, 1024, 0.72);
      const filename = file.name.replace(/\.[^.]+$/, ".jpg");
      if (navigator.onLine) {
        const tempUrl = URL.createObjectURL(blob);
        setArrivalMedia((prev) => [...prev, { id, url: tempUrl, filename, mimeType: "image/jpeg" }]);
        const uploadResp = await fetch("/api/uploads", {
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
          body: blob,
          credentials: "include",
        });
        if (!uploadResp.ok) throw new Error("Upload failed");
        const { objectUrl } = await uploadResp.json();
        URL.revokeObjectURL(tempUrl);
        setArrivalMedia((prev) => prev.map((m) => m.id === id ? { ...m, url: objectUrl } : m));
      } else {
        arrivalMediaBlobsRef.current.set(id, { blob, filename, mimeType: "image/jpeg" });
        const previewUrl = URL.createObjectURL(blob);
        setArrivalMedia((prev) => [...prev, { id, url: previewUrl, filename, mimeType: "image/jpeg" }]);
        toast({ title: "Photo saved locally", description: "No connection — photo will upload when your arrival is submitted." });
      }
    } catch {
      // Remove the placeholder added before upload if the upload fails
      setArrivalMedia((prev) => {
        const item = prev.find((m) => m.id === id);
        if (item?.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
        return prev.filter((m) => m.id !== id);
      });
      arrivalMediaBlobsRef.current.delete(id);
      toast({ title: "Photo error", description: "Could not process the photo. Please try again.", variant: "destructive" });
    } finally {
      setArrivalUploading(false);
    }
  }

  async function startRecording() {
    if (!navigator.onLine) {
      toast({ title: "No connection", description: "Voice recording requires a data connection.", variant: "destructive" });
      return;
    }
    if (arrivalMedia.length >= MAX_ARRIVAL_MEDIA) {
      toast({ title: "Limit reached", description: `You can attach up to ${MAX_ARRIVAL_MEDIA} media items per arrival report.`, variant: "destructive" });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Mirror incident-dialog.tsx: negotiate MIME type in priority order
      const supportedMime = ["audio/webm", "audio/ogg", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
      if (!supportedMime) {
        stream.getTracks().forEach((t) => t.stop());
        toast({ title: "Unsupported device", description: "Your browser does not support audio recording.", variant: "destructive" });
        return;
      }
      audioChunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: supportedMime });
      mediaRecorderRef.current = mr;
      // Stable ID allocated now so onstop closure has the right reference regardless of
      // any array mutations that happen between start and stop.
      const id = crypto.randomUUID();
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const mimeType = supportedMime;
        const ext = mimeType.split("/")[1] ?? "webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const filename = `voice-${Date.now()}.${ext}`;
        // Store in blob map before upload so submit logic can find it if the user submits
        // while the in-flight upload is still pending (race-safe)
        arrivalMediaBlobsRef.current.set(id, { blob: audioBlob, filename, mimeType });
        const previewUrl = URL.createObjectURL(audioBlob);
        setArrivalMedia((prev) => [...prev, { id, url: previewUrl, filename, mimeType }]);
        // Upload immediately (voice always requires being online); on failure discard the item
        fetch("/api/uploads", {
          method: "POST",
          headers: { "Content-Type": mimeType },
          body: audioBlob,
          credentials: "include",
        }).then((r) => r.ok ? r.json() : Promise.reject()).then(({ objectUrl }) => {
          URL.revokeObjectURL(previewUrl);
          arrivalMediaBlobsRef.current.delete(id);
          setArrivalMedia((prev) => prev.map((m) => m.id === id ? { ...m, url: objectUrl } : m));
        }).catch(() => {
          // Upload failed — discard the item so the user knows to re-record
          URL.revokeObjectURL(previewUrl);
          arrivalMediaBlobsRef.current.delete(id);
          setArrivalMedia((prev) => prev.filter((m) => m.id !== id));
          toast({ title: "Upload failed", description: "Voice recording could not be saved. Please try again.", variant: "destructive" });
        });
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setIsRecording(false);
        setRecordingSeconds(0);
      };
      mr.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => {
          if (s >= 119) { mr.stop(); return s; }
          return s + 1;
        });
      }, 1000);
    } catch {
      toast({ title: "Microphone error", description: "Could not access microphone. Check permissions and try again.", variant: "destructive" });
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
  }

  // Online / offline detection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Keep arrivalMediaStateRef in sync so the unmount cleanup can revoke blob: URLs
  arrivalMediaStateRef.current = arrivalMedia;

  // Revoke any lingering blob: URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      arrivalMediaStateRef.current.forEach((m) => { if (m.url.startsWith("blob:")) URL.revokeObjectURL(m.url); });
      arrivalMediaBlobsRef.current.clear();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  // When connectivity is restored, auto-submit any queued arrival
  useEffect(() => {
    if (!isOnline) return;
    const raw = localStorage.getItem(ARRIVAL_QUEUE_KEY);
    if (!raw) return;
    // Support both legacy `photo` shape and new `media` array shape
    let queued: { incidentId: number; categoryId: number | null; otherCategoryNote?: string | null; description: string; locationName?: string | null; media?: ArrivalMedia[]; photo?: ArrivalMedia | null };
    try { queued = JSON.parse(raw); } catch { localStorage.removeItem(ARRIVAL_QUEUE_KEY); return; }
    if (!queued.incidentId) { localStorage.removeItem(ARRIVAL_QUEUE_KEY); return; }
    localStorage.removeItem(ARRIVAL_QUEUE_KEY);
    (async () => {
      try {
        await apiRequest("PATCH", `/api/incidents/${queued.incidentId}`, {
          ...(queued.categoryId ? { categoryId: queued.categoryId } : {}),
          ...(queued.otherCategoryNote?.trim() ? { otherCategoryNote: queued.otherCategoryNote.trim() } : {}),
          description: queued.description?.trim() || "",
          locationName: queued.locationName ?? null,
        });
        // Normalise legacy `photo` key to a media array; strip `id` if present (it was in-memory only)
        const persistedMedia: Omit<ArrivalMedia, "id">[] = queued.media ?? (queued.photo ? [queued.photo] : []);
        // Persist already-uploaded GCS attachments
        for (const item of persistedMedia) {
          if (!item.url.startsWith("blob:")) {
            await apiRequest("POST", `/api/incidents/${queued.incidentId}/attachments`, { url: item.url, filename: item.filename, mimeType: item.mimeType });
          }
        }
        // Upload in-memory blobs (captured offline, still in memory)
        for (const [, blobEntry] of arrivalMediaBlobsRef.current) {
          const uploadResp = await fetch("/api/uploads", {
            method: "POST",
            headers: { "Content-Type": blobEntry.mimeType },
            body: blobEntry.blob,
            credentials: "include",
          });
          if (!uploadResp.ok) {
            // Re-queue the arrival so the user can retry; abort before ending the live session
            localStorage.setItem(ARRIVAL_QUEUE_KEY, raw);
            toast({ title: "Media upload failed", description: "Could not upload a media item. Your arrival will retry when you tap 'Record Incident' again.", variant: "destructive" });
            return;
          }
          const { objectUrl } = await uploadResp.json();
          await apiRequest("POST", `/api/incidents/${queued.incidentId}/attachments`, { url: objectUrl, filename: blobEntry.filename, mimeType: blobEntry.mimeType });
        }
        arrivalMediaBlobsRef.current.clear();
        await apiRequest("POST", `/api/incidents/${queued.incidentId}/end-live`, {});
        resetAfterEnd();
        navigate("/");
        toast({ title: "Arrival submitted", description: "Your arrival report was sent once data was restored." });
        queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
        queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      } catch {
        toast({ title: "Sync failed", description: "Could not submit your queued arrival. Please try again.", variant: "destructive" });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  useEffect(() => {
    // Always load the JS API — it's needed for search/geocoding on both web and
    // native, and as a map fallback if native Capacitor map fails.
    loadGoogleMaps().then(() => {
      setMapsReady(true);
      // Initialize search/geocoder services as soon as the JS API loads.
      // These work in the Capacitor WebView and avoid CORS issues from
      // calling Google REST APIs directly via fetch().
      if (!geocoderRef.current && window.google?.maps) {
        geocoderRef.current = new google.maps.Geocoder();
        setGeocoderReady(true);
      }
      if (!autocompleteRef.current && window.google?.maps?.places) {
        autocompleteRef.current = new google.maps.places.AutocompleteService();
        setAutocompleteReady(true);
      }
    }).catch((err) => {
      setMapsError(true);
      setMapsErrorMsg(err?.message ?? String(err));
    });
    return () => stopTracking();
  }, []);

  useEffect(() => {
    if (!useWebMap || !mapsReady || !mapRef.current || mapInstanceRef.current) return;
    const map = new google.maps.Map(mapRef.current, {
      center: { lat: -26.2041, lng: 28.0473 },
      zoom: 6,
      mapId: "d5b5764e0927466e62dc5e4e",
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      rotateControl: false,
      gestureHandling: "greedy",
      zoomControl: true,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
    });
    mapInstanceRef.current = map;
    geocoderRef.current = new google.maps.Geocoder();
    autocompleteRef.current = new google.maps.places.AutocompleteService();

    const renderer = new google.maps.DirectionsRenderer({
      suppressMarkers: true,
      polylineOptions: { strokeColor: "#4285F4", strokeWeight: 7, strokeOpacity: 0.95 },
    });
    renderer.setMap(map);
    directionsRendererRef.current = renderer;

    // Nav-mode zoom guardian: whenever anything (fitBounds, setDirections, async
    // callbacks) tries to zoom the map below street level during navigation, snap
    // it straight back to 17. Runs for the lifetime of the map instance.
    map.addListener("zoom_changed", () => {
      if (navModeRef.current && (map.getZoom() ?? 17) < 15) {
        map.setZoom(17);
      }
    });

    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLoc(p);
        map.setCenter(p);
        map.setZoom(13);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#3b82f6" stroke="white" stroke-width="2"/><circle cx="10" cy="10" r="4" fill="white" fill-opacity="0.85"/></svg>`;
        originMarkerRef.current = new google.maps.Marker({
          position: p,
          map,
          icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize: new google.maps.Size(20, 20), anchor: new google.maps.Point(10, 10) },
          title: "Your location",
          zIndex: 100,
        });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsReady, nativeMapFailed]);

  // Fallback: if localStorage was cleared (fresh app open), auto-detect this
  // user's active live incident from the server query and resume tracking.
  // Only bind if exactly one matching incident exists to avoid ambiguity.
  useEffect(() => {
    if (!liveQueryLoaded || !me || liveId !== null) return;
    const myIncidents = liveIncidents.filter(i => i.isLive && i.userId === me.id);
    if (myIncidents.length === 1) {
      localStorage.setItem(LIVE_INCIDENT_KEY, String(myIncidents[0].id));
      setLiveId(myIncidents[0].id);
    }
  }, [liveQueryLoaded, me?.id, liveId]);

  // Stale-liveId cleanup: if the live-incidents query has loaded and our stored
  // liveId is no longer an active live incident (it ended in a previous session),
  // clear the stale localStorage key and reset state so that both the autostart
  // effect (below) and the manual "Start Live Incident" button are unblocked.
  // Guard: pendingActive !== null means startLive() just ran and the new incident
  // hasn't appeared in the refetch yet — never wipe a just-created incident.
  useEffect(() => {
    if (!liveQueryLoaded || liveId === null || pendingActive !== null) return;
    const isStillLive = liveIncidents.some(i => i.id === liveId && i.isLive);
    if (!isStillLive) {
      try { localStorage.removeItem(LIVE_INCIDENT_KEY); } catch { /* ignore */ }
      setLiveId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveQueryLoaded, liveId, liveIncidents, pendingActive]);

  // Mark hadIncidentRef as soon as we actually have an active incident so the
  // redirect effect below knows this wasn't a fresh "start new" session.
  useEffect(() => {
    if (active !== null || joinedIncident !== null) {
      hadIncidentRef.current = true;
    }
  // active and joinedIncident are derived from state — intentional narrow dep list
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, joinedIncident?.id]);

  // Redirect home when the incident is finished and this session ever had one.
  // This covers:
  //   1. Stale-key reopen (storedId was set → hadIncidentRef=true on mount)
  //   2. Normal close (finishClosePanicLocal / resetAfterEnd set liveId→null)
  //   3. Remote close detected by the stale-liveId cleanup above
  // Fresh visits where the user is choosing to start a new incident are NOT
  // affected — hadIncidentRef starts false and liveId stays null throughout.
  useEffect(() => {
    if (!liveQueryLoaded) return;
    if (liveId !== null || joinedId !== null) return;
    if (!hadIncidentRef.current) return;
    // Don't redirect if we're mid-flow from severity selection — autostart will
    // create a new incident immediately after. Redirecting here would send the
    // user home while startLive() fires in the background.
    const autostartPending = (() => { try { return !!localStorage.getItem("omt_live_autostart"); } catch { return false; } })();
    if (autostartPending) return;
    hadIncidentRef.current = false; // reset so a subsequent new incident on the same mount works
    navigate("/");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveId, joinedId, liveQueryLoaded]);

  // Fallback recovery for joiner mode: if the user was a joiner and the page
  // reloaded, resume GPS tracking for the joined incident.
  // Primary: restore from localStorage. Fallback: derive from server — if the current user
  // is an active responder in any live incident, enter joiner mode even without the key.
  useEffect(() => {
    if (!liveQueryLoaded || !me || joinedId !== null || liveId !== null) return;
    const storedJoined = localStorage.getItem(JOINED_INCIDENT_KEY);
    if (storedJoined) {
      const id = parseInt(storedJoined);
      if (isNaN(id)) { localStorage.removeItem(JOINED_INCIDENT_KEY); return; }
      const joinedInc = liveIncidents.find(i => i.id === id && i.isLive);
      // Only re-enter joiner mode if the server still considers us an active
      // responder. If the incident is live but we're no longer in its
      // responders list (we left or arrived in a prior session), discard the
      // stale key — otherwise startTracking would PATCH /joiner-position and
      // get 403 forever (the bug Nicolaas hit at 13:48 after a 11:53 arrival).
      if (joinedInc) {
        const stillActive = (joinedInc.responders ?? []).some(r => r.userId === me.id);
        if (stillActive) {
          setJoinedId(id);
          return;
        }
      }
      localStorage.removeItem(JOINED_INCIDENT_KEY);
      // Stale joiner key implies any persisted nav-started flag is also stale.
      // Without this cleanup the new "match either live or joined" navStarted
      // rehydrate logic can leak a true value into the next session.
      localStorage.removeItem(NAV_STARTED_KEY);
      setNavStarted(false);
    }
    // Fallback: check server state — find any live incident where I am an active responder
    const serverJoined = liveIncidents.find(
      i => i.isLive && i.userId !== me.id && (i.responders ?? []).some(r => r.userId === me.id)
    );
    if (serverJoined) {
      localStorage.setItem(JOINED_INCIDENT_KEY, String(serverJoined.id));
      setJoinedId(serverJoined.id);
    }
  }, [liveQueryLoaded, me?.id, joinedId, liveId]);

  // Reactively recompute navStarted whenever the active incident id changes.
  // The useState initializer only runs at mount, so a joiner whose joinedId is
  // restored from the server fallback (above) would otherwise miss a matching
  // NAV_STARTED_KEY and keep showing the big "Open in Google Maps" button.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const navId = localStorage.getItem(NAV_STARTED_KEY);
    if (navId === null) { setNavStarted(false); return; }
    const activeId = liveId ?? joinedId;
    if (activeId === null) { setNavStarted(false); return; }
    setNavStarted(navId === String(activeId));
  }, [liveId, joinedId]);

  // Joiner GPS tracking — mirrors creator tracking useEffect
  useEffect(() => {
    if (!liveQueryLoaded || !joinedId) return;
    if (joinedIncident) {
      if (trackingIncidentIdRef.current === joinedId) return;
      gpsEndpointRef.current = "joiner-position";
      startTracking(joinedId);
    } else {
      // Joined incident no longer live — auto-clear joiner state
      resetAfterLeave();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinedIncident?.id, liveQueryLoaded, joinedId]);

  // GPS tracking — starts as soon as the incident is active, independent of
  // whether Google Maps has finished loading.
  useEffect(() => {
    if (!liveQueryLoaded) return;
    if (active) {
      // Skip if startLive() already called startTracking() for this incident —
      // avoids stopping the in-flight probe that was just started.
      if (trackingIncidentIdRef.current === active.id) return;
      startTracking(active.id);
    } else if (liveId) {
      stopTracking();
      localStorage.removeItem(LIVE_INCIDENT_KEY);
      localStorage.removeItem(NAV_STARTED_KEY);
      setNavStarted(false);
      setPendingActive(null);
      setLiveId(null);
    }
  }, [active?.id, liveQueryLoaded]);

  // Route drawing — only possible once Google Maps is ready.
  // On reload, prefer the server-saved destinationLat/Lng over the incident start
  // coords so the map shows the correct route after a PWA kill/reopen.
  useEffect(() => {
    if (!mapsReady || !currentIncident) return;
    if (stepsRef.current.length === 0) {
      const dlat = currentIncident.destinationLat != null
        ? Number(currentIncident.destinationLat)
        : (currentIncident.latitude ?? null);
      const dlng = currentIncident.destinationLng != null
        ? Number(currentIncident.destinationLng)
        : (currentIncident.longitude ?? null);
      if (dlat && dlng) drawRoute(dlat, dlng, undefined, navModeRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIncident?.id, mapsReady]);

  // Keep destPositionRef in sync with the active incident's saved destination so
  // the sendPosition closure can check proximity without stale-closure issues.
  // Also immediately evaluate proximity against the last known GPS fix — this
  // ensures the button appears as soon as the query loads, without waiting for
  // the next watchPosition callback (which can be up to 9 s away).
  useEffect(() => {
    const dest = currentIncident;
    // Panic incidents set destinationLat/Lng to the panicker's own coords so
    // responders can join/navigate. We must NOT treat that as a real destination
    // for arrival-detection purposes — suppress the 150 m proximity check entirely.
    // Use categoryName (a field on the incident itself) rather than categories.find()
    // to avoid a race condition where categories haven't loaded yet.
    const catName = (dest?.categoryName ?? "").toLowerCase();
    const isPanicCat = catName.includes("panic");
    if (dest?.destinationLat != null && dest?.destinationLng != null) {
      const destPos = { lat: dest.destinationLat, lng: dest.destinationLng };
      // Always store destination for rerouting, even for panic incidents.
      // Arrival UI is suppressed separately via isPanicIncidentRef in sendPosition.
      destPositionRef.current = destPos;
      if (!isPanicCat && lastPosRef.current) {
        setIsNearDestination(haversineM(lastPosRef.current, destPos) <= 150);
      }
    } else {
      destPositionRef.current = null;
      setIsNearDestination(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIncident?.destinationLat, currentIncident?.destinationLng, currentIncident?.categoryName]);

  // Restore destination state after PWA kill/reopen or session expiry.
  // The server holds destinationLat/Lng/Name — read them back once when the
  // incident query first arrives and the local destination state is still empty.
  useEffect(() => {
    if (!currentIncident || destination !== null) return;
    const { destinationLat: dlat, destinationLng: dlng, destinationName: dname } = currentIncident;
    if (dlat != null && dlng != null && dname) {
      setDestination({ lat: Number(dlat), lng: Number(dlng), name: dname });
      setSearch(dname);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIncident?.destinationLat, currentIncident?.destinationLng, currentIncident?.destinationName]);

  // Auto-start when arriving from the severity selection screen.
  // The flag is set by live-severity.tsx only when a category is explicitly chosen
  // (not on "Skip"), so direct navigation or joiner paths are unaffected.
  // Depends on [liveId, joinedId] so it re-fires after the stale-liveId cleanup
  // effect sets liveId to null, allowing autostart to succeed even when
  // localStorage held a stale incident ID from a previous session.
  useEffect(() => {
    if (liveId !== null || joinedId !== null) return;
    const flag = (() => { try { return localStorage.getItem("omt_live_autostart"); } catch { return null; } })();
    if (!flag) return;
    try { localStorage.removeItem("omt_live_autostart"); } catch { /* ignore */ }
    startLive();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveId, joinedId]);

  // Respond Live from panic banner: when a panic target was stashed in
  // localStorage, pre-fill the destination and draw the route as soon as both
  // the live incident and the map are ready, then PATCH the server so the
  // dispatch/monitor surfaces show the panicker as the destination.
  const panicTargetAppliedRef = useRef(false);
  useEffect(() => {
    if (panicTargetAppliedRef.current) return;
    const incId = currentIncidentId;
    if (!incId || !mapsReady) return;
    let target: { lat: number; lng: number; name: string } | null = null;
    try {
      const raw = localStorage.getItem("omt_panic_target");
      if (raw) target = JSON.parse(raw);
    } catch { /* ignore */ }
    if (!target || typeof target.lat !== "number" || typeof target.lng !== "number") return;
    panicTargetAppliedRef.current = true;
    try { localStorage.removeItem("omt_panic_target"); } catch { /* ignore */ }
    setDestination(target);
    setSearch(target.name);
    drawRoute(target.lat, target.lng);
    const path = isJoinerMode ? "joiner-destination" : "destination";
    apiRequest("PATCH", `/api/incidents/${incId}/${path}`, {
      destinationName: target.name,
      destinationLat: target.lat,
      destinationLng: target.lng,
    }).catch((err) => {
      console.warn(`[panic-respond] PATCH /${path} failed for incident ${incId}`, err);
      toast({
        title: "Destination not shared",
        description: "Panic destination set locally but couldn't be sent to the team.",
        variant: "destructive",
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIncidentId, mapsReady]);

  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    if (searchDebRef.current) clearTimeout(searchDebRef.current);
    if (!val.trim()) { setSuggestions([]); return; }
    searchDebRef.current = setTimeout(() => {
      setLoadingSugg(true);
      // Use the JS API on both web and native — the REST API doesn't return CORS
      // headers so it fails when called from a WebView. The JS API works in any
      // browser context including Capacitor's WebView.
      if (!autocompleteRef.current) { setLoadingSugg(false); return; }
      autocompleteRef.current.getPlacePredictions(
        { input: val, componentRestrictions: { country: "za" } },
        (preds, status) => {
          setLoadingSugg(false);
          if (status === google.maps.places.PlacesServiceStatus.OK && preds) {
            setSuggestions(preds.slice(0, 5).map((p) => ({ place_id: p.place_id, description: p.description })));
          } else {
            setSuggestions([]);
          }
        }
      );
    }, 350);
  }, []);

  function selectPlace(s: PlaceSuggestion) {
    setSearch(s.description);
    setSuggestions([]);

    const commitDestination = (lat: number, lng: number) => {
      setDestination({ lat, lng, name: s.description });
      drawRoute(lat, lng);
      // Save destination to server immediately so Live Monitor reflects it
      // within the next 5-second poll — not only when the user taps Navigate.
      const incId = currentIncidentId;
      if (incId) {
        const path = isJoinerMode ? "joiner-destination" : "destination";
        apiRequest("PATCH", `/api/incidents/${incId}/${path}`, {
          destinationName: s.description,
          destinationLat: lat,
          destinationLng: lng,
        }).catch((err) => {
          console.warn(`[destination] PATCH /${path} failed for incident ${incId}`, err);
          toast({
            title: "Destination not shared",
            description: "Your destination is set locally but couldn't be sent to the team. Tap a destination again to retry.",
            variant: "destructive",
          });
        });
      }
    };

    // Use the JS API geocoder on both web and native — the REST API doesn't
    // return CORS headers so it fails when called from a WebView.
    geocoderRef.current?.geocode(
      { placeId: s.place_id },
      (results, status) => {
        if (status !== google.maps.GeocoderStatus.OK || !results?.[0]) return;
        const loc = results[0].geometry.location;
        commitDestination(loc.lat(), loc.lng());
      }
    );
  }

  function drawRoute(dlat: number, dlng: number, origin?: { lat: number; lng: number }, skipFitBounds = false) {
    // ── Native path ────────────────────────────────────────────────────────────
    if (isNative && capMapRef.current) {
      const cap = capMapRef.current;
      setRouteInfo(null);
      // Always place/refresh the destination marker — even when GPS has no fix yet.
      // The web path (line ~1653) does this unconditionally; matching that behaviour
      // here prevents a blank map when GPS arrives late.
      if (capDestMarkerIdRef.current) {
        cap.removeMarker(capDestMarkerIdRef.current).catch(() => {});
        capDestMarkerIdRef.current = '';
      }
      // tintColor intentionally omitted — the plugin needs {r,g,b,a} (0-255) and
      // silently drops the marker when given a hex string. Default native pin is red.
      cap.addMarker({ lat: dlat, lng: dlng, title: 'Destination' })
        .then(id => { capDestMarkerIdRef.current = id; }).catch(() => {});

      const originToUse = origin ?? lastPosRef.current ?? userLoc;
      if (!originToUse) {
        // No GPS fix yet — center the camera on the destination so at least the
        // pin is visible. The GPS callback will retry drawRoute once a fix arrives.
        cap.setCamera({ lat: dlat, lng: dlng, zoom: 13, tilt: 0 }).catch(() => {});
        return;
      }
      cap.drawRoute(originToUse, { lat: dlat, lng: dlng }, skipFitBounds || navModeRef.current)
        .then(result => {
          if (!result) return;
          stepsRef.current = result.steps as unknown as google.maps.DirectionsStep[];
          setRouteInfo({ distance: result.distance, duration: result.duration });
          setHasRoute(true);
          setCurrentStepIndex(0);
          setStepDist(result.steps[0]?.distance.value ?? null);
          setIsOffRoute(false);
        }).catch(() => {});
      return;
    }
    // ── Web path (JS API) — unchanged below ────────────────────────────────────
    const map = mapInstanceRef.current;
    if (!map) return;
    // In nav mode always preserve the viewport so setTilt(45) isn't wiped by setDirections
    const effectiveSkip = skipFitBounds || navModeRef.current;
    if (destMarkerRef.current) { destMarkerRef.current.setMap(null); destMarkerRef.current = null; }
    setRouteInfo(null);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#ef4444" stroke="white" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="white" fill-opacity="0.9"/></svg>`;
    destMarkerRef.current = new google.maps.Marker({
      position: { lat: dlat, lng: dlng },
      map,
      icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12) },
      title: "Destination",
      zIndex: 99,
    });
    const originToUse = origin ?? lastPosRef.current ?? userLoc;
    if (!originToUse) { map.setCenter({ lat: dlat, lng: dlng }); map.setZoom(13); return; }
    const ds = new google.maps.DirectionsService();
    ds.route(
      { origin: originToUse, destination: { lat: dlat, lng: dlng }, travelMode: google.maps.TravelMode.DRIVING },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          if (directionsRendererRef.current) {
            directionsRendererRef.current.setOptions({ preserveViewport: effectiveSkip });
            directionsRendererRef.current.setDirections(result);
          }
          const leg = result.routes[0]?.legs[0];
          if (leg) {
            setRouteInfo({ distance: leg.distance?.value ?? 0, duration: leg.duration?.value ?? 0 });
            stepsRef.current = leg.steps ?? [];
            setHasRoute(true);
            setCurrentStepIndex(0);
            setStepDist(leg.steps?.[0]?.distance?.value ?? null);
            setIsOffRoute(false);
          }
          if (effectiveSkip) {
            // Nav mode already active when route was drawn (joiner flow) — stay at street level
            if (lastPosRef.current) map.setCenter(lastPosRef.current);
            map.setZoom(17);
            // Re-apply tilt in case setDirections reset it
            (map as any).moveCamera({ tilt: 45, zoom: 17 });
          } else {
            const b = new google.maps.LatLngBounds();
            b.extend(originToUse);
            b.extend({ lat: dlat, lng: dlng });
            map.fitBounds(b, 60);
          }
        } else {
          map.setCenter({ lat: dlat, lng: dlng });
          map.setZoom(13);
        }
      }
    );
  }

  async function startLive(retryWithoutCategory = false) {
    if (starting || liveId !== null) return;
    try {
      setStarting(true);
      const now = new Date();
      const storedSeverity = (() => { try { return localStorage.getItem("omt_live_severity_sel"); } catch { return null; } })() as "red" | "orange" | "yellow" | null;
      const storedCatId = retryWithoutCategory ? null : (() => { try { return localStorage.getItem("omt_live_category_sel"); } catch { return null; } })();
      const preselectCategoryId = storedCatId ? parseInt(storedCatId, 10) : null;
      const res = await apiRequest("POST", "/api/incidents", {
        incidentDate: now.toISOString().slice(0, 10),
        incidentTime: now.toTimeString().slice(0, 5),
        locationName: "Live Incident",
        description: "Live incident started",
        isLive: true,
        ...(preselectCategoryId ? { categoryId: preselectCategoryId } : {}),
        ...(storedSeverity ? { severity: storedSeverity } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Stale category in localStorage (e.g. deleted since it was selected) —
        // clear it and retry once without a pre-selected category so the live
        // incident still starts cleanly.
        if (body?.message === "STALE_CATEGORY" && !retryWithoutCategory) {
          try { localStorage.removeItem("omt_live_category_sel"); } catch { /* ignore */ }
          setStarting(false);
          return startLive(true);
        }
        throw new Error(body?.message ?? `Server error ${res.status}`);
      }
      const incident: Incident = await res.json();
      try { localStorage.removeItem("omt_live_severity_sel"); localStorage.removeItem("omt_live_category_sel"); } catch { /* ignore */ }
      localStorage.setItem(LIVE_INCIDENT_KEY, String(incident.id));
      // Switch the render branch to "active" instantly — no query refetch needed.
      setPendingActive(incident);
      setLiveId(incident.id);
      // Start GPS immediately — the tracking useEffect is skipped for this
      // incidentId because trackingIncidentIdRef is set first, preventing
      // a redundant second call that would interrupt the probe mid-flight.
      startTracking(incident.id);
      // Background refetch so liveIncidents stays in sync.
      queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
    } catch (e: unknown) {
      toast({ title: "Failed to start", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    } finally {
      setStarting(false);
    }
  }

  async function dispatchInApp() {
    const incId = currentIncidentId;
    if (!destination || !incId) return;
    try {
      setDispatching(true);
      // Persist nav-started flag so the arrived-button survives app switches / reloads.
      localStorage.setItem(NAV_STARTED_KEY, String(incId));
      setNavStarted(true);
      announcedStepRef.current = -1;
      approachingTurnAnnouncedRef.current = -1;
      arrivedAnnouncedRef.current = false;
      // Save destination to server — only for creator (avoids overwriting creator's destination for joiners)
      if (!isJoinerMode) {
        apiRequest("PATCH", `/api/incidents/${incId}/destination`, {
          destinationName: destination.name,
          destinationLat: destination.lat,
          destinationLng: destination.lng,
        }).catch(() => {});
      }
      // iOS Safari requires an explicit user-gesture permission call before
      // DeviceOrientationEvent fires. Request it here (inside the user gesture)
      // and proceed regardless of the outcome — if denied, heading-up simply
      // falls back to GPS heading; nothing else is affected.
      if (typeof DeviceOrientationEvent !== "undefined" && typeof (DeviceOrientationEvent as any).requestPermission === "function") {
        try { await (DeviceOrientationEvent as any).requestPermission(); } catch { /* denied — proceed */ }
      }
      // On native: ensure the route is drawn before entering navMode so the step
      // banner, tilt camera, and ETA are all seeded correctly. drawRoute may have
      // bailed earlier because GPS had no fix at mapsReady time.
      if (isNative && capMapRef.current && stepsRef.current.length === 0) {
        drawRoute(
          destination.lat, destination.lng,
          lastPosRef.current ?? undefined,
          true, // skipFitBounds — we're about to go nav-mode, don't pan around
        );
        // Give the DirectionsService a moment to resolve before navMode useEffect
        // runs — otherwise stepsRef is still empty when the tilt+seed block fires.
        await new Promise(r => setTimeout(r, 600));
      }
      setNavMode(true);
      toast({ title: "Navigation started", description: "GPS tracking continues — dispatch can see your position." });
    } catch (e: unknown) {
      toast({ title: "Navigation failed", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    } finally {
      setDispatching(false);
    }
  }

  async function dispatchJoinerInApp() {
    if (!joinedId || !currentIncident?.destinationLat || !currentIncident?.destinationLng) return;
    localStorage.setItem(NAV_STARTED_KEY, String(joinedId));
    setNavStarted(true);
    announcedStepRef.current = -1;
    approachingTurnAnnouncedRef.current = -1;
    arrivedAnnouncedRef.current = false;
    // Draw the route to the incident destination so the step panel, voice
    // announcements, and ETA all work for joiners — matching creator behaviour.
    drawRoute(
      Number(currentIncident.destinationLat),
      Number(currentIncident.destinationLng),
      lastPosRef.current ?? undefined,
      true
    );
    // On native: wait briefly for DirectionsService to resolve before setNavMode(true)
    // so the tilt+seed useEffect finds stepsRef already populated.
    if (isNative) await new Promise(r => setTimeout(r, 600));
    // iOS Safari requires an explicit user-gesture permission call before
    // DeviceOrientationEvent fires — request it here and proceed regardless.
    if (typeof DeviceOrientationEvent !== "undefined" && typeof (DeviceOrientationEvent as any).requestPermission === "function") {
      try { await (DeviceOrientationEvent as any).requestPermission(); } catch { /* denied — proceed */ }
    }
    setNavMode(true);
    toast({ title: "Navigation started", description: "GPS tracking continues — dispatch can see your position." });
  }

  async function dispatch() {
    const incId = currentIncidentId;
    if (!destination || !incId) return;
    try {
      setDispatching(true);
      confirmAndOpenNav(destination.lat, destination.lng);
      // Persist nav-started flag so the arrived-button survives app switches / reloads.
      localStorage.setItem(NAV_STARTED_KEY, String(incId));
      setNavStarted(true);
      // Save destination to server — only for creator (avoids overwriting creator's destination for joiners)
      if (!isJoinerMode) {
        apiRequest("PATCH", `/api/incidents/${incId}/destination`, {
          destinationName: destination.name,
          destinationLat: destination.lat,
          destinationLng: destination.lng,
        }).catch(() => {});
      }
      toast({ title: "Opened in Google Maps", description: "GPS tracking resumes when you return to OMT." });
    } catch (e: unknown) {
      toast({ title: "Navigation failed", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    } finally {
      setDispatching(false);
    }
  }

  async function submitJoinerArrival() {
    if (!joinedId) return;
    stopTracking();
    setArrivalSubmitting(true);
    // Tracks whether the server has already committed the arrival. Once true,
    // we MUST clear the joiner state locally, even if subsequent best-effort
    // steps (leave-live, attachments) fail — otherwise the client gets stuck
    // retrying joiner-position against a row that already has left_at set,
    // producing an infinite HTTP 403 loop (the bug Nicolaas hit).
    let arrivalCommitted = false;
    const incId = joinedId;
    try {
      const otherNoteTrimmed = arrivalOtherType.trim();
      const descTrimmed = arrivalDescription.trim();
      const arrivalNote = otherNoteTrimmed
        ? (descTrimmed ? `${otherNoteTrimmed}: ${descTrimmed}` : otherNoteTrimmed)
        : descTrimmed;
      // 1. Upload all media attachments to the same incident (upload pending blobs first)
      for (const mediaRecord of arrivalMedia) {
        let record = mediaRecord;
        if (record.url.startsWith("blob:")) {
          const blobEntry = arrivalMediaBlobsRef.current.get(record.id);
          if (!blobEntry) throw new Error(`A media item blob is no longer available — please retake it.`);
          const uploadResp = await fetch("/api/uploads", {
            method: "POST",
            headers: { "Content-Type": blobEntry.mimeType },
            body: blobEntry.blob,
            credentials: "include",
          });
          if (!uploadResp.ok) throw new Error(`A media upload failed — please check your connection.`);
          const { objectUrl } = await uploadResp.json();
          URL.revokeObjectURL(record.url);
          arrivalMediaBlobsRef.current.delete(record.id);
          record = { ...record, url: objectUrl };
        }
        if (!record.url.startsWith("blob:")) {
          await apiRequest("POST", `/api/incidents/${incId}/attachments`, { url: record.url, filename: record.filename, mimeType: record.mimeType });
        }
      }
      // 2. Record arrival on the live_responders row (sets arrivedAt + note)
      await apiRequest("POST", `/api/incidents/${incId}/joiner-arrival`, { arrivalNote: arrivalNote || null });
      arrivalCommitted = true;
      // 3. Leave the incident (best-effort — already-committed arrival means
      // resetAfterLeave runs regardless of the outcome here).
      try {
        await apiRequest("POST", `/api/incidents/${incId}/leave-live`, {});
      } catch (leaveErr) {
        console.warn(`[joiner-arrival] leave-live failed for incident ${incId} but arrival was already recorded`, leaveErr);
      }
      toast({ title: "Arrival recorded", description: "Your arrival has been recorded. You have left the incident." });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
    } catch (e: unknown) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Could not record arrival.", variant: "destructive" });
    } finally {
      // If the arrival reached the server, locally reset no matter what — the
      // server-side row already has arrived_at + left_at after the leave-live
      // call above (or will get cleaned up server-side). Either way, this
      // client must NOT keep PATCHing joiner-position.
      if (arrivalCommitted) {
        resetAfterLeave();
        navigate("/");
      }
      setArrivalSubmitting(false);
    }
  }

  const steps = stepsRef.current;
  const currentStep = steps[currentStepIndex];
  const nonLiveCategories = categories.filter((c) => c.name.toLowerCase() !== "live incident");

  // --- Panicker view detection ---------------------------------------------
  // A panic incident is created as a live incident with destination = the
  // panicker's own coords (so responders can join and navigate to them via
  // the normal live-incident flow). If the panicker re-opens the PWA while
  // their own panic is still active, restoring the standard responder UI
  // makes no sense — they'd see "Where are you going? <self>" and an
  // "I've Arrived" button. Show a dedicated panicker view instead.
  const currentIncidentCategory = currentIncident?.categoryId
    ? categories.find((c) => c.id === currentIncident.categoryId)
    : undefined;
  // Also derive isPanicIncident directly from categoryName on the incident itself
  // (belt-and-suspenders: covers the case where categories haven't loaded yet).
  const isPanicIncident =
    (currentIncidentCategory?.name ?? "").toLowerCase().includes("panic") ||
    (currentIncident?.categoryName ?? "").toLowerCase().includes("panic");

  // Keep isPanicIncidentRef in sync so the sendPosition closure inside
  // startTracking() can read it without stale-closure issues.
  useEffect(() => {
    isPanicIncidentRef.current = isPanicIncident;
  }, [isPanicIncident]);

  // Keep navModeRef in sync so the step-tracking interval reads the latest value.
  useEffect(() => { navModeRef.current = navMode; }, [navMode]);

  // Detect new joiners while in nav mode — flash their first name for 5 s.
  // Seeds the known-set silently on first render so pre-existing responders never trigger a flash.
  useEffect(() => {
    if (!currentIncident?.responders) return;
    const nonSelf = currentIncident.responders.filter(r => r.userId !== me?.id);
    const newJoiners = navMode
      ? nonSelf.filter(r => !knownResponderIdsRef.current.has(r.userId))
      : [];
    // Always keep the set current regardless of nav mode
    nonSelf.forEach(r => knownResponderIdsRef.current.add(r.userId));
    if (newJoiners.length === 0) return;
    const latest = newJoiners[newJoiners.length - 1];
    setNewJoinerFlash(`${latest.firstName} joined`);
    const t = setTimeout(() => setNewJoinerFlash(null), 5000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIncident?.responders, navMode, me?.id]);

  // Keep currentStepIndexRef in sync so the step-tracking interval can read the latest step index.
  useEffect(() => { currentStepIndexRef.current = currentStepIndex; }, [currentStepIndex]);

  // When navMode activates: scroll to top, apply navigation perspective (tilt + heading-up).
  // When navMode deactivates: reset map to default top-down view and resize.
  useEffect(() => {
    if (navMode && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    // ── Native (Capacitor) camera + step seeding ────────────────────────────────
    if (isNative && capMapRef.current && mapsReady) {
      if (navMode) {
        if (lastPosRef.current && stepsRef.current.length > 0) {
          const pos = lastPosRef.current;
          const navSteps = stepsRef.current;
          let idx = currentStepIndexRef.current;
          while (idx < navSteps.length - 1) {
            const nextLoc = navSteps[idx + 1].start_location;
            if (haversineM(pos, { lat: nextLoc.lat(), lng: nextLoc.lng() }) <= 60) { idx++; } else { break; }
          }
          if (idx === 0) {
            let nearestIdx = 0, nearestDist = Infinity;
            for (let i = 0; i < navSteps.length; i++) {
              const loc = navSteps[i].start_location;
              const d = haversineM(pos, { lat: loc.lat(), lng: loc.lng() });
              if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
            }
            if (nearestIdx > idx) idx = nearestIdx;
          }
          currentStepIndexRef.current = idx;
          setCurrentStepIndex(idx);
          const currStep = navSteps[idx];
          if (currStep) setStepDist(Math.round(haversineM(pos, { lat: currStep.end_location.lat(), lng: currStep.end_location.lng() })));
        }
        // Lock out tilt + rotate gestures in nav mode. The Android Maps SDK
        // runs a gesture-settle deceleration when the user lifts fingers from
        // any pinch-tilt or 2-finger rotate; that physics pipeline outranks
        // setCamera and flattens tilt back to 0 within ~2 s. Removing the
        // gesture itself removes the settle trigger, so the v70 200 ms
        // animateCamera patch + v69 400 ms tilt-keeper can finally win.
        // Pinch-zoom and pan stay enabled.
        capMapRef.current.setGestures({ tilt: false, rotate: false, zoom: true, scroll: true }).catch(() => {});
        if (lastPosRef.current) {
          // animate:false — apply tilt instantly on nav-mode entry. With
          // animate:true the discrete 0→45 angle transition can be interrupted
          // by the next GPS-driven setCamera before it completes, leaving the
          // map flat. See GPS callback above for the same rationale.
          capMapRef.current.setCamera({
            lat: lastPosRef.current.lat, lng: lastPosRef.current.lng,
            zoom: 17, tilt: 45, bearing: lastHeadingRef.current ?? 0,
            animate: false,
          }).catch(() => {});
        }
      } else {
        // Restore all gestures on nav-mode exit.
        capMapRef.current.setGestures({ tilt: true, rotate: true, zoom: true, scroll: true }).catch(() => {});
        if (lastPosRef.current) {
          capMapRef.current.setCamera({
            lat: lastPosRef.current.lat, lng: lastPosRef.current.lng,
            zoom: 15, tilt: 0, bearing: 0,
            animate: false,
          }).catch(() => {});
        }
        lastHeadingRef.current = null;
      }
      return; // skip JS API path
    }
    // ── Web / JS API path (unchanged) ────────────────────────────────────────
    if (mapInstanceRef.current && mapsReady) {
      if (navMode) {
        mapInstanceRef.current.setOptions({ minZoom: 15 });
        if (lastPosRef.current) {
          mapInstanceRef.current.setCenter(lastPosRef.current);
          // Seed step index + stepDist immediately from last known GPS fix so the
          // banner shows the correct step as soon as nav mode opens.
          const pos = lastPosRef.current;
          const navSteps = stepsRef.current;
          if (navSteps.length > 0) {
            let idx = currentStepIndexRef.current;
            while (idx < navSteps.length - 1) {
              const nextLoc = navSteps[idx + 1].start_location;
              if (haversineM(pos, { lat: nextLoc.lat(), lng: nextLoc.lng() }) <= 60) { idx++; } else { break; }
            }
            if (idx === 0) {
              let nearestIdx = 0; let nearestDist = Infinity;
              for (let i = 0; i < navSteps.length; i++) {
                const loc = navSteps[i].start_location;
                const d = haversineM(pos, { lat: loc.lat(), lng: loc.lng() });
                if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
              }
              if (nearestIdx > idx) idx = nearestIdx;
            }
            currentStepIndexRef.current = idx;
            setCurrentStepIndex(idx);
            const currStep = navSteps[idx];
            if (currStep) {
              setStepDist(Math.round(haversineM(pos, { lat: currStep.end_location.lat(), lng: currStep.end_location.lng() })));
            }
          }
        }
        // moveCamera is atomic — sets tilt, zoom, heading, center in one call so
        // nothing can partially override any individual property.
        (mapInstanceRef.current as any).moveCamera({
          tilt: 45,
          zoom: 17,
          heading: lastHeadingRef.current ?? 0,
          ...(lastPosRef.current ? { center: lastPosRef.current } : {}),
        });
      } else {
        mapInstanceRef.current.setOptions({ minZoom: undefined });
        mapInstanceRef.current.setHeading(0);
        lastHeadingRef.current = null;
        (mapInstanceRef.current as any).moveCamera({ tilt: 0 });
      }
      setTimeout(() => {
        google.maps.event.trigger(mapInstanceRef.current!, "resize");
        // Re-apply via moveCamera after resize
        if (navMode && mapInstanceRef.current) {
          (mapInstanceRef.current as any).moveCamera({
            tilt: 45,
            zoom: 17,
            heading: lastHeadingRef.current ?? 0,
          });
        }
      }, 80);
    }
  }, [navMode, mapsReady]);

  // v69: APK nav-mode tilt-keeper.
  // The Android Google Maps SDK runs a "gesture-settle" deceleration when the
  // user lifts fingers after a pinch-tilt. That settle can flatten the camera
  // back to tilt:0 over 1–2 s, faster than our GPS-cadence setCamera (which
  // only fires every ~1 s on a fix). To prevent the flatten, re-assert the
  // nav-mode camera every 400 ms — too fast for the settle to ever complete.
  // Native only; no-op on web (the JS API doesn't have this settle issue).
  useEffect(() => {
    if (!isNative || !navMode || !mapsReady || !capMapRef.current) return;
    const id = window.setInterval(() => {
      if (!navModeRef.current || !capMapRef.current || !lastPosRef.current) return;
      capMapRef.current.setCamera({
        lat: lastPosRef.current.lat,
        lng: lastPosRef.current.lng,
        zoom: 17,
        tilt: 45,
        bearing: lastHeadingRef.current ?? 0,
        animate: true,
      }).catch(() => {});
    }, 400);
    return () => window.clearInterval(id);
  }, [isNative, navMode, mapsReady]);

  // Compass fallback: use deviceorientationabsolute (true-north bearing from device compass)
  // to drive heading-up when GPS heading is null — common on many Android devices.
  // Active only while nav mode is on; cleans up automatically on deactivation.
  useEffect(() => {
    if (!navMode || !mapsReady) return;
    function handleOrientation(e: Event) {
      const doe = e as DeviceOrientationEvent;
      if (!navModeRef.current || !mapInstanceRef.current) return;
      if (doe.alpha == null) return;
      // deviceorientationabsolute.alpha is counter-clockwise from true north;
      // Google Maps heading is clockwise from north → convert accordingly.
      const mapHeading = (360 - doe.alpha) % 360;
      lastHeadingRef.current = mapHeading;
      mapInstanceRef.current.setHeading(mapHeading);
    }
    window.addEventListener("deviceorientationabsolute", handleOrientation, true);
    return () => window.removeEventListener("deviceorientationabsolute", handleOrientation, true);
  }, [navMode, mapsReady]);

  // Re-acquire the wake lock specifically when nav mode activates so the screen
  // stays on for the entire navigation session. The incident-level lock may
  // already be held (acquire is idempotent), but this catches the case where
  // the lock was dropped (e.g. tab was briefly hidden) before nav mode started.
  // If the platform denies the lock (background tab, battery saver policy, or
  // unsupported browser), show a subtle toast so the user knows to keep the
  // screen on manually.
  useEffect(() => {
    if (!navMode) return;
    acquireWakeLock().then((granted) => {
      if (!granted) {
        toast({
          title: "Screen may dim during navigation",
          description: "Your device or browser couldn't keep the screen on. Tap to prevent it from locking.",
          variant: "destructive",
          duration: 6000,
        });
      }
    });
  }, [navMode, acquireWakeLock, toast]);

  const isPanickerView =
    !!currentIncident &&
    !isJoinerMode &&
    !!me &&
    currentIncident.userId === me.id &&
    isPanicIncident;

  // --- Pre-flight nav warning ---------------------------------------------
  // Opening Google Maps backgrounds OMT, which stops watchPosition on Android.
  // Warn once per device so dispatchers know GPS may pause until she returns.
  const NAV_WARNING_KEY = "omt_nav_warning_dismissed";
  const [pendingNavTarget, setPendingNavTarget] = useState<{ lat: number; lng: number; after?: () => void } | null>(null);
  function confirmAndOpenNav(lat: number, lng: number, after?: () => void) {
    const dismissed = (() => { try { return localStorage.getItem(NAV_WARNING_KEY) === "1"; } catch { return false; } })();
    if (dismissed) {
      openGoogleMapsNav(lat, lng);
      after?.();
      return;
    }
    setPendingNavTarget({ lat, lng, after });
  }

  // --- Panicker close-with-notes dialog state ------------------------------
  const [closePanicDialogOpen, setClosePanicDialogOpen] = useState(false);
  const [closePanicCategoryId, setClosePanicCategoryId] = useState<number | null>(null);
  const [closePanicOtherNote, setClosePanicOtherNote] = useState("");
  const [closePanicDescription, setClosePanicDescription] = useState("");
  const [closePanicPhotos, setClosePanicPhotos] = useState<Array<{ id: string; url: string; filename: string; mimeType: string }>>([]);
  const [closePanicUploading, setClosePanicUploading] = useState(false);
  const [closePanicSubmitting, setClosePanicSubmitting] = useState(false);
  const closePanicPhotoInputRef = useRef<HTMLInputElement>(null);

  function resetClosePanicForm() {
    setClosePanicDialogOpen(false);
    setClosePanicCategoryId(null);
    setClosePanicOtherNote("");
    setClosePanicDescription("");
    setClosePanicPhotos([]);
    setClosePanicUploading(false);
    setClosePanicSubmitting(false);
  }

  function finishClosePanicLocal() {
    try { localStorage.removeItem(LIVE_INCIDENT_KEY); } catch { /* ignore */ }
    try { localStorage.removeItem(NAV_STARTED_KEY); } catch { /* ignore */ }
    setLiveId(null);
    setPendingActive(null);
    setNavStarted(false);
    stopTracking();
    void releaseWakeLock();
    queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
    queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
    queryClient.invalidateQueries({ queryKey: ["/api/incidents/panic-active"] });
    queryClient.invalidateQueries({ queryKey: ["/api/panic/recent"] });
  }

  // Fast-close path (used by the "Just close — I'll add details later" link)
  const closePanicMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/incidents/${id}/close-panic`, {}),
    onSuccess: () => {
      finishClosePanicLocal();
      resetClosePanicForm();
      toast({ title: "Panic closed", description: "Your alert has been cleared." });
      navigate("/");
    },
    onError: () => {
      toast({ title: "Couldn't close panic", description: "Try again — if the problem persists, ask an admin to close it for you.", variant: "destructive" });
    },
  });

  // Submit-with-notes path
  async function submitClosePanicWithNotes(incidentId: number) {
    const description = closePanicDescription.trim();
    const otherNote = closePanicOtherNote.trim();
    if (description.length < 3) {
      toast({ title: "Describe what happened", description: "A short description is required before closing.", variant: "destructive" });
      return;
    }
    setClosePanicSubmitting(true);
    try {
      // STEP 1 — close the panic FIRST, while category is still "Panic".
      // The server guard (`server/routes.ts` close-panic) rejects with 400 if
      // the incident's category is anything other than Panic, so re-categorising
      // before calling close-panic causes "Not a panic incident".
      await apiRequest("POST", `/api/incidents/${incidentId}/close-panic`, {});

      // STEP 2 — once the alert is cleared, apply notes/category/attachments.
      // If any of these fail, the panic is still closed and the user gets a
      // softer toast asking them to finish the edit in the Occurrence Book.
      try {
        await apiRequest("PATCH", `/api/incidents/${incidentId}`, {
          ...(closePanicCategoryId ? { categoryId: closePanicCategoryId } : {}),
          ...(otherNote ? { otherCategoryNote: otherNote } : {}),
          description,
        });
        for (const photo of closePanicPhotos) {
          await apiRequest("POST", `/api/incidents/${incidentId}/attachments`, {
            url: photo.url, filename: photo.filename, mimeType: photo.mimeType,
          });
        }
        finishClosePanicLocal();
        resetClosePanicForm();
        toast({ title: "Panic closed", description: "Your alert was cleared and the incident has been recorded." });
        navigate("/");
      } catch (notesErr: unknown) {
        // Panic IS closed; only the notes/photos failed. Don't make it sound
        // like the alert is still live.
        finishClosePanicLocal();
        resetClosePanicForm();
        toast({
          title: "Panic closed",
          description: notesErr instanceof Error
            ? `Couldn't save your notes (${notesErr.message}). Please finish editing in the Occurrence Book.`
            : "Couldn't save your notes — please finish editing in the Occurrence Book.",
          variant: "destructive",
        });
        navigate("/");
      }
    } catch (e: unknown) {
      // close-panic itself failed — alert is still live.
      toast({ title: "Couldn't close panic", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setClosePanicSubmitting(false);
    }
  }

  async function handleClosePanicPhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setClosePanicUploading(true);
    try {
      for (const file of Array.from(files)) {
        const resp = await fetch("/api/uploads", {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
          credentials: "include",
        });
        if (!resp.ok) throw new Error("Upload failed");
        const { objectUrl } = await resp.json();
        setClosePanicPhotos((prev) => [...prev, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url: objectUrl,
          filename: file.name || "photo",
          mimeType: file.type || "application/octet-stream",
        }]);
      }
    } catch {
      toast({ title: "Photo upload failed", description: "Check your connection and try again.", variant: "destructive" });
    } finally {
      setClosePanicUploading(false);
      if (closePanicPhotoInputRef.current) closePanicPhotoInputRef.current.value = "";
    }
  }

  // Acknowledgers feed for the panicker view — separate from live_responders.
  // /api/panic/recent already returns acknowledgedBy for every active panic in
  // the org. We poll every 5 s so the list catches up even if push fails.
  type PanicAlertWithAcks = {
    id: number;
    userId: string | null;
    acknowledgedBy: Array<{ userId: string; firstName: string; lastName: string; acknowledgedAt: string }>;
  };
  const { data: panicAlertsForView = [] } = useQuery<PanicAlertWithAcks[]>({
    queryKey: ["/api/panic/recent"],
    enabled: isPanickerView,
    refetchInterval: isPanickerView ? 5000 : false,
    refetchIntervalInBackground: true,
  });

  if (isPanickerView && currentIncident) {
    // Acknowledgers from panic_acknowledgers
    const ownPanic = panicAlertsForView.find((p) => p.id === currentIncident.id);
    const acknowledgers = ownPanic?.acknowledgedBy ?? [];
    // Live responders from live_responders (people who tapped "Respond Live")
    const liveResponders = currentIncident.responders ?? [];
    // Merge — dedup by userId; "on the way" outranks "acknowledged"
    const merged = new Map<string, { userId: string; firstName: string; lastName: string; status: "ack" | "live" }>();
    for (const a of acknowledgers) {
      merged.set(a.userId, { userId: a.userId, firstName: a.firstName, lastName: a.lastName, status: "ack" });
    }
    for (const r of liveResponders) {
      merged.set(r.userId, { userId: r.userId, firstName: r.firstName, lastName: r.lastName, status: "live" });
    }
    const responderList = Array.from(merged.values());
    const startedAt = currentIncident.liveStartedAt
      ? new Date(currentIncident.liveStartedAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })
      : null;
    return (
      <div className="flex flex-col h-full bg-background live-page-root">
        <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0 bg-background">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")} data-testid="button-back-panicker">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <span className="font-semibold text-lg">Panic Active</span>
          </div>
          <Badge className="ml-auto text-white bg-red-600 animate-pulse" data-testid="badge-panic-active">
            SOS
          </Badge>
        </div>

        {!isOnline && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white text-sm font-medium shrink-0" data-testid="banner-offline-panicker">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>No mobile data — your panic was already sent. Responders can still see your last known location.</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="rounded-lg border-2 border-red-600 bg-red-600/10 p-4 text-center" data-testid="panel-panic-status">
            <AlertTriangle className="h-12 w-12 text-red-600 mx-auto mb-2" />
            <p className="text-lg font-bold text-red-700 dark:text-red-400">
              Your panic alert is live
            </p>
            {startedAt && (
              <p className="text-sm text-muted-foreground mt-1">
                Sent at {startedAt}
              </p>
            )}
            <p className="text-sm mt-2">
              Help is on the way. Stay on this screen if you can — your location is being shared.
            </p>
          </div>

          <div className="rounded-lg border bg-card p-4" data-testid="panel-panic-responders">
            <p className="text-sm font-semibold mb-2">
              Responders ({responderList.length})
            </p>
            {responderList.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No one has acknowledged yet. Your team has been alerted.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {responderList.map((r) => (
                  <li
                    key={r.userId}
                    className="flex items-center gap-2 text-sm"
                    data-testid={`item-responder-${r.userId}`}
                  >
                    <CheckCircle2 className={`h-4 w-4 shrink-0 ${r.status === "live" ? "text-green-600" : "text-amber-600"}`} />
                    <span className="flex-1">{r.firstName} {r.lastName}</span>
                    <span className={`text-xs ${r.status === "live" ? "text-green-700 dark:text-green-400 font-medium" : "text-muted-foreground"}`}>
                      {r.status === "live" ? "on the way" : "acknowledged"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button
            variant="outline"
            className="w-full"
            size="lg"
            onClick={() => setClosePanicDialogOpen(true)}
            disabled={closePanicMutation.isPending || closePanicSubmitting}
            data-testid="button-close-panic-panicker-view"
          >
            <X className="h-5 w-5 mr-2" />
            I'm safe — close panic alert
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Only close if you're safe. If you can't, your admin or supervisor can close it for you.
          </p>
        </div>

        <Dialog
          open={closePanicDialogOpen}
          onOpenChange={(open) => {
            if (!open && !closePanicSubmitting && !closePanicMutation.isPending) {
              resetClosePanicForm();
            }
          }}
        >
          <DialogContent className="max-w-md" data-testid="dialog-close-panic">
            <DialogHeader>
              <DialogTitle>What happened?</DialogTitle>
              <DialogDescription>
                Before we close the alert, please record what happened so the incident is properly logged.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="close-panic-category">Type</Label>
                <Select
                  value={closePanicCategoryId !== null ? String(closePanicCategoryId) : ""}
                  onValueChange={(v) => setClosePanicCategoryId(Number(v))}
                >
                  <SelectTrigger id="close-panic-category" data-testid="select-close-panic-category">
                    <SelectValue placeholder="Keep as Panic, or pick a more specific type…" />
                  </SelectTrigger>
                  <SelectContent>
                    {nonLiveCategories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)} data-testid={`option-close-panic-cat-${c.id}`}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {closePanicCategoryId !== null
                && nonLiveCategories.find((c) => c.id === closePanicCategoryId)?.name.toLowerCase() === "other" && (
                <div className="space-y-1.5">
                  <Label htmlFor="close-panic-other">Other type — short label</Label>
                  <Input
                    id="close-panic-other"
                    value={closePanicOtherNote}
                    onChange={(e) => setClosePanicOtherNote(e.target.value)}
                    placeholder="e.g. Suspicious vehicle"
                    data-testid="input-close-panic-other"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="close-panic-description">Describe what happened *</Label>
                <Textarea
                  id="close-panic-description"
                  value={closePanicDescription}
                  onChange={(e) => setClosePanicDescription(e.target.value)}
                  placeholder="A few words about what happened…"
                  rows={4}
                  data-testid="textarea-close-panic-description"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Photos (optional)</Label>
                <div className="flex flex-wrap gap-2">
                  {closePanicPhotos.map((p) => (
                    <div key={p.id} className="relative">
                      <img src={p.url} alt={p.filename} className="h-16 w-16 rounded object-cover border" data-testid={`img-close-panic-photo-${p.id}`} />
                      <button
                        type="button"
                        onClick={() => setClosePanicPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                        className="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full h-5 w-5 flex items-center justify-center"
                        data-testid={`button-remove-close-panic-photo-${p.id}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => closePanicPhotoInputRef.current?.click()}
                    disabled={closePanicUploading}
                    className="h-16 w-16 rounded border-2 border-dashed flex items-center justify-center text-muted-foreground hover:bg-muted/40"
                    data-testid="button-add-close-panic-photo"
                  >
                    {closePanicUploading
                      ? <Loader2 className="h-5 w-5 animate-spin" />
                      : <Camera className="h-5 w-5" />}
                  </button>
                  <input
                    ref={closePanicPhotoInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleClosePanicPhotoPick}
                    data-testid="input-close-panic-photo"
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
              <Button
                onClick={() => submitClosePanicWithNotes(currentIncident.id)}
                disabled={closePanicSubmitting || closePanicUploading || closePanicDescription.trim().length < 3}
                className="w-full"
                data-testid="button-submit-close-panic"
              >
                {closePanicSubmitting
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Closing…</>
                  : <>Submit & close panic</>}
              </Button>
              <button
                type="button"
                onClick={() => closePanicMutation.mutate(currentIncident.id)}
                disabled={closePanicSubmitting || closePanicMutation.isPending}
                className="text-xs text-muted-foreground underline mx-auto disabled:opacity-50"
                data-testid="button-skip-close-panic-notes"
              >
                {closePanicMutation.isPending ? "Closing…" : "Just close — I'll add details later"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background live-page-root">
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0 bg-background">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} data-testid="button-back-live">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div
          className="flex items-center gap-2 select-none"
          onPointerDown={() => {
            if (titlePressTimerRef.current) clearTimeout(titlePressTimerRef.current);
            titlePressTimerRef.current = setTimeout(() => setDebugVisible((v) => !v), 1200);
          }}
          onPointerUp={() => {
            if (titlePressTimerRef.current) { clearTimeout(titlePressTimerRef.current); titlePressTimerRef.current = null; }
          }}
          onPointerLeave={() => {
            if (titlePressTimerRef.current) { clearTimeout(titlePressTimerRef.current); titlePressTimerRef.current = null; }
          }}
          data-testid="title-live-incident"
        >
          <Radio className="h-5 w-5 text-green-500" />
          <span className="font-semibold text-lg">Live Incident</span>
        </div>
        {currentIncident && (
          <Badge className={`ml-auto text-white ${isJoinerMode ? "bg-blue-600" : "bg-green-500"}`} data-testid="badge-live-active">
            {isJoinerMode ? "JOINED" : "LIVE"}
          </Badge>
        )}
      </div>

      <MapDebugOverlay
        visible={debugVisible}
        onClose={() => setDebugVisible(false)}
        snapshot={{
          isNative,
          mapsReady,
          mapsError,
          mapsErrorMsg,
          geocoderReady,
          autocompleteReady,
          nativeMapStatus,
          nativeMapErrorMsg,
          nativeMapCreateAt,
          nativeMapReadyAt,
          useWebMap,
          errors: debugErrors,
        } satisfies MapDebugSnapshot}
      />

      {/* Offline warning banner */}
      {!isOnline && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white text-sm font-medium shrink-0" data-testid="banner-offline">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>No mobile data — turn data back on. Your arrival report will sync automatically when reconnected.</span>
        </div>
      )}

      {/* Wake lock unsupported banner — shown when the browser doesn't support
          the Screen Wake Lock API at all (e.g. Firefox). One-time dismissable. */}
      {!wakeLockSupported && currentIncidentId !== null && !wakeLockUnsupportedDismissed && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center gap-2 px-4 py-3 bg-amber-600 text-white text-sm font-semibold" data-testid="banner-wake-lock-unsupported">
          <span className="flex-1">⚠️ Your browser can't keep the screen on automatically — you may need to prevent it from locking manually during this incident.</span>
          <button
            className="underline font-bold shrink-0 ml-2"
            onClick={() => setWakeLockUnsupportedDismissed(true)}
            data-testid="button-wake-lock-unsupported-dismiss"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Wake lock lost warning — shown when the OS overrides the screen-on
          request (e.g. battery saver). The hook auto-retries; this banner
          tells the user to keep the screen on manually. */}
      {wakeLockLost && currentIncidentId !== null && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center gap-2 px-4 py-3 bg-amber-500 text-white text-sm font-semibold" data-testid="banner-wake-lock-lost">
          <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse shrink-0" />
          <span className="flex-1">⚠️ Screen lock detected — GPS may pause. Keep the screen on for reliable tracking.</span>
          <button
            className="underline font-bold shrink-0 ml-2"
            onClick={() => { void acquireWakeLock(); }}
            data-testid="button-wake-lock-retry"
          >
            Keep On
          </button>
        </div>
      )}

      {/* GPS lost warning banner — shown when >30 s with no successful GPS send.
          fixed so it floats above all content regardless of scroll position. */}
      {gpsLost && currentIncidentId !== null && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center gap-2 px-4 py-3 bg-red-600 text-white text-sm font-semibold" data-testid="banner-gps-lost">
          <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse shrink-0" />
          <span className="flex-1">⚠️ GPS signal lost — your location is not being shared. Tap to retry.</span>
          <button
            className="underline font-bold shrink-0 ml-2"
            onClick={() => {
              if (joinedId) { gpsEndpointRef.current = "joiner-position"; startTracking(joinedId); }
              else if (liveId) { gpsEndpointRef.current = "responder-position"; startTracking(liveId); }
            }}
            data-testid="button-retry-gps-lost"
          >
            Retry
          </button>
        </div>
      )}

      {/* GPS status banner — only shown while a live incident is active */}
      {currentIncident && gpsStatus !== "idle" && (
        <div
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium shrink-0 ${
            gpsStatus === "tracking" || gpsStatus === "stationary"
              ? "bg-green-600/10 text-green-700 dark:text-green-400 border-b border-green-600/20"
              : gpsStatus === "acquiring"
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-b border-amber-500/20"
              : "bg-red-600/10 text-red-700 dark:text-red-400 border-b border-red-600/20"
          }`}
          data-testid="banner-gps-status"
        >
          <span
            className={`inline-block w-2 h-2 rounded-full shrink-0 ${
              gpsLost
                ? "bg-red-500 animate-pulse"
                : gpsStatus === "tracking" || gpsStatus === "stationary"
                ? "bg-green-500"
                : gpsStatus === "acquiring" || gpsStatus === "timeout"
                ? "bg-amber-500 animate-pulse"
                : "bg-red-500"
            }`}
          />
          {gpsStatus === "tracking" && (
            <span>
              GPS active{gpsAccuracy != null ? ` · ±${gpsAccuracy} m` : ""}
              {gpsLastSentAt != null && (
                <span className="opacity-70"> · {Math.max(0, Math.round((Date.now() - gpsLastSentAt) / 1000))}s ago</span>
              )}
            </span>
          )}
          {gpsStatus === "stationary" && (
            <span>
              Stationary{gpsAccuracy != null ? ` · ±${gpsAccuracy} m` : ""}
              {gpsLastSentAt != null && (
                <span className="opacity-70"> · {Math.max(0, Math.round((Date.now() - gpsLastSentAt) / 1000))}s ago</span>
              )}
            </span>
          )}
          {gpsStatus === "acquiring" && (
            <span>
              {gpsAccuracy != null
                ? gpsAccuracy < GPS_ACCURACY_FIRST
                  ? patchState === "sending"
                    ? `Sending position… (±${gpsAccuracy} m)`
                    : patchState.startsWith("fail:")
                    ? `Retrying… (±${gpsAccuracy} m)`
                    : patchState === "error"
                    ? `Network error — retrying… (±${gpsAccuracy} m)`
                    : `GPS ready · ±${gpsAccuracy} m`
                  : `Acquiring GPS… (${gpsAccuracy} m)`
                : "Acquiring GPS…"}
            </span>
          )}
          {gpsStatus === "denied" && (
            <>
              <span>Location access is off — enable it in your browser settings so dispatch can track your position.</span>
              {/* Deep link works on desktop Chrome; silently ignored by other browsers */}
              <a
                href="chrome://settings/content/location"
                className="ml-2 underline font-semibold shrink-0"
                data-testid="link-gps-settings"
              >
                Open settings
              </a>
            </>
          )}
          {gpsStatus === "unavailable" && <span>GPS unavailable on this device.</span>}
          {gpsStatus === "session_expired" && (
            <>
              <span>Session expired —</span>
              <a href="/login" className="underline font-semibold ml-1">log in again</a>
            </>
          )}
          {(gpsStatus === "stopped" || gpsStatus === "timeout") && (
            <>
              <span>GPS lost.</span>
              <button
                className="ml-2 underline font-semibold"
                onClick={() => {
                  if (joinedId) { gpsEndpointRef.current = "joiner-position"; startTracking(joinedId); }
                  else if (liveId) { gpsEndpointRef.current = "responder-position"; startTracking(liveId); }
                }}
                data-testid="button-retry-gps"
              >
                Retry
              </button>
            </>
          )}

          {/* Right-side: Live/Waiting badge */}
          <span className="ml-auto flex items-center gap-2 shrink-0">
            {(gpsStatus === "tracking" || gpsStatus === "stationary") && (
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-600 text-white tracking-wide"
                data-testid="badge-gps-live"
              >
                LIVE
              </span>
            )}
            {gpsStatus === "acquiring" && (
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white tracking-wide"
                data-testid="badge-gps-waiting"
              >
                WAITING
              </span>
            )}
          </span>
        </div>
      )}

      <div ref={scrollContainerRef} className="flex flex-col flex-1 gap-3 p-4 overflow-y-auto live-scroll">
        {currentIncident ? (
          <>
            {/* Joiner mode status banner */}
            {isJoinerMode && (
              <div className="rounded-lg border border-blue-500/40 bg-blue-500/5 px-3 py-2 flex items-center gap-2 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                  Joined Incident #{joinedId} — GPS tracking on
                </span>
              </div>
            )}
            {/* Destination — joiner sees creator's destination as a navigate button;
                creator gets the address search box */}
            <div className="space-y-1.5 shrink-0">
              {isJoinerMode ? (
                /* Joiner: show a navigate button to the creator's saved destination */
                !navMode && currentIncident?.destinationLat != null && currentIncident?.destinationLng != null ? (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">Incident destination</p>
                    {navStarted ? (
                      <button
                        type="button"
                        className="w-full min-w-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors py-1 text-left flex items-center gap-1.5"
                        onClick={() => confirmAndOpenNav(
                          Number(currentIncident.destinationLat),
                          Number(currentIncident.destinationLng)
                        )}
                        data-testid="button-joiner-reopen-maps"
                      >
                        <Navigation className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Open in Google Maps (pauses GPS) — {currentIncident.destinationName ?? "Incident Location"}</span>
                      </button>
                    ) : (
                      <Button
                        size="lg"
                        className="w-full flex-col h-auto py-3 gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                        onClick={dispatchJoinerInApp}
                        data-testid="button-joiner-navigate"
                      >
                        <div className="flex items-center gap-2">
                          <Navigation className="h-5 w-5 shrink-0" />
                          <span className="text-base font-semibold">Navigate (keeps GPS active)</span>
                        </div>
                        <span className="text-xs font-normal opacity-80 max-w-full truncate px-2">
                          {currentIncident.destinationName ?? "Incident Location"}
                        </span>
                      </Button>
                    )}
                    {routeInfo && (
                      <div className="flex gap-3 text-sm pt-0.5">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Navigation className="h-3.5 w-3.5" />
                          <span className="font-medium text-foreground">{fmtDist(routeInfo.distance)}</span>
                        </div>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">ETA <span className="font-medium text-foreground">{fmtDur(routeInfo.duration)}</span></span>
                      </div>
                    )}
                  </div>
                ) : !navMode ? (
                  <div className="rounded-lg border border-dashed px-3 py-2.5 flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0" />
                    Waiting for creator to set a destination…
                  </div>
                ) : null
              ) : navStarted && destination ? (
                /* Creator: navigation active — show compact destination + change link */
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-sm min-w-0">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate font-medium">{destination.name}</span>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors shrink-0"
                    onClick={() => setNavStarted(false)}
                    data-testid="button-change-destination"
                  >
                    Change
                  </button>
                </div>
              ) : (
                /* Creator: full destination address search */
                <>
                  <p className="text-sm font-medium">Where are you going?</p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="Search destination address…"
                      value={search}
                      onChange={(e) => handleSearch(e.target.value)}
                      data-testid="input-destination-search"
                    />
                    {loadingSugg && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                  {suggestions.length > 0 && (
                    <div className="border rounded-md bg-popover shadow-md overflow-hidden max-h-44 overflow-y-auto" data-testid="list-suggestions">
                      {suggestions.map((s) => (
                        <button
                          key={s.place_id}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-start gap-2 border-b last:border-b-0"
                          onClick={() => selectPlace(s)}
                          data-testid={`suggestion-${s.place_id}`}
                        >
                          <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                          <span className="line-clamp-2">{s.description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {!isJoinerMode && routeInfo && (
                <div className="flex gap-3 text-sm pt-0.5">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Navigation className="h-3.5 w-3.5" />
                    <span className="font-medium text-foreground">{fmtDist(routeInfo.distance)}</span>
                  </div>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">ETA <span className="font-medium text-foreground">{fmtDur(routeInfo.duration)}</span></span>
                </div>
              )}
            </div>

            {!navMode && hasRoute && currentStep ? (
              <div className="rounded-lg border border-green-500/40 bg-green-500/5 px-4 py-3 space-y-2 shrink-0" data-testid="nav-panel">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-base leading-snug flex-1 pr-2" data-testid="text-step-instruction">
                    {stripHtml(currentStep.instructions)}
                  </p>
                  {isOffRoute && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-amber-600 dark:text-amber-400 gap-1 px-2 shrink-0"
                      onClick={() => {
                        const destLat = isJoinerMode
                          ? (currentIncident?.destinationLat != null ? Number(currentIncident.destinationLat) : null)
                          : (destination?.lat ?? (currentIncident?.destinationLat != null ? Number(currentIncident.destinationLat) : null));
                        const destLng = isJoinerMode
                          ? (currentIncident?.destinationLng != null ? Number(currentIncident.destinationLng) : null)
                          : (destination?.lng ?? (currentIncident?.destinationLng != null ? Number(currentIncident.destinationLng) : null));
                        if (destLat && destLng) drawRoute(destLat, destLng, lastPosRef.current ?? undefined);
                      }}
                      data-testid="button-recalculate"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Recalculate
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Navigation className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="font-medium text-foreground">
                    {stepDist !== null ? fmtDist(stepDist) : (currentStep.distance ? fmtDist(currentStep.distance.value) : "—")}
                  </span>
                  <span className="ml-auto text-xs opacity-60">{currentStepIndex + 1} / {steps.length}</span>
                </div>
              </div>
            ) : !navMode ? (
              <div className="rounded-lg border border-green-500/40 bg-green-500/5 p-4 space-y-2 shrink-0">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-semibold text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  {isJoinerMode ? `Joined Incident #${joinedId} — GPS tracking on` : "Incident Active — GPS tracking on"}
                </div>
                <p className="text-xs text-muted-foreground">
                  Started: {currentIncident?.liveStartedAt ? new Date(currentIncident.liveStartedAt).toLocaleTimeString() : currentIncident?.incidentTime}
                </p>
                {currentIncident?.latitude && currentIncident?.longitude && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full gap-1.5 text-xs mt-1"
                    onClick={() => drawRoute(currentIncident!.latitude!, currentIncident!.longitude!, lastPosRef.current ?? undefined)}
                    data-testid="button-load-route"
                  >
                    <Navigation className="h-3 w-3" />
                    Load Navigation
                  </Button>
                )}
              </div>
            ) : null}
          </>
        ) : (
          /* Pre-start screen — no incident created yet */
          <div className="flex flex-col flex-1 gap-4" data-testid="pre-start-screen">
            <div className="flex flex-col items-center justify-center flex-1 gap-5 text-center px-6">
              <div className="rounded-full bg-green-500/10 p-5">
                <Radio className="h-10 w-10 text-green-500" />
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold text-lg">Ready to respond?</p>
                <p className="text-sm text-muted-foreground">Tap the button below to create your live incident and begin GPS tracking.</p>
              </div>
            </div>
            {/* Joinable incidents — only visible when there are active live incidents from other users */}
            {joinableIncidents.length > 0 && (
              <div className="shrink-0 space-y-2 border-t pt-3" data-testid="joinable-incidents-section">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                  Active incidents you can join
                </p>
                {joinableIncidents.map(inc => (
                  <div key={inc.id} className="rounded-lg border p-3 flex items-center justify-between gap-3" data-testid={`joinable-incident-${inc.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">Incident #{inc.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {inc.responderFirstName ?? ""} {inc.responderLastName ?? ""}
                        {inc.locationName ? ` · ${inc.locationName}` : ""}
                      </p>
                      {(inc.responders ?? []).length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {(inc.responders ?? []).length} joiner{(inc.responders ?? []).length > 1 ? "s" : ""} already on this
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={() => joinLiveMutation.mutate(inc.id)}
                      disabled={joinLiveMutation.isPending}
                      data-testid={`button-join-incident-${inc.id}`}
                    >
                      {joinLiveMutation.isPending && (joinLiveMutation.variables as number) === inc.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : "Join"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Responder status pill — non-nav mode only; nav mode shows the chip in the overlay */}
        {!navMode && navResponders.length > 0 && (
          <div className="flex items-center gap-1.5 px-1 shrink-0 text-xs font-medium text-green-700 dark:text-green-400" data-testid="chip-responders-nonav">
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span>
              {navResponders.length === 1
                ? `${navResponders[0].firstName} is responding`
                : `${navResponders.length} responders en route`}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
          </div>
        )}

        {/* Map always mounted — avoids losing the google.maps.Map instance on state change */}
        {mapsError ? (
          <div className="flex-1 rounded-lg border border-destructive/40 bg-destructive/5 flex items-center justify-center min-h-[200px]" data-testid="map-error">
            <div className="text-center px-6 py-8 space-y-2">
              <MapPin className="h-8 w-8 mx-auto text-destructive/60" />
              <p className="text-sm text-muted-foreground">Map unavailable — contact your administrator.</p>
            </div>
          </div>
        ) : (
          <div
            className={navMode ? "relative overflow-hidden native-map-host" : "relative rounded-lg overflow-hidden min-h-[200px] flex-1 native-map-host"}
            style={navMode ? { height: "calc(100dvh - 3.5rem)" } : undefined}
          >
            {/* Nav mode: step banner overlaid at the top of the (tall in-flow) map.
                Shows large maneuver arrow + instruction + distance, plus a "Then"
                pill with the next step's arrow when available. */}
            {navMode && currentStep && (
              <div
                className="absolute top-0 left-0 right-0 z-10 px-3 pb-2 pointer-events-none"
                style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
              >
                {/* Main step banner */}
                <div className="pointer-events-auto bg-primary text-primary-foreground rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">
                  <ManeuverIcon
                    maneuver={(currentStep as google.maps.DirectionsStep & { maneuver?: string }).maneuver}
                    className="h-12 w-12 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xl font-bold leading-tight line-clamp-2" data-testid="text-nav-instruction">
                      {stripHtml(currentStep.instructions)}
                    </p>
                    <p className="text-base font-semibold opacity-90 leading-tight">
                      {stepDist !== null ? fmtDist(stepDist) : currentStep.distance ? fmtDist(currentStep.distance.value) : "—"}
                      <span className="ml-2 text-xs opacity-70">{currentStepIndex + 1} / {steps.length}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => setNavMode(false)}
                    className="shrink-0 p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                    aria-label="Exit navigation"
                    data-testid="button-exit-nav"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                {/* Row: "Then" pill (left) + responder "en route" chip (right) */}
                <div className="mt-1.5 flex items-center gap-2">
                  {steps[currentStepIndex + 1] && (
                    <div className="pointer-events-auto inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-full pl-3 pr-3 py-1 shadow-lg text-sm font-medium max-w-[60%]">
                      <span className="opacity-75">Then</span>
                      <ManeuverIcon
                        maneuver={(steps[currentStepIndex + 1] as google.maps.DirectionsStep & { maneuver?: string }).maneuver}
                        className="h-4 w-4 shrink-0"
                      />
                      <span className="truncate opacity-90">
                        {stripHtml(steps[currentStepIndex + 1].instructions)}
                      </span>
                    </div>
                  )}
                  {navResponders.length > 0 && (
                    <div
                      className={`pointer-events-none ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 shadow-lg text-xs font-semibold transition-colors duration-300 ${newJoinerFlash ? "bg-green-500 text-white" : "bg-black/55 text-white"}`}
                      data-testid="chip-nav-responders"
                    >
                      <Users className="h-3 w-3 shrink-0" />
                      <span>
                        {newJoinerFlash
                          ? newJoinerFlash
                          : navResponders.length === 1
                            ? `${navResponders[0].firstName} en route`
                            : `${navResponders.length} en route`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!useWebMap ? (
              <CapacitorMap
                ref={capMapRef}
                apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''}
                className="absolute inset-0"
                onReady={() => {
                  setNativeMapStatus("ready");
                  setNativeMapReadyAt(Date.now());
                }}
                onError={(err) => {
                  const msg = (err as Error)?.message ?? String(err);
                  setNativeMapStatus(msg.includes("timeout") ? "timeout" : "error");
                  setNativeMapErrorMsg(msg);
                  setNativeMapFailed(true);
                }}
              />
            ) : (
              <div ref={mapRef} className="absolute inset-0" data-testid="map-live" />
            )}

            {/* Nav mode: action bar — absolute overlay at the bottom of the in-flow map */}
            {navMode && (
              <div
                className="absolute bottom-0 left-0 right-0 z-10 bg-background border-t px-4 py-3 space-y-2"
                style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
              >
                {/* Route summary row + speed */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    {routeInfo && (
                      <>
                        <span className="font-medium">{fmtDist(routeInfo.distance)}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">ETA{" "}
                          <span className="font-medium text-foreground">{fmtDur(routeInfo.duration)}</span>
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground" data-testid="nav-speed">
                    <Gauge className="h-4 w-4" />
                    <span className="font-bold text-foreground text-base tabular-nums">{speedKmh ?? "--"}</span>
                    <span className="text-xs">km/h</span>
                  </div>
                </div>
                {/* Arrived button */}
                <Button
                  size="lg"
                  variant="destructive"
                  className="w-full font-bold"
                  onClick={() => {
                    setNavMode(false);
                    arrivalTimeRef.current = new Date();
                    if (!isJoinerMode && currentIncident) {
                      apiRequest("PATCH", `/api/incidents/${currentIncident.id}/mark-arrived`, {}).catch(() => {});
                    }
                    setShowArrivalForm(true);
                  }}
                  data-testid="button-arrived-nav"
                >
                  <CheckCircle2 className="h-5 w-5 mr-2" />
                  {isJoinerMode ? "I've Arrived — Record & Leave" : "I've Arrived — Record Incident"}
                </Button>
              </div>
            )}

            {/* Location denied overlay */}
            {(locationPermission === "denied" || gpsStatus === "denied") && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/85 backdrop-blur-sm z-10 px-6 text-center"
                data-testid="map-overlay-location-denied"
              >
                <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-sm">Location access is blocked</p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    GPS tracking won't work until you re-enable location for this app.
                  </p>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                      data-testid="button-map-location-help"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                      How to fix this
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-4 space-y-2 text-sm" data-testid="popover-map-location-help">
                    <p className="font-semibold">Re-enable Location</p>
                    <p className="text-xs text-muted-foreground">
                      {/iPad|iPhone|iPod/.test(navigator.userAgent)
                        ? "Settings → Privacy & Security → Location Services → find your browser → set to \"While Using\"."
                        : /Android/i.test(navigator.userAgent)
                        ? "Settings → Apps → Chrome → Permissions → Location → Allow."
                        : "Click the lock icon in your browser's address bar → Site settings → Location → Allow."}
                    </p>
                    <p className="text-xs text-muted-foreground">Once granted, return here — the map will restore automatically.</p>
                  </PopoverContent>
                </Popover>
              </div>
            )}

            {/* Location prompt overlay — shown when location has never been asked */}
            {locationPermission === "prompt" && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm z-10 px-6 text-center"
                data-testid="map-overlay-location-prompt"
              >
                <div className="h-12 w-12 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                  <Navigation className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-sm">Location needed</p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    Allow location access so OMT can track your GPS during a live incident.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                  onClick={() => {
                    if (navigator.geolocation) {
                      navigator.geolocation.getCurrentPosition(() => {}, () => {}, { timeout: 10000 });
                    }
                  }}
                  data-testid="button-map-allow-location"
                >
                  Allow Location
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Bottom action area */}
        {currentIncident ? (
          showArrivalForm ? (
            /* ---- Arrival capture form — full-screen page overlay ---- */
            <div className="fixed inset-0 z-50 bg-background flex flex-col" data-testid="arrival-form">
              {/* Page header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b bg-background shrink-0">
                <button
                  onClick={() => setShowArrivalForm(false)}
                  className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
                  data-testid="button-cancel-arrival"
                  aria-label="Back"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div>
                  <p className="text-base font-semibold leading-tight">Record On-Ground Incident</p>
                  <p className="text-xs text-muted-foreground">
                    {currentIncident?.destinationName || "Current location"}
                  </p>
                </div>
              </div>
              {/* Scrollable form body */}
              <div className="flex-1 overflow-y-auto">
              <div className="space-y-4 p-4 pb-2" data-testid="arrival-form-body">

              {/* Pre-filled location / time — read-only summary */}
              <div className="rounded-md bg-muted/60 border px-3 py-2 text-xs space-y-0.5" data-testid="arrival-prefill">
                <div className="flex gap-1.5">
                  <span className="font-medium text-muted-foreground w-14 shrink-0">Location</span>
                  <span className="font-medium truncate" data-testid="text-arrival-location">
                    {currentIncident?.destinationName || "Current location"}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <span className="font-medium text-muted-foreground w-14 shrink-0">Time</span>
                  <span data-testid="text-arrival-time">
                    {arrivalTimeRef.current.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <span className="font-medium text-muted-foreground w-14 shrink-0">Date</span>
                  <span data-testid="text-arrival-date">
                    {arrivalTimeRef.current.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </div>
              </div>

              {/* Category */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Incident Type</label>
                <Select
                  value={arrivalCategoryId !== null ? String(arrivalCategoryId) : ""}
                  onValueChange={(v) => { setArrivalCategoryId(v ? Number(v) : null); setArrivalOtherType(""); }}
                >
                  <SelectTrigger className="h-9 text-sm" data-testid="select-arrival-category">
                    <SelectValue placeholder="Select type…" />
                  </SelectTrigger>
                  <SelectContent>
                    {nonLiveCategories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)} data-testid={`arrival-cat-${c.id}`}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {arrivalCategoryId !== null &&
                  nonLiveCategories.find((c) => c.id === arrivalCategoryId)?.name.toLowerCase() === "other" && (
                  <div className="space-y-1 mt-1">
                    <label className="text-xs font-medium text-muted-foreground">Please specify</label>
                    <Input
                      placeholder="Please specify…"
                      value={arrivalOtherType}
                      onChange={(e) => setArrivalOtherType(e.target.value)}
                      className="h-9 text-sm"
                      maxLength={100}
                      data-testid="input-arrival-other-type"
                    />
                  </div>
                )}
              </div>

              {/* Description */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Notes / Description</label>
                <Textarea
                  placeholder="Describe what you found on arrival…"
                  value={arrivalDescription}
                  onChange={(e) => setArrivalDescription(e.target.value)}
                  rows={2}
                  className="text-sm resize-none"
                  maxLength={500}
                  data-testid="textarea-arrival-description"
                />
              </div>

              {/* Media — up to 5 photos + voice */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    Evidence Media (optional, up to {MAX_ARRIVAL_MEDIA})
                  </label>
                  <span className="text-xs text-muted-foreground">{arrivalMedia.length}/{MAX_ARRIVAL_MEDIA}</span>
                </div>

                {/* Thumbnail grid for images + audio cards */}
                {arrivalMedia.length > 0 && (
                  <div className="grid grid-cols-3 gap-1.5">
                    {arrivalMedia.map((item, idx) => (
                      <div key={item.id} className="relative rounded overflow-hidden border bg-muted" data-testid={`arrival-media-item-${item.id}`}>
                        {item.mimeType.startsWith("image/") ? (
                          <img
                            src={item.url}
                            alt={`Media ${idx + 1}`}
                            className="w-full h-20 object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center h-20 gap-1 px-1">
                            <Mic className="h-5 w-5 text-muted-foreground" />
                            <audio src={item.url} controls className="w-full h-6 scale-90" />
                          </div>
                        )}
                        <button
                          onClick={() => removeMedia(item.id)}
                          className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5"
                          aria-label={`Remove media ${idx + 1}`}
                          data-testid={`button-remove-arrival-media-${item.id}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {arrivalUploading && (
                      <div className="flex items-center justify-center h-20 rounded border bg-muted">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </div>
                )}

                {/* Add media buttons — always shown, disabled at cap or while uploading */}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5 text-xs h-9"
                    disabled={arrivalUploading || arrivalMedia.length >= MAX_ARRIVAL_MEDIA}
                    onClick={() => arrivalCameraRef.current?.click()}
                    data-testid="button-arrival-camera"
                  >
                    {arrivalUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    Camera
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5 text-xs h-9"
                    disabled={arrivalUploading || arrivalMedia.length >= MAX_ARRIVAL_MEDIA}
                    onClick={() => arrivalFileRef.current?.click()}
                    data-testid="button-arrival-gallery"
                  >
                    <ImageIcon className="h-4 w-4" />
                    Gallery
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={isRecording ? "destructive" : "outline"}
                    className="flex-1 gap-1.5 text-xs h-9"
                    disabled={(!isOnline && !isRecording) || (!isRecording && arrivalMedia.length >= MAX_ARRIVAL_MEDIA)}
                    onClick={isRecording ? stopRecording : startRecording}
                    data-testid="button-arrival-voice"
                  >
                    {isRecording ? (
                      <>
                        <Square className="h-4 w-4" />
                        {`${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, "0")} / 2:00`}
                      </>
                    ) : (
                      <>
                        <Mic className="h-4 w-4" />
                        Voice
                      </>
                    )}
                  </Button>
                </div>

                <input
                  ref={arrivalCameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAddImage(f); e.target.value = ""; }}
                  data-testid="input-arrival-camera"
                />
                <input
                  ref={arrivalFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAddImage(f); e.target.value = ""; }}
                  data-testid="input-arrival-gallery"
                />
              </div>

              </div>
              </div>

              {/* Sticky submit footer */}
              <div className="shrink-0 px-4 pt-3 pb-4 border-t bg-background" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
                <Button
                  size="lg"
                  className="w-full"
                  onClick={isJoinerMode ? submitJoinerArrival : submitArrival}
                  disabled={arrivalSubmitting}
                  data-testid="button-submit-arrival"
                >
                  {arrivalSubmitting ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <CheckCircle2 className="h-5 w-5 mr-2" />}
                  {isJoinerMode ? "Record Arrival & Leave" : "Record & Close Incident"}
                </Button>
              </div>
            </div>
          ) : navMode ? null : isNearDestination && !isPanicIncident ? (
            /* ---- Auto-detected arrival: within 150 m of destination ---- */
            <div className="shrink-0 space-y-2 pb-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
              <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-700 px-4 py-2 text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0" />
                <span>You are within 150 m of your destination</span>
              </div>
              <Button
                size="lg"
                variant="destructive"
                className="w-full shrink-0 text-base font-bold py-6"
                onClick={() => {
                  arrivalTimeRef.current = new Date();
                  if (!isJoinerMode && currentIncident) apiRequest("PATCH", `/api/incidents/${currentIncident.id}/mark-arrived`, {}).catch(() => {});
                  setShowArrivalForm(true);
                }}
                data-testid="button-arrived-auto"
              >
                <CheckCircle2 className="h-6 w-6 mr-2" />
                {isJoinerMode ? "I've Arrived — Record & Leave" : "I've Arrived — Record Incident"}
              </Button>
              {isJoinerMode && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-blue-500/60 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
                  disabled={leaveLiveMutation.isPending}
                  onClick={() => joinedId !== null && leaveLiveMutation.mutate(joinedId)}
                  data-testid="button-leave-live"
                >
                  {leaveLiveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <LogOut className="h-4 w-4 mr-1.5" />}
                  Leave without recording
                </Button>
              )}
            </div>
          ) : destination && !navStarted && !isJoinerMode ? (
            /* ---- Creator: destination selected, not yet navigating — start in-app nav ---- */
            <div className="shrink-0 space-y-2">
              <Button
                size="lg"
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={dispatching}
                onClick={dispatchInApp}
                data-testid="button-dispatch"
              >
                {dispatching ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Navigation className="h-5 w-5 mr-2" />}
                Navigate — GPS stays live
              </Button>
              <button
                type="button"
                className="w-full text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors py-0.5"
                onClick={() => destination && confirmAndOpenNav(destination.lat, destination.lng, () => {
                  const incId = currentIncidentId;
                  if (incId) { localStorage.setItem(NAV_STARTED_KEY, String(incId)); setNavStarted(true); }
                })}
                data-testid="button-dispatch-external"
              >
                Open in Google Maps (pauses GPS)
              </button>
            </div>
          ) : (
            /* ---- Navigation started (or no destination): show arrived button ---- */
            <div className="shrink-0 space-y-2" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
              <Button
                size="lg"
                variant="destructive"
                className="w-full text-base font-bold py-6"
                onClick={() => {
                  arrivalTimeRef.current = new Date();
                  if (!isJoinerMode && currentIncident) apiRequest("PATCH", `/api/incidents/${currentIncident.id}/mark-arrived`, {}).catch(() => {});
                  setShowArrivalForm(true);
                }}
                data-testid="button-arrived"
              >
                <CheckCircle2 className="h-6 w-6 mr-2" />
                {isJoinerMode ? "I've Arrived — Record & Leave" : "I've Arrived — Record Incident"}
              </Button>
              {navStarted && destination && (
                <button
                  type="button"
                  className="w-full text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors py-1"
                  onClick={() => confirmAndOpenNav(destination.lat, destination.lng)}
                  data-testid="button-reopen-maps"
                >
                  Open in Google Maps (pauses GPS)
                </button>
              )}
              {isJoinerMode && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-blue-500/60 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
                  disabled={leaveLiveMutation.isPending}
                  onClick={() => joinedId !== null && leaveLiveMutation.mutate(joinedId)}
                  data-testid="button-leave-live"
                >
                  {leaveLiveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <LogOut className="h-4 w-4 mr-1.5" />}
                  Leave without recording
                </Button>
              )}
            </div>
          )
        ) : (
          /* ---- Pre-start: create incident and begin tracking ---- */
          <Button
            size="lg"
            className="w-full shrink-0 bg-green-600 hover:bg-green-700 text-white"
            disabled={starting || !liveQueryLoaded}
            onClick={startLive}
            data-testid="button-start-live"
          >
            {starting ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Radio className="h-5 w-5 mr-2" />}
            {starting ? "Starting…" : "Start Live Incident"}
          </Button>
        )}
      </div>

      {/* Pre-flight nav warning — opening Google Maps backgrounds OMT and stops
          live GPS until the user returns to the app. Shown once per device. */}
      <Dialog
        open={pendingNavTarget !== null}
        onOpenChange={(o) => { if (!o) setPendingNavTarget(null); }}
      >
        <DialogContent className="max-w-md" data-testid="dialog-nav-warning">
          <DialogHeader>
            <DialogTitle>Heads up — live GPS will pause</DialogTitle>
            <DialogDescription className="pt-2 space-y-2">
              <span className="block">
                Opening Google Maps puts OMT in the background. Android stops sharing
                your live GPS with dispatch while another app is in the foreground.
              </span>
              <span className="block font-medium text-foreground">
                As soon as you tap back into OMT, GPS sharing resumes automatically.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => {
                const t = pendingNavTarget;
                if (!t) return;
                openGoogleMapsNav(t.lat, t.lng);
                t.after?.();
                setPendingNavTarget(null);
              }}
              data-testid="button-nav-warning-continue"
            >
              Continue to Google Maps
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground underline mx-auto"
              onClick={() => {
                try { localStorage.setItem(NAV_WARNING_KEY, "1"); } catch { /* ignore */ }
                const t = pendingNavTarget;
                if (!t) return;
                openGoogleMapsNav(t.lat, t.lng);
                t.after?.();
                setPendingNavTarget(null);
              }}
              data-testid="button-nav-warning-dismiss-forever"
            >
              Continue and don't show this again
            </button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground mx-auto"
              onClick={() => setPendingNavTarget(null)}
              data-testid="button-nav-warning-cancel"
            >
              Cancel
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
