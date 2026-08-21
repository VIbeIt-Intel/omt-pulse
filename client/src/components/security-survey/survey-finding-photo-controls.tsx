import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpandablePhoto } from "@/components/photo-lightbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { prepareAndUploadFile, UploadValidationError } from "@/lib/upload-media";
import type { SurveyFinding } from "@/lib/security-survey-types";
import { cn } from "@/lib/utils";

const MAX_PHOTOS = 12;

type Props = {
  surveyId: number;
  finding: SurveyFinding;
  /** Allow gallery/camera add + remove when survey is not archived. */
  canEdit: boolean;
  /** Smaller controls for checklist table cells. */
  compact?: boolean;
  className?: string;
};

/**
 * Evidence thumbnails + post-hoc upload for a survey finding (YES or NO).
 * Reuses POST /api/uploads + PATCH .../findings/:id { photoUrls } (replace semantics).
 */
export function SurveyFindingPhotoControls({
  surveyId,
  finding,
  canEdit,
  compact = false,
  className,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const photoUrls = finding.photos.map((p) => p.objectUrl);
  const atLimit = photoUrls.length >= MAX_PHOTOS;

  const patchPhotos = useMutation({
    mutationFn: async (nextUrls: string[]) => {
      const res = await apiRequest(
        "PATCH",
        `/api/security-surveys/${surveyId}/findings/${finding.id}`,
        { photoUrls: nextUrls },
      );
      return res.json();
    },
    onSuccess: () => {
      // Prefix match covers both numeric and string surveyId query keys.
      void qc.invalidateQueries({ queryKey: ["/api/security-surveys"] });
    },
    onError: (err: Error) =>
      toast({
        title: "Photo update failed",
        description: err.message,
        variant: "destructive",
      }),
  });

  async function onPickFile(file: File) {
    if (!canEdit || atLimit) return;
    setBusy(true);
    try {
      const { objectUrl } = await prepareAndUploadFile(file, { preset: "evidence" });
      await patchPhotos.mutateAsync([...photoUrls, objectUrl]);
      toast({ title: "Photo added" });
    } catch (err) {
      const message =
        err instanceof UploadValidationError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Upload error";
      toast({ title: "Photo failed", description: message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  function removeAt(index: number) {
    if (!canEdit) return;
    const next = photoUrls.filter((_, i) => i !== index);
    patchPhotos.mutate(next);
  }

  const showControls = canEdit;
  const hasPhotos = finding.photos.length > 0;
  if (!hasPhotos && !showControls) return null;

  const thumbClass = compact ? "h-10 w-10 rounded object-cover border" : "h-14 w-14 rounded object-cover border";
  const btnClass = compact ? "h-7 text-[11px] px-2" : "h-7 text-xs";

  return (
    <div className={cn("space-y-1.5", className)} data-testid={`survey-finding-photos-${finding.id}`}>
      {showControls && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid={`survey-finding-upload-${finding.id}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onPickFile(f);
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            data-testid={`survey-finding-camera-${finding.id}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onPickFile(f);
            }}
          />
        </>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {finding.photos.map((p, i) => (
          <div key={p.id} className="relative">
            <ExpandablePhoto
              photoUrl={p.objectUrl}
              className={thumbClass}
              title={finding.prompt}
            />
            {showControls && (
              <button
                type="button"
                className="absolute top-0 right-0 rounded-bl bg-black/60 p-0.5"
                title="Remove photo"
                disabled={busy || patchPhotos.isPending}
                onClick={() => removeAt(i)}
                data-testid={`survey-finding-remove-photo-${finding.id}-${p.id}`}
              >
                <Trash2 className="h-3 w-3 text-white" />
              </button>
            )}
          </div>
        ))}

        {showControls && !atLimit && (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={btnClass}
              disabled={busy || patchPhotos.isPending}
              onClick={() => fileRef.current?.click()}
              data-testid={`survey-finding-add-photo-${finding.id}`}
            >
              {busy || patchPhotos.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Upload className="h-3 w-3 mr-1" />
              )}
              Add photo
            </Button>
            {!compact && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={btnClass}
                disabled={busy || patchPhotos.isPending}
                onClick={() => cameraRef.current?.click()}
                data-testid={`survey-finding-camera-btn-${finding.id}`}
              >
                <Camera className="h-3 w-3 mr-1" />
                Camera
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Post-hoc evidence is for answered YES/NO checkpoints (and NA if present). */
export function findingAllowsEvidencePhotos(answer: string | null | undefined): boolean {
  const a = String(answer ?? "").toLowerCase();
  return a === "yes" || a === "no" || a === "na";
}
