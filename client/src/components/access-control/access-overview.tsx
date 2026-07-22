import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AccessLogWithDetails } from "@shared/schema";
import { ACCESS_ENTRY_CATEGORIES } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccessVisitDetailSheet } from "@/components/access-control/access-visit-detail-sheet";
import { ACCESS_CATEGORY_LABELS } from "@/lib/access-control-labels";
import { DESTINATION_TYPE_OPTIONS } from "@/lib/access-control-labels";
import {
  accessOverviewQueryKey,
  accessOverviewQueryOptions,
  currentlyInsideQueryKey,
  currentlyInsideQueryOptions,
} from "@/lib/access-control-queries";
import { formatAccessScanSummary } from "@shared/access-scan-data";
import {
  BarChart3,
  Building2,
  Car,
  ChevronRight,
  Clock,
  DoorOpen,
  Download,
  LogOut,
  MapPin,
  Search,
  User,
  Users,
} from "lucide-react";
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

type AccessAnalytics = {
  periodDays: number;
  totalVisits: number;
  uniquePeople: number;
  avgVisitMinutes: number | null;
  byCategory: Record<string, number>;
  hourlyCheckInsToday: number[];
  topDestinations: Array<{ destinationId: number; destinationName: string; count: number }>;
};

type PeriodFilter = "today" | "7d" | "30d";
type StatusFilter = "all" | "inside" | "exited";

function formatTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

function categoryLabel(category: string): string {
  return category in ACCESS_CATEGORY_LABELS
    ? ACCESS_CATEGORY_LABELS[category as keyof typeof ACCESS_CATEGORY_LABELS]
    : category;
}

