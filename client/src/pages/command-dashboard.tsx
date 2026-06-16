import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Location } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { IncidentDialog } from "@/components/incident-dialog";
import { OmtShield } from "@/components/omt-shield";
import { HeartbeatLine } from "@/components/heartbeat-line";
import { PanicBanner, type PanicAlert } from "@/components/panic-banner";
import { PanicConfirmOverlay } from "@/components/panic-confirm-overlay";
import { useToast } from "@/hooks/use-toast";
import {
  PlusCircle,
  Radio,
  ChevronRight,
  Siren,
  MessageSquare,
  Navigation,
  MapPin,
  Clock,
  type LucideIcon,
} from "lucide-react";

type Period = "day" | "week";

type DashboardData = {
  totalIncidents: number;
  liveCount: number;
  chartData: Array<{ label: string; count: number }>;
  users: unknown[];
};

type LiveIncidentRow = {
  id: number;
  userId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  severity: string | null;
  locationId: number | null;
  locationName: string | null;
  destinationName: string | null;
  destinationLat?: number | string | null;
  destinationLng?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  liveStartLat?: number | string | null;
  liveStartLng?: number | string | null;
  responderLat?: number | string | null;
  responderLng?: number | string | null;
  liveStartedAt: string | null;
  responderFirstName: string | null;
  responderLastName: string | null;
  isEscalated?: boolean;
  responders?: Array<{
    userId: string;
    firstName: string;
    lastName: string;
    joinedAt: string;
    lastPositionAt: string | null;
    arrivedAt: string | null;
  }>;
};

const FAR_JOIN_KM = 50;

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function fmtDistanceKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

function estimateDriveMinutes(km: number): number {
  const roadKm = km * 1.25;
  return Math.max(1, Math.round((roadKm / 55) * 60));
}

function pickLatLng(
  lat: number | string | null | undefined,
  lng: number | string | null | undefined,
): { lat: number; lng: number } | null {
  if (lat == null || lng == null) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return { lat: la, lng: ln };
}

function getIncidentTarget(inc: LiveIncidentRow): { lat: number; lng: number } | null {
  const isPanic = (inc.categoryName ?? "").toLowerCase().includes("panic");
  if (isPanic) {
    return (
      pickLatLng(inc.destinationLat, inc.destinationLng) ??
      pickLatLng(inc.liveStartLat, inc.liveStartLng) ??
      pickLatLng(inc.latitude, inc.longitude)
    );
  }
  return (
    pickLatLng(inc.destinationLat, inc.destinationLng) ??
    pickLatLng(inc.liveStartLat, inc.liveStartLng) ??
    pickLatLng(inc.latitude, inc.longitude) ??
    pickLatLng(inc.responderLat, inc.responderLng)
  );
}

function severityBadgeClass(severity: string | null): string {
  if (severity === "red") {
    return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
  }
  if (severity === "orange") {
    return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30";
  }
  if (severity === "yellow") {
    return "bg-yellow-400/15 text-yellow-800 dark:text-yellow-400 border-yellow-400/30";
  }
  return "bg-muted text-muted-foreground border-border";
}

function severityDotClass(severity: string | null): string {
  if (severity === "red") return "bg-red-500";
  if (severity === "orange") return "bg-orange-500";
  if (severity === "yellow") return "bg-yellow-400";
  return "bg-muted-foreground";
}

function severityRowAccent(severity: string | null): string {
  if (severity === "red") return "border-l-4 border-l-red-500 bg-red-500/[0.04]";
  if (severity === "orange") return "border-l-4 border-l-orange-500 bg-orange-500/[0.03]";
  if (severity === "yellow") return "border-l-4 border-l-yellow-400 bg-yellow-400/[0.03]";
  return "";
}

function formatStarterName(inc: LiveIncidentRow): string | null {
  const name = [inc.responderFirstName, inc.responderLastName].filter(Boolean).join(" ").trim();
  return name || null;
}

