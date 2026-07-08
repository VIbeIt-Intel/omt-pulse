import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Location } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PanicBanner, type PanicAlert } from "@/components/panic-banner";
import { type LiveIncidentMapItem } from "@/components/live-incidents-map";
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
  History,
} from "lucide-react";

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

type TodayIncidentRow = {
  id: number;
  incidentDate: string;
  incidentTime: string;
  isLive: boolean;
  categoryName: string | null;
  locationName: string | null;
  severity: string | null;
  reporterFirstName: string | null;
  reporterLastName: string | null;
};

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

function formatReporterName(inc: TodayIncidentRow): string {
  const name = [inc.reporterFirstName, inc.reporterLastName].filter(Boolean).join(" ").trim();
  return name || "Unknown reporter";
}

function formatIncidentTime(inc: TodayIncidentRow): string {
  if (!inc.incidentTime) return "—";
  const [h, m] = inc.incidentTime.split(":");
  if (h == null || m == null) return inc.incidentTime;
  const d = new Date();
  d.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  const [clock, setClock] = useState(() => new Date());
  const [lastRefresh, setLastRefresh] = useState(() => new Date());

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [clock]);

  const { data: dayDashboard, isLoading: dayLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard", "day"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard?period=day", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: allIncidents = [], isLoading: incidentsLoading } = useQuery<TodayIncidentRow[]>({
    queryKey: ["/api/incidents"],
    queryFn: async () => {
      const res = await fetch("/api/incidents", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load incidents");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setLastRefresh(new Date());
  }, [liveIncidents, panicAlerts, dayDashboard, allIncidents]);

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

  const todayIncidents = useMemo(() => {
    return allIncidents
      .filter((inc) => inc.incidentDate === todayStr)
      .sort((a, b) => {
        const ta = `${a.incidentDate}T${a.incidentTime ?? "00:00"}`;
        const tb = `${b.incidentDate}T${b.incidentTime ?? "00:00"}`;
        return tb.localeCompare(ta);
      });
  }, [allIncidents, todayStr]);

  const todayClosed = useMemo(
    () => todayIncidents.filter((inc) => !inc.isLive),
    [todayIncidents],
  );

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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KpiCard
            label="Active Incidents"
            value={liveCount}
            hint={liveCount > 0 ? "open live monitor" : "none right now"}
            accent={liveCount > 0 ? "orange" : "green"}
            onClick={() => onOpenLiveMonitor()}
            testId="ops-kpi-active"
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
            label="Logged Today"
            value={kpiSource?.totalIncidents ?? todayIncidents.length}
            hint="occurrences today"
            accent="slate"
            onClick={onOpenOccurrenceBook}
            testId="ops-kpi-occurrences"
            loading={kpiLoading || incidentsLoading}
          />
          <KpiCard
            label="Closed Today"
            value={todayClosed.length}
            hint="no longer live"
            accent="blue"
            onClick={onOpenOccurrenceBook}
            testId="ops-kpi-closed"
            loading={incidentsLoading}
          />
        </div>
      </div>

      {/* ── Incidents + today's occurrences ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden gap-px bg-slate-800/40">
        <div
          className="flex-1 min-w-0 flex flex-col border-r border-slate-800/80 bg-[#131a22]"
          data-testid="ops-live-panel"
        >
          <div className="shrink-0 px-3 py-2 border-b border-slate-800/80 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 flex items-center gap-1.5">
              <Radio className="h-3.5 w-3.5 text-orange-400" />
              Live Incidents
            </p>
            <span className="text-[10px] font-medium text-orange-500/80 tabular-nums">
              {queueItems.length} active
            </span>
          </div>
          <div className="flex-1 overflow-y-auto ops-scroll">
            {!showQueue ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-6 py-10 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500/80" />
                <p className="font-semibold text-sm text-slate-300">All clear</p>
                <p className="text-xs text-slate-500">No active live incidents. Team and fleet are on Live Monitor.</p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="mt-2 h-8 text-xs gap-1 bg-slate-800 border-slate-600"
                  onClick={() => onOpenLiveMonitor()}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Live Monitor
                </Button>
              </div>
            ) : (
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
            )}
          </div>
        </div>

        <div
          className="flex-1 min-w-0 flex flex-col bg-[#131a22]"
          data-testid="ops-occurrences-panel"
        >
          <div className="shrink-0 px-3 py-2 border-b border-slate-800/80 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 flex items-center gap-1.5">
              <History className="h-3.5 w-3.5 text-slate-500" />
              Today&apos;s Occurrences
            </p>
            <button
              type="button"
              onClick={onOpenOccurrenceBook}
              className="text-[10px] text-blue-400 hover:underline"
            >
              Full book →
            </button>
          </div>
          <div className="flex-1 overflow-y-auto ops-scroll">
            {incidentsLoading ? (
              <div className="p-3 space-y-2">
                <Skeleton className="h-12 bg-slate-800" />
                <Skeleton className="h-12 bg-slate-800" />
                <Skeleton className="h-12 bg-slate-800" />
              </div>
            ) : todayIncidents.length === 0 ? (
              <p className="text-xs text-slate-600 text-center py-10 px-4">
                No occurrences logged today yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800/80">
                {todayIncidents.map((inc) => {
                  const isLive = inc.isLive;
                  const isPanic = (inc.categoryName ?? "").toLowerCase().includes("panic");
                  return (
                    <li key={inc.id}>
                      <button
                        type="button"
                        onClick={onOpenOccurrenceBook}
                        className={cn(
                          "w-full text-left px-3 py-3 hover:bg-slate-800/50 transition-colors",
                          isLive && "bg-orange-950/15",
                          severityRowAccent(inc.severity, isPanic),
                        )}
                        data-testid={`ops-occurrence-row-${inc.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-medium text-sm text-slate-200 truncate">
                                {inc.categoryName ?? "Incident"}
                              </p>
                              {isLive && (
                                <span className="inline-flex rounded border border-orange-500/40 bg-orange-950/40 px-1 py-0 text-[8px] font-bold uppercase text-orange-300">
                                  Live
                                </span>
                              )}
                              {inc.severity && inc.severity !== "none" && (
                                <span
                                  className={cn(
                                    "inline-flex rounded border px-1 py-0 text-[8px] font-bold uppercase",
                                    severityBadgeClass(inc.severity),
                                  )}
                                >
                                  {inc.severity}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              #{inc.id} · {formatReporterName(inc)}
                            </p>
                            {inc.locationName && (
                              <p className="text-[11px] text-slate-500 truncate mt-0.5 flex items-center gap-1">
                                <MapPin className="h-3 w-3 shrink-0 text-slate-600" />
                                {inc.locationName}
                              </p>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
                            {formatIncidentTime(inc)}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
