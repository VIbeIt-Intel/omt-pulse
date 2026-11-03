import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  enrichMode?: boolean;
  className?: string;
  title?: string;
  optionalLabel?: string;
  hint?: string;
  enrichHint?: string;
};

/** Prominent optional block for Person / Vehicle / SAPS on Report Incident. */
export function IncidentReportMoreDetailsSection({
  children,
  enrichMode = false,
  className,
  title = "More details",
  optionalLabel = "Optional",
  hint = "Tap to add Person, Vehicle or SAPS case details if relevant.",
  enrichHint = "Add person, vehicle, or SAPS case information for investigations.",
}: Props) {
  return (
    <section
      className={cn(
        "rounded-xl border-2 border-border/80 bg-muted/30 p-4 space-y-4 shadow-sm",
        className,
      )}
      data-testid="section-optional-details"
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold text-foreground">{title}</h3>
          <span className="inline-flex items-center rounded-full border border-border/80 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {optionalLabel}
          </span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {enrichMode ? enrichHint : hint}
        </p>
      </div>
      {children}
    </section>
  );
}
