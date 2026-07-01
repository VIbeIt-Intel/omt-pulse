import type { Category, FormField } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AttachmentPreview } from "@/components/attachment-preview";
import { IncidentInvolvementSection, INVOLVEMENT_FIELD_KEYS } from "@/components/incident-involvement-section";
import { IncidentReportDescriptionField } from "@/components/incident-report-description-field";
import { IncidentReportMoreDetailsSection } from "@/components/incident-report-more-details-section";
import { IncidentReportSceneEvidenceSection } from "@/components/incident-report-scene-evidence-section";
import { IncidentSapsSection, SapsCaseTile, clearSapsCustomFields, isSapsFormField } from "@/components/incident-saps-section";
import { resolveAttachmentKind } from "@/lib/attachment-kind";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Loader2,
  MapPin,
  Mic,
  Square,
  Upload,
  X,
} from "lucide-react";
import type { RefObject } from "react";

export type ArrivalMediaItem = {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
};

type Props = {
  destinationLabel: string;
  arrivalTime: Date;
  isJoinerMode: boolean;
  description: string;
  onDescriptionChange: (value: string) => void;
  categoryId: number | null;
  onCategoryChange: (id: number | null) => void;
  otherCategoryNote: string;
  onOtherCategoryNoteChange: (value: string) => void;
  categories: Category[];
  media: ArrivalMediaItem[];
  maxMedia: number;
  uploading: boolean;
  uploadSource: "file" | "camera" | "voice" | null;
  isRecording: boolean;
  recordingSeconds: number;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onRemoveMedia: (id: string) => void;
  onPickUpload: () => void;
  onPickCamera: () => void;
  cameraInputRef: RefObject<HTMLInputElement>;
  uploadInputRef: RefObject<HTMLInputElement>;
  onCameraChange: (file: File | undefined) => void;
  onUploadChange: (files: FileList | undefined) => void;
  submitting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  showCategory?: boolean;
  showMoreDetails?: boolean;
  formFields?: FormField[];
  customFields: Record<string, string | number | null | undefined>;
  onCustomFieldsChange: (next: Record<string, string | number | null | undefined>) => void;
  personInvolved: boolean;
  onPersonInvolvedChange: (v: boolean) => void;
  vehicleInvolved: boolean;
  onVehicleInvolvedChange: (v: boolean) => void;
  sapsSectionOpen: boolean;
  onSapsSectionOpenChange: (open: boolean) => void;
};

