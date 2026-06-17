import { Loader2, Mic, Square } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (value: string | null) => void;
  error?: string;
  isRecording: boolean;
  recordingSeconds: number;
  onStartVoice: () => void;
  onStopVoice: () => void;
  voiceBusy?: boolean;
};

export function IncidentReportDescriptionField({
  value,
  onChange,
  error,
  isRecording,
  recordingSeconds,
  onStartVoice,
  onStopVoice,
  voiceBusy = false,
}: Props) {
  const timerLabel = `${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, "0")}`;

  return (
    <div className="space-y-2" data-testid="section-description-prominent">
      <Label className="text-sm font-semibold text-foreground">
        What happened?
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">(optional — type or record)</span>
      </Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder="Describe what you saw — who, what, where, when…"
        className={cn(
          "min-h-[140px] resize-none bg-background border-border/70 text-base leading-relaxed",
          "focus-visible:ring-primary/30",
        )}
        maxLength={500}
        data-testid="input-description"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{value.length}/500</p>
        {isRecording ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onStopVoice}
            className="gap-2 animate-pulse"
            data-testid="button-stop-description-voice"
          >
            <Square className="h-4 w-4 shrink-0" />
            Stop voice note ({timerLabel})
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={onStartVoice}
            disabled={voiceBusy}
            className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground border-0 h-10 px-4"
            data-testid="button-description-voice"
          >
            {voiceBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
            Record voice note
          </Button>
        )}
      </div>
      {isRecording && (
        <p className="text-xs text-primary font-medium">
          Recording… Your voice note will be attached as scene evidence when you stop.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
