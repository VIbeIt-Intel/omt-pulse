import { useLocation } from "wouter";
import { ChevronRight, MapPin, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

export type JoinableLiveIncident = {
  id: number;
  categoryName: string | null;
  severity: string | null;
  destinationName: string | null;
  locationName: string | null;
  responderFirstName: string | null;
  responderLastName: string | null;
};

function formatStarterName(inc: JoinableLiveIncident): string {
  const name = [inc.responderFirstName, inc.responderLastName].filter(Boolean).join(" ").trim();
  return name || "A colleague";
}

function severityAccent(severity: string | null): string {
  if (severity === "red") return "border-l-red-500 bg-red-500/[0.04]";
  if (severity === "orange") return "border-l-orange-500 bg-orange-500/[0.03]";
  if (severity === "yellow") return "border-l-yellow-400 bg-yellow-400/[0.03]";
  return "border-l-primary bg-primary/[0.03]";
}

type Props = {
  incidents: JoinableLiveIncident[];
  testIdSuffix?: string;
};

export function LiveIncidentJoinBanner({ incidents, testIdSuffix = "" }: Props) {
  const [, navigate] = useLocation();
  if (incidents.length === 0) return null;

  const suffix = testIdSuffix ? `-${testIdSuffix}` : "";
  const hasRed = incidents.some((i) => i.severity === "red");

  function openJoin(inc: JoinableLiveIncident) {
    navigate(`/live-incident?join=${inc.id}`);
  }

  return (
    <div
      className={cn(
        "w-full rounded-2xl border-2 overflow-hidden shadow-lg",
        hasRed ? "border-red-500/70 bg-red-500/[0.06]" : "border-green-500/60 bg-green-500/[0.06]",
      )}
      data-testid={`banner-live-join${suffix}`}
    >
      <div
        className={cn(
          "px-4 py-2 flex items-center gap-2",
          hasRed ? "bg-red-600" : "bg-green-600",
        )}
      >
        <Radio className="h-4 w-4 text-white shrink-0" />
        <span className="text-white font-bold text-sm uppercase tracking-wide">
          {incidents.length === 1 ? "Live incident needs you" : `${incidents.length} live incidents need you`}
        </span>
        <span className="relative ml-1 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
        </span>
      </div>
      <div className="px-0 py-0 divide-y divide-border/60">
        {incidents.map((inc) => {
          const starter = formatStarterName(inc);
          const category = inc.categoryName ?? "Live incident";
          const dest = inc.destinationName || inc.locationName;
          return (
            <button
              key={inc.id}
              type="button"
              onClick={() => openJoin(inc)}
              className={cn(
                "w-full text-left px-4 py-3.5 hover:bg-muted/50 active:bg-muted/70 transition-colors touch-manipulation border-l-4",
                severityAccent(inc.severity),
              )}
              data-testid={`banner-live-join-row${suffix}-${inc.id}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-foreground leading-snug">
                    {starter} · {category}
                  </p>
                  <p className="text-xs text-muted-foreground">Incident #{inc.id}</p>
                  {dest ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{dest}</span>
                    </p>
                  ) : null}
                  <p className="text-xs font-medium text-green-700 dark:text-green-400 pt-0.5">
                    Tap to join response
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
