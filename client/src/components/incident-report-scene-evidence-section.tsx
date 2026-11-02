import type { ReactNode } from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  className?: string;
  title?: string;
  optionalLabel?: string;
  hint?: string;
  vuur?: boolean;
};

/** Scene evidence block — matches More details card styling on Report Incident. */
export function IncidentReportSceneEvidenceSection({
  children,
  className,
  title = "Scene evidence",
  optionalLabel = "Optional",
  hint = "Snap a photo, record a voice note, or attach a file.",
  vuur = false,
}: Props) {
  return (
    <section
      className={cn(
        "rounded-xl border-2 p-4 space-y-4 shadow-sm",
        vuur ? "border-orange-500/40 bg-orange-500/10" : "border-border/80 bg-muted/30",
        className,
      )}
      data-testid="section-evidence"
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Paperclip className={cn("h-4 w-4 shrink-0", vuur ? "text-orange-500" : "text-primary")} />
          <h3 className="text-base font-bold text-foreground">{title}</h3>
          <span className="inline-flex items-center rounded-full border border-border/80 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {optionalLabel}
          </span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {hint}
        </p>
      </div>
      {children}
    </section>
  );
}
