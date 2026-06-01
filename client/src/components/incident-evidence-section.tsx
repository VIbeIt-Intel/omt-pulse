import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AttachmentWithUploader } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { prepareAndUploadFile, UploadValidationError } from "@/lib/upload-media";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { AttachmentPreview, attachmentUploaderLabel } from "@/components/attachment-preview";
import { Camera, Loader2, Paperclip, Upload, X } from "lucide-react";

type IncidentEvidenceSectionProps = {
  incidentId: number;
  canAdd?: boolean;
  canDelete?: boolean;
  compact?: boolean;
};

export function IncidentEvidenceSection({
  incidentId,
  canAdd = true,
  canDelete = false,
  compact = false,
}: IncidentEvidenceSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const queryKey = ["/api/incidents", incidentId, "attachments"] as const;

  const { data: attachments = [], isLoading } = useQuery<AttachmentWithUploader[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/incidents/${incidentId}/attachments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load attachments");
      return res.json();
    },
    staleTime: 30_000,
  });

  async function uploadFiles(files: FileList | File[]) {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const { objectUrl, file: processed } = await prepareAndUploadFile(file, { preset: "evidence" });
        await apiRequest("POST", `/api/incidents/${incidentId}/attachments`, {
          url: objectUrl,
          filename: processed.name,
          mimeType: processed.type || "application/octet-stream",
        });
      }
      await queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      toast({ title: "Evidence added", description: "Your file has been attached to this incident." });
    } catch (err) {
      const message =
        err instanceof UploadValidationError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not upload evidence";
      toast({ title: "Upload failed", description: message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(attachmentId: number) {
    try {
      await apiRequest("DELETE", `/api/attachments/${attachmentId}`);
      await queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
    } catch {
      toast({ title: "Error", description: "Could not remove attachment.", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-3" data-testid={`evidence-section-${incidentId}`}>
      {canAdd && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
            className="hidden"
            data-testid={`input-evidence-file-${incidentId}`}
            onChange={(e) => {
              if (e.target.files?.length) void uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            data-testid={`input-evidence-camera-${incidentId}`}
            onChange={(e) => {
              if (e.target.files?.length) void uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={uploading}
              onClick={() => cameraInputRef.current?.click()}
              data-testid={`button-evidence-camera-${incidentId}`}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              Take photo
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              data-testid={`button-evidence-upload-${incidentId}`}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Add file
            </Button>
          </div>
        </>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading attachments…</p>
      ) : attachments.length === 0 ? (
        <p className={`text-muted-foreground ${compact ? "text-sm" : "text-sm"}`}>No attachments yet.</p>
      ) : (
        <div className={compact ? "grid grid-cols-2 gap-2" : "grid grid-cols-2 sm:grid-cols-3 gap-3"}>
          {attachments.map((att) => (
            <div
              key={att.id}
              className="relative border border-border rounded-md overflow-hidden"
              data-testid={`card-evidence-${att.id}`}
            >
              <AttachmentPreview url={att.url} alt={att.filename} mimeType={att.mimeType} filename={att.filename} />
              <div className="p-1.5 bg-background border-t border-border space-y-0.5">
                <p className="text-xs truncate">{att.filename}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  {attachmentUploaderLabel(att)}
                </p>
              </div>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => void handleDelete(att.id)}
                  className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 hover:opacity-80"
                  data-testid={`button-delete-evidence-${att.id}`}
                  aria-label="Delete attachment"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!canAdd && attachments.length > 0 && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Paperclip className="h-3 w-3" />
          {attachments.length} attachment{attachments.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
