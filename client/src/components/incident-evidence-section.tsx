import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AttachmentWithUploader, EvidenceNoteWithAuthor, EvidencePhase } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { prepareAndUploadFile, UploadValidationError } from "@/lib/upload-media";
import { effectiveEvidencePhase } from "@/lib/evidence-phase";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentPreview, attachmentUploaderLabel, evidenceFootprintLabel } from "@/components/attachment-preview";
import { Camera, FileText, Loader2, MessageSquarePlus, Paperclip, Upload, X } from "lucide-react";

type IncidentEvidenceSectionProps = {
  incidentId: number;
  canAdd?: boolean;
  canDelete?: boolean;
  compact?: boolean;
  /** Split scene (initial) vs supplementary (after-the-fact) evidence with footprints */
  splitPhases?: boolean;
  liveEndedAt?: Date | string | null;
  incidentCreatedAt?: Date | string | null;
};

function noteAuthorLabel(note: EvidenceNoteWithAuthor, phase: EvidencePhase) {
  return evidenceFootprintLabel(
    {
      uploadedByFirstName: note.authorFirstName,
      uploadedByLastName: note.authorLastName,
      createdAt: note.createdAt,
    },
    phase,
  );
}

export function IncidentEvidenceSection({
  incidentId,
  canAdd = true,
  canDelete = false,
  compact = false,
  splitPhases = false,
  liveEndedAt = null,
  incidentCreatedAt = null,
}: IncidentEvidenceSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [showNoteComposer, setShowNoteComposer] = useState(false);

  const incidentTiming = { liveEndedAt, createdAt: incidentCreatedAt };
  const addPhase: EvidencePhase = splitPhases ? "supplementary" : "scene";

  const attachmentsKey = ["/api/incidents", incidentId, "attachments"] as const;
  const notesKey = ["/api/incidents", incidentId, "evidence-notes"] as const;

  const { data: attachments = [], isLoading: attachmentsLoading } = useQuery<AttachmentWithUploader[]>({
    queryKey: attachmentsKey,
    queryFn: async () => {
      const res = await fetch(`/api/incidents/${incidentId}/attachments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load attachments");
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data: notes = [], isLoading: notesLoading } = useQuery<EvidenceNoteWithAuthor[]>({
    queryKey: notesKey,
    queryFn: async () => {
      const res = await fetch(`/api/incidents/${incidentId}/evidence-notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load evidence notes");
      return res.json();
    },
    staleTime: 30_000,
  });

  async function invalidateEvidence() {
    await queryClient.invalidateQueries({ queryKey: attachmentsKey });
    await queryClient.invalidateQueries({ queryKey: notesKey });
    queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
  }

  async function uploadFiles(files: FileList | File[]) {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const { objectUrl, file: processed } = await prepareAndUploadFile(file, { preset: "evidence" });
        await apiRequest("POST", `/api/incidents/${incidentId}/attachments`, {
          url: objectUrl,
          filename: processed.name,
          mimeType: processed.type || "application/octet-stream",
          evidencePhase: addPhase,
        });
      }
      await invalidateEvidence();
      toast({
        title: "Evidence added",
        description: splitPhases
          ? "Your file has been recorded as supplementary evidence with your name and timestamp."
          : "Your file has been attached to this incident.",
      });
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

  async function saveNote() {
    const body = noteDraft.trim();
    if (!body) return;
    setSavingNote(true);
    try {
      await apiRequest("POST", `/api/incidents/${incidentId}/evidence-notes`, {
        body,
        evidencePhase: addPhase,
      });
      setNoteDraft("");
      setShowNoteComposer(false);
      await invalidateEvidence();
      toast({
        title: "Note added",
        description: splitPhases
          ? "Your follow-up note is recorded with your digital footprint."
          : "Your commentary has been recorded on this incident.",
      });
    } catch (err) {
      toast({
        title: "Could not save note",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingNote(false);
    }
  }

  async function handleDeleteAttachment(attachmentId: number) {
    try {
      await apiRequest("DELETE", `/api/attachments/${attachmentId}`);
      await invalidateEvidence();
    } catch {
      toast({ title: "Error", description: "Could not remove attachment.", variant: "destructive" });
    }
  }

  async function handleDeleteNote(noteId: number) {
    try {
      await apiRequest("DELETE", `/api/evidence-notes/${noteId}`);
      await invalidateEvidence();
    } catch {
      toast({ title: "Error", description: "Could not remove note.", variant: "destructive" });
    }
  }

  const isLoading = attachmentsLoading || notesLoading;
  const hasEvidence = notes.length > 0 || attachments.length > 0;

  const sceneAttachments = attachments.filter(
    (a) => effectiveEvidencePhase(a, incidentTiming) === "scene",
  );
  const supplementaryAttachments = attachments.filter(
    (a) => effectiveEvidencePhase(a, incidentTiming) === "supplementary",
  );
  const sceneNotes = notes.filter((n) => effectiveEvidencePhase(n, incidentTiming) === "scene");
  const supplementaryNotes = notes.filter(
    (n) => effectiveEvidencePhase(n, incidentTiming) === "supplementary",
  );

  function renderAddControls(testIdSuffix: string) {
    if (!canAdd) return null;
    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
          className="hidden"
          data-testid={`input-evidence-file-${incidentId}${testIdSuffix}`}
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
          data-testid={`input-evidence-camera-${incidentId}${testIdSuffix}`}
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
            disabled={uploading || savingNote}
            onClick={() => cameraInputRef.current?.click()}
            data-testid={`button-evidence-camera-${incidentId}${testIdSuffix}`}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            Take photo
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={uploading || savingNote}
            onClick={() => fileInputRef.current?.click()}
            data-testid={`button-evidence-upload-${incidentId}${testIdSuffix}`}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Add file
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={uploading || savingNote}
            onClick={() => setShowNoteComposer((v) => !v)}
            data-testid={`button-evidence-note-${incidentId}${testIdSuffix}`}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Add note
          </Button>
        </div>
        {(showNoteComposer || noteDraft.length > 0) && (
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2" data-testid={`composer-evidence-note-${incidentId}`}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              {splitPhases ? "Follow-up note (after the fact)" : "Text evidence / commentary"}
            </p>
            <Textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder={
                splitPhases
                  ? "Supervisor follow-up, witness statements, additional context…"
                  : "Add follow-up details, witness statements, supervisor notes…"
              }
              className="min-h-[88px] resize-none text-sm bg-background"
              maxLength={2000}
              data-testid={`input-evidence-note-${incidentId}`}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">{noteDraft.length}/2000</span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={savingNote}
                  onClick={() => {
                    setNoteDraft("");
                    setShowNoteComposer(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!noteDraft.trim() || savingNote}
                  onClick={() => void saveNote()}
                  data-testid={`button-save-evidence-note-${incidentId}`}
                >
                  {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save note"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  function renderNotesList(items: EvidenceNoteWithAuthor[], phase: EvidencePhase) {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2" data-testid={`evidence-notes-list-${incidentId}-${phase}`}>
        {items.map((note) => (
          <div
            key={note.id}
            className="relative rounded-lg border bg-background p-3 space-y-1.5"
            data-testid={`card-evidence-note-${note.id}`}
          >
            <p className="text-sm whitespace-pre-wrap">{note.body}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">{noteAuthorLabel(note, phase)}</p>
            {canDelete && (
              <button
                type="button"
                onClick={() => void handleDeleteNote(note.id)}
                className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-0.5 hover:opacity-80"
                data-testid={`button-delete-evidence-note-${note.id}`}
                aria-label="Delete note"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }

  function renderAttachmentsGrid(items: AttachmentWithUploader[], phase: EvidencePhase) {
    if (items.length === 0) return null;
    return (
      <div className={compact ? "grid grid-cols-2 gap-2" : "grid grid-cols-2 sm:grid-cols-3 gap-3"}>
        {items.map((att) => (
          <div
            key={att.id}
            className="relative border border-border rounded-md overflow-hidden"
            data-testid={`card-evidence-${att.id}`}
          >
            <AttachmentPreview url={att.url} alt={att.filename} mimeType={att.mimeType} filename={att.filename} />
            <div className="p-1.5 bg-background border-t border-border space-y-0.5">
              <p className="text-xs truncate">{att.filename}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">
                {splitPhases ? evidenceFootprintLabel(att, phase) : attachmentUploaderLabel(att)}
              </p>
            </div>
            {canDelete && (
              <button
                type="button"
                onClick={() => void handleDeleteAttachment(att.id)}
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
    );
  }

  function renderPhaseBlock(
    title: string,
    subtitle: string,
    phaseAttachments: AttachmentWithUploader[],
    phaseNotes: EvidenceNoteWithAuthor[],
    phase: EvidencePhase,
    showAddControls: boolean,
    testIdSuffix: string,
  ) {
    const empty = phaseAttachments.length === 0 && phaseNotes.length === 0;
    return (
      <div className="space-y-3" data-testid={`evidence-phase-${phase}-${incidentId}`}>
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        {showAddControls && renderAddControls(testIdSuffix)}
        {empty && !showAddControls ? (
          <p className="text-sm text-muted-foreground">None recorded.</p>
        ) : empty && showAddControls ? (
          <p className="text-sm text-muted-foreground">Nothing added yet — use the buttons above.</p>
        ) : (
          <div className="space-y-4">
            {renderNotesList(phaseNotes, phase)}
            {renderAttachmentsGrid(phaseAttachments, phase)}
          </div>
        )}
      </div>
    );
  }

  if (splitPhases) {
    return (
      <div className="space-y-6" data-testid={`evidence-section-${incidentId}`}>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading evidence…</p>
        ) : (
          <>
            {renderPhaseBlock(
              "Scene evidence",
              "Photos, files, and notes captured when the incident was first reported or closed on scene.",
              sceneAttachments,
              sceneNotes,
              "scene",
              false,
              "-scene",
            )}
            <div className="border-t border-border/60 pt-4">
              {renderPhaseBlock(
                "Supplementary evidence",
                "Added after the fact — each item records who added it and when (digital footprint).",
                supplementaryAttachments,
                supplementaryNotes,
                "supplementary",
                canAdd,
                "-supplementary",
              )}
            </div>
          </>
        )}
        {!canAdd && hasEvidence && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Paperclip className="h-3 w-3" />
            {sceneAttachments.length + supplementaryAttachments.length} file
            {sceneAttachments.length + supplementaryAttachments.length !== 1 ? "s" : ""}
            {sceneNotes.length + supplementaryNotes.length > 0 &&
              ` · ${sceneNotes.length + supplementaryNotes.length} note${sceneNotes.length + supplementaryNotes.length !== 1 ? "s" : ""}`}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid={`evidence-section-${incidentId}`}>
      {canAdd && renderAddControls("")}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading evidence…</p>
      ) : !hasEvidence ? (
        <p className={`text-muted-foreground ${compact ? "text-sm" : "text-sm"}`}>No evidence added yet.</p>
      ) : (
        <div className="space-y-4">
          {renderNotesList(notes, "supplementary")}
          {renderAttachmentsGrid(attachments, "scene")}
        </div>
      )}
      {!canAdd && hasEvidence && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Paperclip className="h-3 w-3" />
          {notes.length > 0 && `${notes.length} note${notes.length !== 1 ? "s" : ""}`}
          {notes.length > 0 && attachments.length > 0 && " · "}
          {attachments.length > 0 && `${attachments.length} file${attachments.length !== 1 ? "s" : ""}`}
        </p>
      )}
    </div>
  );
}
