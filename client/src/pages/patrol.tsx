import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { PatrolRoute } from "@shared/schema";
import { canManagePatrolRoutes } from "@/lib/user-roles";
import type { PatrolDetail, PatrolHistoryItem } from "@/lib/patrol-types";
import { PatrolActiveRun } from "@/components/patrol/patrol-active-run";
import { PatrolRouteAdminSheet } from "@/components/patrol/patrol-route-admin-sheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Footprints, History, Loader2, Plus, Route } from "lucide-react";

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

export default function PatrolPage({ userRole }: PatrolPageProps) {
  const isManager = canManagePatrolRoutes(userRole);
  const [tab, setTab] = useState<"run" | "history">("run");
  const [routeSheetOpen, setRouteSheetOpen] = useState(false);
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
    mutationFn: (routeId: number) => apiRequest("POST", "/api/patrol/patrols", { routeId }),
    onSuccess: () => {
      toast({ title: "Patrol started" });
      void qc.invalidateQueries({ queryKey: ["/api/patrol/patrols/active"] });
      void qc.invalidateQueries({ queryKey: ["/api/patrol/dispatches/pending"] });
      setTab("run");
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
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
              <ul className="p-4 space-y-2">
                {history.map((p) => (
                  <li key={p.id} className="rounded-lg border px-4 py-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{p.routeName}</span>
                      <span className="text-xs capitalize text-muted-foreground">{p.status.replace("_", " ")}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {p.startedByName} · {p.completedCheckpoints}/{p.totalCheckpoints} checkpoints
                    </p>
                  </li>
                ))}
              </ul>
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
    </div>
  );
}
