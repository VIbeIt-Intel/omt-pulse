import { useEffect, useRef, useState } from "react";
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
  const seenEventIds = useRef<Set<number>>(new Set());
  const primedEvents = useRef(false);

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

  useEffect(() => {
    primedEvents.current = false;
    seenEventIds.current = new Set();
  }, [selected?.id]);

  useEffect(() => {
    if (!selected?.aiEnabled) return;
    if (!primedEvents.current) {
      for (const ev of aiEvents) seenEventIds.current.add(ev.id);
      primedEvents.current = true;
      return;
    }
    const fresh = aiEvents.filter((ev) => !seenEventIds.current.has(ev.id));
    for (const ev of fresh) {
      seenEventIds.current.add(ev.id);
      toast({
        title: ev.label === "person" ? "Person detected" : "Vehicle detected",
        description: `${selected.name}: ${ev.label} (${Math.round(ev.confidence * 100)}%)`,
      });
    }
  }, [aiEvents, selected, toast]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,280px)_1fr]">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground px-1">
          Cameras ({cameras.length})
        </p>
        <ul className="space-y-1.5" data-testid="cctv-camera-list">
          {cameras.map((cam) => {
            const active = cam.id === selectedId;
            return (
              <li key={cam.id}>
                <button
                  type="button"
                  onClick={() => onSelect(active ? null : cam.id)}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                    active
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-accent/50",
                  )}
                  data-testid={`cctv-camera-item-${cam.id}`}
                >
                  <Video className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span className="flex-1 truncate font-medium">{cam.name}</span>
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
        <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden sm:max-w-md">
          {snapshotPreview && (
            <>
              <DialogHeader className="px-4 pt-4 pb-2 space-y-1">
                <DialogTitle className="capitalize text-base">
                  {snapshotPreview.label} ({Math.round(snapshotPreview.confidence * 100)}%)
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {new Date(snapshotPreview.createdAt).toLocaleString()}
                </DialogDescription>
              </DialogHeader>
              <div className="px-4 pb-4 flex justify-center bg-muted/30">
                <img
                  src={snapshotPreview.url}
                  alt={`${snapshotPreview.label} detection`}
                  className="max-h-[min(70vh,480px)] w-auto max-w-full rounded border object-contain image-rendering-auto"
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