function destinationTypeLabel(type: string): string {
  return DESTINATION_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

function periodRange(period: PeriodFilter): { from?: Date; label: string } {
  const now = new Date();
  if (period === "today") {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    return { from, label: "Today" };
  }
  const from = new Date(now);
  from.setDate(from.getDate() - (period === "7d" ? 7 : 30));
  from.setHours(0, 0, 0, 0);
  return { from, label: period === "7d" ? "Last 7 days" : "Last 30 days" };
}

function SummaryCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number | string;
  sub?: string;
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
      {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function ActivityRow({
  entry,
  onSelect,
}: {
  entry: AccessLogWithDetails;
  onSelect: (id: number) => void;
}) {
  const exited = entry.status === "exited" && entry.timeOut;
  const scanSummary = formatAccessScanSummary(entry.scanData);

  return (
    <button
      type="button"
      onClick={() => onSelect(entry.id)}
      className="w-full flex items-start gap-3 py-3 border-b border-border/60 last:border-0 text-left hover:bg-muted/30 rounded-md px-1 -mx-1 transition-colors group"
    >
      <div
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
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
        <p className="text-[11px] text-muted-foreground mt-1">
          {formatDate(entry.timeIn)} ·{" "}
          {exited
            ? `In ${formatTime(entry.timeIn)} → Out ${formatTime(entry.timeOut!)}`
            : `In ${formatTime(entry.timeIn)}`}
          {entry.personIdNumber ? ` · ID …${entry.personIdNumber.slice(-4)}` : ""}
        </p>
        {scanSummary && (
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{scanSummary}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span
          className={cn(
            "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full",
            exited ? "text-muted-foreground bg-muted" : "text-primary bg-primary/10",
          )}
        >
          {exited ? "Exited" : "Inside"}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
      </div>
    </button>
  );
}

export function AccessOverview() {
  const [destinationFilter, setDestinationFilter] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [period, setPeriod] = useState<PeriodFilter>("7d");
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const { from: periodFrom, label: periodLabel } = periodRange(period);

  const { data: overview, isLoading: overviewLoading } = useQuery<AccessOverviewResponse>({
    queryKey: accessOverviewQueryKey,
    ...accessOverviewQueryOptions,
  });

  const analyticsDays = period === "today" ? 1 : period === "7d" ? 7 : 30;

  const { data: analytics } = useQuery<AccessAnalytics>({
    queryKey: ["/api/access-control/analytics", analyticsDays],
    queryFn: async () => {
      const res = await fetch(`/api/access-control/analytics?days=${analyticsDays}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load analytics");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: inside = [] } = useQuery<AccessLogWithDetails[]>({
    queryKey: currentlyInsideQueryKey,
    ...currentlyInsideQueryOptions,
  });

  const activityQueryKey = useMemo(
    () => [
      "/api/access-control/activity",
      {
        destinationId: destinationFilter,
        search: search.trim() || undefined,
        status: statusFilter,
        from: periodFrom?.toISOString(),
      },
    ],
    [destinationFilter, search, statusFilter, periodFrom],
  );

  const { data: activity = [], isLoading: activityLoading } = useQuery<AccessLogWithDetails[]>({
    queryKey: activityQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (destinationFilter != null) params.set("destinationId", String(destinationFilter));
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (periodFrom) params.set("from", periodFrom.toISOString());
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

  const categoryMax = useMemo(() => {
    if (!analytics?.byCategory) return 1;
    return Math.max(1, ...Object.values(analytics.byCategory));
  }, [analytics?.byCategory]);

  const hourlyMax = useMemo(() => {
    if (!analytics?.hourlyCheckInsToday) return 1;
    return Math.max(1, ...analytics.hourlyCheckInsToday);
  }, [analytics?.hourlyCheckInsToday]);

  async function downloadReport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (destinationFilter != null) params.set("destinationId", String(destinationFilter));
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (periodFrom) params.set("from", periodFrom.toISOString());
      const res = await fetch(`/api/access-control/report.csv?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `access-report-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

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
    <div className="space-y-5 pb-6 w-full max-w-none" data-testid="access-overview">
      {/* Live stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <SummaryCard
          label="On site now"
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
        />
        <SummaryCard
          label="Vehicles on site"
          value={totals.vehiclesInside}
          icon={Car}
          accent="text-amber-400"
        />
      </div>

      {/* Analytics */}
      {analytics && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Analytics</h2>
                <span className="text-xs text-muted-foreground">({periodLabel})</span>
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>
                  <strong className="text-foreground tabular-nums">{analytics.totalVisits}</strong> visits
                </span>
                <span>
                  <strong className="text-foreground tabular-nums">{analytics.uniquePeople}</strong> people
                </span>
                {analytics.avgVisitMinutes != null && (
                  <span>
                    Avg stay{" "}
                    <strong className="text-foreground tabular-nums">{analytics.avgVisitMinutes}m</strong>
                  </span>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 xl:grid-cols-2 gap-4 lg:gap-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  By category
                </p>
                <div className="space-y-1.5">
                  {ACCESS_ENTRY_CATEGORIES.map((cat) => {
                    const count = analytics.byCategory[cat] ?? 0;
                    if (count === 0 && analytics.totalVisits > 0) return null;
                    return (
                      <div key={cat} className="flex items-center gap-2 text-xs">
                        <span className="w-24 shrink-0 truncate text-muted-foreground">
                          {categoryLabel(cat)}
                        </span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${(count / categoryMax) * 100}%` }}
                          />
                        </div>
                        <span className="w-6 text-right tabular-nums font-medium">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Check-ins by hour (today)
                </p>
                <div className="flex items-end gap-0.5 h-16">
                  {analytics.hourlyCheckInsToday.map((count, hour) => (
                    <div
                      key={hour}
                      className="flex-1 flex flex-col items-center justify-end gap-0.5 min-w-0"
                      title={`${hour}:00 — ${count}`}
                    >
                      <div
                        className="w-full rounded-t bg-primary/60 min-h-[2px]"
                        style={{ height: `${(count / hourlyMax) * 100}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground mt-1 px-0.5">
                  <span>00</span>
                  <span>06</span>
                  <span>12</span>
                  <span>18</span>
                  <span>23</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Locations */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Locations
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
                All locations
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
              No locations configured. Add destinations to track access by site.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            {destinations.map((d) => (
              <button
                key={d.destinationId}
                type="button"
                onClick={() =>
                  setDestinationFilter(
                    destinationFilter === d.destinationId ? null : d.destinationId,
                  )
                }
                className={cn(
                  "text-left rounded-xl border bg-card/80 p-4 transition-all hover:border-primary/40",
                  destinationFilter === d.destinationId && "border-primary ring-1 ring-primary/30",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{d.destinationName}</p>
                    <p className="text-xs text-muted-foreground">
                      {destinationTypeLabel(d.destinationType)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold tabular-nums text-primary">{d.currentlyInside}</p>
                    <p className="text-[10px] text-muted-foreground">on site</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
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
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Currently inside */}
      {inside.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Currently on site ({inside.length})
            </h2>
            <p className="text-xs text-muted-foreground mb-3">Tap a person to view their full visit record</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {inside
                .filter((e) => destinationFilter == null || e.destinationId === destinationFilter)
                .slice(0, 8)
                .map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedEntryId(entry.id)}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                  >
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{entry.personFullName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {entry.destinationName} · since {formatTime(entry.timeIn)}
                      </p>
                    </div>
                  </button>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Activity log with filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold">Visit log</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Search, filter, and open individual records
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => void downloadReport()}
            >
              <Download className="h-4 w-4 mr-1" />
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9 h-10"
                placeholder="Search name or ID number…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-full sm:w-[140px] h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="inside">On site</SelectItem>
                <SelectItem value="exited">Exited</SelectItem>
              </SelectContent>
            </Select>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
              <SelectTrigger className="w-full sm:w-[140px] h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {activityLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No visits match your filters.
            </p>
          ) : (
            <div>
              <p className="text-[11px] text-muted-foreground mb-2">
                {activity.length} record{activity.length === 1 ? "" : "s"} · tap to view details
              </p>
              {activity.map((entry) => (
                <ActivityRow key={entry.id} entry={entry} onSelect={setSelectedEntryId} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AccessVisitDetailSheet
        entryId={selectedEntryId}
        onOpenChange={(open) => {
          if (!open) setSelectedEntryId(null);
        }}
        onSelectEntry={setSelectedEntryId}
      />
    </div>
  );
}
