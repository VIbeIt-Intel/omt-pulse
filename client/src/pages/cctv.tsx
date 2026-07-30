import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Video } from "lucide-react";
import type { CctvCameraPublic } from "@shared/cctv";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHero } from "@/components/page-hero";
import { OPS_PAGE_SHELL } from "@/lib/ops-layout";
import { cn } from "@/lib/utils";
import { CctvCameraList } from "@/components/cctv/cctv-camera-list";
import { CctvCameraFormSheet } from "@/components/cctv/cctv-camera-form-sheet";
import { useQueryClient } from "@tanstack/react-query";

export default function CctvPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editCamera, setEditCamera] = useState<CctvCameraPublic | null>(null);

  const { data: me } = useQuery<{ role: string }>({ queryKey: ["/api/auth/me"] });
  const isAdmin = me?.role === "administrator";

  const { data: status } = useQuery<{ ffmpegAvailable: boolean }>({
    queryKey: ["/api/cctv/status"],
  });

  const { data: cameras = [], isLoading } = useQuery<CctvCameraPublic[]>({
    queryKey: ["/api/cctv/cameras"],
  });

  function openAdd() {
    setEditCamera(null);
    setFormOpen(true);
  }

  function openEdit(camera: CctvCameraPublic) {
    setEditCamera(camera);
    setFormOpen(true);
  }

  function onSaved() {
    void queryClient.invalidateQueries({ queryKey: ["/api/cctv/cameras"] });
  }

  return (
    <div className="h-full overflow-y-auto bg-background" data-testid="cctv-page">
      <div className={cn(OPS_PAGE_SHELL, "py-4 sm:py-6 space-y-5")}>
        <PageHero
          eyebrow="Cameras"
          badge="CCTV"
          total={cameras.length}
          totalLabel={cameras.length === 1 ? "camera configured" : "cameras configured"}
          description="Live RTSP feeds converted for browser viewing. Administrators can add and manage cameras."
          emptyMessage="No cameras yet — add your first RTSP source to start monitoring."
          actions={
            isAdmin ? (
              <Button onClick={openAdd} data-testid="cctv-add-camera">
                <Plus className="h-4 w-4 mr-1" />
                Add camera
              </Button>
            ) : undefined
          }
        />

        {status && !status.ffmpegAvailable && (
          <Alert variant="destructive">
            <Video className="h-4 w-4" />
            <AlertTitle>Streaming unavailable</AlertTitle>
            <AlertDescription>
              FFmpeg is not available on this server, so live video cannot be transcoded. Contact your
              platform operator to enable FFmpeg on the OMT Pulse host.
            </AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full max-w-md" />
            <Skeleton className="aspect-video w-full rounded-lg" />
          </div>
        ) : cameras.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
            <Video className="mx-auto h-12 w-12 opacity-30 mb-3" aria-hidden />
            <p className="text-sm">No cameras configured for your organisation.</p>
            {isAdmin && (
              <Button className="mt-4" onClick={openAdd}>
                <Plus className="h-4 w-4 mr-1" />
                Add camera
              </Button>
            )}
          </div>
        ) : (
          <CctvCameraList
            cameras={cameras}
            isAdmin={!!isAdmin}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onEdit={openEdit}
          />
        )}
      </div>

      <CctvCameraFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        camera={editCamera}
        onSaved={onSaved}
      />
    </div>
  );
}
