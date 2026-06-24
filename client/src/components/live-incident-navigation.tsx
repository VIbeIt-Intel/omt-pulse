import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Gauge, Loader2, MessageCircle, Navigation, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Straight-line distance thresholds for navigation UI phases. */
export const NAV_ARRIVAL_AT_SCENE_M = 150;
export const NAV_ARRIVAL_SOON_M = 500;

export type NavFieldPhase = "navigating" | "arriving_soon" | "at_scene";

export function resolveNavFieldPhase(distM: number | null): NavFieldPhase {
  if (distM == null) return "navigating";
  if (distM <= NAV_ARRIVAL_AT_SCENE_M) return "at_scene";
  if (distM <= NAV_ARRIVAL_SOON_M) return "arriving_soon";
  return "navigating";
}

const PHASE_LABEL: Record<NavFieldPhase, string> = {
  navigating: "Navigating",
  arriving_soon: "Arriving soon",
  at_scene: "At scene",
};

const PHASE_BADGE: Record<NavFieldPhase, string> = {
  navigating: "bg-primary text-primary-foreground",
  arriving_soon: "bg-amber-500 text-amber-950",
  at_scene: "bg-red-600 text-white",
};

export function LiveIncidentNavPhaseBadge({
  phase,
  className,
}: {
  phase: NavFieldPhase;
  className?: string;
}) {
  return (
    <Badge
      className={cn("text-[10px] uppercase tracking-wide font-bold shrink-0", PHASE_BADGE[phase], className)}
      data-testid="badge-nav-phase"
    >
      {PHASE_LABEL[phase]}
    </Badge>
  );
}

type NavBottomBarProps = {
  phase: NavFieldPhase;
  isJoinerMode: boolean;
  activeNavStyle: "direct" | "guided";
  directDist: number | null;
  directBearing: number | null;
  navRouteDisplay: { distance: number; duration: number } | null;
  speedKmh: number | null;
  fmtDist: (m: number) => string;
  fmtDur: (s: number) => string;
  bearingCardinal: (deg: number) => string;
  showProminentArrived: boolean;
  onChat: () => void;
  onCancelNavigation: () => void;
  onRecordArrival: () => void;
};

export function LiveIncidentNavBottomBar({
  phase,
  isJoinerMode,
  activeNavStyle,
  directDist,
  directBearing,
  navRouteDisplay,
  speedKmh,
  fmtDist,
  fmtDur,
  bearingCardinal,
  showProminentArrived,
  onChat,
  onCancelNavigation,
  onRecordArrival,
}: NavBottomBarProps) {
  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-10 bg-background/95 backdrop-blur border-t px-4 py-3 space-y-2.5"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      data-testid="nav-bottom-bar"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {activeNavStyle === "direct" && directDist != null ? (
            <>
              <span className="text-lg font-bold text-foreground tabular-nums" data-testid="text-nav-distance">
                {fmtDist(directDist)}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-sm font-semibold text-muted-foreground" data-testid="text-nav-bearing">
                {directBearing != null ? bearingCardinal(directBearing) : "—"}
              </span>
            </>
          ) : navRouteDisplay ? (
            <>
              <span className="text-lg font-bold text-foreground tabular-nums" data-testid="text-nav-distance">
                {fmtDist(navRouteDisplay.distance)}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-sm font-semibold text-muted-foreground" data-testid="text-nav-eta">
                ETA {fmtDur(navRouteDisplay.duration)}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Computing route…</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 text-muted-foreground" data-testid="nav-speed">
            <Gauge className="h-4 w-4" />
            <span className="font-semibold text-foreground tabular-nums">{speedKmh ?? "--"}</span>
            <span className="text-[10px]">km/h</span>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-chat-nav" aria-label="Chat" onClick={onChat}>
            <MessageCircle className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {showProminentArrived ? (
        <Button
          size="lg"
          variant="destructive"
          className={cn("w-full font-bold", phase === "at_scene" && "py-6 text-base")}
          onClick={onRecordArrival}
          data-testid="button-arrived-nav"
        >
          <CheckCircle2 className="h-5 w-5 mr-2" />
          {isJoinerMode ? "I've Arrived — Record & Leave" : "I've Arrived — Record Incident"}
        </Button>
      ) : (
        <button
          type="button"
          className="w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground py-1"
          onClick={onRecordArrival}
          data-testid="button-arrived-early"
        >
          Record arrival early (still en route)
        </button>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full h-9 text-muted-foreground border-dashed"
        onClick={onCancelNavigation}
        data-testid="button-cancel-navigation"
      >
        <X className="h-3.5 w-3.5 mr-1.5" />
        Cancel navigation
      </Button>
    </div>
  );
}

type StartNavigationCtaProps = {
  onStart: () => void;
  dispatching?: boolean;
  label?: string;
};

export function LiveIncidentStartNavigationCta({
  onStart,
  dispatching = false,
  label = "Start Navigation",
}: StartNavigationCtaProps) {
  return (
    <Button
      size="lg"
      className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-6 text-base shadow-md"
      disabled={dispatching}
      onClick={onStart}
      data-testid="button-start-navigation"
    >
      {dispatching ? (
        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
      ) : (
        <Navigation className="h-5 w-5 mr-2" />
      )}
      {dispatching ? "Starting…" : label}
    </Button>
  );
}
