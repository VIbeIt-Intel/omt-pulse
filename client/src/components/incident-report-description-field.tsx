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
    <div
      className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3 shadow-sm"
      data-testid="section-description-prominent"
    >
      <div className="space-y-1">
        <Label className="text-base font-bold text-foreground leading-snug">
          What happened? (type or speak)
        </Label>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Describe who, what, where, when…
        </p>
      </div>

      <div className="rounded-lg border border-border/70 bg-background overflow-hidden shadow-sm">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="Type what you saw here…"
          className={cn(
            "min-h-[180px] resize-none border-0 rounded-none bg-background text-base leading-relaxed px-3.5 py-3",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
          )}
          maxLength={500}
          data-testid="input-description"
        />

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-t border-border/60 bg-muted/25">
          <span className="text-xs text-muted-foreground tabular-nums">{value.length}/500</span>
          {isRecording ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onStopVoice}
              className="gap-2 animate-pulse h-10 px-4 font-semibold"
              data-testid="button-stop-description-voice"
            >
              <Square className="h-4 w-4 shrink-0" />
              Stop ({timerLabel})
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={onStartVoice}
              disabled={voiceBusy}
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground border-0 h-10 px-4 font-semibold shadow-sm"
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
      </div>

      {isRecording && (
        <p className="text-xs text-primary font-medium">
          Recording… Tap Stop when done — your voice note will attach as scene evidence.
        </p>
      )}
      {error && <p className="text-xs text-destructive font-medium">{error}</p>}
    </div>
  );
}
