import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
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
import { ArrowLeft, Navigation, MapPin, Radio, CheckCircle2, Loader2, RotateCcw, RotateCw, ChevronRight, ExternalLink, Camera, ImageIcon, X, WifiOff, LogOut, Mic, Square, AlertTriangle, HelpCircle, Gauge, ArrowUp, ArrowUpRight, ArrowUpLeft, ArrowRight, CornerUpRight, CornerUpLeft, Merge, Users, Layers, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { usePermissionStatus } from "@/hooks/use-permission-status";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { loadGoogleMaps, resetGoogleMapsLoader } from "@/lib/google-maps-loader";
import { speak, stopSpeaking } from "@/lib/tts";
import { Capacitor } from '@capacitor/core';
import CapacitorMap, { type CapacitorMapHandle } from '@/components/CapacitorMap';
import type { Incident, Category, FormField } from "@shared/schema";
import { isCloseReclassifyType } from "@/lib/incident-categories";
import { resolveJoinerNavDestination, resolveLiveNavTarget } from "@/lib/incident-display";
import {
  type JoinNavStyle,
  bearingCardinal,
  bearingDegrees,
  GUIDED_REROUTE_COOLDOWN_MS,
  haversineM,
  minDistToPolylineM,
  NAV_TRACK_INTERVAL_MS,
  OFF_ROUTE_FALLBACK_STREAK,
  OFF_ROUTE_POLYLINE_M,
  ptSegDistM,
  readStoredJoinNavStyle,
  seedStepIndexFromPosition,
  storeJoinNavStyle,
} from "@/lib/join-nav";
import { pathFromDirectionsRoute, type LatLngPoint } from "@/lib/decode-polyline";
import { usePanickerLocationSync } from "@/hooks/use-panicker-location-sync";
import { LocationPermissionGuide } from "@/components/location-permission-guide";
import { LiveIncidentArrivalForm } from "@/components/live-incident-arrival-form";
import {
  LiveIncidentDestinationSheet,
  LiveIncidentJoinerNavSheet,
  LiveIncidentNavBottomBar,
  LiveIncidentNavPhaseBadge,
  LiveIncidentStartNavigationCta,
  LiveIncidentBypassNavigationCta,
  NAV_ARRIVAL_AT_SCENE_M,
  NAV_ARRIVAL_SOON_M,
  resolveNavFieldPhase,
} from "@/components/live-incident-navigation";
import { probePanicLocation } from "@/lib/panic-send";
import { acquirePanicLocation, hasPanicCoordinates } from "@/lib/panic-location";

const LIVE_INCIDENT_KEY = "omt_live_incident_id";

const GENERIC_INCIDENT_LOCATION_NAMES = new Set([
  "live incident",
  "gps tracking",
  "current location",
]);

type IncidentCoordSource = {
  latitude?: number | string | null;
  longitude?: number | string | null;
  liveStartLat?: number | string | null;
  liveStartLng?: number | string | null;
};

function isValidGpsPair(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  // Reject null-island placeholders stored before the first real GPS fix.
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return true;
}

function incidentGpsCoords(inc: IncidentCoordSource | null | undefined): { lat: number; lng: number } | null {
  if (!inc) return null;
  const candidates: Array<[number | string | null | undefined, number | string | null | undefined]> = [
    [inc.liveStartLat, inc.liveStartLng],
    [inc.latitude, inc.longitude],
  ];
  for (const [rawLat, rawLng] of candidates) {
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (isValidGpsPair(lat, lng)) return { lat, lng };
  }
  return null;
}

/** Prefer the device’s live GPS fix; fall back to coords persisted on the incident. */
function resolveFieldGpsCoords(
  inc: IncidentCoordSource | null | undefined,
  livePos: { lat: number; lng: number } | null | undefined,
): { lat: number; lng: number } | null {
  if (livePos && isValidGpsPair(livePos.lat, livePos.lng)) return livePos;
  return incidentGpsCoords(inc);
}

function isUsableLocationSearchLabel(name: string | null | undefined): boolean {
  const trimmed = name?.trim() ?? "";
  return trimmed.length >= 3 && !GENERIC_INCIDENT_LOCATION_NAMES.has(trimmed.toLowerCase());
}

function incidentLocationDisplayLabel(
  inc: IncidentCoordSource & { locationName?: string | null; destinationName?: string | null },
  livePos?: { lat: number; lng: number } | null,
): string {
  if (isUsableLocationSearchLabel(inc.destinationName)) return inc.destinationName!.trim();
  if (isUsableLocationSearchLabel(inc.locationName)) return inc.locationName!.trim();
  if (livePos && isValidGpsPair(livePos.lat, livePos.lng)) {
    return "Your current GPS position";
  }
  const coords = incidentGpsCoords(inc);
  if (coords) return `GPS position (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`;
  return "Your GPS position";
}

function incidentHasPanicCoords(inc: {
  latitude?: number | string | null;
  longitude?: number | string | null;
  liveStartLat?: number | string | null;
  liveStartLng?: number | string | null;
  destinationLat?: number | string | null;
  destinationLng?: number | string | null;
}): boolean {
  const pick = (lat: number | string | null | undefined, lng: number | string | null | undefined) => {
    if (lat == null || lng == null) return false;
    const la = Number(lat);
    const ln = Number(lng);
    return Number.isFinite(la) && Number.isFinite(ln);
  };
  return (
    pick(inc.destinationLat, inc.destinationLng) ||
    pick(inc.liveStartLat, inc.liveStartLng) ||
    pick(inc.latitude, inc.longitude)
  );
}
const JOINED_INCIDENT_KEY = "omt_joined_incident_id";
const ARRIVAL_QUEUE_KEY = "omt_arrival_queue";
const ARRIVAL_FORM_SESSION_KEY = "omt_arrival_form_session";
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

function severityBadgeClass(severity: string | null | undefined): string {
  if (severity === "red") return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
  if (severity === "orange") return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30";
  if (severity === "yellow") return "bg-yellow-400/15 text-yellow-800 dark:text-yellow-400 border-yellow-400/30";
  return "bg-muted text-muted-foreground border-border";
}

function severityDotClass(severity: string | null | undefined): string {
  if (severity === "red") return "bg-red-500";
  if (severity === "orange") return "bg-orange-500";
  if (severity === "yellow") return "bg-yellow-400";
  return "bg-muted-foreground";
}

type LiveIncidentSummary = Incident & {
  categoryName?: string | null;
  categoryColor?: string | null;
  responderFirstName?: string | null;
  responderLastName?: string | null;
};

function IncidentActiveSummary({
  incident,
  isJoiner,
  categories,
  showLoadRoute,
  onLoadRoute,
  compact = false,
}: {
  incident: LiveIncidentSummary;
  isJoiner: boolean;
  categories: Category[];
  showLoadRoute: boolean;
  onLoadRoute: () => void;
  compact?: boolean;
}) {
  const categoryName =
    incident.categoryName ?? categories.find((c) => c.id === incident.categoryId)?.name ?? null;
  const categoryColor =
    incident.categoryColor ?? categories.find((c) => c.id === incident.categoryId)?.color ?? null;
  const severity = incident.severity;
  const starter = [incident.responderFirstName, incident.responderLastName].filter(Boolean).join(" ").trim();

  if (compact) {
    return (
      <div
        className={`rounded-lg border bg-card px-3 py-2 shrink-0 ${
          severity === "red" ? "border-red-500/25" : severity === "orange" ? "border-orange-500/20" : ""
        }`}
        data-testid="card-incident-active-summary"
      >
        <div className="flex items-center gap-2 min-w-0 text-xs">
          {categoryColor ? (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: categoryColor }}
              aria-hidden
            />
          ) : null}
          <span className="font-semibold shrink-0">#{incident.id}</span>
          {severity && severity !== "none" ? (
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase ${severityBadgeClass(severity)}`}
              data-testid="badge-live-severity"
            >
              <span className={`h-1 w-1 rounded-full ${severityDotClass(severity)}`} />
              {severity}
            </span>
          ) : null}
          {categoryName ? (
            <span className="truncate font-medium text-foreground/90">{categoryName}</span>
          ) : null}
          {isJoiner && starter ? (
            <span className="truncate text-muted-foreground hidden min-[360px]:inline">· {starter}</span>
          ) : null}
          <span className="ml-auto flex shrink-0 items-center gap-1 text-green-600 dark:text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            GPS
          </span>
        </div>
      </div>
    );
  }

  const startedLabel = incident.liveStartedAt
    ? new Date(incident.liveStartedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : incident.incidentTime;

  return (
    <div
      className={`rounded-xl border bg-card shadow-sm overflow-hidden shrink-0 ${
        severity === "red" ? "border-red-500/30" : severity === "orange" ? "border-orange-500/25" : ""
      }`}
      data-testid="card-incident-active-summary"
    >
      {severity === "red" ? <div className="h-1 bg-red-500" aria-hidden /> : null}
      <div className="p-4 flex items-start gap-3">
        {categoryColor ? (
          <div
            className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-sm"
            style={{ backgroundColor: categoryColor }}
            aria-hidden
          >
            <Radio className="h-5 w-5 text-white" strokeWidth={2.25} />
          </div>
        ) : null}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-base">Incident #{incident.id}</span>
            {severity && severity !== "none" ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${severityBadgeClass(severity)}`}
                data-testid="badge-live-severity"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${severityDotClass(severity)} ${severity === "red" ? "animate-pulse" : ""}`} />
                {severity}
              </span>
            ) : null}
            {categoryName ? (
              <span className="text-sm font-medium text-muted-foreground">{categoryName}</span>
            ) : null}
          </div>
          {isJoiner && starter ? (
            <p className="text-sm text-foreground/80">Started by {starter}</p>
          ) : null}
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            {isJoiner ? "You're responding · GPS active" : "GPS tracking active"}
            {startedLabel ? <span>· Started {startedLabel}</span> : null}
          </p>
          {showLoadRoute ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5 text-xs mt-2"
              onClick={onLoadRoute}
              data-testid="button-load-route"
            >
              <Navigation className="h-3 w-3" />
              Load Navigation
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function fmtDist(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
function fmtDur(s: number) {
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}min`;
}
/** Sum distance/duration from the current step onward (for nav-mode ETA strip). */
function remainingFromSteps(
  steps: Array<{ distance?: { value?: number }; duration?: { value?: number } }>,
  fromIndex: number,
) {
  let distance = 0;
  let duration = 0;
  for (let i = fromIndex; i < steps.length; i++) {
    distance += steps[i].distance?.value ?? 0;
    duration += steps[i].duration?.value ?? 0;
  }
  return { distance, duration };
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

function fmtTimeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}

type NavRosterEntry = {
  userId: string;
  firstName: string;
  lastName: string;
  role: "panicker" | "creator" | "you" | "responder";
  status: "live" | "ack";
  joinedAt?: string | null;
  lastPositionAt?: string | null;
};

function buildNavRoster(opts: {
  incident: {
    userId: string | null;
    responderFirstName?: string | null;
    responderLastName?: string | null;
    responderPositionUpdatedAt?: Date | string | null;
    responders?: Array<{
      userId: string;
      firstName: string;
      lastName: string;
      joinedAt: string;
      lastPositionAt?: string | null;
    }>;
  };
  meId?: string;
  isJoiner: boolean;
  isPanic: boolean;
  acknowledgers: Array<{ userId: string; firstName: string; lastName: string }>;
}): NavRosterEntry[] {
  const { incident, meId, isJoiner, isPanic, acknowledgers } = opts;
  const entries: NavRosterEntry[] = [];
  const byUserId = new Map<string, NavRosterEntry>();

  if (isJoiner && incident.userId) {
    const creatorPositionAt =
      incident.responderPositionUpdatedAt instanceof Date
        ? incident.responderPositionUpdatedAt.toISOString()
        : incident.responderPositionUpdatedAt ?? null;
    const row: NavRosterEntry = {
      userId: incident.userId,
      firstName: incident.responderFirstName ?? (isPanic ? "Panicker" : "Incident lead"),
      lastName: incident.responderLastName ?? "",
      role: isPanic ? "panicker" : "creator",
      status: "live",
      lastPositionAt: creatorPositionAt,
    };
    byUserId.set(row.userId, row);
    entries.push(row);
  }

  if (isPanic) {
    for (const a of acknowledgers) {
      if (byUserId.has(a.userId)) continue;
      const row: NavRosterEntry = {
        userId: a.userId,
        firstName: a.firstName,
        lastName: a.lastName,
        role: a.userId === meId ? "you" : "responder",
        status: "ack",
      };
      byUserId.set(a.userId, row);
      entries.push(row);
    }
  }

  for (const r of incident.responders ?? []) {
    const existing = byUserId.get(r.userId);
    const row: NavRosterEntry = {
      userId: r.userId,
      firstName: r.firstName,
      lastName: r.lastName,
      role: r.userId === meId ? "you" : "responder",
      status: "live",
      joinedAt: r.joinedAt,
      lastPositionAt: r.lastPositionAt ?? null,
    };
    if (existing) {
      Object.assign(existing, {
        ...row,
        role:
          existing.role === "panicker" || existing.role === "creator"
            ? existing.role
            : row.role,
      });
    } else {
      byUserId.set(r.userId, row);
      entries.push(row);
    }
  }

  return entries;
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
  const capOriginMarkerIdRef = useRef<string>('');
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
  /** Full route polyline for off-route detection (not step chords). */
  const routePolylineRef = useRef<LatLngPoint[]>([]);
  const offRouteStreakRef = useRef(0);
  const activeNavStyleRef = useRef<JoinNavStyle>("direct");
  const announcedStepRef = useRef<number>(-1);       // step-advance voice (fires on index change)
  const approachingTurnAnnouncedRef = useRef<number>(-1); // 200 m "In X m, turn …" voice (per step)
  const arrivedAnnouncedRef = useRef<boolean>(false);
  const lastHeadingRef = useRef<number | null>(null); // last valid GPS heading — persisted through brief null gaps (e.g. mid-turn)
  const arrivalCameraRef = useRef<HTMLInputElement>(null);
  const arrivalUploadRef = useRef<HTMLInputElement>(null);
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
  // Cooldown for the "Could not compute driving route" toast — off-route
  // reroutes can fire every few seconds, we don't want to spam the toast queue.
  const lastDirectionsToastAtRef = useRef<number>(0);
  // Stable ref so the sendPosition closure inside startTracking() can check
  // isPanicIncident without stale-closure issues (React state is not readable
  // inside a watchPosition callback).
  const isPanicIncidentRef = useRef<boolean>(false);
  const arrivalTimeRef = useRef<Date>(new Date());
  const gpsEndpointRef = useRef<"responder-position" | "joiner-position">("responder-position");

  const locationPermission = usePermissionStatus().location;

  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  // Internal map status state — drives the NATIVE/WEB-MAP badge and the
  // "Map unavailable" error UI. (The former on-screen debug overlay that also
  // consumed these was removed for the Play Store release.)
  const [mapsErrorMsg, setMapsErrorMsg] = useState<string | null>(null);
  // Native: JS API (search/routes) can fail while the Capacitor map still works.
  // Don't replace the whole map with an error panel in that case.
  const [jsApiDegraded, setJsApiDegraded] = useState(false);
  const [jsApiRetrying, setJsApiRetrying] = useState(false);
  const [geocoderReady, setGeocoderReady] = useState(false);
  const [autocompleteReady, setAutocompleteReady] = useState(false);
  const [nativeMapStatus, setNativeMapStatus] = useState<"idle" | "creating" | "ready" | "timeout" | "error">("idle");
  const [nativeMapErrorMsg, setNativeMapErrorMsg] = useState<string | null>(null);
  const [nativeMapCreateAt, setNativeMapCreateAt] = useState<number | null>(null);
  const [nativeMapReadyAt, setNativeMapReadyAt] = useState<number | null>(null);
  // Current base map tile style — cycled by the floating top-right button.
  const [mapType, setMapType] = useState<"Normal" | "Hybrid" | "Satellite">("Normal");

  // Mark native map as "creating" the moment we mount <CapacitorMap>.
  useEffect(() => {
    if (!useWebMap && nativeMapStatus === "idle") {
      setNativeMapStatus("creating");
      setNativeMapCreateAt(Date.now());
    }
  }, [useWebMap, nativeMapStatus]);
  const [search, setSearch] = useState("");
  const [searchHint, setSearchHint] = useState<string | null>(null);
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
  const [guidedOffRoute, setGuidedOffRoute] = useState(false);
  const [navMode, setNavMode] = useState(false);
  /** Direct = bearing/distance to live target; Guided = turn-by-turn. */
  const [activeNavStyle, setActiveNavStyle] = useState<JoinNavStyle>(() => readStoredJoinNavStyle());
  const [directDist, setDirectDist] = useState<number | null>(null);
  const [directBearing, setDirectBearing] = useState<number | null>(null);
  const [speedKmh, setSpeedKmh] = useState<number | null>(null);
  // Joiner navigation is gated on a real GPS fix — without the joiner's own
  // position there is no route origin and dispatch can't track them. These
  // drive the "Getting your location…" button state and the location-enable
  // guide shown when a joiner taps Navigate with location off.
  const [acquiringJoinerGps, setAcquiringJoinerGps] = useState(false);
  const [joinerGpsBlocked, setJoinerGpsBlocked] = useState(false);
  // Mirrors navMode so interval callbacks (startStepTracking) always read the latest value.
  const navModeRef = useRef(false);
  // Guards the one-shot nav-mode auto-resume after PWA reopen / app kill.
  // If the user manually leaves nav mode, we must not bounce them back in.
  const autoResumedNavRef = useRef(false);
  // Tracks responder userIds we've already announced so we only flash on genuinely new joiners.
  const knownResponderIdsRef = useRef<Set<string>>(new Set());
  // Seeded on the first effect run so pre-existing responders never trigger a flash.
  const responderSeedDoneRef = useRef(false);
  // Name to flash when a new responder joins (auto-clears after 10s).
  const [newJoinerFlash, setNewJoinerFlash] = useState<string | null>(null);
  const [respondersSheetOpen, setRespondersSheetOpen] = useState(false);
  // Timestamp of the last auto-reroute, for 30-second rate-limiting.
  const lastRerouteRef = useRef<number>(0);
  // Monotonic id so stale DirectionsService callbacks can't overwrite a newer route.
  const drawRouteGenRef = useRef(0);
  // Mirrors currentStepIndex so the step-tracking interval can read the current value.
  const currentStepIndexRef = useRef(0);
  // Scrollable content container — scrolled to top when nav mode is entered.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pinnedSummaryRef = useRef<HTMLDivElement>(null);
  const fieldFooterRef = useRef<HTMLDivElement>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);

  // Arrival form state
  const [showArrivalForm, setShowArrivalForm] = useState(false);
  const [sessionClosing, setSessionClosing] = useState(false);
  const [arrivalCategoryId, setArrivalCategoryId] = useState<number | null>(null);
  const [arrivalOtherType, setArrivalOtherType] = useState("");
  const [arrivalDescription, setArrivalDescription] = useState("");
  const [arrivalMedia, setArrivalMedia] = useState<ArrivalMedia[]>([]);
  const [arrivalUploading, setArrivalUploading] = useState(false);
  const [arrivalUploadSource, setArrivalUploadSource] = useState<"file" | "camera" | "voice" | null>(null);
  const [arrivalCustomFields, setArrivalCustomFields] = useState<Record<string, string | number | null | undefined>>({});
  const [arrivalPersonInvolved, setArrivalPersonInvolved] = useState(false);
  const [arrivalVehicleInvolved, setArrivalVehicleInvolved] = useState(false);
  const [arrivalSapsOpen, setArrivalSapsOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [arrivalSubmitting, setArrivalSubmitting] = useState(false);
  const [isNearDestination, setIsNearDestination] = useState(false);
  const [distToDestinationM, setDistToDestinationM] = useState<number | null>(null);
  /** Creator flow: true while the responder is picking a destination after Start Navigation. */
  const [destinationPickerOpen, setDestinationPickerOpen] = useState(false);
  const [joinerNavPickerOpen, setJoinerNavPickerOpen] = useState(false);
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
  const joinFromPushRef = useRef(false);
  const [staleJoinNotice, setStaleJoinNotice] = useState<{ id: number; closedAt: string | null } | null>(null);
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
    categoryName?: string | null;
    categoryColor?: string | null;
  };

  const { data: liveIncidents = [], isSuccess: liveQueryLoaded } = useQuery<LiveIncidentWithResponders[]>({
    queryKey: ["/api/incidents/live"],
    // Joiners need fresh destination/GPS — stale cache caused "waiting for creator"
    // until the user backgrounded the app and a later poll/refetch arrived.
    refetchInterval: joinedId !== null || liveId !== null ? 5000 : 15000,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: formFields = [] } = useQuery<FormField[]>({
    queryKey: ["/api/form-fields"],
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
  const joinerNavDestination = currentIncident && isJoinerMode
    ? resolveJoinerNavDestination(currentIncident)
    : null;
  const liveNavTarget = currentIncident && isJoinerMode
    ? resolveLiveNavTarget(currentIncident)
    : null;
  /** Joiner has not yet picked Direct vs Guided — keep map and turn-by-turn hidden. */
  const joinerChoosingNav =
    isJoinerMode && !!joinerNavDestination && !navMode && !navStarted;
  /** Live incident active but not in full-screen nav — pin map between header and footer. */
  const pinnedFieldLayout = Boolean(currentIncident && !navMode && !showArrivalForm);

  const destinationSheetGps = useMemo(
    () => resolveFieldGpsCoords(currentIncident, userLoc),
    [currentIncident, userLoc],
  );

  // The field-view map is a normal in-flow flex child (flex-1). The native
  // MapView is created only after its host reaches a stable height (see
  // CapacitorMap), so it fills the region correctly. Whenever the field layout
  // settles or the destination sheet toggles, nudge a bounds re-sync so the
  // native surface stays aligned with the element.
  useLayoutEffect(() => {
    if (!pinnedFieldLayout || !isNative || navMode) return;
    const sync = () => { void capMapRef.current?.syncBounds(); };
    const t1 = window.setTimeout(sync, 60);
    const t2 = window.setTimeout(sync, 350);
    const t3 = window.setTimeout(sync, 900);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [
    pinnedFieldLayout,
    isNative,
    navMode,
    currentIncidentId,
    nativeMapReadyAt,
    destinationPickerOpen,
    gpsLastSentAt,
  ]);

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

  function updateDirectNavMetrics() {
    const pos = lastPosRef.current;
    const target = destPositionRef.current;
    if (!target || !pos) {
      setDirectDist(null);
      setDirectBearing(null);
      return;
    }
    setDirectDist(Math.round(haversineM(pos, target)));
    setDirectBearing(Math.round(bearingDegrees(pos, target)));
  }

  function applyGuidedRouteResult(
    steps: google.maps.DirectionsStep[],
    distance: number,
    duration: number,
    path: LatLngPoint[],
  ) {
    stepsRef.current = steps;
    routePolylineRef.current = path;
    setRouteInfo({ distance, duration });
    setHasRoute(true);
    setIsOffRoute(false);
    setGuidedOffRoute(false);
    offRouteStreakRef.current = 0;
    const pos = lastPosRef.current;
    if (pos && steps.length > 0) {
      const { idx, stepDist } = seedStepIndexFromPosition(pos, steps);
      currentStepIndexRef.current = idx;
      setCurrentStepIndex(idx);
      setStepDist(stepDist);
    } else {
      setCurrentStepIndex(0);
      setStepDist(steps[0]?.distance?.value ?? null);
    }
  }

  async function clearGuidedRouteVisuals() {
    routePolylineRef.current = [];
    stepsRef.current = [];
    setHasRoute(false);
    setRouteInfo(null);
    if (isNative && capMapRef.current) {
      await capMapRef.current.clearRoute().catch(() => {});
    }
    if (directionsRendererRef.current) {
      directionsRendererRef.current.setDirections({ routes: [] } as unknown as google.maps.DirectionsResult);
    }
  }

  function switchToDirectNav(reason?: string) {
    if (activeNavStyleRef.current === "direct") return;
    storeJoinNavStyle("direct");
    setActiveNavStyle("direct");
    activeNavStyleRef.current = "direct";
    void clearGuidedRouteVisuals();
    setIsOffRoute(false);
    setGuidedOffRoute(false);
    offRouteStreakRef.current = 0;
    void stopSpeaking();
    updateDirectNavMetrics();
    const target = destPositionRef.current;
    if (target) {
      void refreshDestMarker(target.lat, target.lng, (liveNavTarget ?? joinerNavDestination)?.name ?? "Destination");
    }
    if (reason) {
      toast({ title: "Direct guidance", description: reason });
    }
  }

  async function refreshDestMarker(dlat: number, dlng: number, title: string) {
    if (isNative && capMapRef.current) {
      const cap = capMapRef.current;
      if (capDestMarkerIdRef.current) {
        await cap.removeMarker(capDestMarkerIdRef.current).catch(() => {});
        capDestMarkerIdRef.current = "";
      }
      cap.addMarker({ lat: dlat, lng: dlng, title, tintColor: { r: 239, g: 68, b: 68, a: 255 } })
        .then((id) => { capDestMarkerIdRef.current = id; })
        .catch(() => {});
      return;
    }
    const map = mapInstanceRef.current;
    if (!map) return;
    if (destMarkerRef.current) {
      destMarkerRef.current.setMap(null);
      destMarkerRef.current = null;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 24 16 24S32 28 32 16C32 7.163 24.837 0 16 0z" fill="#ef4444" stroke="white" stroke-width="1.5"/><text x="16" y="21" text-anchor="middle" fill="white" font-family="sans-serif" font-size="14" font-weight="bold">B</text></svg>`;
    destMarkerRef.current = new google.maps.Marker({
      position: { lat: dlat, lng: dlng },
      map,
      icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize: new google.maps.Size(32, 40), anchor: new google.maps.Point(16, 40) },
      title,
      zIndex: 99,
    });
  }

  function recalculateGuidedRoute() {
    const target = isJoinerMode
      ? (liveNavTarget ?? joinerNavDestination)
      : destination ?? (currentIncident?.destinationLat != null && currentIncident?.destinationLng != null
        ? { lat: Number(currentIncident.destinationLat), lng: Number(currentIncident.destinationLng) }
        : null);
    if (!target) return;
    lastRerouteRef.current = Date.now();
    offRouteStreakRef.current = 0;
    drawRoute(target.lat, target.lng, lastPosRef.current ?? undefined, navModeRef.current);
  }

  function switchToGuidedNav() {
    storeJoinNavStyle("guided");
    setActiveNavStyle("guided");
    activeNavStyleRef.current = "guided";
    const target = liveNavTarget ?? joinerNavDestination ?? destPositionRef.current;
    if (target && lastPosRef.current) {
      drawRoute(target.lat, target.lng, lastPosRef.current, true);
    }
    toast({ title: "Turn-by-turn enabled", description: "Following Google's suggested route from your current position." });
  }

  function startStepTracking() {
    stopStepTracking();
    const intervalMs = navModeRef.current ? NAV_TRACK_INTERVAL_MS : 5000;
    stepCheckIntervalRef.current = setInterval(() => {
      const pos = lastPosRef.current;

      // ── Direct mode: distance + bearing only, no route enforcement ──────
      if (navModeRef.current && activeNavStyleRef.current === "direct") {
        updateDirectNavMetrics();
        setIsOffRoute(false);
        setGuidedOffRoute(false);
        return;
      }

      const steps = stepsRef.current;
      if (!pos || steps.length === 0) {
        setIsOffRoute(false);
        setGuidedOffRoute(false);
        return;
      }

      // --- Off-route: prefer full polyline; fall back to step segments ---
      const polyline = routePolylineRef.current;
      let minRouteDistM = polyline.length >= 2
        ? minDistToPolylineM(pos, polyline)
        : Infinity;
      if (!Number.isFinite(minRouteDistM) || polyline.length < 2) {
        minRouteDistM = Infinity;
        for (const step of steps) {
          const a = { lat: step.start_location.lat(), lng: step.start_location.lng() };
          const b = { lat: step.end_location.lat(), lng: step.end_location.lng() };
          const d = ptSegDistM(pos, a, b);
          if (d < minRouteDistM) minRouteDistM = d;
        }
      }
      const offRoute = minRouteDistM > OFF_ROUTE_POLYLINE_M;
      setIsOffRoute(offRoute);
      setGuidedOffRoute(offRoute && navModeRef.current);

      if (offRoute) {
        offRouteStreakRef.current += 1;
      } else {
        offRouteStreakRef.current = 0;
      }

      // Joiner on guided nav: fall back to Direct after sustained off-route
      if (
        navModeRef.current &&
        activeNavStyleRef.current === "guided" &&
        gpsEndpointRef.current === "joiner-position" &&
        offRouteStreakRef.current >= OFF_ROUTE_FALLBACK_STREAK
      ) {
        switchToDirectNav("You left the suggested route — showing direct guidance to the panicker.");
        return;
      }

      // Auto-reroute in guided nav when off-course
      if (navModeRef.current && activeNavStyleRef.current === "guided" && offRoute && destPositionRef.current) {
        const now = Date.now();
        if (now - lastRerouteRef.current > GUIDED_REROUTE_COOLDOWN_MS) {
          lastRerouteRef.current = now;
          drawRoute(destPositionRef.current.lat, destPositionRef.current.lng, pos, true);
        }
      }

      let idx = currentStepIndexRef.current;
      while (idx < steps.length - 1) {
        const nextLoc = steps[idx + 1].start_location;
        if (haversineM(pos, { lat: nextLoc.lat(), lng: nextLoc.lng() }) <= 60) {
          idx++;
        } else {
          break;
        }
      }
      if (idx === 0) {
        const seeded = seedStepIndexFromPosition(pos, steps);
        idx = seeded.idx;
      }

      if (idx !== currentStepIndexRef.current && steps[idx]) {
        const advancedStep = steps[idx];
        if (idx !== announcedStepRef.current) {
          announcedStepRef.current = idx;
          void speak(stripHtml(advancedStep.instructions));
        }
      }
      currentStepIndexRef.current = idx;
      setCurrentStepIndex(idx);

      const currStep = steps[idx];
      if (currStep) {
        const endLoc = currStep.end_location;
        const dist = Math.round(haversineM(pos, { lat: endLoc.lat(), lng: endLoc.lng() }));
        setStepDist(dist);
        if (dist <= 200 && idx !== approachingTurnAnnouncedRef.current) {
          approachingTurnAnnouncedRef.current = idx;
          const turnInstr = steps[idx + 1]?.instructions ?? currStep.instructions;
          void speak(`In ${fmtDist(dist)}, ${stripHtml(turnInstr)}`);
        }
      }
    }, intervalMs);
  }

  function stopGpsFallbackTracking() {
    if (gpsFallbackIntervalRef.current !== null) {
      clearInterval(gpsFallbackIntervalRef.current);
      gpsFallbackIntervalRef.current = null;
    }
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
      setUserLoc(p);
      // A real fix arrived — clear the joiner "location off" guide if it was
      // showing. Without this the guide lingers when GPS recovers on its own
      // (e.g. user enabled location in system settings and returned). Setting
      // to the same value is a no-op re-render, so the ~1 Hz call is harmless.
      setJoinerGpsBlocked(false);
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
        const distM = haversineM(p, destPositionRef.current);
        setDistToDestinationM(distM);
        setIsNearDestination(distM <= NAV_ARRIVAL_AT_SCENE_M);
        if (distM <= NAV_ARRIVAL_AT_SCENE_M && !arrivedAnnouncedRef.current) {
          arrivedAnnouncedRef.current = true;
          void speak("You have arrived at your destination.");
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
        if (stepsRef.current.length === 0 && destPositionRef.current) {
          drawRoute(destPositionRef.current.lat, destPositionRef.current.lng, p, navModeRef.current);
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
      // Refresh live incident payload (destination, panicker GPS) after app switch.
      if (currentIncidentId !== null) {
        void queryClient.refetchQueries({ queryKey: ["/api/incidents/live"] });
      }
      // Camera / gallery on Android can reload the WebView — restore arrival form.
      if (currentIncidentId !== null) {
        try {
          const raw = sessionStorage.getItem(ARRIVAL_FORM_SESSION_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as { incidentId: number; arrivalTime?: string };
            if (parsed.incidentId === currentIncidentId) {
              if (parsed.arrivalTime) arrivalTimeRef.current = new Date(parsed.arrivalTime);
              setShowArrivalForm(true);
            }
          }
        } catch { /* ignore */ }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [active?.id, joinedIncident?.id, currentIncidentId, queryClient]);

  // Restore arrival form after WebView reload while recording on-scene evidence.
  useEffect(() => {
    if (!currentIncidentId) return;
    try {
      const raw = sessionStorage.getItem(ARRIVAL_FORM_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { incidentId: number; arrivalTime?: string };
      if (parsed.incidentId !== currentIncidentId) {
        sessionStorage.removeItem(ARRIVAL_FORM_SESSION_KEY);
        return;
      }
      if (parsed.arrivalTime) arrivalTimeRef.current = new Date(parsed.arrivalTime);
      setShowArrivalForm(true);
    } catch {
      sessionStorage.removeItem(ARRIVAL_FORM_SESSION_KEY);
    }
  }, [currentIncidentId]);

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
    void stopSpeaking();
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
    routePolylineRef.current = [];
    drawRouteGenRef.current += 1;
    setRouteInfo(null);
    announcedStepRef.current = -1;
    approachingTurnAnnouncedRef.current = -1;
    arrivedAnnouncedRef.current = false;
    setNavMode(false);
    setHasRoute(false);
    setCurrentStepIndex(0);
    setStepDist(null);
    setIsOffRoute(false);
    setGuidedOffRoute(false);
    setDirectDist(null);
    setDirectBearing(null);
    offRouteStreakRef.current = 0;
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
    void stopSpeaking();
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
    drawRouteGenRef.current += 1;
    setRouteInfo(null);
    setHasRoute(false);
    stepsRef.current = [];
    routePolylineRef.current = [];
    setIsOffRoute(false);
    setGuidedOffRoute(false);
    setDirectDist(null);
    setDirectBearing(null);
    offRouteStreakRef.current = 0;
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
    onSuccess: async (_, id) => {
      setStaleJoinNotice(null);
      localStorage.setItem(JOINED_INCIDENT_KEY, String(id));
      setJoinedId(id);
      gpsEndpointRef.current = "joiner-position";
      startTracking(id);
      await queryClient.refetchQueries({ queryKey: ["/api/incidents/live"] });
      toast({ title: "Joined incident", description: "Your GPS position is now being shared with the team." });
    },
    onError: (err: Error, id: number) => {
      if (err.message.includes("Incident is not live")) {
        void (async () => {
          try {
            const res = await fetch(`/api/incidents/${id}`, { credentials: "include" });
            if (res.ok) {
              const inc = (await res.json()) as Incident;
              if (!inc.isLive) {
                const closedAt = inc.liveEndedAt
                  ? new Date(inc.liveEndedAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })
                  : null;
                setStaleJoinNotice({ id, closedAt });
                return;
              }
            }
          } catch { /* fall through */ }
          toast({ title: "Incident closed", description: "This live incident is no longer active.", variant: "destructive" });
        })();
        return;
      }
      toast({ title: "Error", description: "Could not join the incident.", variant: "destructive" });
    },
  });

  // Opened from a push notification — auto-join the incident (reporters cannot use Live Monitor).
  useEffect(() => {
    if (!liveQueryLoaded || !me || joinFromPushRef.current) return;
    const joinParam = new URLSearchParams(window.location.search).get("join");
    if (!joinParam) return;
    const id = parseInt(joinParam, 10);
    if (isNaN(id)) return;
    joinFromPushRef.current = true;
    window.history.replaceState({}, "", "/live-incident");
    void queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
    if (joinedId === id || liveId === id) return;

    const showClosedNotice = (closedAt: string | null) => {
      setStaleJoinNotice({ id, closedAt });
    };

    const tryJoin = () => {
      const alreadyJoined = liveIncidents.some(
        (i) => i.id === id && i.isLive && (i.responders ?? []).some((r) => r.userId === me.id && !r.arrivedAt),
      );
      if (alreadyJoined) {
        localStorage.setItem(JOINED_INCIDENT_KEY, String(id));
        setJoinedId(id);
        return;
      }
      joinLiveMutation.mutate(id);
    };

    const isLiveOnServer = liveIncidents.some((i) => i.id === id && i.isLive);
    if (isLiveOnServer) {
      tryJoin();
      return;
    }

    void (async () => {
      try {
        const res = await fetch(`/api/incidents/${id}`, { credentials: "include" });
        if (res.ok) {
          const inc = (await res.json()) as Incident;
          if (!inc.isLive) {
            const closedAt = inc.liveEndedAt
              ? new Date(inc.liveEndedAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })
              : null;
            showClosedNotice(closedAt);
            return;
          }
        }
      } catch { /* fall through — attempt join */ }
      tryJoin();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveQueryLoaded, me?.id, joinedId, liveId, liveIncidents]);

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
        ...(Object.keys(arrivalCustomFields).length > 0 ? { customFields: arrivalCustomFields } : {}),
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
          await apiRequest("POST", `/api/incidents/${liveId}/attachments`, { url: record.url, filename: record.filename, mimeType: record.mimeType, evidencePhase: "scene" });
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
      sessionStorage.removeItem(ARRIVAL_FORM_SESSION_KEY);
      setSessionClosing(true);
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

  async function addArrivalAttachment(file: File, source: "file" | "camera" | "voice" = "file") {
    if (arrivalMedia.length >= MAX_ARRIVAL_MEDIA) {
      toast({ title: "Limit reached", description: `You can attach up to ${MAX_ARRIVAL_MEDIA} media items per arrival report.`, variant: "destructive" });
      return;
    }
    if (file.size > MAX_MEDIA_BYTES) {
      toast({ title: "File too large", description: "Each file must be under 10 MB.", variant: "destructive" });
      return;
    }
    const id = crypto.randomUUID();
    setArrivalUploading(true);
    setArrivalUploadSource(source);
    try {
      const isImage = file.type.startsWith("image/");
      const blob = isImage ? await compressImageToBlob(file, 1024, 0.72) : file;
      const filename = isImage ? file.name.replace(/\.[^.]+$/, ".jpg") : file.name;
      const mimeType = isImage ? "image/jpeg" : (file.type || "application/octet-stream");
      if (navigator.onLine) {
        const tempUrl = URL.createObjectURL(blob);
        setArrivalMedia((prev) => [...prev, { id, url: tempUrl, filename, mimeType }]);
        const uploadResp = await fetch("/api/uploads", {
          method: "POST",
          headers: { "Content-Type": mimeType },
          body: blob,
          credentials: "include",
        });
        if (!uploadResp.ok) throw new Error("Upload failed");
        const { objectUrl } = await uploadResp.json();
        URL.revokeObjectURL(tempUrl);
        setArrivalMedia((prev) => prev.map((m) => m.id === id ? { ...m, url: objectUrl } : m));
      } else {
        arrivalMediaBlobsRef.current.set(id, { blob, filename, mimeType });
        const previewUrl = URL.createObjectURL(blob);
        setArrivalMedia((prev) => [...prev, { id, url: previewUrl, filename, mimeType }]);
        toast({ title: "Saved locally", description: "No connection — media will upload when your arrival is submitted." });
      }
    } catch {
      setArrivalMedia((prev) => {
        const item = prev.find((m) => m.id === id);
        if (item?.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
        return prev.filter((m) => m.id !== id);
      });
      arrivalMediaBlobsRef.current.delete(id);
      toast({ title: "Upload error", description: "Could not process the file. Please try again.", variant: "destructive" });
    } finally {
      setArrivalUploading(false);
      setArrivalUploadSource(null);
    }
  }

  async function handleArrivalUploadFiles(files: FileList | undefined) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (arrivalMedia.length >= MAX_ARRIVAL_MEDIA) break;
      await addArrivalAttachment(file, "file");
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
    setArrivalUploadSource("voice");
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
        setArrivalUploadSource(null);
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
      setArrivalUploadSource(null);
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
            await apiRequest("POST", `/api/incidents/${queued.incidentId}/attachments`, { url: item.url, filename: item.filename, mimeType: item.mimeType, evidencePhase: "scene" });
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
          await apiRequest("POST", `/api/incidents/${queued.incidentId}/attachments`, { url: objectUrl, filename: blobEntry.filename, mimeType: blobEntry.mimeType, evidencePhase: "scene" });
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

  const initJsApi = useCallback((attempt = 0) => {
    const maxAttempts = isNative ? 3 : 1;
    const timeoutMs = isNative ? 45_000 : 15_000;
    if (attempt > 0) setJsApiRetrying(true);

    loadGoogleMaps({ timeoutMs }).then(() => {
      setJsApiDegraded(false);
      setJsApiRetrying(false);
      setMapsError(false);
      setMapsErrorMsg(null);
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
      const msg = err?.message ?? String(err);
      if (isNative && attempt < maxAttempts - 1) {
        resetGoogleMapsLoader();
        window.setTimeout(() => initJsApi(attempt + 1), 2_000);
        return;
      }
      setJsApiRetrying(false);
      setMapsErrorMsg(msg);
      if (isNative && !nativeMapFailed) {
        // Keep the native map visible; only search/routes need the JS API.
        setJsApiDegraded(true);
        setMapsError(false);
      } else {
        setMapsError(true);
      }
    });
  }, [isNative, nativeMapFailed]);

  useEffect(() => {
    // Always load the JS API — it's needed for search/geocoding on both web and
    // native, and as a map fallback if native Capacitor map fails.
    initJsApi();
    return () => stopTracking();
  }, [initJsApi]);

  useEffect(() => {
    if (!useWebMap || !mapsReady || !mapRef.current || mapInstanceRef.current) return;
    const map = new google.maps.Map(mapRef.current, {
      center: { lat: -26.2041, lng: 28.0473 },
      zoom: 6,
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
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 24 16 24S32 28 32 16C32 7.163 24.837 0 16 0z" fill="#006039" stroke="white" stroke-width="1.5"/><text x="16" y="21" text-anchor="middle" fill="white" font-family="sans-serif" font-size="14" font-weight="bold">A</text></svg>`;
        originMarkerRef.current = new google.maps.Marker({
          position: p,
          map,
          icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize: new google.maps.Size(32, 40), anchor: new google.maps.Point(16, 40) },
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
        const stillActive = (joinedInc.responders ?? []).some(
          (r) => r.userId === me.id && !r.arrivedAt,
        );
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
      (i) =>
        i.isLive &&
        i.userId !== me.id &&
        (i.responders ?? []).some((r) => r.userId === me.id && !r.arrivedAt),
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

  // Auto-resume nav mode after PWA reopen / app kill.
  // If the user was in nav mode when they closed the app, NAV_STARTED_KEY in
  // localStorage still matches the active incident — but navMode is React state
  // and starts false on cold-mount, so they'd land on the static pre-nav screen.
  // Re-enter nav mode once per session when all preconditions hold; guarded by
  // autoResumedNavRef so a manual Leave doesn't bounce the user back in.
  useEffect(() => {
    if (autoResumedNavRef.current) return;
    if (navMode) return;
    if (!navStarted) return;
    // On native: capMapRef is only usable once nativeMapStatus === "ready".
    // Proceeding on mapsReady alone (JS API loaded but native map not yet ready)
    // causes drawRoute to fail silently, sets autoResumedNavRef=true, then the
    // native-ready re-trigger is permanently blocked by the guard.
    const mapActuallyReady = isNative ? nativeMapStatus === "ready" : mapsReady;
    if (!mapActuallyReady || !currentIncident) return;
    const navDest = isJoinerMode && joinerNavDestination
      ? joinerNavDestination
      : currentIncident.destinationLat != null && currentIncident.destinationLng != null
        ? {
            lat: Number(currentIncident.destinationLat),
            lng: Number(currentIncident.destinationLng),
          }
        : null;
    if (!navDest) return;

    autoResumedNavRef.current = true;
    const storedStyle = readStoredJoinNavStyle();
    if (isJoinerMode) {
      setActiveNavStyle(storedStyle);
      activeNavStyleRef.current = storedStyle;
    } else {
      setActiveNavStyle("guided");
      activeNavStyleRef.current = "guided";
    }
    (async () => {
      if (isJoinerMode && storedStyle === "direct") {
        const target = resolveLiveNavTarget(currentIncident) ?? joinerNavDestination;
        if (target) {
          destPositionRef.current = { lat: target.lat, lng: target.lng };
          await refreshDestMarker(target.lat, target.lng, target.name);
          updateDirectNavMetrics();
        }
        setNavMode(true);
        startStepTracking();
        return;
      }
      if (stepsRef.current.length === 0) {
        drawRoute(navDest.lat, navDest.lng, lastPosRef.current ?? undefined, true);
        if (isNative) await new Promise((r) => setTimeout(r, 1500));
      }
      setNavMode(true);
      startStepTracking();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navStarted, mapsReady, nativeMapStatus, currentIncident?.id, navMode]);

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

  // Route drawing — creators only; joiners pick Direct/Guided at navigate time.
  useEffect(() => {
    const mapActuallyReady = isNative ? nativeMapStatus === "ready" : mapsReady;
    if (!mapActuallyReady || !currentIncident || isJoinerMode) return;
    if (stepsRef.current.length === 0) {
      const dest =
        destination ??
        (currentIncident.destinationLat != null && currentIncident.destinationLng != null
          ? {
              lat: Number(currentIncident.destinationLat),
              lng: Number(currentIncident.destinationLng),
              name: currentIncident.destinationName ?? "Incident Location",
            }
          : null);
      if (dest) drawRoute(dest.lat, dest.lng, lastPosRef.current ?? undefined, navModeRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentIncident?.id,
    currentIncident?.destinationLat,
    currentIncident?.destinationLng,
    currentIncident?.responderLat,
    currentIncident?.responderLng,
    destination?.lat,
    destination?.lng,
    joinerNavDestination?.lat,
    joinerNavDestination?.lng,
    mapsReady,
    nativeMapStatus,
    isJoinerMode,
  ]);

  // Keep panicker live GPS as the direct-mode target for joiners.
  useEffect(() => {
    if (!isJoinerMode || !currentIncident) return;
    const t = resolveLiveNavTarget(currentIncident) ?? joinerNavDestination;
    if (!t) return;
    destPositionRef.current = { lat: t.lat, lng: t.lng };
    if (navMode && activeNavStyle === "direct") {
      void refreshDestMarker(t.lat, t.lng, t.name);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentIncident?.responderLat,
    currentIncident?.responderLng,
    currentIncident?.destinationLat,
    currentIncident?.destinationLng,
    isJoinerMode,
    navMode,
    activeNavStyle,
  ]);

  useEffect(() => { activeNavStyleRef.current = activeNavStyle; }, [activeNavStyle]);

  // Stale guided route from a prior session must not show before the joiner picks a mode.
  useEffect(() => {
    if (!joinerChoosingNav) return;
    void clearGuidedRouteVisuals();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinerChoosingNav, currentIncident?.id]);

  useEffect(() => {
    if (!navMode) return;
    startStepTracking();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navMode, activeNavStyle]);

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
    const navPos = isJoinerMode && joinerNavDestination
      ? { lat: joinerNavDestination.lat, lng: joinerNavDestination.lng }
      : dest?.destinationLat != null && dest?.destinationLng != null
        ? { lat: Number(dest.destinationLat), lng: Number(dest.destinationLng) }
        : null;
    if (navPos) {
      const destPos = navPos;
      // Always store destination for rerouting, even for panic incidents.
      // Arrival UI is suppressed separately via isPanicIncidentRef in sendPosition.
      destPositionRef.current = destPos;
      if (!isPanicCat && lastPosRef.current) {
        const distM = haversineM(lastPosRef.current, destPos);
        setDistToDestinationM(distM);
        setIsNearDestination(distM <= NAV_ARRIVAL_AT_SCENE_M);
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
    destPositionRef.current = { lat: target.lat, lng: target.lng };
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
    if (isJoinerMode) {
      void dispatchJoinerInApp("guided");
    } else {
      void beginInAppNavigation(target);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIncidentId, mapsReady]);

  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    if (searchDebRef.current) clearTimeout(searchDebRef.current);
    if (!val.trim()) { setSuggestions([]); setSearchHint(null); return; }
    if (val.trim().length < 3) {
      setSuggestions([]);
      setSearchHint("Type at least 3 characters to search.");
      return;
    }
    searchDebRef.current = setTimeout(() => {
      setLoadingSugg(true);
      setSearchHint(null);
      // Use the JS API on both web and native — the REST API doesn't return CORS
      // headers so it fails when called from a WebView. The JS API works in any
      // browser context including Capacitor's WebView.
      if (!autocompleteRef.current) {
        setLoadingSugg(false);
        setSuggestions([]);
        setSearchHint("Address search is unavailable. Tap Retry search or use incident location.");
        return;
      }
      autocompleteRef.current.getPlacePredictions(
        { input: val, componentRestrictions: { country: "za" } },
        (preds, status) => {
          setLoadingSugg(false);
          if (status === google.maps.places.PlacesServiceStatus.OK && preds) {
            setSuggestions(preds.slice(0, 5).map((p) => ({ place_id: p.place_id, description: p.description })));
            setSearchHint(null);
          } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
            setSuggestions([]);
            setSearchHint("No places found — try a different spelling or address.");
          } else {
            setSuggestions([]);
            setSearchHint("Search unavailable — check your connection and tap Retry search.");
          }
        }
      );
    }, 350);
  }, []);

  function selectPlace(s: PlaceSuggestion) {
    setSearch(s.description);
    setSuggestions([]);

    const commitDestination = (lat: number, lng: number) => {
      const name = s.description;
      setDestination({ lat, lng, name });
      destPositionRef.current = { lat, lng };
      const incId = currentIncidentId;
      if (incId) {
        const path = isJoinerMode ? "joiner-destination" : "destination";
        apiRequest("PATCH", `/api/incidents/${incId}/${path}`, {
          destinationName: name,
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
      if (!isJoinerMode) {
        void beginInAppNavigation({ lat, lng, name });
      } else {
        drawRoute(lat, lng);
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
    const gen = ++drawRouteGenRef.current;
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
      if (capOriginMarkerIdRef.current) {
        cap.removeMarker(capOriginMarkerIdRef.current).catch(() => {});
        capOriginMarkerIdRef.current = '';
      }
      // Destination — red tint
      cap.addMarker({ lat: dlat, lng: dlng, title: 'Destination', tintColor: { r: 239, g: 68, b: 68, a: 255 } })
        .then(id => { capDestMarkerIdRef.current = id; }).catch(() => {});
      // Origin / start — primary green tint. Only use live GPS (lastPosRef), never
      // the one-shot getCurrentPosition cache which can be stale/wrong city.
      // Skipped in nav mode: the heading-up "you" arrow overlay represents the
      // responder, so a static "A — Start" pin would just clutter the route ahead.
      const startPos = origin ?? lastPosRef.current;
      if (startPos && !navModeRef.current) {
        cap.addMarker({ lat: startPos.lat, lng: startPos.lng, title: 'Start', tintColor: { r: 0, g: 96, b: 57, a: 255 } })
          .then(id => { capOriginMarkerIdRef.current = id; }).catch(() => {});
      }

      const originToUse = origin ?? lastPosRef.current;
      if (!originToUse) {
        // No GPS fix yet — center the camera on the destination so at least the
        // pin is visible. The GPS callback will retry drawRoute once a fix arrives.
        cap.setCamera({ lat: dlat, lng: dlng, zoom: 13, tilt: 0 }).catch(() => {});
        return;
      }
      cap.drawRoute(originToUse, { lat: dlat, lng: dlng }, skipFitBounds || navModeRef.current)
        .then(result => {
          if (gen !== drawRouteGenRef.current) return;
          if (!result) return;
          applyGuidedRouteResult(
            result.steps as unknown as google.maps.DirectionsStep[],
            result.distance,
            result.duration,
            result.path,
          );
        }).catch((err) => {
          // Surface DirectionsService failures so the responder sees why the
          // route isn't drawing — previously silent, which made a missing
          // polyline look like a straight-line bug. 30 s cooldown so repeated
          // off-route reroutes don't spam the toast queue.
          const msg = String(err?.message ?? err ?? '');
          if (msg.startsWith('DirectionsService:')) {
            const now = Date.now();
            if (now - lastDirectionsToastAtRef.current > 30_000) {
              lastDirectionsToastAtRef.current = now;
              toast({
                title: 'Could not compute driving route',
                description: 'Try starting navigation again.',
                variant: 'destructive',
              });
            }
          }
        });
      return;
    }
    // ── Web path (JS API) — unchanged below ────────────────────────────────────
    const map = mapInstanceRef.current;
    if (!map) return;
    // In nav mode always preserve the viewport so setTilt(45) isn't wiped by setDirections
    const effectiveSkip = skipFitBounds || navModeRef.current;
    if (destMarkerRef.current) { destMarkerRef.current.setMap(null); destMarkerRef.current = null; }
    setRouteInfo(null);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 24 16 24S32 28 32 16C32 7.163 24.837 0 16 0z" fill="#ef4444" stroke="white" stroke-width="1.5"/><text x="16" y="21" text-anchor="middle" fill="white" font-family="sans-serif" font-size="14" font-weight="bold">B</text></svg>`;
    destMarkerRef.current = new google.maps.Marker({
      position: { lat: dlat, lng: dlng },
      map,
      icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize: new google.maps.Size(32, 40), anchor: new google.maps.Point(16, 40) },
      title: "Destination",
      zIndex: 99,
    });
    const originToUse = origin ?? lastPosRef.current;
    if (!originToUse) { map.setCenter({ lat: dlat, lng: dlng }); map.setZoom(13); return; }
    const ds = new google.maps.DirectionsService();
    ds.route(
      { origin: originToUse, destination: { lat: dlat, lng: dlng }, travelMode: google.maps.TravelMode.DRIVING },
      (result, status) => {
        if (gen !== drawRouteGenRef.current) return;
        if (status === google.maps.DirectionsStatus.OK && result) {
          if (directionsRendererRef.current) {
            directionsRendererRef.current.setOptions({ preserveViewport: effectiveSkip });
            directionsRendererRef.current.setDirections(result);
          }
          const leg = result.routes[0]?.legs[0];
          if (leg) {
            const path = pathFromDirectionsRoute(result.routes[0], leg);
            applyGuidedRouteResult(leg.steps ?? [], leg.distance?.value ?? 0, leg.duration?.value ?? 0, path);
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
        locationName: null,
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

  async function beginInAppNavigation(dest: { lat: number; lng: number; name: string }) {
    const incId = currentIncidentId;
    if (!incId) return;
    const mapActuallyReady = isNative ? nativeMapStatus === "ready" || nativeMapFailed : mapsReady;
    if (!mapActuallyReady) {
      toast({
        title: "Map still loading",
        description: "Wait a moment for the map to finish loading, then try again.",
        variant: "destructive",
      });
      return;
    }
    try {
      setDispatching(true);
      setDestination(dest);
      setSearch(dest.name);
      destPositionRef.current = { lat: dest.lat, lng: dest.lng };
      setDestinationPickerOpen(false);
      localStorage.setItem(NAV_STARTED_KEY, String(incId));
      setNavStarted(true);
      announcedStepRef.current = -1;
      approachingTurnAnnouncedRef.current = -1;
      arrivedAnnouncedRef.current = false;
      if (!isJoinerMode) {
        apiRequest("PATCH", `/api/incidents/${incId}/destination`, {
          destinationName: dest.name,
          destinationLat: dest.lat,
          destinationLng: dest.lng,
        }).catch(() => {});
      }
      if (typeof DeviceOrientationEvent !== "undefined" && typeof (DeviceOrientationEvent as any).requestPermission === "function") {
        try { await (DeviceOrientationEvent as any).requestPermission(); } catch { /* denied — proceed */ }
      }
      drawRoute(dest.lat, dest.lng, lastPosRef.current ?? undefined, true);
      if (isNative && capMapRef.current) {
        await new Promise((r) => setTimeout(r, 600));
      }
      setNavMode(true);
      setActiveNavStyle("guided");
      activeNavStyleRef.current = "guided";
      startStepTracking();
    } catch (e: unknown) {
      toast({ title: "Navigation failed", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    } finally {
      setDispatching(false);
    }
  }

  async function dispatchInApp() {
    if (!destination) return;
    await beginInAppNavigation(destination);
  }

  function bypassInAppNavigation() {
    const incId = currentIncidentId;
    if (!incId) return;
    setDestinationPickerOpen(false);
    setJoinerNavPickerOpen(false);
    setNavMode(false);
    navModeRef.current = false;
    setNavStarted(true);
    localStorage.setItem(NAV_STARTED_KEY, String(incId));
    toast({
      title: "Tracking without route",
      description: "GPS and timing stay active for dispatch and investigation. No turn-by-turn route is shown.",
    });
  }

  function cancelNavigation() {
    void stopSpeaking();
    setNavMode(false);
    setNavStarted(false);
    setDestinationPickerOpen(false);
    setJoinerNavPickerOpen(false);
    try { localStorage.removeItem(NAV_STARTED_KEY); } catch { /* ignore */ }
    autoResumedNavRef.current = true;
    toast({ title: "Navigation cancelled", description: "GPS tracking stays active for this live incident." });
  }

  function openDestinationPicker() {
    setDestinationPickerOpen(true);
    setSearchHint(null);
    const prefill = destination?.name && isUsableLocationSearchLabel(destination.name)
      ? destination.name
      : isUsableLocationSearchLabel(currentIncident?.locationName)
        ? currentIncident!.locationName!.trim()
        : "";
    setSearch(prefill);
    setSuggestions([]);
    if (prefill.length >= 3) handleSearch(prefill);
  }

  function retryDestinationSearchServices() {
    resetGoogleMapsLoader();
    setJsApiDegraded(false);
    setSearchHint(null);
    initJsApi();
  }

  function useIncidentLocationAsDestination() {
    const coords = resolveFieldGpsCoords(currentIncident, lastPosRef.current);
    if (!coords) return;
    void beginInAppNavigation({
      lat: coords.lat,
      lng: coords.lng,
      name: incidentLocationDisplayLabel(currentIncident ?? {}, coords),
    });
  }

  async function dispatchJoinerInApp(style: JoinNavStyle = "direct") {
    const dest = liveNavTarget ?? joinerNavDestination;
    if (!joinedId || !dest) return;

    // ── Enforce location ON before a joiner can navigate ──────────────────
    let origin = lastPosRef.current;
    if (!origin) {
      setAcquiringJoinerGps(true);
      const probe = await acquirePanicLocation();
      setAcquiringJoinerGps(false);
      if (!hasPanicCoordinates(probe)) {
        setJoinerGpsBlocked(true);
        toast({
          title: "Turn on location to navigate",
          description: "Navigation needs your live position. Enable Location for OMT Pulse, then tap Navigate again.",
          variant: "destructive",
        });
        return;
      }
      origin = { lat: probe.lat, lng: probe.lng };
      lastPosRef.current = origin;
    }
    setJoinerGpsBlocked(false);

    setJoinerNavPickerOpen(false);
    storeJoinNavStyle(style);
    setActiveNavStyle(style);
    activeNavStyleRef.current = style;
    localStorage.setItem(NAV_STARTED_KEY, String(joinedId));
    setNavStarted(true);
    announcedStepRef.current = -1;
    approachingTurnAnnouncedRef.current = -1;
    arrivedAnnouncedRef.current = false;
    destPositionRef.current = { lat: dest.lat, lng: dest.lng };

    if (typeof DeviceOrientationEvent !== "undefined" && typeof (DeviceOrientationEvent as any).requestPermission === "function") {
      try { await (DeviceOrientationEvent as any).requestPermission(); } catch { /* denied — proceed */ }
    }

    if (style === "direct") {
      await clearGuidedRouteVisuals();
      await refreshDestMarker(dest.lat, dest.lng, dest.name);
      updateDirectNavMetrics();
      setNavMode(true);
      startStepTracking();
      toast({
        title: "Direct guidance started",
        description: "Distance and bearing to the panicker — take your own route. GPS tracking continues.",
      });
      return;
    }

    drawRoute(dest.lat, dest.lng, origin, true);
    if (isNative) await new Promise(r => setTimeout(r, 600));
    setNavMode(true);
    startStepTracking();
    toast({ title: "Turn-by-turn started", description: "GPS tracking continues — dispatch can see your position." });
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
          await apiRequest("POST", `/api/incidents/${incId}/attachments`, { url: record.url, filename: record.filename, mimeType: record.mimeType, evidencePhase: "scene" });
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
        sessionStorage.removeItem(ARRIVAL_FORM_SESSION_KEY);
        setSessionClosing(true);
        resetAfterLeave();
        navigate("/");
      }
      setArrivalSubmitting(false);
    }
  }

  const steps = stepsRef.current;
  const currentStep = steps[currentStepIndex];
  // Turn-by-turn shows the maneuver you are APPROACHING, not the road you are
  // already on. step[i].instructions is the maneuver at the START of step i, so
  // while travelling step `currentStepIndex` the next thing to do is step
  // `currentStepIndex + 1`. stepDist is the distance remaining to it.
  // `followingStep` (+2) feeds the "Then" pill. Falls back gracefully near the
  // destination where no further maneuver exists.
  const upcomingStep = steps[currentStepIndex + 1] ?? currentStep;
  const followingStep = steps[currentStepIndex + 2] ?? null;
  // Nav strip shows distance/time still to go, not the initial full-leg totals
  // (which could be wrong if an early stale-GPS route raced a later reroute).
  const navRouteDisplay =
    navMode && activeNavStyle === "guided" && steps.length > 0
      ? remainingFromSteps(steps, currentStepIndex)
      : routeInfo;
  const nonLiveCategories = categories.filter(isCloseReclassifyType);

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
  const navFieldPhase = navMode ? resolveNavFieldPhase(distToDestinationM) : null;
  const showProminentArrived =
    !isPanicIncident
    && distToDestinationM != null
    && distToDestinationM <= NAV_ARRIVAL_SOON_M;

  function cancelArrivalForm() {
    sessionStorage.removeItem(ARRIVAL_FORM_SESSION_KEY);
    setShowArrivalForm(false);
  }

  function recordArrival() {
    void stopSpeaking();
    setNavMode(false);
    arrivalTimeRef.current = new Date();
    if (!isJoinerMode && currentIncident) {
      apiRequest("PATCH", `/api/incidents/${currentIncident.id}/mark-arrived`, {}).catch(() => {});
    }
    if (currentIncidentId !== null) {
      try {
        sessionStorage.setItem(
          ARRIVAL_FORM_SESSION_KEY,
          JSON.stringify({
            incidentId: currentIncidentId,
            arrivalTime: arrivalTimeRef.current.toISOString(),
          }),
        );
      } catch { /* ignore */ }
    }
    setShowArrivalForm(true);
  }

  // Keep isPanicIncidentRef in sync so the sendPosition closure inside
  // startTracking() can read it without stale-closure issues.
  useEffect(() => {
    isPanicIncidentRef.current = isPanicIncident;
  }, [isPanicIncident]);

  // Keep navModeRef in sync so the step-tracking interval reads the latest value.
  useEffect(() => { navModeRef.current = navMode; }, [navMode]);

  // Stop any in-flight voice utterance the moment nav mode is exited
  // (X button, Arrived, incident close, leave, etc.). Guarantees no future
  // nav-exit path leaks audio even if a new exit site is added later.
  useEffect(() => {
    if (!navMode) void stopSpeaking();
  }, [navMode]);

  // Reset the joiner-detection seed whenever the incident context changes so
  // pre-existing responders on a different incident don't get re-announced as
  // "new joiners". Also clears any in-flight flash from the previous incident.
  useEffect(() => {
    knownResponderIdsRef.current = new Set();
    responderSeedDoneRef.current = false;
    setNewJoinerFlash(null);
  }, [currentIncidentId]);

  // Detect new joiners on the creator's view — surface a toast + vibration + a
  // 10 s flash chip in nav mode. Fires regardless of whether the creator is
  // currently in nav mode (a polled responder showing up while they're on the
  // panel screen still pops a toast). First-render is seeded silently so
  // pre-existing responders never trigger a flash on page load.
  useEffect(() => {
    if (!currentIncident?.responders) return;
    // Only the creator gets the "backup arrived" surface — joiners shouldn't
    // get a toast when other joiners arrive.
    if (!me?.id || currentIncident.userId !== me.id) return;
    const nonSelf = currentIncident.responders.filter(r => r.userId !== me.id);

    if (!responderSeedDoneRef.current) {
      nonSelf.forEach(r => knownResponderIdsRef.current.add(r.userId));
      responderSeedDoneRef.current = true;
      return;
    }

    const newJoiners = nonSelf.filter(r => !knownResponderIdsRef.current.has(r.userId));
    nonSelf.forEach(r => knownResponderIdsRef.current.add(r.userId));
    if (newJoiners.length === 0) return;

    const latest = newJoiners[newJoiners.length - 1];
    const fullName = `${latest.firstName} ${latest.lastName}`.trim() || latest.firstName;

    setNewJoinerFlash(`${latest.firstName} joined`);
    const t = setTimeout(() => setNewJoinerFlash(null), 10000);

    toast({
      title: "👥 Backup on the way",
      description: `${fullName} has joined and is en route.`,
    });
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try { navigator.vibrate([120, 60, 120]); } catch { /* ignored */ }
    }

    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIncident?.responders, currentIncident?.userId, me?.id]);

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
        // Drop any "Start" pin placed during the pre-nav preview — in nav mode the
        // heading-up "you" arrow overlay represents the responder instead.
        if (capOriginMarkerIdRef.current) {
          capMapRef.current.removeMarker(capOriginMarkerIdRef.current).catch(() => {});
          capOriginMarkerIdRef.current = '';
        }
        if (lastPosRef.current) {
          // v72: animate:true with 100 ms duration. animate:false routes through
          // Kotlin moveCamera, which on this Android Maps SDK version silently
          // drops the tilt component — so the initial 45° tilt never applies
          // and the map stays flat until the 400 ms tilt-keeper recovers it
          // (if it ever does). animate:true with a short 100 ms duration uses
          // animateCamera (patched to 200 ms), which honors tilt and is fast
          // enough not to fight the subsequent tilt-keeper ticks.
          capMapRef.current.setCamera({
            lat: lastPosRef.current.lat, lng: lastPosRef.current.lng,
            zoom: 17, tilt: 45, bearing: lastHeadingRef.current ?? 0,
            animate: true, animationDuration: 100,
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
            url: photo.url, filename: photo.filename, mimeType: photo.mimeType, evidencePhase: "scene",
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
    enabled: isPanickerView || (isPanicIncident && (navMode || isJoinerMode)),
    refetchInterval: isPanickerView || (isPanicIncident && (navMode || isJoinerMode)) ? 5000 : false,
    refetchIntervalInBackground: true,
  });

  const panicAcknowledgers = useMemo(() => {
    if (!currentIncident || !isPanicIncident) return [];
    return panicAlertsForView.find((p) => p.id === currentIncident.id)?.acknowledgedBy ?? [];
  }, [currentIncident?.id, isPanicIncident, panicAlertsForView]);

  const navRoster = useMemo(() => {
    if (!currentIncident) return [];
    return buildNavRoster({
      incident: currentIncident,
      meId: me?.id,
      isJoiner: isJoinerMode,
      isPanic: isPanicIncident,
      acknowledgers: panicAcknowledgers,
    });
  }, [currentIncident, me?.id, isJoinerMode, isPanicIncident, panicAcknowledgers]);

  const navRosterOthersCount = navRoster.filter((e) => e.role !== "you").length;

  const panickerHasCoords = currentIncident ? incidentHasPanicCoords(currentIncident) : false;
  usePanickerLocationSync(
    isPanickerView ? currentIncident?.id ?? null : null,
    isPanickerView,
    panickerHasCoords,
  );

  if (sessionClosing) {
    return (
      <div
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background text-foreground"
        style={{ backgroundColor: "hsl(var(--background))" }}
        data-testid="session-closing-overlay"
      >
        <Loader2 className="h-9 w-9 animate-spin text-primary" />
        <p className="text-sm font-medium">Saving incident…</p>
      </div>
    );
  }

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
          {!panickerHasCoords && (
            <div data-testid="banner-panicker-location-off">
              <LocationPermissionGuide
                variant="light"
                testIdPrefix="panicker-location"
                onLocationUpdated={() => {
                  void probePanicLocation();
                  void queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
                }}
              />
            </div>
          )}
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
              {panickerHasCoords
                ? "Help is on the way. Stay on this screen if you can — your location is being shared."
                : "Help is on the way. Turn on Location so your team can see where you are."}
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

  function navRespondersChipLabel(): string {
    if (newJoinerFlash) return newJoinerFlash;
    const others = navRoster.filter((e) => e.role !== "you");
    if (others.length === 0) return "Responders";
    if (others.length === 1) {
      const o = others[0];
      return o.role === "panicker"
        ? `${o.firstName} · SOS`
        : o.role === "creator"
          ? `${o.firstName} · live`
          : `${o.firstName} responding`;
    }
    return `${others.length} responding`;
  }

  function renderNavRespondersChip() {
    if (!navMode || navRosterOthersCount === 0) return null;
    return (
      <button
        type="button"
        onClick={() => setRespondersSheetOpen(true)}
        className={`pointer-events-auto ml-auto inline-flex items-center gap-1.5 rounded-full shadow-lg font-semibold transition-all duration-300 hover:brightness-110 active:scale-95 ${newJoinerFlash ? "bg-green-500 text-white px-3 py-1.5 text-sm ring-2 ring-white/70 animate-pulse" : "bg-black/55 text-white px-2.5 py-1 text-xs"}`}
        data-testid="button-nav-responders"
        aria-label="View who is responding"
      >
        <Users className={`shrink-0 ${newJoinerFlash ? "h-4 w-4" : "h-3 w-3"}`} />
        <span>{navRespondersChipLabel()}</span>
        <ChevronRight className="h-3 w-3 shrink-0 opacity-80" />
      </button>
    );
  }

  function rosterStatusLabel(entry: NavRosterEntry): string {
    if (entry.role === "panicker") return "SOS — needs help";
    if (entry.role === "creator") {
      const gpsAgo = fmtTimeAgo(entry.lastPositionAt);
      return gpsAgo ? `Live incident · GPS ${gpsAgo}` : "Live incident · at scene";
    }
    if (entry.status === "ack") return "Acknowledged";
    const gpsAgo = fmtTimeAgo(entry.lastPositionAt);
    return gpsAgo ? `En route · GPS ${gpsAgo}` : "En route";
  }

  const fieldActionFooterClass = cn(
    "shrink-0 space-y-2",
    pinnedFieldLayout && "px-4 pt-3 border-t border-border/50 bg-background/95 backdrop-blur-sm",
  );

  return (
    <div className="flex flex-col h-full bg-background live-page-root">
      {/* v75: merged title + GPS status row. Single LIVE pill, inline GPS info,
          background tinted by GPS health. The fixed top-0 GPS-lost banner (60 s
          threshold) still handles retry. */}
      <div
        className={`flex items-center gap-2 px-3 shrink-0 transition-colors border-b ${
          navMode ? "py-1.5" : "py-2"
        } ${
          navMode && navFieldPhase === "at_scene"
            ? "bg-red-600/10"
            : navMode && navFieldPhase === "arriving_soon"
            ? "bg-amber-500/10"
            : navMode
            ? "bg-primary/10"
            : !currentIncident || gpsStatus === "idle"
            ? "bg-background"
            : gpsStatus === "tracking" || gpsStatus === "stationary"
            ? "bg-green-600/10"
            : gpsStatus === "acquiring"
            ? "bg-amber-500/10"
            : "bg-red-600/10"
        }`}
      >
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} data-testid="button-back-live">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div
          className="flex items-center gap-2 select-none min-w-0 flex-1"
          data-testid="title-live-incident"
        >
          {navMode ? (
            <div className="flex flex-col min-w-0 flex-1 gap-0.5">
              <span className="font-semibold text-sm truncate leading-tight">Navigating to scene</span>
              {(destination ?? joinerNavDestination) && (
                <span className="text-[11px] text-muted-foreground truncate">
                  {(destination ?? joinerNavDestination)?.name}
                </span>
              )}
            </div>
          ) : (
            <span className="font-semibold text-base shrink-0">
              {isJoinerMode ? "Responding" : "Live Incident"}
            </span>
          )}
          {currentIncident && gpsStatus !== "idle" && (
            <span className={`text-muted-foreground truncate ${navMode ? "text-[11px]" : "text-xs"}`} data-testid="text-gps-inline">
              {!navMode ? "· " : null}
              {gpsStatus === "tracking" || gpsStatus === "stationary"
                ? `GPS${gpsAccuracy != null ? ` ±${gpsAccuracy}m` : ""}${
                    gpsLastSentAt != null
                      ? ` · ${Math.max(0, Math.round((Date.now() - gpsLastSentAt) / 1000))}s ago`
                      : ""
                  }`
                : gpsStatus === "acquiring"
                ? `Acquiring GPS…${gpsAccuracy != null ? ` ±${gpsAccuracy}m` : ""}`
                : gpsStatus === "denied"
                ? "Location off"
                : gpsStatus === "unavailable"
                ? "GPS unavailable"
                : gpsStatus === "session_expired"
                ? "Session expired"
                : "GPS lost"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {navMode && navFieldPhase && (
            <LiveIncidentNavPhaseBadge phase={navFieldPhase} />
          )}
          {currentIncident && (
            <Badge
              className={`text-white ${isJoinerMode ? "bg-blue-600" : "bg-green-500"}`}
              data-testid="badge-live-active"
            >
              {isJoinerMode ? "JOINED" : "LIVE"}
            </Badge>
          )}
        </div>
      </div>

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
          <span className="flex-1">{isNative ? "Your device can't keep the screen on automatically — prevent it from locking manually during this incident." : "Your browser can't keep the screen on automatically — you may need to prevent it from locking manually during this incident."}</span>
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


      <div
        ref={scrollContainerRef}
        className={cn(
          "flex flex-col flex-1 min-h-0 live-scroll",
          navMode || pinnedFieldLayout
            ? "overflow-hidden p-0 gap-0 bg-background"
            : "gap-3 p-4 overflow-y-auto",
        )}
      >
        {currentIncident ? (
          <>
            {!navMode && (
              <div ref={pinnedSummaryRef} className={cn("shrink-0 space-y-2", pinnedFieldLayout && "px-4 pt-3 pb-1")}>
              <IncidentActiveSummary
                incident={currentIncident}
                isJoiner={isJoinerMode}
                categories={categories}
                compact={isJoinerMode || pinnedFieldLayout}
                showLoadRoute={
                  !isJoinerMode &&
                  !hasRoute &&
                  Boolean(currentIncident.latitude && currentIncident.longitude)
                }
                onLoadRoute={() =>
                  drawRoute(
                    currentIncident!.latitude!,
                    currentIncident!.longitude!,
                    lastPosRef.current ?? undefined,
                  )
                }
              />
            {!navMode && isJoinerMode && navRosterOthersCount > 0 && (
              <button
                type="button"
                className="w-full flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors shrink-0"
                onClick={() => setRespondersSheetOpen(true)}
                data-testid="button-joiner-view-responders"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Users className="h-4 w-4 text-primary" />
                  {navRosterOthersCount === 1
                    ? navRespondersChipLabel()
                    : `${navRosterOthersCount} people responding`}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            )}
            {/* Joiner-only destination status — creators pick via Start Navigation sheet */}
            {!navMode && isJoinerMode && (
            <div className="space-y-1.5 shrink-0">
              {joinerNavDestination ? (
                  <div className="space-y-1.5">
                    {navStarted ? (
                      <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                        <div className="flex items-center gap-1.5 text-sm min-w-0">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="truncate font-medium">{joinerNavDestination.name}</span>
                        </div>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline shrink-0"
                          onClick={cancelNavigation}
                          data-testid="button-joiner-change-nav"
                        >
                          Change
                        </button>
                      </div>
                    ) : null}
                    {routeInfo && activeNavStyle === "guided" && !joinerChoosingNav && (
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
                ) : isPanicIncident ? (
                  <div
                    className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/10 px-3 py-2.5 flex items-center gap-2 text-sm text-amber-900 dark:text-amber-200"
                    data-testid="panel-panic-location-pending"
                  >
                    <MapPin className="h-4 w-4 shrink-0" />
                    Panicker GPS pending — the map updates when they turn location on
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed px-3 py-2.5 flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0" />
                    Waiting for creator to set a destination…
                  </div>
                )}
            </div>
            )}
              </div>
            )}

            {!navMode && !joinerChoosingNav && hasRoute && currentStep && isJoinerMode ? (
              <div className={cn("rounded-lg border border-green-500/40 bg-green-500/5 px-4 py-3 space-y-2 shrink-0", pinnedFieldLayout && "mx-4")} data-testid="nav-panel">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-base leading-snug flex-1 pr-2" data-testid="text-step-instruction">
                    {stripHtml(upcomingStep.instructions)}
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
            ) : null}
          </>
        ) : (
          /* Pre-start screen — no incident created yet */
          <div className="flex flex-col flex-1 gap-4" data-testid="pre-start-screen">
            {staleJoinNotice && (
              <div
                className="mx-4 mt-4 rounded-lg border border-green-500/30 bg-green-500/10 p-4 space-y-3 text-left"
                data-testid="stale-join-notice"
              >
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-sm">This incident is already closed</p>
                    <p className="text-sm text-muted-foreground">
                      {staleJoinNotice.closedAt
                        ? `It was closed at ${staleJoinNotice.closedAt}.`
                        : "It is no longer active."}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => navigate(`/occurrence-book?incident=${staleJoinNotice.id}`)}
                  >
                    View in Occurrence Book
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setStaleJoinNotice(null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
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
        {!navMode && !joinerChoosingNav && navResponders.length > 0 && (
          <div className={cn("flex items-center gap-1.5 shrink-0 text-xs font-medium text-green-700 dark:text-green-400", pinnedFieldLayout ? "px-4 pb-1" : "px-1")} data-testid="chip-responders-nonav">
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span>
              {navResponders.length === 1
                ? `${navResponders[0].firstName} is responding`
                : `${navResponders.length} responders en route`}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
          </div>
        )}

        {/* Map always mounted — avoids losing the google.maps.Map instance on state change.
            In nav mode this wrapper must be a flex child with flex-1: the map host
            uses absolute children only, so without a sized parent the map collapses
            to 0px and the screen goes blank. */}
        <div
          className={cn(
            (navMode || pinnedFieldLayout) && "flex flex-1 flex-col min-h-0 min-w-0 basis-0",
            pinnedFieldLayout && "px-4 pb-2",
          )}
        >
        {isNative && (jsApiDegraded || jsApiRetrying) && !mapsError && (
          <div
            className="shrink-0 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-950 dark:text-amber-100 space-y-2"
            data-testid="banner-js-api-degraded"
          >
            <p>
              {jsApiRetrying
                ? "Loading map services… destination search may take a moment on slow networks."
                : "Map search is slow or unavailable. The map below should still work — check WiFi/data, then retry."}
            </p>
            {!jsApiRetrying && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => {
                  resetGoogleMapsLoader();
                  setJsApiDegraded(false);
                  initJsApi();
                }}
                data-testid="button-retry-js-api"
              >
                Retry map services
              </Button>
            )}
          </div>
        )}
        {mapsError && useWebMap ? (
          <div className="flex-1 rounded-lg border border-destructive/40 bg-destructive/5 flex items-center justify-center min-h-[200px]" data-testid="map-error">
            <div className="text-center px-6 py-8 space-y-2 max-w-md">
              <MapPin className="h-8 w-8 mx-auto text-destructive/60" />
              <p className="text-sm font-medium">Map unavailable</p>
              <p className="text-xs text-muted-foreground break-words">
                {mapsErrorMsg ?? "Google Maps failed to load — contact your administrator."}
              </p>
              <p className="text-xs text-muted-foreground">
                API key in build: {import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? "configured" : "missing"}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  resetGoogleMapsLoader();
                  setMapsError(false);
                  initJsApi();
                }}
                data-testid="button-retry-map-load"
              >
                Retry
              </Button>
            </div>
          </div>
        ) : (
          <div
            ref={mapHostRef}
            className={
              navMode
                ? "relative overflow-hidden native-map-host flex-1 min-h-0 w-full h-full basis-0"
                : pinnedFieldLayout
                ? "relative overflow-hidden native-map-host live-field-map-host flex-1 min-h-0 w-full basis-0 rounded-xl border border-border/50 shadow-sm"
                : "relative rounded-lg overflow-hidden min-h-[200px] flex-1 native-map-host"
            }
          >
            {/* Nav mode: Direct banner (bearing + distance) or Guided step banner */}
            {navMode && activeNavStyle === "direct" && (liveNavTarget ?? joinerNavDestination) && (
              <div
                className="absolute top-0 left-0 right-0 z-10 px-3 pb-2 pointer-events-none"
                style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
              >
                <div className="pointer-events-auto bg-primary text-primary-foreground rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">
                  <Navigation
                    className="h-12 w-12 shrink-0 transition-transform duration-300"
                    strokeWidth={2.5}
                    style={{ transform: directBearing != null ? `rotate(${directBearing}deg)` : undefined }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-2xl font-bold leading-tight tabular-nums" data-testid="text-direct-distance">
                      {directDist != null ? fmtDist(directDist) : "—"}
                    </p>
                    <p className="text-base font-semibold opacity-90 leading-tight truncate" data-testid="text-direct-bearing">
                      {directBearing != null ? `${bearingCardinal(directBearing)} · ${Math.round(directBearing)}°` : "—"}
                      <span className="ml-2 text-xs opacity-70 font-normal">direct</span>
                    </p>
                    <p className="text-xs opacity-80 truncate mt-0.5">
                      {(liveNavTarget ?? joinerNavDestination)?.name}
                    </p>
                  </div>
                  <button
                    onClick={() => { void stopSpeaking(); cancelNavigation(); }}
                    className="shrink-0 p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                    aria-label="Exit navigation"
                    data-testid="button-exit-nav"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    type="button"
                    className="pointer-events-auto text-xs font-medium bg-black/55 text-white rounded-full px-3 py-1 shadow-lg hover:bg-black/70"
                    onClick={() => switchToGuidedNav()}
                    data-testid="button-switch-guided"
                  >
                    Turn-by-turn
                  </button>
                  {renderNavRespondersChip()}
                </div>
              </div>
            )}
            {navMode && activeNavStyle === "guided" && currentStep && (
              <div
                className="absolute top-0 left-0 right-0 z-10 px-3 pb-2 pointer-events-none"
                style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
              >
                {/* Main step banner */}
                <div className="pointer-events-auto bg-primary text-primary-foreground rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">
                  <ManeuverIcon
                    maneuver={(upcomingStep as google.maps.DirectionsStep & { maneuver?: string }).maneuver}
                    className="h-12 w-12 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xl font-bold leading-tight line-clamp-2" data-testid="text-nav-instruction">
                      {stripHtml(upcomingStep.instructions)}
                    </p>
                    <p className="text-base font-semibold opacity-90 leading-tight">
                      {stepDist !== null ? fmtDist(stepDist) : currentStep.distance ? fmtDist(currentStep.distance.value) : "—"}
                      <span className="ml-2 text-xs opacity-70">{currentStepIndex + 1} / {steps.length}</span>
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {(guidedOffRoute || isOffRoute) && (
                      <button
                        type="button"
                        onClick={() => recalculateGuidedRoute()}
                        className="p-1.5 rounded-full bg-amber-400/90 text-amber-950 hover:bg-amber-300 transition-colors"
                        aria-label="Recalculate route"
                        data-testid="button-recalculate-nav"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => { void stopSpeaking(); cancelNavigation(); }}
                      className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                      aria-label="Exit navigation"
                      data-testid="button-exit-nav"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                {/* Row: off-route hint / "Then" pill / en route chip */}
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  {guidedOffRoute && (
                    <div className="pointer-events-auto inline-flex items-center gap-1.5 bg-amber-500 text-amber-950 rounded-full pl-3 pr-3 py-1 shadow-lg text-xs font-semibold">
                      Off suggested route
                    </div>
                  )}
                  {followingStep && (
                    <div className="pointer-events-auto inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-full pl-3 pr-3 py-1 shadow-lg text-sm font-medium max-w-[60%]">
                      <span className="opacity-75">Then</span>
                      <ManeuverIcon
                        maneuver={(followingStep as google.maps.DirectionsStep & { maneuver?: string }).maneuver}
                        className="h-4 w-4 shrink-0"
                      />
                      <span className="truncate opacity-90">
                        {stripHtml(followingStep.instructions)}
                      </span>
                    </div>
                  )}
                  {isJoinerMode && (
                    <button
                      type="button"
                      className="pointer-events-auto text-xs font-medium bg-black/55 text-white rounded-full px-3 py-1 shadow-lg hover:bg-black/70"
                      onClick={() => switchToDirectNav()}
                      data-testid="button-switch-direct"
                    >
                      Direct mode
                    </button>
                  )}
                  {renderNavRespondersChip()}
                </div>
              </div>
            )}
            {navMode && activeNavStyle === "guided" && !currentStep && (destination ?? joinerNavDestination) && (
              <div
                className="absolute top-0 left-0 right-0 z-10 px-3 pb-2 pointer-events-none"
                style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
              >
                <div className="pointer-events-auto bg-primary text-primary-foreground rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">
                  <Navigation className="h-10 w-10 shrink-0" strokeWidth={2.5} />
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-bold leading-tight">
                      {gpsStatus === "unavailable" || gpsStatus === "denied"
                        ? "Waiting for GPS to compute route…"
                        : "Loading route…"}
                    </p>
                    <p className="text-sm opacity-90 truncate mt-0.5">
                      {(destination ?? joinerNavDestination)?.name}
                    </p>
                  </div>
                  <button
                    onClick={() => { void stopSpeaking(); cancelNavigation(); }}
                    className="shrink-0 p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                    aria-label="Exit navigation"
                    data-testid="button-exit-nav-pending"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )}

            {/* v75: floating map-type toggle (Map → Hybrid → Satellite).
                In nav mode the step banner occupies top; we render below it
                (bottom-right above the action bar). Otherwise top-right.
                Hidden on web fallback — capMapRef is only set for native. */}
            {!useWebMap ? (
              <button
                type="button"
                onClick={() => {
                  const next = mapType === "Normal" ? "Hybrid" : mapType === "Hybrid" ? "Satellite" : "Normal";
                  setMapType(next as "Normal" | "Hybrid" | "Satellite");
                  capMapRef.current?.setMapType(next as "Normal" | "Hybrid" | "Satellite").catch(() => {});
                }}
                className={`absolute right-3 z-20 h-10 w-10 rounded-full bg-background/90 backdrop-blur border shadow-lg flex items-center justify-center text-foreground hover:bg-accent active:scale-95 transition-transform ${navMode ? "top-[8.5rem]" : "top-3"}`}
                aria-label={`Map view: ${mapType} — tap to cycle`}
                title={`Map: ${mapType} (tap to cycle)`}
                data-testid="button-map-type-toggle"
              >
                <Layers className="h-5 w-5" />
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] font-bold uppercase bg-background/90 px-1 rounded leading-none">
                  {mapType === "Normal" ? "Map" : mapType === "Hybrid" ? "Hyb" : "Sat"}
                </span>
              </button>
            ) : null}
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

            {/* Nav mode: "you" arrow — center-locked over the map. The camera is
                heading-up (bearing follows GPS heading) so the map rotates to put
                the direction of travel at the top; a fixed upward arrow therefore
                always points "forward". Pure CSS overlay — no native marker, so it
                never disturbs the frozen tilt/camera pipeline. */}
            {navMode && (
              <div
                className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none"
                data-testid="nav-user-arrow"
              >
                <svg width="46" height="46" viewBox="0 0 46 46" className="drop-shadow-lg">
                  <circle cx="23" cy="23" r="20" fill="#006039" stroke="#ffffff" strokeWidth="3" />
                  <path d="M23 11 L32 32 L23 26.5 L14 32 Z" fill="#ffffff" />
                </svg>
              </div>
            )}

            {/* Nav mode: action bar — absolute overlay at the bottom of the in-flow map */}
            {navMode && navFieldPhase && (
              <LiveIncidentNavBottomBar
                phase={navFieldPhase}
                isJoinerMode={isJoinerMode}
                activeNavStyle={activeNavStyle}
                directDist={directDist}
                directBearing={directBearing}
                navRouteDisplay={navRouteDisplay}
                speedKmh={speedKmh}
                fmtDist={fmtDist}
                fmtDur={fmtDur}
                bearingCardinal={bearingCardinal}
                showProminentArrived={showProminentArrived}
                onChat={() => navigate("/chat")}
                onCancelNavigation={cancelNavigation}
                onRecordArrival={recordArrival}
              />
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
                        : isNative
                        ? "Settings → Apps → OMT Pulse → Permissions → Location → Allow (or \"Allow all the time\" for background tracking)."
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
        </div>

      </div>

        {/* Bottom action area — sibling of scroll so map can flex between header and footer */}
        {currentIncident ? (
          showArrivalForm ? (
            <LiveIncidentArrivalForm
              destinationLabel={currentIncident?.destinationName || "Current location"}
              arrivalTime={arrivalTimeRef.current}
              isJoinerMode={isJoinerMode}
              description={arrivalDescription}
              onDescriptionChange={setArrivalDescription}
              categoryId={arrivalCategoryId}
              onCategoryChange={setArrivalCategoryId}
              otherCategoryNote={arrivalOtherType}
              onOtherCategoryNoteChange={setArrivalOtherType}
              categories={nonLiveCategories}
              media={arrivalMedia}
              maxMedia={MAX_ARRIVAL_MEDIA}
              uploading={arrivalUploading}
              uploadSource={arrivalUploadSource}
              isRecording={isRecording}
              recordingSeconds={recordingSeconds}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              onRemoveMedia={removeMedia}
              onPickUpload={() => arrivalUploadRef.current?.click()}
              onPickCamera={() => arrivalCameraRef.current?.click()}
              cameraInputRef={arrivalCameraRef}
              uploadInputRef={arrivalUploadRef}
              onCameraChange={(file) => { if (file) void addArrivalAttachment(file, "camera"); }}
              onUploadChange={(files) => { void handleArrivalUploadFiles(files); }}
              submitting={arrivalSubmitting}
              onSubmit={isJoinerMode ? submitJoinerArrival : submitArrival}
              onCancel={cancelArrivalForm}
              formFields={formFields}
              customFields={arrivalCustomFields}
              onCustomFieldsChange={setArrivalCustomFields}
              personInvolved={arrivalPersonInvolved}
              onPersonInvolvedChange={setArrivalPersonInvolved}
              vehicleInvolved={arrivalVehicleInvolved}
              onVehicleInvolvedChange={setArrivalVehicleInvolved}
              sapsSectionOpen={arrivalSapsOpen}
              onSapsSectionOpenChange={setArrivalSapsOpen}
            />
          ) : navMode ? null : showProminentArrived && !isPanicIncident ? (
            /* ---- Approaching destination (within 500 m) ---- */
            <div className={fieldActionFooterClass} ref={fieldFooterRef} style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/40 px-4 py-2 text-sm text-amber-900 dark:text-amber-200 flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0" />
                <span>
                  {isNearDestination
                    ? "You are at the scene — ready to record"
                    : `Approaching destination · ${distToDestinationM != null ? fmtDist(distToDestinationM) : ""} away`}
                </span>
              </div>
              <Button
                size="lg"
                variant="destructive"
                className={cn("w-full shrink-0 font-bold", isNearDestination ? "text-base py-6" : "")}
                onClick={recordArrival}
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
          ) : !navStarted && !navMode ? (
            <div className={fieldActionFooterClass} ref={fieldFooterRef} style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
              <LiveIncidentBypassNavigationCta onBypass={bypassInAppNavigation} disabled={dispatching} />
              <LiveIncidentStartNavigationCta
                onStart={() => {
                  if (isJoinerMode && joinerNavDestination) {
                    setJoinerNavPickerOpen(true);
                  } else {
                    openDestinationPicker();
                  }
                }}
                dispatching={dispatching}
                label="Start Navigation"
              />
            </div>
          ) : !navMode ? (
            /* Live incident active — en route or between flows; subtle early arrival */
            <div className={fieldActionFooterClass} ref={fieldFooterRef} style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
              {!isPanicIncident && (
                <button
                  type="button"
                  className="w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground py-1"
                  onClick={recordArrival}
                  data-testid="button-arrived"
                >
                  Record arrival early (still en route)
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
          ) : null
        ) : (
          /* ---- Pre-start: create incident and begin tracking ---- */
          <div
            className="shrink-0 px-4"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
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
          </div>
        )}

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

      <LiveIncidentDestinationSheet
        open={destinationPickerOpen}
        onOpenChange={setDestinationPickerOpen}
        search={search}
        onSearchChange={handleSearch}
        suggestions={suggestions}
        loadingSuggestions={loadingSugg}
        searchHint={searchHint}
        searchServicesLoading={jsApiRetrying || (!mapsReady && !mapsError && !jsApiDegraded)}
        searchServicesUnavailable={jsApiDegraded || mapsError || (mapsReady && !autocompleteReady)}
        onRetrySearchServices={retryDestinationSearchServices}
        onSelectSuggestion={selectPlace}
        incidentLocation={
          destinationSheetGps
            ? { name: incidentLocationDisplayLabel(currentIncident!, userLoc) }
            : null
        }
        onUseIncidentLocation={
          destinationSheetGps
            ? useIncidentLocationAsDestination
            : undefined
        }
      />

      {joinerNavDestination ? (
        <LiveIncidentJoinerNavSheet
          open={joinerNavPickerOpen}
          onOpenChange={setJoinerNavPickerOpen}
          destinationName={joinerNavDestination.name}
          acquiringGps={acquiringJoinerGps}
          onDirect={() => void dispatchJoinerInApp("direct")}
          onGuided={() => void dispatchJoinerInApp("guided")}
          onBypass={bypassInAppNavigation}
          gpsBlockedGuide={
            joinerGpsBlocked ? (
              <div data-testid="banner-joiner-location-off">
                <LocationPermissionGuide
                  variant="light"
                  testIdPrefix="joiner-location"
                  onLocationUpdated={(loc) => {
                    if (hasPanicCoordinates(loc)) {
                      lastPosRef.current = { lat: loc.lat, lng: loc.lng };
                      setJoinerGpsBlocked(false);
                      void dispatchJoinerInApp("direct");
                    }
                  }}
                />
              </div>
            ) : undefined
          }
        />
      ) : null}

      <Sheet open={respondersSheetOpen} onOpenChange={setRespondersSheetOpen}>
        <SheetContent side="bottom" className="max-h-[70vh] rounded-t-2xl" data-testid="sheet-nav-responders">
          <SheetHeader className="text-left pb-2">
            <SheetTitle>Who&apos;s responding</SheetTitle>
            <SheetDescription>
              {isPanicIncident
                ? "People heading to the panic or who acknowledged the alert."
                : "People joined on this live incident."}
            </SheetDescription>
          </SheetHeader>
          <ul className="space-y-2 overflow-y-auto max-h-[50vh] pr-1">
            {navRoster.length === 0 ? (
              <li className="text-sm text-muted-foreground py-4 text-center">
                No responders yet — your team has been alerted.
              </li>
            ) : (
              navRoster.map((entry) => (
                <li
                  key={entry.userId}
                  className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
                  data-testid={`nav-roster-${entry.userId}`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      entry.role === "panicker"
                        ? "bg-red-600 text-white"
                        : entry.role === "creator" || entry.status === "live"
                          ? "bg-green-600 text-white"
                          : "bg-amber-500 text-white"
                    }`}
                  >
                    {entry.role === "panicker" ? (
                      <AlertTriangle className="h-4 w-4" />
                    ) : (
                      `${entry.firstName.charAt(0)}${entry.lastName.charAt(0) || ""}`.trim()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate">
                      {entry.firstName} {entry.lastName}
                      {entry.role === "you" ? (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>
                      ) : entry.role === "creator" ? (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">(incident lead)</span>
                      ) : null}
                    </p>
                    <p className={`text-xs truncate ${entry.role === "panicker" ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}`}>
                      {rosterStatusLabel(entry)}
                    </p>
                  </div>
                  {entry.status === "live" && entry.role !== "panicker" ? (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-green-500 animate-pulse" aria-hidden />
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  );
}
