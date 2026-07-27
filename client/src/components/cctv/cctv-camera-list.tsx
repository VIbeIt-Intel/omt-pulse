import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, ScanSearch, Trash2, Video } from "lucide-react";
import type { CctvCameraPublic } from "@shared/cctv";
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
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { ROTATE180_OSD_HINT } from "@shared/cctv";
import { CctvCameraPlayer } from "./cctv-camera-player";
import { CctvPtzControls } from "./cctv-ptz-controls";

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
  const [deleteTarget, setDeleteTarget] = useState<CctvCameraPublic | null>(null);

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

  const selected = cameras.find((c) => c.id === selectedId) ?? null;

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
                  {cam.isPtz && <ScanSearch className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="PTZ camera" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="min-w-0 space-y-3">
        {selected ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                <p className="text-xs text-muted-foreground font-mono truncate max-w-xl">
                  {selected.rtspPreview}
                </p>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {selected.streamRotation === "rotate180" && (
                    <span className="rounded-full border px-2 py-0.5">Rotated 180 degrees</span>
                  )}
                  {selected.isPtz && <span className="rounded-full border px-2 py-0.5">PTZ</span>}
                </div>
              </div>
              {isAdmin && (
                <div className="flex gap-2">
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
            <CctvCameraPlayer cameraId={selected.id} cameraName={selected.name} />
            {selected.streamRotation === "rotate180" && (
              <Alert>
                <AlertDescription className="text-sm leading-relaxed space-y-3">
                  <p>{ROTATE180_OSD_HINT}</p>
                  {isAdmin && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      data-testid="cctv-fix-timestamp"
                      onClick={async () => {
                        try {
                          await apiRequest("POST", `/api/cctv/cameras/${selected.id}/fix-timestamp`, {});
                          void queryClient.invalidateQueries({ queryKey: ["/api/cctv/cameras"] });
                        } catch {
                          /* toast handled by apiRequest throw — still refresh list */
                          void queryClient.invalidateQueries({ queryKey: ["/api/cctv/cameras"] });
                        }
                      }}
                    >
                      Fix timestamp (camera flip + Normal)
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {selected.isPtz && <CctvPtzControls cameraId={selected.id} />}
          </>
        ) : (
          <Card className="flex flex-col items-center justify-center gap-2 border-dashed py-16 text-center text-muted-foreground">
            <Video className="h-10 w-10 opacity-40" aria-hidden />
            <p className="text-sm">Select a camera to view the live stream.</p>
          </Card>
        )}
      </div>

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
