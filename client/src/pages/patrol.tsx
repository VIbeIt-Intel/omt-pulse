import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { PatrolRoute } from "@shared/schema";
import { canManagePatrolRoutes } from "@/lib/user-roles";
import type { PatrolDetail, PatrolHistoryItem } from "@/lib/patrol-types";
import { PatrolActiveRun } from "@/components/patrol/patrol-active-run";
import { PatrolHistoryDetailSheet } from "@/components/patrol/patrol-history-detail-sheet";
import { PatrolRouteAdminSheet } from "@/components/patrol/patrol-route-admin-sheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { requestLocationAccess } from "@/lib/request-location-access";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Footprints,
  History,
  Loader2,
  MapPin,
  Plus,
  Route,
} from "lucide-react";

type PatrolPageProps = {
  userRole: string;
};

type OrgCommand = { id: number; name: string };

type PendingDispatch = {
  id: number;
  routeId: number;
  status: string;
  startByAt: string;
  routeName: string;
};

function patrolDuration(startedAt: string | Date, endedAt: string | Date | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
  const minutes = Math.max(1, Math.round((end - start) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function patrolDistance(distanceM: number | null): string {
  if (distanceM == null || !Number.isFinite(distanceM)) return "No track";
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return `${(distanceM / 1000).toFixed(2)} km`;
}

function patrolDate(value: string | Date): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function patrolTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PatrolPage({ userRole }: PatrolPageProps) {
  const isManager = canManagePatrolRoutes(userRole);
  const [tab, setTab] = useState<"run" | "history">("run");
  const [routeSheetOpen, setRouteSheetOpen] = useState(false);
  const [historyPatrolId, setHistoryPatrolId] = useState<number | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [location] = useLocation();
  const highlightRouteId = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("routeId");
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }, [location]);

  const { data: activePatrol, isLoading: activeLoading } = useQuery<PatrolDetail | null>({
    queryKey: ["/api/patrol/patrols/active"],
    refetchInterval: 15_000,
  });

  const { data: routes = [], isLoading: routesLoading } = useQuery<PatrolRoute[]>({
    queryKey: ["/api/patrol/routes"],
  });

  const { data: pendingDispatches = [] } = useQuery<PendingDispatch[]>({
    queryKey: ["/api/patrol/dispatches/pending"],
    refetchInterval: 30_000,
  });

  const pendingByRoute = useMemo(() => {
    const map = new Map<number, PendingDispatch>();
    for (const d of pendingDispatches) {
      if (!map.has(d.routeId)) map.set(d.routeId, d);
    }
    return map;
  }, [pendingDispatches]);

  const { data: history = [], isLoading: historyLoading } = useQuery<PatrolHistoryItem[]>({
    queryKey: ["/api/patrol/patrols"],
    enabled: isManager,
  });

  const { data: commands = [] } = useQuery<OrgCommand[]>({
    queryKey: ["/api/commands"],
    enabled: isManager,
  });

  const startMutation = useMutation({
    mutationFn: async (routeId: number) => {
      // Hard gate: do not start a patrol without a live GPS fix. Opens Location /
      // app permission settings when Location is off or blocked.
      const loc = await requestLocationAccess({ probeMode: "settle" });
      if (loc.result !== "granted" || loc.lat == null || loc.lng == null) {
        const msg =
          loc.result === "settings-opened"
            ? loc.message || "Turn on Location, return here, then tap Start again."
            : loc.message || "Location is required to start a patrol.";
        throw new Error(msg);
      }
      return apiRequest("POST", "/api/patrol/patrols", { routeId });
    },
    onSuccess: () => {
      toast({ title: "Patrol started", description: "GPS is on — your route will be recorded." });
      void qc.invalidateQueries({ queryKey: ["/api/patrol/patrols/active"] });
      void qc.invalidateQueries({ queryKey: ["/api/patrol/dispatches/pending"] });
      setTab("run");
    },
    onError: (e: Error) =>
      toast({
        title: "Location required",
        description: e.message,
        variant: "destructive",
      }),
  });

  const loading = activeLoading || routesLoading;
  const sortedRoutes = useMemo(() => {
    return [...routes].sort((a, b) => {
      const aPending = pendingByRoute.has(a.id) ? 0 : 1;
      const bPending = pendingByRoute.has(b.id) ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      if (highlightRouteId != null) {
        if (a.id === highlightRouteId) return -1;
        if (b.id === highlightRouteId) return 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [routes, pendingByRoute, highlightRouteId]);
  const historySummary = useMemo(() => {
    const completed = history.filter((p) => p.status === "completed").length;
    const checkpoints = history.reduce((sum, p) => sum + p.completedCheckpoints, 0);
    const totalCheckpoints = history.reduce((sum, p) => sum + p.totalCheckpoints, 0);
    const distanceM = history.reduce((sum, p) => sum + (p.distanceM ?? 0), 0);
    const alerts = history.reduce((sum, p) => sum + (p.geofenceFailCount ?? 0), 0);
    return { completed, checkpoints, totalCheckpoints, distanceM, alerts };
  }, [history]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 border-b bg-background px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Footprints className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Patrol</h1>
              <p className="text-xs text-muted-foreground">Follow planned routes and clock checkpoints</p>
            </div>
          </div>
          {isManager && (
            <Button type="button" variant="outline" size="sm" onClick={() => setRouteSheetOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Routes
            </Button>
          )}
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "run" | "history")}
        className="flex flex-col flex-1 min-h-0"
      >
        <TabsList className={`mx-4 mt-3 grid shrink-0 ${isManager ? "grid-cols-2" : "grid-cols-1"}`}>
          <TabsTrigger value="run" className="gap-1.5">
            <Route className="h-4 w-4" />
            Run
          </TabsTrigger>
          {isManager && (
            <TabsTrigger value="history" className="gap-1.5">
              <History className="h-4 w-4" />
              History
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="run" className="flex-1 overflow-y-auto mt-0 data-[state=inactive]:hidden">
          {loading ? (
            <div className="p-4 space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : activePatrol ? (
            <PatrolActiveRun patrol={activePatrol} />
          ) : routes.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {isManager
                ? "No patrol routes yet. Tap Routes to create one."
                : "No patrol routes are available for your group."}
            </div>
          ) : (
            <div className="p-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Start a route</p>
              <p className="text-[11px] text-muted-foreground rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                Location must be on before you can start. The app will ask for GPS and open phone Location settings if needed.
              </p>
              {sortedRoutes.map((route) => {
                const pending = pendingByRoute.get(route.id);
                const highlighted = highlightRouteId === route.id || !!pending;
                return (
                  <div
                    key={route.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border px-4 py-3",
                      highlighted && "border-primary/60 bg-primary/5",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{route.name}</p>
                      {pending ? (
                        <p className="text-xs text-primary font-medium mt-0.5">
                          {pending.status === "overdue" ? "Overdue — start now" : "Due now — start patrol"}
                        </p>
                      ) : route.description ? (
                        <p className="text-xs text-muted-foreground line-clamp-2">{route.description}</p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={startMutation.isPending}
                      onClick={() => startMutation.mutate(route.id)}
                    >
                      {startMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {isManager && (
          <TabsContent value="history" className="flex-1 overflow-y-auto mt-0 data-[state=inactive]:hidden">
            {historyLoading ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : history.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">No patrol history yet.</p>
            ) : (
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <HistoryStat
                    icon={CheckCircle2}
                    label="Completed"
                    value={`${historySummary.completed}/${history.length}`}
                  />
                  <HistoryStat
                    icon={MapPin}
                    label="Checkpoints"
                    value={`${historySummary.checkpoints}/${historySummary.totalCheckpoints}`}
                  />
                  <HistoryStat
                    icon={Route}
                    label="Distance"
                    value={patrolDistance(historySummary.distanceM)}
                  />
                  <HistoryStat
                    icon={AlertTriangle}
                    label="GPS alerts"
                    value={String(historySummary.alerts)}
                    warning={historySummary.alerts > 0}
                  />
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Recent patrols
                  </p>
                  <ul className="space-y-2">
                    {history.map((p) => {
                      const hasAlert = (p.geofenceFailCount ?? 0) > 0;
                      const checkpointComplete =
                        p.totalCheckpoints > 0 && p.completedCheckpoints === p.totalCheckpoints;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            className="w-full rounded-lg border px-4 py-3 text-sm text-left hover:bg-muted/40 transition-colors"
                            onClick={() => setHistoryPatrolId(p.id)}
                          >
                            <div className="flex justify-between gap-3 items-start">
                              <div className="min-w-0">
                                <p className="font-medium truncate">{p.routeName}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {p.startedByName}
                                </p>
                              </div>
                              <span className="flex items-center gap-2 shrink-0">
                                <span
                                  className={cn(
                                    "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                                    p.status === "completed"
                                      ? "bg-green-500/10 text-green-700 dark:text-green-400"
                                      : p.status === "cancelled"
                                        ? "bg-destructive/10 text-destructive"
                                        : "bg-muted text-muted-foreground",
                                  )}
                                >
                                  {p.status.replace("_", " ")}
                                </span>
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </span>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                              <HistoryDetail
                                icon={CalendarClock}
                                label="Started"
                                value={`${patrolDate(p.startedAt)} · ${patrolTime(p.startedAt)}`}
                              />
                              <HistoryDetail
                                icon={Clock3}
                                label="Duration"
                                value={patrolDuration(p.startedAt, p.endedAt)}
                              />
                              <HistoryDetail
                                icon={MapPin}
                                label="Checkpoints"
                                value={`${p.completedCheckpoints}/${p.totalCheckpoints}`}
                                good={checkpointComplete}
                              />
                              <HistoryDetail
                                icon={Route}
                                label="Distance"
                                value={patrolDistance(p.distanceM)}
                              />
                            </div>

                            {hasAlert && (
                              <div className="mt-3 flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-[11px] font-medium text-destructive">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                {p.geofenceFailCount} checkpoint
                                {p.geofenceFailCount === 1 ? "" : "s"} clocked outside the allowed radius
                              </div>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      {isManager && (
        <PatrolRouteAdminSheet
          open={routeSheetOpen}
          onOpenChange={setRouteSheetOpen}
          routes={routes}
          commands={commands}
        />
      )}

      {isManager && (
        <PatrolHistoryDetailSheet
          patrolId={historyPatrolId}
          open={historyPatrolId != null}
          onOpenChange={(open) => {
            if (!open) setHistoryPatrolId(null);
          }}
        />
      )}
    </div>
  );
}

type IconComponent = typeof History;

function HistoryStat({
  icon: Icon,
  label,
  value,
  warning = false,
}: {
  icon: IconComponent;
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5", warning && "text-destructive")} />
        {label}
      </div>
      <p className={cn("mt-1 text-base font-semibold", warning && "text-destructive")}>{value}</p>
    </div>
  );
}

function HistoryDetail({
  icon: Icon,
  label,
  value,
  good = false,
}: {
  icon: IconComponent;
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-start gap-1.5">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground", good && "text-green-600")} />
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="block truncate font-medium">{value}</span>
      </span>
    </span>
  );
}
