import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  incidentOptionTileClass,
  incidentOptionTileIconClass,
  incidentOptionTileIconWrap,
  incidentOptionTileLabelClass,
  incidentOptionTileSubLabelClass,
} from "@/components/incident-option-tile-styles";

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
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (!next) onChange(null);
        }}
        className={incidentOptionTileClass(open)}
        data-testid="toggle-description"
      >
        <span className={incidentOptionTileIconWrap(open)}>
          <FileText className={incidentOptionTileIconClass} />
        </span>
        <span className={incidentOptionTileLabelClass}>
          Description
          <span className={incidentOptionTileSubLabelClass}>optional</span>
        </span>
      </button>

      {open && (
        <div
          className="rounded-xl border border-border/70 bg-card/40 p-4 space-y-2 shadow-sm"
          data-testid="section-description"
        >
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-primary/70" />
            Incident description
          </Label>
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value || null)}
            placeholder="Describe what happened…"
            className="min-h-[100px] resize-none bg-background border-border/60"
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
