import { useLocation } from "wouter";
import { ChevronRight, MapPin, Siren } from "lucide-react";
import type { PanicAlert } from "@/components/panic-banner";

type Props = {
  alerts: PanicAlert[];
  testIdSuffix?: string;
};

export function PanicJoinBanner({ alerts, testIdSuffix = "" }: Props) {
  const [, navigate] = useLocation();
  if (alerts.length === 0) return null;

  const suffix = testIdSuffix ? `-${testIdSuffix}` : "";

  function openRespond(alert: PanicAlert) {
    navigate(`/live-incident?join=${alert.id}`);
  }

  return (
    <div
      className="w-full rounded-2xl border-2 border-red-500/80 bg-red-500/[0.08] overflow-hidden shadow-lg"
      data-testid={`banner-panic-join${suffix}`}
    >
      <div className="bg-red-600 px-4 py-2 flex items-center gap-2">
        <Siren className="h-4 w-4 text-white animate-pulse shrink-0" />
        <span className="text-white font-bold text-sm uppercase tracking-wide">
          {alerts.length === 1 ? "Panic — respond now" : `${alerts.length} panic alerts — respond now`}
        </span>
      </div>
      <div className="divide-y divide-border/60">
        {alerts.map((alert) => {
          const name = `${alert.firstName} ${alert.lastName}`.trim() || "A colleague";
          const hasGps = alert.lat != null && alert.lng != null;
          return (
            <button
              key={alert.id}
              type="button"
              onClick={() => openRespond(alert)}
              className="w-full text-left px-4 py-3.5 hover:bg-muted/50 active:bg-muted/70 transition-colors touch-manipulation border-l-4 border-l-red-500 bg-red-500/[0.04]"
              data-testid={`banner-panic-join-row${suffix}-${alert.id}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-foreground leading-snug">
                    {name} needs immediate help
                  </p>
                  <p className="text-xs text-muted-foreground">Panic alert · Incident #{alert.id}</p>
                  {hasGps ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0" />
                      GPS live — tap to respond
                    </p>
                  ) : (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      GPS pending — tap to respond; map updates when location is shared
                    </p>
                  )}
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
