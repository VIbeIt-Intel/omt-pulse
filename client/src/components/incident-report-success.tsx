import { CheckCircle2, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Incident } from "@shared/schema";

type Props = {
  incident: Incident;
  typeLabel?: string | null;
  onAddDetails: () => void;
  onDone: () => void;
  title?: string;
  incidentWord?: string;
  body?: string;
  notify?: string;
  addMoreLabel?: string;
  doneLabel?: string;
};

export function IncidentReportSuccess({
  incident,
  typeLabel,
  onAddDetails,
  onDone,
  title = "Report sent",
  incidentWord = "Incident",
  body = "is in the occurrence book.",
  notify = "Supervisors and administrators have been notified. You can add person, vehicle, or SAPS details now, or later from the occurrence book.",
  addMoreLabel = "Add more details",
  doneLabel = "Done",
}: Props) {
  const when = `${incident.incidentDate} · ${incident.incidentTime}`;

  return (
    <div
      className="flex flex-col items-center justify-center py-10 px-6 text-center space-y-5"
      data-testid="section-report-success"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15 border-2 border-green-500/30">
        <CheckCircle2 className="h-9 w-9 text-green-600 dark:text-green-400" />
      </div>

      <div className="space-y-2 max-w-sm">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {incidentWord} <span className="font-semibold text-foreground">#{incident.id}</span> {body}
          {typeLabel ? (
            <>
              {" "}
              <span className="text-foreground">{typeLabel}</span>
            </>
          ) : null}
          {" · "}
          {when}
        </p>
        <p className="text-sm text-muted-foreground">
          {notify}
        </p>
      </div>

      <div className="flex flex-col w-full max-w-xs gap-2 pt-2">
        <Button
          type="button"
          variant="default"
          className="gap-2 h-11 bg-primary hover:bg-primary/90"
          onClick={onAddDetails}
          data-testid="button-add-more-details"
        >
          <FilePlus2 className="h-4 w-4" />
          {addMoreLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={onDone}
          data-testid="button-report-done"
        >
          {doneLabel}
        </Button>
      </div>
    </div>
  );
}
