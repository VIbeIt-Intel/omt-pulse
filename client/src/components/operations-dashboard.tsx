import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Location } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PanicBanner, type PanicAlert } from "@/components/panic-banner";
import { LiveIncidentsMap, SA_MAP_DEFAULT, type LiveIncidentMapItem, type OnlineUserMapMarker, type TrackerMapMarker } from "@/components/live-incidents-map";
import { cn } from "@/lib/utils";
import {
  ClipboardList,
  Radio,
  Siren,
  MessageSquare,
  ChevronRight,
  MapPin,
  Clock,
  Users,
  ExternalLink,
  CheckCircle2,
  Shield,
  Car,
  ChevronDown,
} from "lucide-react";
import { Link } from "wouter";

type Period = "day" | "week";

export type DashboardUserSummary = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  avatarUrl: string | null;
  incidentCount: number;
  isLive: boolean;
  liveIncidentId: number | null;
  lastSeenAt: string | Date | null;
  lastLat: number | null;
  lastLng: number | null;
  lastPositionAt: string | Date | null;
};

type DashboardData = {
  totalIncidents: number;
  liveCount: number;
  chartData: Array<{ label: string; count: number }>;
  users: DashboardUserSummary[];
};

export type TrackerDeviceSummary = {
  id: number;
  imei: string;
  label: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleRegistration: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  notes: string | null;
  commandId: number | null;
  commandName: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastSpeedKph: number | null;
  lastHeading: number | null;
  lastIgnitionOn: boolean | null;
  lastMileageKm: number | null;
  lastGpsValid: boolean | null;
  lastPositionAt: string | null;
  lastSeenAt: string | null;
};

type LiveQueueItem = LiveIncidentMapItem & {
  locationId?: number | null;
};

type ResponderFilter = "all" | "responding" | "available";

const ONLINE_WINDOW_MS = 30 * 60 * 1000;
const TRACKER_ACTIVE_MS = 30 * 60 * 1000;

function severityBadgeClass(severity: string | null): string {
  if (severity === "red") return "bg-red-500/20 text-red-300 border-red-500/40";
  if (severity === "orange") return "bg-orange-500/20 text-orange-300 border-orange-500/40";
  if (severity === "yellow") return "bg-yellow-500/20 text-yellow-200 border-yellow-500/40";
  return "bg-slate-600/50 text-slate-300 border-slate-500/40";
}

function severityRowAccent(severity: string | null, isPanic: boolean): string {
  if (isPanic || severity === "red") return "border-l-[3px] border-l-red-500 bg-red-950/40";
  if (severity === "orange") return "border-l-[3px] border-l-orange-500 bg-orange-950/20";
  if (severity === "yellow") return "border-l-[3px] border-l-yellow-500 bg-yellow-950/15";
  return "border-l-[3px] border-l-slate-600 bg-slate-800/30";
}

function formatGpsAge(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const secs = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

function formatStarterName(inc: LiveQueueItem): string | null {
  const name = [inc.responderFirstName, inc.responderLastName].filter(Boolean).join(" ").trim();
  return name || null;
}

function isUserOnline(lastSeenAt: string | Date | null | undefined): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

function hasMapPosition(user: DashboardUserSummary): boolean {
  if (user.isLive) return false;
  if (user.lastLat == null || user.lastLng == null) return false;
  if (!isUserOnline(user.lastSeenAt)) return false;
  if (user.lastPositionAt) {
    const age = Date.now() - new Date(user.lastPositionAt).getTime();
    if (age > ONLINE_WINDOW_MS) return false;
  }
  return true;
}

function isTrackerLive(device: TrackerDeviceSummary): boolean {
  if (!device.lastSeenAt) return false;
  return Date.now() - new Date(device.lastSeenAt).getTime() < TRACKER_ACTIVE_MS;
}

function hasTrackerMapPosition(device: TrackerDeviceSummary): boolean {
  if (device.lastLat == null || device.lastLng == null) return false;
  return isTrackerLive(device);
}

function trackerDisplayName(device: TrackerDeviceSummary): string {
  const makeModel = [device.vehicleMake, device.vehicleModel].filter(Boolean).join(" ").trim();
  if (makeModel) return makeModel;
  return device.label?.trim() || `Vehicle …${device.imei.slice(-4)}`;
}

function OpsCollapsibleSection({
  title,
  icon: Icon,
  accentClass,
  borderClass,
  count,
  open,
  onToggle,
  headerExtra,
  manageHref,
  testId,
  children,
}: {
  title: string;
  icon: typeof Users;
  accentClass: string;
  borderClass: string;
  count?: string;
  open: boolean;
  onToggle: () => void;
  headerExtra?: ReactNode;
  manageHref?: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col min-h-0 border-t",
        open ? "flex-1" : "shrink-0",
        borderClass || "border-slate-800/80",
      )}
      data-testid={testId}
    >
      {open && <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{children}</div>}
      {headerExtra}
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "shrink-0 w-full px-3 py-2.5 flex items-center gap-2 text-left transition-colors",
          open ? accentClass : "hover:bg-slate-800/50",
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" />
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] flex-1">{title}</span>
        {count != null && <span className="text-[10px] text-slate-500 tabular-nums">{count}</span>}
        {manageHref && (
          <Link
            href={manageHref}
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] text-blue-400 hover:underline px-1"
          >
            Manage
          </Link>
        )}
        <ChevronDown
          className={cn("h-4 w-4 text-slate-500 transition-transform shrink-0", open && "rotate-180")}
        />
      </button>
    </section>
  );
}