function LiveIncidentDashboardCard({
  incidents,
  hasRedLive,
  isDispatch,
  locations,
  currentUserId,
  userPos,
  gpsUnavailable,
  onOpenRow,
}: {
  incidents: LiveIncidentRow[];
  hasRedLive: boolean;
  isDispatch: boolean;
  locations: Location[];
  currentUserId?: string;
  userPos: { lat: number; lng: number } | null;
  gpsUnavailable: boolean;
  onOpenRow: (inc: LiveIncidentRow) => void;
}) {
  if (incidents.length === 0) return null;

    return (
    <Card
      className={
        hasRedLive
          ? "border-red-500/50 shadow-md ring-1 ring-red-500/20"
          : "border-green-500/35 shadow-sm"
      }
    >
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${hasRedLive ? "bg-red-500" : "bg-green-500"}`}
            />
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${hasRedLive ? "bg-red-500" : "bg-green-500"}`}
            />
          </span>
          <CardTitle className={`text-sm font-semibold ${hasRedLive ? "text-red-700 dark:text-red-400" : ""}`}>
            {hasRedLive ? "RED live incident active" : "Active Live Incidents"}
          </CardTitle>
          <span className="ml-auto text-[10px] text-muted-foreground uppercase tracking-wide">
            {isDispatch ? "Tap → Live Monitor" : "Tap to join"}
          </span>
    </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <ul className="divide-y divide-border">
          {incidents.map((inc) => (
            <LiveIncidentDashboardRow
              key={inc.id}
              inc={inc}
              locations={locations}
              currentUserId={currentUserId}
              userPos={userPos}
              gpsUnavailable={gpsUnavailable}
              isDispatch={isDispatch}
              onOpen={() => onOpenRow(inc)}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function LiveIncidentDashboardRow({
  inc,
  locations,
  currentUserId,
  userPos,
  gpsUnavailable,
  isDispatch,
  onOpen,
}: {
  inc: LiveIncidentRow;
  locations: Location[];
  currentUserId?: string;
  userPos: { lat: number; lng: number } | null;
  gpsUnavailable: boolean;
  isDispatch: boolean;
  onOpen: () => void;
}) {
  const locText =
    inc.destinationName ||
    inc.locationName ||
    (inc.locationId ? locations.find((l) => l.id === inc.locationId)?.name : null) ||
    "Location not set";
  const startedMs = inc.liveStartedAt ? new Date(inc.liveStartedAt).getTime() : null;
  const minsAgo = startedMs != null ? Math.max(0, Math.round((Date.now() - startedMs) / 60000)) : null;
  const isMine = inc.userId === currentUserId;
  const alreadyJoined = (inc.responders ?? []).some(
    (r) => r.userId === currentUserId && !r.arrivedAt,
  );
  const starterName = formatStarterName(inc);
  const rowAccent = severityRowAccent(inc.severity);
  const target = getIncidentTarget(inc);
  const distanceKm =
    !isMine && !alreadyJoined && userPos && target
      ? haversineKm(userPos, target)
      : null;
  const tooFar = distanceKm != null && distanceKm > FAR_JOIN_KM;
  const categoryLabel = inc.categoryName ?? "Live incident";
  const isPanicRow = (inc.categoryName ?? "").toLowerCase().includes("panic");
  const panicGpsPending = isPanicRow && !target;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`w-full text-left px-4 py-3.5 hover:bg-muted/50 active:bg-muted/70 transition-colors touch-manipulation ${rowAccent}`}
        data-testid={`row-live-incident-${inc.id}`}
      >
        <div className="flex items-start gap-3">
          {inc.categoryColor ? (
            <div
              className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-sm"
              style={{ backgroundColor: inc.categoryColor }}
              aria-hidden
            >
              <Radio className="h-5 w-5 text-white" strokeWidth={2.25} />
                </div>
              ) : (
            <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted">
              <Radio className="h-5 w-5 text-muted-foreground" strokeWidth={2.25} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold text-base leading-tight truncate">{categoryLabel}</p>
                  {inc.severity && inc.severity !== "none" && (
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${severityBadgeClass(inc.severity)}`}
                      data-testid={`badge-severity-live-${inc.id}`}
                    >
                            <span
                        className={`h-1.5 w-1.5 rounded-full ${severityDotClass(inc.severity)} ${inc.severity === "red" ? "animate-pulse" : ""}`}
                      />
                      {inc.severity}
                    </span>
                  )}
                  {inc.isEscalated && (
                    <span className="inline-flex shrink-0 items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/25">
                      ESCALATED
                    </span>
                                )}
                              </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">#{inc.id}</p>
                            </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                          </div>

            {isMine ? (
              <p className="text-sm font-medium text-primary mt-1">Your live incident</p>
            ) : alreadyJoined ? (
              <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mt-1">You're responding</p>
            ) : starterName ? (
              <p className="text-sm text-foreground/90 mt-1">
                Logged by <span className="font-medium">{starterName}</span>
              </p>
            ) : null}

            <p className="text-sm text-muted-foreground truncate mt-1 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-primary/80" />
              <span className="truncate">
                {panicGpsPending ? "GPS pending — panicker location not shared yet" : locText}
                                  </span>
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {minsAgo != null && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3 shrink-0" />
                  {minsAgo === 0 ? "Just started" : `${minsAgo} min ago`}
                                  </span>
              )}
              {distanceKm != null && (
                <span
                  className={`inline-flex items-center gap-1 font-semibold tabular-nums ${
                    tooFar ? "text-amber-700 dark:text-amber-400" : "text-foreground"
                  }`}
                  data-testid={`text-distance-live-${inc.id}`}
                >
                  <Navigation className="h-3 w-3 shrink-0" />
                  {fmtDistanceKm(distanceKm)} away · ~{estimateDriveMinutes(distanceKm)} min drive
                                  </span>
                                )}
              {!isMine && !alreadyJoined && gpsUnavailable && target && (
                <span className="text-muted-foreground">Enable location for distance</span>
                            )}
                              </div>

            {tooFar && !isDispatch && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1.5 font-medium">
                Far from you — joining may not be practical
              </p>
            )}
            {!isMine && !alreadyJoined && !panicGpsPending && distanceKm != null && !tooFar && (
              <p className="text-[11px] text-green-700 dark:text-green-400 mt-1.5 font-medium">
                Within reach — tap to join
              </p>
            )}
            {panicGpsPending && !isMine && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1.5 font-medium">
                Tap to join — map updates when their GPS is available
              </p>
            )}
                                      </div>
        </div>
      </button>
    </li>
  );
}

function ActionTile({
  title,
  subtitle,
  icon: Icon,
  onClick,
  variant = "primary",
  testId,
}: {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: "primary" | "live" | "panic";
  testId: string;
}) {
  const surface =
    variant === "panic"
      ? "bg-gradient-to-br from-red-600 to-red-700 text-white shadow-lg shadow-red-600/30 ring-2 ring-red-500/40"
      : variant === "live"
      ? "bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-500/25"
      : "bg-gradient-to-br from-primary to-primary/85 text-primary-foreground shadow-lg shadow-primary/20";
  const subtitleClass =
    variant === "live" || variant === "panic" ? "text-white/85" : "text-primary-foreground/80";
  const titleClass =
    variant === "panic" ? "font-bold text-xl sm:text-2xl leading-tight tracking-tight" : "font-bold text-base leading-tight";

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`w-full flex items-center gap-4 px-4 h-[88px] rounded-2xl active:scale-[0.98] transition-transform touch-manipulation text-left ${surface}`}
    >
      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/20">
        <span className="pointer-events-none absolute inset-0 rounded-xl border-2 border-white/50 action-tile-ring" aria-hidden />
        <Icon className="relative h-6 w-6 action-tile-icon-pulse" strokeWidth={2.25} />
                                    </div>
      <div className="flex-1 min-w-0">
        <p className={titleClass}>{title}</p>
        {subtitle ? (
          <p className={`text-sm mt-0.5 ${subtitleClass}`}>{subtitle}</p>
        ) : null}
                                    </div>
      <ChevronRight className="h-5 w-5 shrink-0 opacity-75" />
    </button>
  );
}

function StatTile({
  label,
  value,
  sublabel,
  onClick,
  highlight,
  testId,
}: {
  label: string;
  value: number | string;
  sublabel: string;
  onClick?: () => void;
  highlight?: boolean;
  testId: string;
}) {
  const inner = (
    <>
      <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">{label}</p>
      <p
        className={`text-2xl sm:text-3xl font-bold tabular-nums ${highlight ? "text-green-600 dark:text-green-400" : ""}`}
        data-testid={testId}
      >
        {value}
      </p>
      <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 flex items-center gap-1 leading-snug">
        {sublabel}
        {onClick && <ChevronRight className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />}
      </p>
    </>
  );

  if (!onClick) {
    return (
      <Card>
        <CardContent className="p-4">{inner}</CardContent>
      </Card>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left w-full rounded-xl border bg-card shadow-sm hover:bg-muted/40 active:scale-[0.99] transition-all touch-manipulation"
      data-testid={`${testId}-button`}
    >
      <div className="p-3 sm:p-4">{inner}</div>
    </button>
  );
}

export default function CommandDashboard() {
  const [, navigate] = useLocation();
  const [period, setPeriod] = useState<Period>("day");
  const [logIncidentOpen, setLogIncidentOpen] = useState(false);
  const [panicOpen, setPanicOpen] = useState(false);
  const { toast } = useToast();

  const DISMISSED_KEY = "dismissedPanicIds";
  const [dismissedPanicIds, setDismissedPanicIds] = useState<Set<number>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]")); } catch { return new Set(); }
  });

  function dismissPanic(id: number) {
    setDismissedPanicIds((prev) => {
      const next = new Set([...prev, id]);
      try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  const { data: currentUser } = useQuery<{ id: string; firstName: string; lastName: string; role: string }>({
    queryKey: ["/api/auth/me"],
  });
  const isReporter = currentUser?.role === "reporter";
  const isDispatch = currentUser?.role === "administrator" || currentUser?.role === "supervisor";

  const { data: panicAlerts = [] } = useQuery<PanicAlert[]>({
    queryKey: ["/api/panic/recent"],
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: true,
  });

  type ChatConversation = { recipientId: string | null; recipientFirstName: string | null; recipientLastName: string | null; unreadCount: number };
  const { data: chatConvos = [] } = useQuery<ChatConversation[]>({
    queryKey: ["/api/chat/conversations"],
    refetchInterval: 5000,
  });
  const totalUnread = chatConvos.reduce((sum, c) => sum + c.unreadCount, 0);
  const unreadSenders = chatConvos
    .filter((c) => c.unreadCount > 0)
    .map((c) => c.recipientId === null ? "General" : `${c.recipientFirstName ?? ""} ${c.recipientLastName ?? ""}`.trim())
    .filter(Boolean);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard", period],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard?period=${period}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: liveIncidents = [] } = useQuery<LiveIncidentRow[]>({
    queryKey: ["/api/incidents/live"],
    refetchInterval: 15_000,
  });
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });

  const visibleLiveIncidents = useMemo(() => {
    if (!isReporter || !currentUser) return liveIncidents;
    return liveIncidents.filter(
      (inc) =>
        inc.userId === currentUser.id ||
        (inc.responders ?? []).some((r) => r.userId === currentUser.id && !r.arrivedAt),
    );
  }, [liveIncidents, isReporter, currentUser?.id]);

  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsUnavailable, setGpsUnavailable] = useState(false);

  useEffect(() => {
    if (visibleLiveIncidents.length === 0 || typeof navigator === "undefined" || !navigator.geolocation) {
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsUnavailable(false);
      },
      () => setGpsUnavailable(true),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 12_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [visibleLiveIncidents.length]);

  const hasRedLive = visibleLiveIncidents.some((i) => i.severity === "red");

  function openIncidentsList() {
    navigate(`/occurrence-book?period=${period}`);
  }

  const liveCountDisplay = visibleLiveIncidents.length;

  function openLiveView() {
    if (liveCountDisplay === 0) {
      toast({ title: "No live incidents", description: "There are no active live incidents right now." });
      return;
    }
    if (isDispatch) {
      navigate("/live-monitor");
      return;
    }
    const inc = visibleLiveIncidents[0];
    if (!inc) return;
    if (inc.userId === currentUser?.id) {
      navigate("/live-incident");
    } else {
      try { localStorage.setItem("omt_joined_incident_id", String(inc.id)); } catch { /* ignore */ }
      navigate("/live-incident");
    }
  }

  function openLiveIncidentRow(inc: LiveIncidentRow) {
    if (isDispatch) {
      navigate(`/live-monitor?incidentId=${inc.id}`);
      return;
    }
    if (inc.userId === currentUser?.id) {
      navigate("/live-incident");
    } else {
      try { localStorage.setItem("omt_joined_incident_id", String(inc.id)); } catch { /* ignore */ }
      navigate("/live-incident");
    }
  }

  const periodLabel = period === "day" ? "Today" : "This Week";
  const incidentSublabel = isReporter
    ? `my incident${(data?.totalIncidents ?? 0) === 1 ? "" : "s"} · tap to view`
    : `incident${(data?.totalIncidents ?? 0) === 1 ? "" : "s"} · tap to view`;

  return (
    <div className="h-full overflow-y-auto bg-background">
      {visibleLiveIncidents.length > 0 && (
        <div
          className="sticky top-0 z-30 border-b border-border/80 bg-background/95 backdrop-blur-md shadow-sm"
          data-testid="banner-live-incident-priority"
        >
          <div className="max-w-4xl mx-auto w-full px-4 md:px-6 pt-3 pb-3">
            <LiveIncidentDashboardCard
              incidents={visibleLiveIncidents}
              hasRedLive={hasRedLive}
              isDispatch={isDispatch}
              locations={locations}
              currentUserId={currentUser?.id}
              userPos={userPos}
              gpsUnavailable={gpsUnavailable}
              onOpenRow={openLiveIncidentRow}
            />
          </div>
        </div>
      )}

      <div className="p-4 md:p-6 pb-4 space-y-4 max-w-4xl mx-auto w-full">

        <div className="flex flex-col items-center gap-2 pt-3 pb-1">
          <OmtShield variant="hero" />
          <div className="flex flex-col items-center gap-0.5">
            <div className="flex items-center justify-center gap-2">
              <div style={{ transform: "scaleX(-1)" }}>
                <HeartbeatLine className="w-14 h-3.5 text-primary/70" />
              </div>
              <h1 className="text-2xl sm:text-[1.65rem] font-bold tracking-tight" data-testid="text-page-title">
                OMT Pulse
              </h1>
              <HeartbeatLine className="w-14 h-3.5 text-primary/70" />
            </div>
            <p className="text-sm text-muted-foreground">
              {currentUser?.firstName ? `Welcome, ${currentUser.firstName}.` : "Welcome."}
            </p>
          </div>
        </div>

        <PanicBanner
          alerts={panicAlerts}
          currentUserId={currentUser?.id}
          dismissedIds={dismissedPanicIds}
          onDismiss={dismissPanic}
          testIdSuffix="dashboard"
        />

        {totalUnread > 0 && (
          <button
            type="button"
            onClick={() => navigate("/chat")}
            className="w-full text-left rounded-2xl border-2 border-primary/60 bg-primary/5 hover:bg-primary/10 transition-colors overflow-hidden shadow-sm"
            data-testid="banner-unread-chat"
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="relative shrink-0">
                <MessageSquare className="h-5 w-5 text-primary" />
                <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground leading-none">
                  {totalUnread > 99 ? "99+" : totalUnread}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {totalUnread} unread message{totalUnread !== 1 ? "s" : ""}
                </p>
                {unreadSenders.length > 0 && (
                  <p className="text-xs text-muted-foreground truncate">{unreadSenders.join(", ")}</p>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          </button>
        )}

        <div className="flex flex-col gap-3">
          <ActionTile
            title="Panic/SOS"
            icon={Siren}
            variant="panic"
            onClick={() => setPanicOpen(true)}
            testId="button-panic"
          />
          <ActionTile
            title="Start Live Incident"
            subtitle="Share GPS and navigate in real time"
            icon={Radio}
            variant="live"
            onClick={() => navigate("/live-severity")}
            testId="button-start-live-incident"
          />
          <ActionTile
            title="Report Incident"
            subtitle="Log an occurrence to the book"
            icon={PlusCircle}
            variant="primary"
            onClick={() => setLogIncidentOpen(true)}
            testId="button-report-incident"
          />
        </div>
      </div>

      <div className="p-4 md:p-6 pt-1 pb-28 max-w-4xl mx-auto w-full">
        <div className="space-y-3">
          <div className="flex justify-center">
            <div className="flex items-center rounded-lg border border-border overflow-hidden text-sm">
              <button
                onClick={() => setPeriod("day")}
                className={`px-4 py-1.5 font-medium transition-colors ${period === "day" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                data-testid="toggle-period-day"
              >
                Today
              </button>
              <button
                onClick={() => setPeriod("week")}
                className={`px-4 py-1.5 font-medium transition-colors border-l border-border ${period === "week" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                data-testid="toggle-period-week"
              >
                This Week
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {isLoading ? (
              <>
                <Skeleton className="h-24 w-full rounded-xl" />
                <Skeleton className="h-24 w-full rounded-xl" />
              </>
            ) : (
              <>
                <StatTile
                  label={periodLabel}
                  value={data?.totalIncidents ?? 0}
                  sublabel={incidentSublabel}
                  onClick={openIncidentsList}
                  testId="stat-total-incidents"
                />
                <StatTile
                  label="Currently Live"
                  value={liveCountDisplay}
                  sublabel={
                    liveCountDisplay > 0
                      ? `active · tap to open`
                      : "no active incidents"
                  }
                  onClick={openLiveView}
                  highlight={liveCountDisplay > 0}
                  testId="stat-live-count"
                />
              </>
            )}
          </div>
        </div>
      </div>

      <IncidentDialog open={logIncidentOpen} onOpenChange={setLogIncidentOpen} />

      <PanicConfirmOverlay
        open={panicOpen}
        onOpenChange={setPanicOpen}
        confirmTestId="button-confirm-panic-dashboard"
      />
    </div>
  );
}