export function LiveIncidentArrivalForm({
  destinationLabel,
  arrivalTime,
  isJoinerMode,
  description,
  onDescriptionChange,
  categoryId,
  onCategoryChange,
  otherCategoryNote,
  onOtherCategoryNoteChange,
  categories,
  media,
  maxMedia,
  uploading,
  uploadSource,
  isRecording,
  recordingSeconds,
  onStartRecording,
  onStopRecording,
  onRemoveMedia,
  onPickUpload,
  onPickCamera,
  cameraInputRef,
  uploadInputRef,
  onCameraChange,
  onUploadChange,
  submitting,
  onSubmit,
  onCancel,
  showCategory = true,
  showMoreDetails = true,
  formFields = [],
  customFields,
  onCustomFieldsChange,
  personInvolved,
  onPersonInvolvedChange,
  vehicleInvolved,
  onVehicleInvolvedChange,
  sapsSectionOpen,
  onSapsSectionOpenChange,
}: Props) {
  const orgCustomFields = formFields.filter(
    (f) => !f.isSystem && f.isVisible && !INVOLVEMENT_FIELD_KEYS.has(f.fieldKey),
  );
  const sapsCustomFields = orgCustomFields.filter(isSapsFormField);
  const selectedCategory = categoryId != null ? categories.find((c) => c.id === categoryId) : undefined;
  const isOtherCategory = selectedCategory?.name.toLowerCase() === "other";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      style={{ backgroundColor: "hsl(var(--background))" }}
      data-testid="arrival-form"
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-background shrink-0">
        <button
          type="button"
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
          data-testid="button-cancel-arrival"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-tight">Report Incident</p>
          <p className="text-xs text-muted-foreground truncate">{destinationLabel}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-4 pb-2 max-w-lg mx-auto w-full" data-testid="arrival-form-body">
          <div
            className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 space-y-1"
            data-testid="arrival-prefill"
          >
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs font-medium text-primary" data-testid="text-arrival-location">
                  {destinationLabel}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span data-testid="text-arrival-time">
                    {arrivalTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {" · "}
                  <span data-testid="text-arrival-date">
                    {arrivalTime.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </p>
              </div>
            </div>
          </div>

          <IncidentReportDescriptionField
            value={description}
            onChange={(v) => onDescriptionChange(v ?? "")}
            isRecording={isRecording}
            recordingSeconds={recordingSeconds}
            onStartVoice={onStartRecording}
            onStopVoice={onStopRecording}
            voiceBusy={uploading && uploadSource === "voice"}
          />

          <IncidentReportSceneEvidenceSection>
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              className="hidden"
              data-testid="input-arrival-upload"
              onChange={(e) => {
                onUploadChange(e.target.files ?? undefined);
                e.target.value = "";
              }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              data-testid="input-arrival-camera"
              onChange={(e) => {
                onCameraChange(e.target.files?.[0]);
                e.target.value = "";
              }}
            />

            <div className="grid grid-cols-3 gap-2">
              {isRecording ? (
                <button
                  type="button"
                  onClick={onStopRecording}
                  data-testid="button-arrival-stop-voice"
                  className={cn(
                    "col-span-3 flex items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-3.5",
                    "text-destructive animate-pulse active:scale-[0.99] transition-all touch-manipulation",
                  )}
                >
                  <Square className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-semibold">
                    Stop recording ({Math.floor(recordingSeconds / 60)}:
                    {String(recordingSeconds % 60).padStart(2, "0")})
                  </span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onPickUpload}
                    disabled={uploading || media.length >= maxMedia}
                    data-testid="button-arrival-upload"
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 rounded-xl border border-border/70 bg-card px-2 py-3.5",
                      "hover:border-primary/35 hover:bg-muted/35 active:scale-[0.98] transition-all touch-manipulation",
                      "disabled:opacity-50 disabled:pointer-events-none min-h-[4.75rem]",
                    )}
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                      {uploading && uploadSource === "file" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                    </span>
                    <span className="text-[11px] font-medium leading-tight text-center">Upload</span>
                  </button>

                  <button
                    type="button"
                    onClick={onPickCamera}
                    disabled={uploading || media.length >= maxMedia}
                    data-testid="button-arrival-camera"
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 rounded-xl border border-border/70 bg-card px-2 py-3.5",
                      "hover:border-primary/35 hover:bg-muted/35 active:scale-[0.98] transition-all touch-manipulation",
                      "disabled:opacity-50 disabled:pointer-events-none min-h-[4.75rem]",
                    )}
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                      {uploading && uploadSource === "camera" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Camera className="h-4 w-4" />
                      )}
                    </span>
                    <span className="text-[11px] font-medium leading-tight text-center">Photo</span>
                  </button>

                  <button
                    type="button"
                    onClick={onStartRecording}
                    disabled={uploading || media.length >= maxMedia}
                    data-testid="button-arrival-voice"
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 rounded-xl border border-border/70 bg-card px-2 py-3.5",
                      "hover:border-primary/35 hover:bg-muted/35 active:scale-[0.98] transition-all touch-manipulation",
                      "disabled:opacity-50 disabled:pointer-events-none min-h-[4.75rem]",
                    )}
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                      {uploading && uploadSource === "voice" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mic className="h-4 w-4" />
                      )}
                    </span>
                    <span className="text-[11px] font-medium leading-tight text-center">
                      {uploading && uploadSource === "voice" ? "Saving…" : "Voice"}
                    </span>
                  </button>
                </>
              )}
            </div>

            {media.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Ready to submit ({media.length}/{maxMedia})
                </p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {media.map((item, idx) => {
                    const isAudio = resolveAttachmentKind(item.mimeType, item.filename) === "audio";
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "relative rounded-lg border border-primary/25 overflow-hidden bg-card shadow-sm",
                          isAudio && "col-span-3 sm:col-span-4",
                        )}
                        data-testid={`arrival-media-item-${item.id}`}
                      >
                        <AttachmentPreview
                          url={item.url}
                          alt={item.filename}
                          mimeType={item.mimeType}
                          filename={item.filename}
                          compact={!isAudio}
                        />
                        {!isAudio && (
                          <div className="p-1.5 text-[10px] text-center truncate bg-background border-t border-border/60 font-medium">
                            {item.filename}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemoveMedia(item.id)}
                          className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 hover:opacity-80 z-10"
                          aria-label={`Remove media ${idx + 1}`}
                          data-testid={`button-remove-arrival-media-${item.id}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                  {uploading && (
                    <div className="flex items-center justify-center min-h-[5rem] rounded-lg border border-border bg-muted/40">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </IncidentReportSceneEvidenceSection>

          {showMoreDetails && !isJoinerMode ? (
            <IncidentReportMoreDetailsSection>
              {showCategory && categories.length > 0 ? (
                <div className="space-y-2 rounded-xl border border-border/60 bg-background/80 p-3">
                  <p className="text-sm font-semibold text-foreground">Incident type</p>
                  <Select
                    value={categoryId !== null ? String(categoryId) : ""}
                    onValueChange={(v) => {
                      onCategoryChange(v ? Number(v) : null);
                      if (!v || categories.find((c) => c.id === Number(v))?.name.toLowerCase() !== "other") {
                        onOtherCategoryNoteChange("");
                      }
                    }}
                  >
                    <SelectTrigger className="h-10" data-testid="select-arrival-category">
                      <SelectValue placeholder="Select type…" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)} data-testid={`arrival-cat-${c.id}`}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isOtherCategory ? (
                    <Input
                      placeholder="Please specify…"
                      value={otherCategoryNote}
                      onChange={(e) => onOtherCategoryNoteChange(e.target.value)}
                      className="h-9 text-sm"
                      maxLength={100}
                      data-testid="input-arrival-other-type"
                    />
                  ) : null}
                </div>
              ) : null}

              <IncidentInvolvementSection
                customFields={customFields}
                onChange={onCustomFieldsChange}
                personInvolved={personInvolved}
                vehicleInvolved={vehicleInvolved}
                onPersonInvolvedChange={onPersonInvolvedChange}
                onVehicleInvolvedChange={onVehicleInvolvedChange}
                threeColumnTiles={sapsCustomFields.length > 0}
                thirdColumnTile={
                  sapsCustomFields.length > 0 ? (
                    <SapsCaseTile
                      open={sapsSectionOpen}
                      onToggle={() => {
                        const next = !sapsSectionOpen;
                        onSapsSectionOpenChange(next);
                        if (!next) {
                          onCustomFieldsChange(clearSapsCustomFields(sapsCustomFields, customFields));
                        }
                      }}
                    />
                  ) : undefined
                }
              />

              {sapsCustomFields.length > 0 ? (
                <IncidentSapsSection
                  fields={sapsCustomFields}
                  customFields={customFields}
                  onChange={onCustomFieldsChange}
                  hideTile
                  open={sapsSectionOpen}
                  onOpenChange={onSapsSectionOpenChange}
                />
              ) : null}
            </IncidentReportMoreDetailsSection>
          ) : null}
        </div>
      </div>

      <div
        className="shrink-0 px-4 pt-3 pb-4 border-t bg-background space-y-2"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <Button
          size="lg"
          className="w-full font-semibold"
          onClick={onSubmit}
          disabled={submitting}
          data-testid="button-submit-arrival"
        >
          {submitting ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <CheckCircle2 className="h-5 w-5 mr-2" />}
          {isJoinerMode ? "Report Arrival & Leave" : "Report Incident"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          onClick={onCancel}
          disabled={submitting}
          data-testid="button-arrival-cancel-footer"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
