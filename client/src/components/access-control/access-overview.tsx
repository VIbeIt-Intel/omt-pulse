import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AccessLogWithDetails } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ACCESS_CATEGORY_LABELS } from "@/lib/access-control-labels";
import {
  accessActivityQueryKey,
  accessOverviewQueryKey,
  accessOverviewQueryOptions,
} from "@/lib/access-control-queries";
import { formatAccessScanDetailLines, formatAccessScanSummary } from "@shared/access-scan-data";
import { Car, Clock, DoorOpen, LogOut, MapPin, Users } from "lucide-react";
import { cn } from "@/lib/utils";

type AccessOverviewResponse = {
  totals: {
    currentlyInside: number;
    checkInsToday: number;
    checkOutsToday: number;
    vehiclesInside: number;
  };
  destinations: Array<{
    destinationId: number;
    destinationName: string;
    destinationType: string;
    active: boolean;
    currentlyInside: number;
    checkInsToday: number;
    checkOutsToday: number;
    vehiclesInside: number;
    insideByCategory: Record<string, number>;
  }>;
};

function formatTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function categoryLabel(category: string): string {
  return category in ACCESS_CATEGORY_LABELS
    ? ACCESS_CATEGORY_LABELS[category as keyof typeof ACCESS_CATEGORY_LABELS]
    : category;
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border bg-card/80 px-3 py-3 sm:px-4 sm:py-3.5 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
          {label}
        </span>
        <Icon className={cn("h-3.5 w-3.5 shrink-0", accent ?? "text-muted-foreground")} />
      </div>
      <p className={cn("text-2xl font-bold tabular-nums leading-none", accent)}>{value}</p>
    </div>
  );
}

function ActivityRow({ entry }: { entry: AccessLogWithDetails }) {
  const exited = entry.status === "exited" && entry.timeOut;
  const scanSummary = formatAccessScanSummary(entry.scanData);
  const scanLines = formatAccessScanDetailLines(entry.scanData);
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/60 last:border-0">
      <div
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          exited ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
        )}
      >
        {exited ? <LogOut className="h-4 w-4" /> : <DoorOpen className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="font-medium text-sm truncate">{entry.personFullName}</p>
          <span className="text-[10px] uppercase font-semibold text-muted-foreground">
            {categoryLabel(entry.category)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
          <MapPin className="h-3 w-3 shrink-0" />
          {entry.destinationName}
          {entry.vehicle?.registration ? ` · ${entry.vehicle.registration}` : ""}
        </p>
        <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
          <Clock className="h-3 w-3 shrink-0" />
          {exited
            ? `Out ${formatTime(entry.timeOut!)} · In ${formatTime(entry.timeIn)}`
            : `In since ${formatTime(entry.timeIn)}`}
          {entry.loggedByName ? ` · ${entry.loggedByName}` : ""}
        </p>
        {scanSummary && (
          <p className="text-[11px] text-muted-foreground mt-1">{scanSummary}</p>
        )}
        {scanLines.length > 0 && (
          <details className="mt-1 text-[11px] text-muted-foreground">
            <summary className="cursor-pointer select-none">Scan details</summary>
            <div className="mt-1 space-y-0.5 pl-1 border-l border-border/60">
              {scanLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </details>
        )}
      </div>
      <span
        className={cn(
          "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0",
          exited
            ? "text-muted-foreground bg-muted"
            : "text-primary bg-primary/10",
        )}
      >
        {exited ? "Exited" : "Inside"}
      </span>
    </div>
  );
}

export function AccessOverview() {
  const [destinationFilter, setDestinationFilter] = useState<number | null>(null);

  const { data: overview, isLoading: overviewLoading } = useQuery<AccessOverviewResponse>({
    queryKey: accessOverviewQueryKey,
    ...accessOverviewQueryOptions,
  });

  const { data: activity = [], isLoading: activityLoading } = useQuery<AccessLogWithDetails[]>({
    queryKey: accessActivityQueryKey(destinationFilter ?? undefined),
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "40" });
      if (destinationFilter != null) params.set("destinationId", String(destinationFilter));
      const res = await fetch(`/api/access-control/activity?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load activity");
      return res.json();
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const destinations = useMemo(
    () => overview?.destinations.filter((d) => d.active) ?? [],
    [overview?.destinations],
  );

  if (overviewLoading) {
    return (
      <div className="space-y-4 pb-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!overview) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">Could not load access overview.</p>
    );
  }

  const { totals } = overview;

  return (
    <div className="space-y-5 pb-6" data-testid="access-overview">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <SummaryCard
          label="Inside now"
          value={totals.currentlyInside}
          icon={Users}
          accent="text-primary"
        />
        <SummaryCard
          label="Check-ins today"
          value={totals.checkInsToday}
          icon={DoorOpen}
          accent="text-emerald-400"
        />
        <SummaryCard
          label="Check-outs today"
          value={totals.checkOutsToday}
          icon={LogOut}
          accent="text-muted-foreground"
        />
        <SummaryCard
          label="Vehicles on site"
          value={totals.vehiclesInside}
          icon={Car}
          accent="text-amber-400"
        />
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            By destination
          </h2>
          {destinations.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setDestinationFilter(null)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  destinationFilter == null
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                All
              </button>
              {destinations.map((d) => (
                <button
                  key={d.destinationId}
                  type="button"
                  onClick={() => setDestinationFilter(d.destinationId)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    destinationFilter === d.destinationId
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d.destinationName}
                </button>
              ))}
            </div>
          )}
        </div>

        {destinations.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No destinations configured yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {destinations.map((d) => (
              <Card
                key={d.destinationId}
                className={cn(
                  "overflow-hidden transition-colors",
                  destinationFilter === d.destinationId && "border-primary/50",
                )}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{d.destinationName}</p>
                      <p className="text-xs text-muted-foreground capitalize">{d.destinationType}</p>
                    </div>
                    <span className="text-lg font-bold tabular-nums text-primary">{d.currentlyInside}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-md bg-muted/50 px-2 py-1.5">
                      <p className="text-muted-foreground">In today</p>
                      <p className="font-semibold tabular-nums mt-0.5">{d.checkInsToday}</p>
                    </div>
                    <div className="rounded-md bg-muted/50 px-2 py-1.5">
                      <p className="text-muted-foreground">Out today</p>
                      <p className="font-semibold tabular-nums mt-0.5">{d.checkOutsToday}</p>
                    </div>
                    <div className="rounded-md bg-muted/50 px-2 py-1.5">
                      <p className="text-muted-foreground">Vehicles</p>
                      <p className="font-semibold tabular-nums mt-0.5">{d.vehiclesInside}</p>
                    </div>
                  </div>
                  {Object.keys(d.insideByCategory).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(d.insideByCategory).map(([cat, count]) => (
                        <span
                          key={cat}
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                        >
                          {categoryLabel(cat)} {count}
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold mb-1">Recent activity</h2>
          <p className="text-xs text-muted-foreground mb-3">Latest check-ins across your premises</p>
          {activityLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No entries logged yet.</p>
          ) : (
            <div>{activity.map((entry) => <ActivityRow key={entry.id} entry={entry} />)}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
