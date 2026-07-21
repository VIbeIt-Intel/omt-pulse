import { useQuery } from "@tanstack/react-query";
import type { PatrolReport } from "@/lib/patrol-types";
import { PatrolHistoryMap } from "@/components/patrol/patrol-history-map";
import { apiUrl } from "@/lib/api-base";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, MapPin, SkipForward } from "lucide-react";

type PatrolHistoryDetailSheetProps = {
  patrolId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatDuration(startedAt: string | Date, endedAt: string | Date | null | undefined): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
  const mins = Math.round((end - start) / 60_000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function formatDistance(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function PatrolHistoryDetailSheet({
  patrolId,
  open,
  onOpenChange,
}: PatrolHistoryDetailSheetProps) {
  const { data: report, isLoading, error } = useQuery<PatrolReport>({
    queryKey: ["/api/patrol/patrols", patrolId, "report"],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/patrol/patrols/${patrolId}/report`), { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: open && patrolId != null,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[min(92vh,900px)] overflow-y-auto p-0">
        <SheetHeader className="px-4 pt-4 pb-2 border-b text-left">
          <SheetTitle>{report?.routeName ?? "Patrol report"}</SheetTitle>
          <SheetDescription>
            {report
              ? `${report.startedByName} · ${report.status.replace("_", " ")}`
              : "Evidence of checkpoints and the path taken"}
          </SheetDescription>
        </SheetHeader>

        <div className="p-4 space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-56 w-full" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Failed to load report"}
            </p>
          ) : report ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Duration" value={formatDuration(report.startedAt, report.endedAt)} />
                <Stat label="Distance" value={formatDistance(report.distanceM)} />
                <Stat
                  label="Checkpoints"
                  value={`${report.completedCheckpoints}/${report.totalCheckpoints}`}
                />
                <Stat label="Track points" value={String(report.trackPointCount ?? report.trackPoints.length)} />
              </div>

              {report.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1.5">
                  {report.warnings.map((w) => (
                    <p key={w} className="text-xs text-amber-800 dark:text-amber-200 flex gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {w}
                    </p>
                  ))}
                </div>
              )}

              <PatrolHistoryMap
                checkpoints={report.checkpoints}
                logs={report.logs}
                trackPoints={report.trackPoints}
              />

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Checkpoint evidence
                </p>
                <ul className="space-y-2">
                  {report.checkpoints.map((cp) => {
                    const log = report.logs.find((l) => l.checkpointId === cp.id);
                    return (
                      <li key={cp.id} className="rounded-lg border px-3 py-2.5 text-sm space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0">
                            <MapPin className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <p className="font-medium truncate">{cp.name}</p>
                              {log ? (
                                <p className="text-xs text-muted-foreground">
                                  {new Date(log.clockedAt).toLocaleString()}
                                  {log.distanceM != null ? ` · ${Math.round(log.distanceM)} m from pin` : ""}
                                </p>
                              ) : (
                                <p className="text-xs text-muted-foreground">Not clocked</p>
                              )}
                            </div>
                          </div>
                          {log?.status === "completed" ? (
                            log.withinGeofence === false ? (
                              <span className="text-[10px] font-semibold text-destructive shrink-0">Outside</span>
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                            )
                          ) : log?.status === "missed" ? (
                            <SkipForward className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : null}
                        </div>
                        {log?.latitude != null && log.longitude != null && (
                          <p className="text-[11px] text-muted-foreground pl-6">
                            Clock GPS: {log.latitude.toFixed(5)}, {log.longitude.toFixed(5)}
                            {cp.latitude != null && cp.longitude != null
                              ? ` · Planned: ${cp.latitude.toFixed(5)}, ${cp.longitude.toFixed(5)}`
                              : ""}
                          </p>
                        )}
                        {log?.notes && (
                          <p className="text-xs text-muted-foreground pl-6">{log.notes}</p>
                        )}
                        {log?.photoUrl && (
                          <img
                            src={log.photoUrl}
                            alt={`${cp.name} evidence`}
                            className="ml-6 mt-1 max-h-32 rounded-md object-cover"
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold mt-0.5">{value}</p>
    </div>
  );
}
