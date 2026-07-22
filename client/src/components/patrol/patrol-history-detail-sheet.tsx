import { useEffect, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PatrolReport } from "@/lib/patrol-types";
import { PatrolHistoryMap } from "@/components/patrol/patrol-history-map";
import { downloadPatrolReportPdf } from "@/lib/patrol-report-pdf";
import { apiUrl } from "@/lib/api-base";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  Footprints,
  Loader2,
  MapPin,
  Route,
  SkipForward,
} from "lucide-react";

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
  const [mapSettled, setMapSettled] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<{ url: string; title: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const { toast } = useToast();

  const { data: report, isLoading, error } = useQuery<PatrolReport>({
    queryKey: ["/api/patrol/patrols", patrolId, "report"],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/patrol/patrols/${patrolId}/report`), { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: open && patrolId != null,
  });

  useEffect(() => {
    if (!open || !report) {
      setMapSettled(false);
      return;
    }
    const t = window.setTimeout(() => setMapSettled(true), 400);
    return () => {
      window.clearTimeout(t);
      setMapSettled(false);
    };
  }, [open, report]);

  async function handleDownload() {
    if (!report) return;
    setDownloading(true);
    try {
      await downloadPatrolReportPdf(report);
      toast({ title: "Report downloaded" });
    } catch (e) {
      toast({
        title: "Download failed",
        description: e instanceof Error ? e.message : "Could not generate PDF",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            "gap-0 p-0 duration-0 data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100",
            // Avoid translate transforms — Google Maps letterboxes inside transformed ancestors.
            "!left-4 !right-4 !top-4 !bottom-4 !translate-x-0 !translate-y-0 sm:!left-[max(2vw,calc(50%-520px))] sm:!right-[max(2vw,calc(50%-520px))] sm:!top-[4vh] sm:!bottom-auto",
            "flex !h-auto max-h-[min(92vh,900px)] w-auto max-w-none flex-col overflow-hidden sm:!h-[min(92vh,900px)]",
          )}
        >
          <DialogHeader className="shrink-0 space-y-1 border-b px-4 py-3 pr-12 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <DialogTitle className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25">
                    <Footprints className="h-4 w-4" />
                  </span>
                  <span className="truncate">{report?.routeName ?? "Patrol report"}</span>
                </DialogTitle>
                <DialogDescription>
                  {report
                    ? `${report.startedByName} · ${report.status.replace("_", " ")}`
                    : "Evidence of checkpoints and the path taken"}
                </DialogDescription>
              </div>
              {report && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5 mr-6"
                  disabled={downloading}
                  onClick={() => void handleDownload()}
                  data-testid="button-download-patrol-report"
                >
                  {downloading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  PDF
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-4 sm:px-6">
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-24 w-full rounded-xl" />
                  <Skeleton className="h-[min(48vh,440px)] min-h-[300px] w-full rounded-xl" />
                  <Skeleton className="h-32 w-full rounded-xl" />
                </div>
              ) : error ? (
                <p className="text-sm text-destructive">
                  {error instanceof Error ? error.message : "Failed to load report"}
                </p>
              ) : report ? (
                <>
                  <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <ReportStat
                      icon={Clock3}
                      label="Duration"
                      value={formatDuration(report.startedAt, report.endedAt)}
                    />
                    <ReportStat
                      icon={Route}
                      label="Distance"
                      value={formatDistance(report.distanceM)}
                    />
                    <ReportStat
                      icon={MapPin}
                      label="Checkpoints"
                      value={`${report.completedCheckpoints}/${report.totalCheckpoints}`}
                    />
                    <ReportStat
                      icon={Footprints}
                      label="Track points"
                      value={String(report.trackPointCount ?? report.trackPoints.length)}
                    />
                  </section>

                  {report.warnings.length > 0 && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-1.5">
                      {report.warnings.map((w) => (
                        <p key={w} className="text-xs text-amber-800 dark:text-amber-200 flex gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          {w}
                        </p>
                      ))}
                    </div>
                  )}

                  <section className="rounded-xl border bg-card/40 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Route map</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Click pins for clock times. Play to replay the walk (or checkpoint hops if no GPS track).
                        </p>
                      </div>
                    </div>
                    <PatrolHistoryMap
                      active={open && mapSettled}
                      checkpoints={report.checkpoints}
                      logs={report.logs}
                      trackPoints={report.trackPoints}
                    />
                  </section>

                  <section className="rounded-xl border bg-card/40 p-4 space-y-3">
                    <div>
                      <p className="text-sm font-semibold">Checkpoint evidence</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Clock times, proximity to the pin, and any photos taken on the run.
                      </p>
                    </div>
                    <ul className="space-y-3">
                      {report.checkpoints.map((cp, index) => {
                        const log = report.logs.find((l) => l.checkpointId === cp.id);
                        const outside = log?.withinGeofence === false;
                        return (
                          <li
                            key={cp.id}
                            className={cn(
                              "rounded-xl border bg-background/50 p-3.5 space-y-2.5",
                              outside && "border-destructive/40",
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5 min-w-0">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
                                  {index + 1}
                                </span>
                                <div className="min-w-0">
                                  <p className="font-medium truncate">{cp.name}</p>
                                  {log ? (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      {new Date(log.clockedAt).toLocaleString()}
                                      {log.distanceM != null
                                        ? ` · ${Math.round(log.distanceM)} m from pin`
                                        : ""}
                                    </p>
                                  ) : (
                                    <p className="text-xs text-muted-foreground mt-0.5">Not clocked</p>
                                  )}
                                </div>
                              </div>
                              {log?.status === "completed" ? (
                                outside ? (
                                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive shrink-0">
                                    Outside
                                  </span>
                                ) : (
                                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                                )
                              ) : log?.status === "missed" ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground shrink-0">
                                  <SkipForward className="h-3.5 w-3.5" />
                                  Missed
                                </span>
                              ) : null}
                            </div>

                            {log?.latitude != null && log.longitude != null && (
                              <div className="grid gap-1 rounded-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                                <p className="tabular-nums">
                                  <span className="text-foreground/80">Clock GPS</span>
                                  <br />
                                  {log.latitude.toFixed(5)}, {log.longitude.toFixed(5)}
                                </p>
                                {cp.latitude != null && cp.longitude != null && (
                                  <p className="tabular-nums">
                                    <span className="text-foreground/80">Planned</span>
                                    <br />
                                    {cp.latitude.toFixed(5)}, {cp.longitude.toFixed(5)}
                                  </p>
                                )}
                              </div>
                            )}

                            {log?.notes && (
                              <p className="text-xs text-muted-foreground">{log.notes}</p>
                            )}

                            {log?.photoUrl && (
                              <button
                                type="button"
                                className="block overflow-hidden rounded-lg border border-border/80 text-left transition-opacity hover:opacity-90"
                                onClick={() =>
                                  setPhotoPreview({ url: log.photoUrl!, title: cp.name })
                                }
                              >
                                <img
                                  src={log.photoUrl}
                                  alt={`${cp.name} evidence`}
                                  className="max-h-48 w-full object-cover sm:max-h-56 sm:w-auto sm:max-w-xs"
                                />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                </>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={photoPreview != null} onOpenChange={(next) => !next && setPhotoPreview(null)}>
        <DialogContent className="max-w-[min(96vw,720px)] gap-3 p-3 sm:p-4">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle className="text-base">{photoPreview?.title ?? "Evidence photo"}</DialogTitle>
            <DialogDescription>Tap outside or press Esc to close.</DialogDescription>
          </DialogHeader>
          {photoPreview && (
            <img
              src={photoPreview.url}
              alt={photoPreview.title}
              className="max-h-[min(70vh,640px)] w-full rounded-lg object-contain bg-muted/30"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReportStat({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border bg-card/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <p className="text-[10px] uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-sm font-semibold mt-1">{value}</p>
    </div>
  );
}
