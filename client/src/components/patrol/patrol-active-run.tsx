import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PatrolDetail, PatrolRouteWithCheckpoints } from "@/lib/patrol-types";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { requestLocationAccess } from "@/lib/request-location-access";
import { prepareAndUploadFile } from "@/lib/upload-media";
import { Camera, CheckCircle2, Loader2, MapPin, SkipForward, XCircle } from "lucide-react";

const ACTIVE_PATROL_KEY = ["/api/patrol/patrols/active"];

type PatrolActiveRunProps = {
  patrol: PatrolDetail;
};

export function PatrolActiveRun({ patrol }: PatrolActiveRunProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const photoRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const loggedIds = new Set(patrol.logs.map((l) => l.checkpointId));
  const nextCheckpoint = patrol.checkpoints.find((cp) => !loggedIds.has(cp.id));
  const progressPct =
    patrol.totalCheckpoints > 0
      ? Math.round((patrol.logs.length / patrol.totalCheckpoints) * 100)
      : 0;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ACTIVE_PATROL_KEY });
    void qc.invalidateQueries({ queryKey: ["/api/patrol/patrols"] });
  };

  const clockMutation = useMutation({
    mutationFn: async (status: "completed" | "missed") => {
      if (!nextCheckpoint) throw new Error("No checkpoint to clock");
      const loc = status === "completed" ? await requestLocationAccess() : { lat: undefined, lng: undefined };
      const res = await apiRequest(
        "POST",
        `/api/patrol/patrols/${patrol.id}/checkpoints/${nextCheckpoint.id}/clock`,
        {
          latitude: loc.lat ?? null,
          longitude: loc.lng ?? null,
          photoUrl: status === "completed" ? photoUrl : null,
          notes: notes.trim() || null,
          status,
        },
      );
      return res.json() as Promise<PatrolDetail>;
    },
    onSuccess: () => {
      toast({ title: "Checkpoint recorded" });
      setNotes("");
      setPhotoPreview(null);
      setPhotoUrl(null);
      invalidate();
    },
    onError: (e: Error) => {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/patrol/patrols/${patrol.id}/complete`, {}),
    onSuccess: () => {
      toast({ title: "Patrol completed" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/patrol/patrols/${patrol.id}/cancel`, {}),
    onSuccess: () => {
      toast({ title: "Patrol cancelled" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  async function handlePhotoChange(file: File | undefined) {
    if (!file) return;
    setPhotoPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const { objectUrl } = await prepareAndUploadFile(file, { preset: "compact" });
      setPhotoUrl(objectUrl);
    } catch (e) {
      toast({
        title: "Photo upload failed",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      });
      setPhotoPreview(null);
      setPhotoUrl(null);
    } finally {
      setUploading(false);
    }
  }

  const busy = clockMutation.isPending || completeMutation.isPending || cancelMutation.isPending || uploading;

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{patrol.routeName}</p>
            <p className="text-xs text-muted-foreground">
              {patrol.logs.length} of {patrol.totalCheckpoints} checkpoints
            </p>
          </div>
          <span className="text-xs font-medium text-primary">In progress</span>
        </div>
        <Progress value={progressPct} className="h-2" />
      </div>

      {nextCheckpoint ? (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-start gap-2">
            <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">{nextCheckpoint.name}</p>
              {nextCheckpoint.instructions && (
                <p className="text-sm text-muted-foreground mt-1">{nextCheckpoint.instructions}</p>
              )}
              {nextCheckpoint.photoRequired && (
                <p className="text-xs text-amber-600 mt-1">Photo required</p>
              )}
            </div>
          </div>

          {nextCheckpoint.photoRequired && (
            <div className="space-y-2">
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void handlePhotoChange(e.target.files?.[0])}
              />
              {photoPreview ? (
                <img src={photoPreview} alt="Checkpoint" className="rounded-md max-h-40 object-cover" />
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => photoRef.current?.click()} disabled={busy}>
                  <Camera className="h-4 w-4 mr-1" />
                  Take photo
                </Button>
              )}
            </div>
          )}

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes"
            rows={2}
          />

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              className="flex-1"
              disabled={busy || (nextCheckpoint.photoRequired && !photoUrl)}
              onClick={() => clockMutation.mutate("completed")}
            >
              {clockMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Clock checkpoint
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => clockMutation.mutate("missed")}
            >
              <SkipForward className="h-4 w-4 mr-1" />
              Mark missed
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 text-center space-y-3">
          <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto" />
          <p className="text-sm font-medium">All checkpoints logged</p>
          <Button type="button" onClick={() => completeMutation.mutate()} disabled={busy}>
            Complete patrol
          </Button>
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive"
        disabled={busy}
        onClick={() => cancelMutation.mutate()}
      >
        <XCircle className="h-4 w-4 mr-1" />
        Cancel patrol
      </Button>

      {patrol.logs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Completed</p>
          <ul className="space-y-1">
            {patrol.logs.map((log) => (
              <li key={log.id} className="text-sm flex items-center gap-2">
                {log.status === "completed" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span>{log.checkpointName}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
