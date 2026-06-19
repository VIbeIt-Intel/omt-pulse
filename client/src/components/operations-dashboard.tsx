import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Location } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PanicBanner, type PanicAlert } from "@/components/panic-banner";
import { LiveIncidentsMap, type LiveIncidentMapItem } from "@/components/live-incidents-map";
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
} from "lucide-react";

type Period = "day" | "week";

type DashboardData = {
  totalIncidents: number;
  liveCount: number;
  chartData: Array<{ label: string; count: number }>;
  users: unknown[];
};

type LiveQueueItem = LiveIncidentMapItem & {
  locationId?: number | null;
};

function severityBadgeClass(severity: string | null): string {
  if (severity === "red") return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
  if (severity === "orange") return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30";
  if (severity === "yellow") return "bg-yellow-400/15 text-yellow-800 dark:text-yellow-400 border-yellow-400/30";
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
  return "border-l-4 border-l-border";
}

function formatGpsAge(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const secs = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

function formatStarterName(inc: LiveQueueItem): string | null {
  const name = [inc.responderFirstName, inc.responderLastName].filter(Boolean).join(" ").trim();
  return name || null;
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

function OpsQuickAction({
  label,
  icon: Icon,
  onClick,
  variant,
  testId,
}: {
  label: string;
  icon: typeof Siren;
  onClick: () => void;
  variant: "panic" | "live" | "primary";
  testId: string;
}) {
  const styles =
    variant === "panic"
      ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-500/15"
      : variant === "live"
        ? "border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-300 hover:bg-orange-500/15"
        : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15";
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors",
        styles,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}

function OpsStatTile({
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
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
      <p
        className={cn("text-2xl font-bold tabular-nums", highlight && "text-green-600 dark:text-green-400")}
        data-testid={testId}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        {sublabel}
        {onClick ? <ChevronRight className="h-3 w-3" /> : null}
      </p>
    </>
  );
  if (!onClick) {
    return <Card><CardContent className="p-4">{inner}</CardContent></Card>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-xl border bg-card shadow-sm hover:bg-muted/40 transition-colors p-4 w-full"
      data-testid={`${testId}-button`}
    >
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
  period,
  onPeriodChange,
  dashboardData,
  dashboardLoading,
  totalUnread,
  unreadSenders,
  onOpenChat,
  onOpenLiveMonitor,
  onOpenOccurrenceBook,
  onPanic,
  onStartLive,
  onReportIncident,
}: Props) {
  const [highlightId, setHighlightId] = useState<number | null>(null);

  const { data: commandsData } = useQuery<{
    commands: Array<{ id: number; name: string; isCentral: boolean }>;
    activeCommandId: number | "all" | null;
    canSeeAll: boolean;
  }>({ queryKey: ["/api/me/commands"] });

  const groupLabel = useMemo(() => {
    if (!commandsData) return null;
    if (commandsData.activeCommandId === "all") return "All Groups";
    const cmd = commandsData.commands.find((c) => c.id === commandsData.activeCommandId);
    return cmd ? `${cmd.name}${cmd.isCentral ? " (Central)" : ""}` : null;
  }, [commandsData]);

  const visiblePanics = panicAlerts.filter(
    (a) => !dismissedPanicIds.has(a.id) && !a.panicClosedAt,
  );
  const hasRedLive = liveIncidents.some((i) => i.severity === "red");
  const liveCount = liveIncidents.length;
  const periodLabel = period === "day" ? "Today" : "This Week";
  const monitoringCalm = liveCount === 0 && visiblePanics.length === 0;

  const mapIncidents = liveIncidents as LiveIncidentMapItem[];

  return (
    <div className="flex flex-col h-full min-h-0 bg-background" data-testid="operations-dashboard">
      {/* Alert strip — always visible */}
      <div
        className={cn(
          "shrink-0 border-b px-4 py-2.5 flex flex-wrap items-center gap-3",
          hasRedLive || visiblePanics.length > 0
            ? "bg-red-500/10 border-red-500/30"
            : liveCount > 0
              ? "bg-green-500/10 border-green-500/30"
              : "bg-muted/30 border-border",
        )}
        data-testid="ops-alert-strip"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {monitoringCalm ? (
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
            ) : (
              <>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </>
            )}
          </span>
          <p className="text-sm font-semibold truncate">
            {monitoringCalm
              ? "Monitoring — no active incidents"
              : visiblePanics.length > 0
                ? `${visiblePanics.length} panic alert${visiblePanics.length === 1 ? "" : "s"}`
                : `${liveCount} live incident${liveCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {groupLabel ? <span className="font-medium text-foreground/80">{groupLabel}</span> : null}
          {groupLabel ? <span>·</span> : null}
          <span>{liveCount} live</span>
          <span>·</span>
          <span>{dashboardData?.totalIncidents ?? "—"} {period === "day" ? "today" : "this week"}</span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {totalUnread > 0 && (
            <button
              type="button"
              onClick={onOpenChat}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/15"
              data-testid="ops-strip-unread-chat"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {totalUnread} unread
            </button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1"
            onClick={() => onOpenLiveMonitor()}
            data-testid="ops-open-live-monitor"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Live Monitor
          </Button>
        </div>
      </div>

      {/* Header + quick actions */}
      <div className="shrink-0 px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight" data-testid="text-ops-title">
            Operations
          </h1>
          <p className="text-sm text-muted-foreground">
            {currentUser?.firstName ? `Welcome, ${currentUser.firstName}.` : "Control room overview."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OpsQuickAction label="Panic/SOS" icon={Siren} variant="panic" onClick={onPanic} testId="ops-button-panic" />
          <OpsQuickAction label="Start Live" icon={Radio} variant="live" onClick={onStartLive} testId="ops-button-live" />
          <OpsQuickAction label="Report" icon={ClipboardList} variant="primary" onClick={onReportIncident} testId="ops-button-report" />
        </div>
      </div>

      {visiblePanics.length > 0 && (
        <div className="shrink-0 px-4 pt-3">
          <PanicBanner
            alerts={panicAlerts}
            currentUserId={currentUser?.id}
            dismissedIds={dismissedPanicIds}
            onDismiss={onDismissPanic}
            testIdSuffix="ops"
          />
        </div>
      )}

      {/* Map + queue */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-[1.6] min-w-0 min-h-[280px] border-r relative" data-testid="ops-map-panel">
          <LiveIncidentsMap
            incidents={mapIncidents}
            highlightId={highlightId}
            onIncidentMarkerClick={setHighlightId}
            className="absolute inset-0"
            testId="map-ops-dashboard"
          />
        </div>

        <div className="flex-1 min-w-[280px] max-w-md flex flex-col min-h-0 bg-muted/20" data-testid="ops-queue-panel">
          <div className="shrink-0 px-3 py-2.5 border-b bg-background flex items-center justify-between">
            <p className="text-sm font-semibold">Live queue</p>
            <span className="text-xs text-muted-foreground">refreshes every 15s</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {liveIncidents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 px-6 py-10 text-center">
                <CheckCircle2 className="h-9 w-9 text-green-500" />
                <p className="font-medium text-sm">All clear</p>
                <p className="text-xs text-muted-foreground">No active live incidents right now.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {liveIncidents.map((inc) => {
                  const locText =
                    inc.destinationName ||
                    inc.locationName ||
                    (inc.locationId ? locations.find((l) => l.id === inc.locationId)?.name : null) ||
                    "Location not set";
                  const starterName = formatStarterName(inc);
                  const joinerCount = (inc.responders ?? []).filter((r) => r.userId !== inc.userId).length;
                  const gpsAge = formatGpsAge(inc.responderPositionUpdatedAt);
                  const isHighlighted = highlightId === inc.id;
                  const isPanic = (inc.categoryName ?? "").toLowerCase().includes("panic");

                  return (
                    <li key={inc.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setHighlightId(inc.id);
                          onOpenLiveMonitor(inc.id);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-3 hover:bg-muted/50 transition-colors",
                          severityRowAccent(inc.severity),
                          isHighlighted && "ring-2 ring-inset ring-primary/50 bg-primary/5",
                        )}
                        data-testid={`ops-queue-row-${inc.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="font-semibold text-sm truncate">
                                {inc.categoryName ?? "Live incident"}
                              </p>
                              {inc.severity && inc.severity !== "none" && (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase",
                                    severityBadgeClass(inc.severity),
                                  )}
                                >
                                  <span className={cn("h-1 w-1 rounded-full", severityDotClass(inc.severity))} />
                                  {inc.severity}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground">#{inc.id}</p>
                            {starterName ? (
                              <p className="text-xs text-foreground/90 mt-1 truncate">{starterName}</p>
                            ) : null}
                            <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1">
                              <MapPin className="h-3 w-3 shrink-0" />
                              {locText}
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                              {inc.liveStartedAt && (
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatGpsAge(inc.liveStartedAt) ?? "active"}
                                </span>
                              )}
                              {gpsAge && (
                                <span className={cn("inline-flex items-center gap-1", isPanic && "text-amber-700 dark:text-amber-400")}>
                                  GPS {gpsAge}
                                </span>
                              )}
                              {joinerCount > 0 && (
                                <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                                  <Users className="h-3 w-3" />
                                  {joinerCount} responding
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
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

      {/* Stats strip */}
      <div className="shrink-0 border-t px-4 py-3 bg-background">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center rounded-lg border border-border overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => onPeriodChange("day")}
              className={cn(
                "px-3 py-1.5 font-medium transition-colors",
                period === "day" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
              data-testid="ops-toggle-period-day"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => onPeriodChange("week")}
              className={cn(
                "px-3 py-1.5 font-medium transition-colors border-l border-border",
                period === "week" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
              data-testid="ops-toggle-period-week"
            >
              This Week
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 flex-1 min-w-[240px] max-w-lg">
            {dashboardLoading ? (
              <>
                <Skeleton className="h-20 rounded-xl" />
                <Skeleton className="h-20 rounded-xl" />
              </>
            ) : (
              <>
                <OpsStatTile
                  label={periodLabel}
                  value={dashboardData?.totalIncidents ?? 0}
                  sublabel={`incident${(dashboardData?.totalIncidents ?? 0) === 1 ? "" : "s"} · view book`}
                  onClick={onOpenOccurrenceBook}
                  testId="ops-stat-total-incidents"
                />
                <OpsStatTile
                  label="Currently Live"
                  value={liveCount}
                  sublabel={liveCount > 0 ? "active · open monitor" : "no active incidents"}
                  onClick={() => onOpenLiveMonitor()}
                  highlight={liveCount > 0}
                  testId="ops-stat-live-count"
                />
              </>
            )}
          </div>
          {totalUnread > 0 && unreadSenders.length > 0 && (
            <button
              type="button"
              onClick={onOpenChat}
              className="text-xs text-muted-foreground hover:text-foreground truncate max-w-xs hidden xl:block"
              data-testid="ops-chat-hint"
            >
              Unread from {unreadSenders.slice(0, 3).join(", ")}
              {unreadSenders.length > 3 ? ` +${unreadSenders.length - 3}` : ""}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