function formatLastSeen(ts: string | Date | null | undefined): string {
  if (!ts) return "Last seen: no recent activity";
  const age = formatGpsAge(typeof ts === "string" ? ts : ts.toISOString());
  return age ? `Last seen: ${age}` : "Last seen: just now";
}

function getUserPresenceHint(
  user: DashboardUserSummary,
  incidents: LiveQueueItem[],
  locations: Location[],
): string {
  if (user.isLive && user.liveIncidentId) {
    const inc = incidents.find((i) => i.id === user.liveIncidentId);
    if (inc) {
      const loc =
        inc.destinationName ||
        inc.locationName ||
        (inc.locationId ? locations.find((l) => l.id === inc.locationId)?.name : null);
      if (loc) return `On scene · ${loc}`;
      return "On active incident";
    }
    return "Responding now";
  }
  if (isUserOnline(user.lastSeenAt)) return "Online now";
  return formatLastSeen(user.lastSeenAt);
}

function responderStatus(
  user: DashboardUserSummary,
): "responding" | "available" | "off-duty" {
  if (user.isLive) return "responding";
  if (isUserOnline(user.lastSeenAt)) return "available";
  return "off-duty";
}

type Props = {
  currentUser?: { id: string; firstName: string; lastName: string; role: string };
  liveIncidents: LiveQueueItem[];
  panicAlerts: PanicAlert[];
  dismissedPanicIds: Set<number>;
  onDismissPanic: (id: number) => void;
  locations: Location[];
  period: Period;
  onPeriodChange: (p: Period) => void;
  dashboardData?: DashboardData;
  dashboardLoading: boolean;
  totalUnread: number;
  unreadSenders: string[];
  onOpenChat: () => void;
  onOpenLiveMonitor: (incidentId?: number) => void;
  onOpenOccurrenceBook: () => void;
  onPanic: () => void;
  onStartLive: () => void;
  onReportIncident: () => void;
};

function KpiCard({
  label,
  value,
  hint,
  accent,
  onClick,
  testId,
  loading,
}: {
  label: string;
  value: number | string;
  hint?: string;
  accent?: "green" | "orange" | "red" | "blue" | "slate";
  onClick?: () => void;
  testId: string;
  loading?: boolean;
}) {
  const accentBorder =
    accent === "red"
      ? "border-red-500/40 shadow-sm shadow-red-950/20"
      : accent === "orange"
        ? "border-orange-500/40 shadow-sm shadow-orange-950/20"
        : accent === "green"
          ? "border-emerald-500/40 shadow-sm shadow-emerald-950/20"
          : accent === "blue"
            ? "border-blue-500/40 shadow-sm shadow-blue-950/20"
            : "border-slate-600/50";

  const inner = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      {loading ? (
        <Skeleton className="h-9 w-16 mt-1.5 bg-slate-700" />
      ) : (
        <p
          className={cn(
            "text-[2rem] leading-none font-extrabold tabular-nums mt-1.5 text-white tracking-tight",
          )}
          data-testid={testId}
        >
          {value}
        </p>
      )}
      {hint ? <p className="text-[11px] text-slate-500 mt-1.5">{hint}</p> : null}
    </>
  );

  const shell = cn(
    "rounded-xl border bg-slate-800/60 px-3.5 py-2.5 min-w-0 backdrop-blur-sm",
    accentBorder,
    onClick && "hover:bg-slate-800/90 hover:border-slate-500/60 transition-all cursor-pointer",
  );

  if (!onClick) return <div className={shell}>{inner}</div>;
  return (
    <button type="button" onClick={onClick} className={cn(shell, "text-left w-full")} data-testid={`${testId}-button`}>
      {inner}
    </button>
  );
}

