import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Pencil, ScanSearch, Trash2, Video } from "lucide-react";
import type { CctvAiEventPublic, CctvCameraPublic, CctvRoi } from "@shared/cctv";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { ROTATE180_OSD_HINT } from "@shared/cctv";
import { useToast } from "@/hooks/use-toast";
import { workstationAuthHeaders } from "@/lib/workstation-session";
import { CctvCameraPlayer } from "./cctv-camera-player";

const SEEN_EVENTS_KEY = "omt-cctv-ai-seen-by-camera";
/** Highest AI event id we already surfaced (toasts) — survives page reloads. */
const TOAST_WATERMARK_KEY = "omt-cctv-ai-toast-watermark";

type SeenMap = Record<string, number>;

function loadToastWatermark(): number {
  try {
    const n = Number(localStorage.getItem(TOAST_WATERMARK_KEY));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function saveToastWatermark(id: number) {
  try {
    const prev = loadToastWatermark();
    if (id > prev) localStorage.setItem(TOAST_WATERMARK_KEY, String(id));
  } catch {
    /* ignore */
  }
}

function loadSeenMap(): SeenMap {
  try {
    const raw = localStorage.getItem(SEEN_EVENTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SeenMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveSeenMap(map: SeenMap) {
  try {
    localStorage.setItem(SEEN_EVENTS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

type CctvCameraListProps = {
  cameras: CctvCameraPublic[];
  isAdmin: boolean;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onEdit: (camera: CctvCameraPublic) => void;
};

export function CctvCameraList({
  cameras,
  isAdmin,
  selectedId,
  onSelect,
  onEdit,
}: CctvCameraListProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<CctvCameraPublic | null>(null);
  const [seenByCamera, setSeenByCamera] = useState<SeenMap>(() => loadSeenMap());
  const [fadingEventIds, setFadingEventIds] = useState<Set<number>>(() => new Set());
  const toastedEventIds = useRef<Set<number>>(new Set());
  const recentPrimed = useRef(false);
  const fadeTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/cctv/cameras/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/cctv/cameras"] });
      if (deleteTarget && selectedId === deleteTarget.id) onSelect(null);
      setDeleteTarget(null);
    },
  });
  const [savingVehicleRoi, setSavingVehicleRoi] = useState(false);
  const [snapshotPreview, setSnapshotPreview] = useState<{
    url: string;
    label: string;
    confidence: number;
    createdAt: string;
  } | null>(null);

  const selected = cameras.find((c) => c.id === selectedId) ?? null;
  const anyAiEnabled = cameras.some((c) => c.aiEnabled);

  async function saveVehicleRoi(roi: CctvRoi | null) {
    if (!selected) return;
    setSavingVehicleRoi(true);
    try {
      await apiRequest("PATCH", `/api/cctv/cameras/${selected.id}`, { vehicleRoi: roi });
      void queryClient.invalidateQueries({ queryKey: ["/api/cctv/cameras"] });
    } finally {
      setSavingVehicleRoi(false);
    }
  }

  const { data: recentAiEvents = [], isFetched: recentAiEventsFetched } = useQuery<CctvAiEventPublic[]>({
    queryKey: ["/api/cctv/ai/events/recent"],
    queryFn: async () => {
      const res = await fetch("/api/cctv/ai/events/recent", {
        credentials: "include",
        cache: "no-store",
        headers: workstationAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to load recent AI events");
      return res.json();
    },
    enabled: anyAiEnabled,
    refetchInterval: anyAiEnabled ? 4000 : false,
  });

  const { data: aiEvents = [] } = useQuery<CctvAiEventPublic[]>({
    queryKey: ["/api/cctv/cameras", selected?.id, "ai", "events"],
    queryFn: async () => {
      const res = await fetch(`/api/cctv/cameras/${selected!.id}/ai/events`, {
        credentials: "include",
        cache: "no-store",
        headers: workstationAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to load AI events");
      return res.json();
    },
    enabled: !!selected?.aiEnabled,
    refetchInterval: selected?.aiEnabled ? 3000 : false,
  });

  const eventsByCamera = useMemo(() => {
    const map = new Map<number, CctvAiEventPublic[]>();
    for (const ev of recentAiEvents) {
      const list = map.get(ev.cameraId) ?? [];
      list.push(ev);
      map.set(ev.cameraId, list);
    }
    return map;
  }, [recentAiEvents]);

  function markCameraSeen(cameraId: number, latestEventId?: number) {
    const events = eventsByCamera.get(cameraId) ?? [];
    const maxId = latestEventId ?? (events.length ? Math.max(...events.map((e) => e.id)) : 0);
    if (!maxId) return;
    setSeenByCamera((prev) => {
      const key = String(cameraId);
      if ((prev[key] ?? 0) >= maxId) return prev;
      const next = { ...prev, [key]: maxId };
      saveSeenMap(next);
      return next;
    });
  }

  function unreadCount(cameraId: number): number {
    const events = eventsByCamera.get(cameraId) ?? [];
    const seenId = seenByCamera[String(cameraId)] ?? 0;
    return events.filter((e) => e.id > seenId).length;
  }

  function acknowledgeSidebarAlert(cam: CctvCameraPublic, ev: CctvAiEventPublic) {
    if (fadingEventIds.has(ev.id)) return;
    setFadingEventIds((prev) => {
      const next = new Set(prev);
      next.add(ev.id);
      return next;
    });
    onSelect(cam.id);
    markCameraSeen(cam.id, ev.id);
    if (ev.snapshotUrl) {
      setSnapshotPreview({
        url: ev.snapshotUrl,
        label: ev.label,
        confidence: ev.confidence,
        createdAt: ev.createdAt,
      });
    }
    const existing = fadeTimers.current.get(ev.id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setFadingEventIds((prev) => {
        const next = new Set(prev);
        next.delete(ev.id);
        return next;
      });
      fadeTimers.current.delete(ev.id);
    }, 900);
    fadeTimers.current.set(ev.id, timer);
  }

  useEffect(() => {
    const timers = fadeTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!anyAiEnabled || !recentAiEventsFetched) return;

    if (!recentPrimed.current) {
      let maxId = loadToastWatermark();
      for (const ev of recentAiEvents) {
        toastedEventIds.current.add(ev.id);
        maxId = Math.max(maxId, ev.id);
      }
      saveToastWatermark(maxId);
      recentPrimed.current = true;
      return;
    }

    const watermark = loadToastWatermark();
    const now = Date.now();
    const fresh = recentAiEvents.filter((ev) => {
      if (ev.id <= watermark || toastedEventIds.current.has(ev.id)) return false;
      // Never toast weak / historical rows (matches ~50%+ alert policy).
      if (!(ev.confidence >= 0.5)) return false;
      const ageMs = now - new Date(ev.createdAt).getTime();
      if (!Number.isFinite(ageMs) || ageMs > 60_000) return false;
      return true;
    });
    for (const ev of fresh) {
      toastedEventIds.current.add(ev.id);
      saveToastWatermark(ev.id);
      const cam = cameras.find((c) => c.id === ev.cameraId);
      toastRef.current({
        title: ev.label === "person" ? "Person detected" : "Vehicle detected",
        description: `${cam?.name ?? `Camera ${ev.cameraId}`}: ${ev.label} (${Math.round(ev.confidence * 100)}%)`,
      });
    }
    // Advance watermark past anything already in the feed so reload never replays it.
    const maxSeen = recentAiEvents.reduce((m, ev) => Math.max(m, ev.id), watermark);
    saveToastWatermark(maxSeen);
  }, [recentAiEvents, recentAiEventsFetched, anyAiEnabled, cameras]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,280px)_1fr]">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground px-1">
          Cameras ({cameras.length})
        </p>
        <ul className="space-y-1.5" data-testid="cctv-camera-list">
          {cameras.map((cam) => {
            const active = cam.id === selectedId;
            const camEvents = eventsByCamera.get(cam.id) ?? [];
            const seenId = seenByCamera[String(cam.id)] ?? 0;
            const latestUnread = camEvents.find((e) => e.id > seenId) ?? null;
            const fadingEvent =
              camEvents.find((e) => fadingEventIds.has(e.id)) ??
              (latestUnread && fadingEventIds.has(latestUnread.id) ? latestUnread : null);
            const notice = fadingEvent ?? latestUnread;
            const isFading = !!(notice && fadingEventIds.has(notice.id));
            const unread = cam.aiEnabled ? unreadCount(cam.id) : 0;
            return (
              <li key={cam.id} className="space-y-1">
                <button
                  type="button"
                  onClick={() => onSelect(active ? null : cam.id)}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                    active
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-accent/50",
                    unread > 0 && !active && "border-amber-500/50",
                  )}
                  data-testid={`cctv-camera-item-${cam.id}`}
                >
                  <Video className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span className="flex-1 truncate font-medium">{cam.name}</span>
                  {unread > 0 && (
                    <span
                      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-black"
                      aria-label={`${unread} new AI alerts`}
                    >
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                  {cam.aiEnabled && (
                    <BrainCircuit className="h-4 w-4 shrink-0 text-emerald-500" aria-label="AI enabled" />
                  )}
                  {cam.vehicleRoi && (
                    <ScanSearch
                      className="h-4 w-4 shrink-0 text-cyan-500"
                      aria-label="Vehicle zone active"
                    />
                  )}
                  {cam.isPtz && (
                    <ScanSearch className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="PTZ camera" />
                  )}
                </button>
                {cam.aiEnabled && notice && (
                  <button
                    type="button"
                    className={cn(
                      "ml-1 flex w-[calc(100%-0.25rem)] items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[11px] transition-all duration-700",
                      isFading
                        ? "border-border/40 bg-muted/20 text-muted-foreground/50 opacity-40 scale-[0.98]"
                        : "border-amber-500/40 bg-amber-500/10 text-muted-foreground hover:bg-amber-500/15",
                    )}
                    onClick={() => acknowledgeSidebarAlert(cam, notice)}
                    disabled={isFading}
                    aria-label={
                      isFading
                        ? "Alert acknowledged"
                        : `Open ${notice.label} alert`
                    }
                  >
                    {notice.snapshotUrl ? (
                      <img
                        src={notice.snapshotUrl}
                        alt=""
                        className={cn(
                          "h-8 w-8 shrink-0 rounded border object-cover transition-opacity duration-700",
                          isFading && "opacity-40",
                        )}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className={cn("capitalize", isFading ? "text-muted-foreground/60" : "text-foreground/90")}>
                        {notice.label}
                      </span>
                      <span> · {Math.round(notice.confidence * 100)}%</span>
                      {isFading ? (
                        <span className="ml-1 text-[10px] uppercase tracking-wide">Seen</span>
                      ) : null}
                      <span className="block truncate tabular-nums">
                        {new Date(notice.createdAt).toLocaleString()}
                      </span>
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="min-w-0 space-y-3">
        {selected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold truncate">{selected.name}</h2>
              {isAdmin && (
                <div className="flex gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(selected)}
                    data-testid="cctv-edit-camera"
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(selected)}
                    data-testid="cctv-delete-camera"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Remove
                  </Button>
                </div>
              )}
            </div>
            <CctvCameraPlayer
              cameraId={selected.id}
              cameraName={selected.name}
              showPtz={selected.isPtz}
              aiEnabled={selected.aiEnabled}
              vehicleRoi={selected.vehicleRoi}
              canEditVehicleRoi={isAdmin}
              savingVehicleRoi={savingVehicleRoi}
              onSaveVehicleRoi={saveVehicleRoi}
            />
            {selected.aiEnabled && (
              <div className="rounded-lg border p-3 space-y-2" data-testid="cctv-ai-events">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Recent AI alerts
                </p>
                {aiEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No AI alerts yet. Detection runs every 2.5 seconds for people and vehicles while AI
                    is enabled and the stream is active.
                  </p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {aiEvents.slice(0, 8).map((ev) => (
                      <li key={ev.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                        <div className="flex min-w-0 items-center gap-3">
                          {ev.snapshotUrl ? (
                            <button
                              type="button"
                              className="h-12 w-12 shrink-0 overflow-hidden rounded border bg-muted ring-offset-background transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() =>
                                setSnapshotPreview({
                                  url: ev.snapshotUrl!,
                                  label: ev.label,
                                  confidence: ev.confidence,
                                  createdAt: ev.createdAt,
                                })
                              }
                              aria-label={`View ${ev.label} snapshot`}
                            >
                              <img
                                src={ev.snapshotUrl}
                                alt=""
                                className="h-full w-full object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            </button>
                          ) : (
                            <div className="h-12 w-12 shrink-0 rounded border bg-muted/50" />
                          )}
                          <span className="min-w-0 capitalize">
                            {ev.label}{" "}
                            <span className="text-muted-foreground">
                              ({Math.round(ev.confidence * 100)}%)
                            </span>
                          </span>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {new Date(ev.createdAt).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {selected.streamRotation === "rotate180" && (
              <Alert>
                <AlertDescription className="text-sm leading-relaxed space-y-3">
                  <p>{ROTATE180_OSD_HINT}</p>
                </AlertDescription>
              </Alert>
            )}
            {selected.streamRotation === "normal" && (
              <Alert>
                <AlertDescription className="text-sm leading-relaxed space-y-3">
                  <p>
                    Orientation is Normal. If the live picture is upside down, open Edit and choose{" "}
                    <strong>Rotate 180 degrees</strong>, then refresh the stream. That uprights the
                    scene (the burned-in EZVIZ timestamp may then appear inverted until you flip the
                    image in the EZVIZ app).
                  </p>
                  {isAdmin && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      data-testid="cctv-set-rotate180"
                      onClick={async () => {
                        try {
                          await apiRequest("PATCH", `/api/cctv/cameras/${selected.id}`, {
                            streamRotation: "rotate180",
                          });
                          void queryClient.invalidateQueries({ queryKey: ["/api/cctv/cameras"] });
                        } catch {
                          void queryClient.invalidateQueries({ queryKey: ["/api/cctv/cameras"] });
                        }
                      }}
                    >
                      Rotate picture 180°
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </>
        ) : (
          <Card className="flex flex-col items-center justify-center gap-2 border-dashed py-16 text-center text-muted-foreground">
            <Video className="h-10 w-10 opacity-40" aria-hidden />
            <p className="text-sm">Select a camera to view the live stream.</p>
          </Card>
        )}
      </div>

      <Dialog
        open={!!snapshotPreview}
        onOpenChange={(open) => {
          if (!open) setSnapshotPreview(null);
        }}
      >
        <DialogContent className="max-w-[min(92vw,36rem)] gap-0 overflow-hidden border-border/60 bg-zinc-950 p-0 text-zinc-50 sm:rounded-xl">
          {snapshotPreview && (
            <>
              <DialogHeader className="space-y-1 border-b border-white/10 px-4 py-3 pr-12 text-left">
                <DialogTitle className="capitalize text-base text-zinc-50">
                  {snapshotPreview.label}{" "}
                  <span className="font-normal text-zinc-400">
                    ({Math.round(snapshotPreview.confidence * 100)}%)
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-zinc-400">
                  {new Date(snapshotPreview.createdAt).toLocaleString()}
                </DialogDescription>
              </DialogHeader>
              <div className="flex min-h-[280px] items-center justify-center bg-black px-3 py-4 sm:min-h-[360px] sm:px-4">
                <img
                  src={snapshotPreview.url}
                  alt={`${snapshotPreview.label} detection`}
                  className="max-h-[min(72vh,560px)] w-full object-contain"
                  decoding="async"
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove camera?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `"${deleteTarget.name}" will be removed. This does not change the physical device.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
