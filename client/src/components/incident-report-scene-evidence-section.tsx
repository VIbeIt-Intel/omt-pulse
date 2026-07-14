import type { ReactNode } from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  className?: string;
};

/** Scene evidence block — matches More details card styling on Report Incident. */
export function IncidentReportSceneEvidenceSection({ children, className }: Props) {
  return (
    <section
      className={cn(
        "rounded-xl border-2 border-border/80 bg-muted/30 p-4 space-y-4 shadow-sm",
        className,
      )}
      data-testid="section-evidence"
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Paperclip className="h-4 w-4 text-primary shrink-0" />
          <h3 className="text-base font-bold text-foreground">Scene evidence</h3>
          <span className="inline-flex items-center rounded-full border border-border/80 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Optional
          </span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Snap a photo, record a voice note, or attach a file.
        </p>
      </div>
      {children}
    </section>
  );
}