export function OperationsDashboard({
  currentUser,
  liveIncidents,
  panicAlerts,
  dismissedPanicIds,
  onDismissPanic,
  locations,
  dashboardData,
  dashboardLoading,
  totalUnread,
  onOpenChat,
  onOpenLiveMonitor,
  onOpenOccurrenceBook,
  onPanic,
  onStartLive,
  onReportIncident,
}: Props) {
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [highlightTrackerId, setHighlightTrackerId] = useState<number | null>(null);
  const [teamPanelOpen, setTeamPanelOpen] = useState(false);
  const [fleetPanelOpen, setFleetPanelOpen] = useState(false);
  const [responderFilter, setResponderFilter] = useState<ResponderFilter>("all");
  const [clock, setClock] = useState(() => new Date());
  const [lastRefresh, setLastRefresh] = useState(() => new Date());

  const { data: dayDashboard, isLoading: dayLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard", "day"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard?period=day", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: trackers = [], isLoading: trackersLoading } = useQuery<TrackerDeviceSummary[]>({
    queryKey: ["/api/trackers"],
    queryFn: async () => {
      const res = await fetch("/api/trackers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load trackers");
      return res.json();
    },
    refetchInterval: 20_000,
  });

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setLastRefresh(new Date());
  }, [liveIncidents, panicAlerts, dayDashboard, trackers]);

  const { data: commandsData } = useQuery<{
    commands: Array<{ id: number; name: string; isCentral: boolean }>;
    activeCommandId: number | "all" | null;
  }>({ queryKey: ["/api/me/commands"] });

  const groupLabel = useMemo(() => {
    if (!commandsData) return "—";
    if (commandsData.activeCommandId === "all") return "All Groups";
    const cmd = commandsData.commands.find((c) => c.id === commandsData.activeCommandId);
    return cmd ? `${cmd.name}${cmd.isCentral ? " (Central)" : ""}` : "—";
  }, [commandsData]);

  const visiblePanics = panicAlerts.filter(
    (a) => !dismissedPanicIds.has(a.id) && !a.panicClosedAt,
  );
  const panicsToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return panicAlerts.filter((a) => {
      const d = new Date(a.createdAt).toISOString().slice(0, 10);
      return d === today;
    }).length;
  }, [panicAlerts]);

  const liveCount = liveIncidents.length;
  const hasRedLive = liveIncidents.some((i) => i.severity === "red");
  const hasActive = liveCount > 0 || visiblePanics.length > 0;
  const isCritical = visiblePanics.length > 0 || hasRedLive;

  const kpiSource = dayDashboard ?? dashboardData;
  const kpiLoading = dayLoading || dashboardLoading;
  const teamUsers = kpiSource?.users ?? [];

  const onlineCount = teamUsers.filter(
    (u) => u.isLive || isUserOnline(u.lastSeenAt),
  ).length;
  const respondingCount = teamUsers.filter((u) => u.isLive).length;

  const filteredTeam = useMemo(() => {
    return teamUsers.filter((u) => {
      const status = responderStatus(u);
      if (responderFilter === "responding") return status === "responding";
      if (responderFilter === "available") return status === "available";
      return true;
    });
  }, [teamUsers, responderFilter]);

  const statusTone = isCritical ? "critical" : hasActive ? "active" : "calm";

  const queueItems = useMemo(() => {
    const sorted = [...liveIncidents].sort((a, b) => {
      const aPanic = (a.categoryName ?? "").toLowerCase().includes("panic") ? 1 : 0;
      const bPanic = (b.categoryName ?? "").toLowerCase().includes("panic") ? 1 : 0;
      if (aPanic !== bPanic) return bPanic - aPanic;
      const sev = { red: 3, orange: 2, yellow: 1, none: 0 };
      const as = sev[(a.severity ?? "none") as keyof typeof sev] ?? 0;
      const bs = sev[(b.severity ?? "none") as keyof typeof sev] ?? 0;
      return bs - as;
    });
    return sorted;
  }, [liveIncidents]);

  const showQueue = queueItems.length > 0;

  const onlineMapUsers = useMemo((): OnlineUserMapMarker[] => {
    return teamUsers
      .filter(hasMapPosition)
      .map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        lat: u.lastLat!,
        lng: u.lastLng!,
        lastPositionAt: u.lastPositionAt
          ? new Date(u.lastPositionAt).toISOString()
          : null,
      }));
  }, [teamUsers]);

  const liveTrackers = useMemo(
    () => trackers.filter(hasTrackerMapPosition),
    [trackers],
  );

  const trackerMapMarkers = useMemo((): TrackerMapMarker[] => {
    return liveTrackers.map((t) => ({
      id: t.id,
      label: trackerDisplayName(t),
      imei: t.imei,
      lat: t.lastLat!,
      lng: t.lastLng!,
      speedKph: t.lastSpeedKph,
      heading: t.lastHeading,
      ignitionOn: t.lastIgnitionOn,
      lastPositionAt: t.lastPositionAt,
      lastSeenAt: t.lastSeenAt,
    }));
  }, [liveTrackers]);

  const vehiclesKpiHint = useMemo(() => {
    if (trackers.length === 0) return "no devices registered";
    if (liveTrackers.length === 0) {
      const latest = trackers.find((t) => t.lastSeenAt);
      if (latest?.lastSeenAt) {
        const age = formatGpsAge(latest.lastSeenAt);
        return age ? `last seen ${age}` : "awaiting GPS";
      }
      return "awaiting GPS";
    }
    if (liveTrackers.length === 1) return "1 vehicle live";
    return `${liveTrackers.length} vehicles live`;
  }, [trackers, liveTrackers]);

  return (
    <div
      className="flex flex-col h-full min-h-0 bg-[#0f1419] text-slate-100"
      data-testid="operations-dashboard"
    >
      {/* ── Top status bar ── */}
      <div
        className={cn(
          "shrink-0 px-4 py-2 border-b flex flex-wrap items-center gap-x-4 gap-y-2",
          statusTone === "critical" && "bg-red-950/95 border-red-900/70",
          statusTone === "active" && "bg-amber-950/85 border-amber-900/50",
          statusTone === "calm" && "bg-[#0d2818] border-emerald-900/40",
        )}
        data-testid="ops-status-bar"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {statusTone === "calm" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400/90 shrink-0" />
          ) : (
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-70" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
            </span>
          )}
          <p
            className={cn(
              "text-sm sm:text-[15px] tracking-wide",
              statusTone === "calm"
                ? "font-semibold text-emerald-100/95"
                : "font-bold text-slate-100",
            )}
          >
            {statusTone === "calm"
              ? "All Clear — No Active Incidents"
              : visiblePanics.length > 0
                ? `${visiblePanics.length} Active Panic${visiblePanics.length === 1 ? "" : "s"}`
                : `${liveCount} Live Incident${liveCount === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
          <span className="tabular-nums font-medium" data-testid="ops-clock">
            {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <span className="text-slate-500">|</span>
          <span className="font-medium">{groupLabel}</span>
          <span className="text-slate-500">|</span>
          <span>{onlineCount} online</span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400">
            Updated {formatGpsAge(lastRefresh.toISOString()) ?? "now"}
          </span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {totalUnread > 0 && (
            <button
              type="button"
              onClick={onOpenChat}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-800/80 border border-slate-600 px-2.5 py-1 text-xs font-semibold hover:bg-slate-700"
              data-testid="ops-strip-unread-chat"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {totalUnread}
            </button>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 text-xs gap-1 bg-slate-800/90 border-slate-600 text-slate-100 hover:bg-slate-700"
            onClick={() => onOpenLiveMonitor()}
            data-testid="ops-open-live-monitor"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Live Monitor
          </Button>
        </div>
      </div>

      {/* ── Toolbar: quick actions ── */}
      <div className="shrink-0 px-4 py-2.5 border-b border-slate-700/80 bg-[#141b24] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-emerald-500" />
          <div>
            <h1 className="text-sm font-bold tracking-wide uppercase text-slate-200" data-testid="text-ops-title">
              Control Room
            </h1>
            <p className="text-[11px] text-slate-500">
              {currentUser?.firstName ? `${currentUser.firstName} · ${currentUser.role}` : "Operations"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPanic}
            data-testid="ops-button-panic"
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-red-900/40 transition-colors"
          >
            <Siren className="h-4 w-4" />
            Panic / SOS
          </button>
          <button
            type="button"
            onClick={onStartLive}
            data-testid="ops-button-live"
            className="inline-flex items-center gap-2 rounded-lg bg-orange-600 hover:bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-md transition-colors"
          >
            <Radio className="h-4 w-4" />
            Start Live
          </button>
          <button
            type="button"
            onClick={onReportIncident}
            data-testid="ops-button-report"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition-colors"
          >
            <ClipboardList className="h-4 w-4" />
            Report
          </button>
        </div>
      </div>

      {visiblePanics.length > 0 && (
        <div className="shrink-0 px-4 pt-2">
          <PanicBanner
            alerts={panicAlerts}
            currentUserId={currentUser?.id}
            dismissedIds={dismissedPanicIds}
            onDismiss={onDismissPanic}
            testIdSuffix="ops"
          />
        </div>
      )}

      {/* ── KPI row ── */}
      <div className="shrink-0 px-3 py-2.5 border-b border-slate-800/80 bg-[#111820]">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <KpiCard
            label="Active Incidents"
            value={liveCount}
            hint={liveCount > 0 ? "tap to open monitor" : "none right now"}
            accent={liveCount > 0 ? "orange" : "green"}
            onClick={() => onOpenLiveMonitor()}
            testId="ops-kpi-active"
            loading={kpiLoading}
          />
          <KpiCard
            label="Responders Online"
            value={onlineCount}
            hint={`${respondingCount} responding`}
            accent="blue"
            testId="ops-kpi-online"
            loading={kpiLoading}
          />
          <KpiCard
            label="Panics Today"
            value={panicsToday}
            hint="since midnight"
            accent={panicsToday > 0 ? "red" : "slate"}
            testId="ops-kpi-panics"
            loading={false}
          />
          <KpiCard
            label="Open Occurrences"
            value={kpiSource?.totalIncidents ?? 0}
            hint="logged today"
            accent="slate"
            onClick={onOpenOccurrenceBook}
            testId="ops-kpi-occurrences"
            loading={kpiLoading}
          />
          <KpiCard
            label="Vehicles Tracked"
            value={liveTrackers.length}
            hint={vehiclesKpiHint}
            accent={liveTrackers.length > 0 ? "blue" : "slate"}
            testId="ops-kpi-vehicles"
            loading={trackersLoading}
          />
        </div>
      </div>

      {/* ── 3-column main area ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden gap-px bg-slate-800/40">
        {/* Left: dispatch queue — hidden when empty */}
        {showQueue && (
        <div
          className="w-[28%] min-w-[220px] max-w-sm flex flex-col border-r border-slate-800/80 bg-[#131a22]"
          data-testid="ops-queue-panel"
        >
          <div className="shrink-0 px-3 py-2 border-b border-slate-800/80 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Live Queue</p>
            <span className="text-[10px] font-medium text-emerald-500/80 tabular-nums">{queueItems.length} active</span>
          </div>
          <div className="flex-1 overflow-y-auto ops-scroll">
              <ul>
                {queueItems.map((inc) => {
                  const locText =
                    inc.destinationName ||
                    inc.locationName ||
                    (inc.locationId ? locations.find((l) => l.id === inc.locationId)?.name : null) ||
                    "Location pending";
                  const starterName = formatStarterName(inc);
                  const joinerCount = (inc.responders ?? []).filter((r) => r.userId !== inc.userId && !r.arrivedAt).length;
                  const gpsAge = formatGpsAge(inc.responderPositionUpdatedAt);
                  const isHighlighted = highlightId === inc.id;
                  const isPanic = (inc.categoryName ?? "").toLowerCase().includes("panic");

                  return (
                    <li key={inc.id} className="border-b border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => {
                          setHighlightId(inc.id);
                          onOpenLiveMonitor(inc.id);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-3 hover:bg-slate-800/60 transition-colors",
                          severityRowAccent(inc.severity, isPanic),
                          isHighlighted && "bg-slate-700/50 ring-1 ring-inset ring-emerald-500/40",
                        )}
                        data-testid={`ops-queue-row-${inc.id}`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {isPanic && <Siren className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                              <p className="font-semibold text-sm text-slate-100 truncate">
                                {inc.categoryName ?? "Incident"}
                              </p>
                              {inc.severity && inc.severity !== "none" && (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded border px-1 py-0 text-[8px] font-bold uppercase",
                                    severityBadgeClass(inc.severity),
                                  )}
                                >
                                  {inc.severity}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500 mt-0.5">#{inc.id}</p>
                            {starterName && (
                              <p className="text-xs text-slate-300 mt-1 truncate">{starterName}</p>
                            )}
                            <p className="text-[11px] text-slate-500 truncate mt-0.5 flex items-center gap-1">
                              <MapPin className="h-3 w-3 shrink-0 text-slate-600" />
                              {locText}
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
                              {inc.liveStartedAt && (
                                <span className="inline-flex items-center gap-0.5">
                                  <Clock className="h-3 w-3" />
                                  {formatGpsAge(inc.liveStartedAt)}
                                </span>
                              )}
                              {gpsAge && <span>GPS {gpsAge}</span>}
                              {joinerCount > 0 && (
                                <span className="text-emerald-500/90 inline-flex items-center gap-0.5">
                                  <Users className="h-3 w-3" />
                                  {joinerCount}
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-slate-600 shrink-0" />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
          </div>
        </div>
        )}

        {/* Centre: map */}
        <div
          className={cn(
            "min-w-0 relative bg-[#0a0e14]",
            showQueue ? "flex-[1_1_48%]" : "flex-1",
          )}
          data-testid="ops-map-panel"
        >
          <LiveIncidentsMap
            incidents={liveIncidents as LiveIncidentMapItem[]}
            onlineUsers={onlineMapUsers}
            trackers={trackerMapMarkers}
            highlightId={highlightId}
            highlightTrackerId={highlightTrackerId}
            onIncidentMarkerClick={setHighlightId}
            onTrackerMarkerClick={setHighlightTrackerId}
            className="absolute inset-0"
            testId="map-ops-dashboard"
            darkTheme
            initialZoom={SA_MAP_DEFAULT.zoom}
            showMapControls
          />
        </div>

        {/* Right: fleet + team */}
        <div
          className="w-[24%] min-w-[200px] max-w-xs flex flex-col justify-end min-h-0 h-full border-l border-slate-800/80 bg-[#131a22]"
          data-testid="ops-side-panel"
        >
          <OpsCollapsibleSection
            title="Fleet"
            icon={Car}
            accentClass="bg-blue-950/30"
            borderClass="border-blue-900/25"
            count={`${liveTrackers.length}/${trackers.length}`}
            open={fleetPanelOpen}
            onToggle={() => setFleetPanelOpen((v) => !v)}
            manageHref="/fleet"
            testId="ops-fleet-panel"
          >
            <div className="flex-1 overflow-y-auto ops-scroll">
              {trackersLoading ? (
                <div className="p-3 space-y-2">
                  <Skeleton className="h-10 bg-slate-800" />
                </div>
              ) : trackers.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-6 px-3">No GPS trackers linked.</p>
              ) : (
                <ul className="divide-y divide-blue-900/20">
                  {trackers.map((device) => {
                    const live = hasTrackerMapPosition(device);
                    const name = trackerDisplayName(device);
                    const isHighlighted = highlightTrackerId === device.id;
                    const speed =
                      device.lastSpeedKph != null ? `${Math.round(device.lastSpeedKph)} km/h` : null;
                    const seen = device.lastSeenAt ? formatGpsAge(device.lastSeenAt) : null;
                    const reg = device.vehicleRegistration?.trim();
                    const assignee = device.assignedUserName?.trim();

                    return (
                      <li key={device.id}>
                        <button
                          type="button"
                          disabled={!live}
                          onClick={() => {
                            setHighlightTrackerId(device.id);
                            setHighlightId(null);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2.5 transition-colors",
                            live ? "hover:bg-blue-950/30" : "opacity-60",
                            isHighlighted && "bg-blue-950/50 ring-1 ring-inset ring-blue-500/40",
                          )}
                          data-testid={`ops-fleet-row-${device.id}`}
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-950/60 border border-blue-800/40">
                              <Car className="h-3.5 w-3.5 text-blue-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-200 truncate">{name}</p>
                              <p className="text-[10px] text-slate-500 truncate">
                                {reg || `…${device.imei.slice(-6)}`}
                              </p>
                              {assignee && (
                                <p className="text-[10px] text-blue-300/80 truncate mt-0.5">{assignee}</p>
                              )}
                              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                <span
                                  className={cn(
                                    "inline-flex rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                                    live
                                      ? "text-blue-300 bg-blue-950/50 border-blue-800/50"
                                      : "text-slate-500 bg-slate-800/50 border-slate-700/50",
                                  )}
                                >
                                  {live ? "Live" : "Offline"}
                                </span>
                                {device.lastIgnitionOn === true && (
                                  <span className="text-[9px] text-amber-400/90 font-medium">ACC on</span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-500 mt-1 truncate">
                                {speed ? `${speed}` : "No speed"}
                                {seen ? ` · ${seen}` : ""}
                              </p>
                            </div>
                          </div>
                        </button>
                        <Link
                          href={`/fleet?device=${device.id}`}
                          className="block px-3 pb-2 text-[10px] text-blue-400/90 hover:underline"
                        >
                          History & details →
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </OpsCollapsibleSection>

          <OpsCollapsibleSection
            title="Team"
            icon={Users}
            accentClass="bg-emerald-950/25"
            borderClass="border-emerald-900/20"
            count={String(teamUsers.length)}
            open={teamPanelOpen}
            onToggle={() => setTeamPanelOpen((v) => !v)}
            testId="ops-team-panel"
            headerExtra={
              teamPanelOpen ? (
                <div className="shrink-0 px-3 pt-2 pb-1 flex gap-1 border-t border-emerald-900/15">
                  {(["all", "responding", "available"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setResponderFilter(f)}
                      className={cn(
                        "flex-1 rounded px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                        responderFilter === f
                          ? "bg-emerald-700/80 text-white"
                          : "bg-slate-800 text-slate-500 hover:text-slate-300",
                      )}
                      data-testid={`ops-filter-${f}`}
                    >
                      {f === "all" ? "All" : f === "responding" ? "Active" : "Avail"}
                    </button>
                  ))}
                </div>
              ) : null
            }
          >
            <div className="flex-1 overflow-y-auto ops-scroll">
              {kpiLoading ? (
                <div className="p-3 space-y-2">
                  <Skeleton className="h-12 bg-slate-800" />
                  <Skeleton className="h-12 bg-slate-800" />
                  <Skeleton className="h-12 bg-slate-800" />
                </div>
              ) : filteredTeam.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-8 px-3">No team members match this filter.</p>
              ) : (
                <ul className="divide-y divide-emerald-900/15">
                  {filteredTeam.map((user) => {
                    const status = responderStatus(user);
                    const statusLabel =
                      status === "responding" ? "Responding" : status === "available" ? "Available" : "Off duty";
                    const statusColor =
                      status === "responding"
                        ? "text-orange-400 bg-orange-950/50 border-orange-800/50"
                        : status === "available"
                          ? "text-emerald-400 bg-emerald-950/40 border-emerald-800/40"
                          : "text-slate-500 bg-slate-800/50 border-slate-700/50";

                    return (
                      <li key={user.id} className="px-3 py-2.5 hover:bg-emerald-950/20">
                        <div className="flex items-start gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-950/40 border border-emerald-800/30 text-xs font-bold text-emerald-200">
                            {user.firstName.charAt(0)}
                            {user.lastName.charAt(0)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-200 truncate">
                              {user.firstName} {user.lastName}
                            </p>
                            <p className="text-[10px] text-slate-500 capitalize">{user.role}</p>
                            <span
                              className={cn(
                                "inline-flex mt-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                                statusColor,
                              )}
                            >
                              {statusLabel}
                            </span>
                            <p className="text-[10px] text-slate-500 mt-1.5 leading-snug truncate">
                              {getUserPresenceHint(user, liveIncidents, locations)}
                            </p>
                            {user.isLive && (
                              <button
                                type="button"
                                className="block mt-1 text-[10px] text-emerald-500 hover:underline"
                                onClick={() => user.liveIncidentId && onOpenLiveMonitor(user.liveIncidentId)}
                              >
                                View incident →
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </OpsCollapsibleSection>
        </div>
      </div>
    </div>
  );
}
