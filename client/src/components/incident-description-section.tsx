import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  value: string;
  onChange: (value: string | null) => void;
  error?: string;
};

export function IncidentDescriptionSection({ value, onChange, error }: Props) {
  const [open, setOpen] = useState(() => Boolean(value.trim()));

  useEffect(() => {
    if (value.trim()) setOpen(true);
  }, [value]);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (!next) onChange(null);
        }}
        className={`w-full flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-colors touch-manipulation ${
          open
            ? "border-primary bg-primary/10 text-primary"
            : "border-border bg-background text-muted-foreground hover:bg-muted/40"
        }`}
        data-testid="toggle-description"
      >
        <FileText className="h-4 w-4 shrink-0" />
        Description (optional)
      </button>

      {open && (
        <div className="rounded-xl border bg-muted/20 p-4 space-y-2" data-testid="section-description">
          <Label className="text-sm font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Incident description
          </Label>
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value || null)}
            placeholder="Describe what happened…"
            className="min-h-[100px] resize-none bg-background"
            maxLength={500}
            data-testid="input-description"
          />
          <p className="text-xs text-muted-foreground text-right">{value.length}/500</p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
