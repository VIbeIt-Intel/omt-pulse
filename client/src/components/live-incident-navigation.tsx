import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CheckCircle2, ChevronRight, Gauge, Loader2, MapPin, MessageCircle, Navigation, Route, Search, Signpost, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type NavPlaceSuggestion = { place_id: string; description: string };

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
      className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-6 text-base shadow-lg shadow-green-900/20"
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

type BypassNavigationCtaProps = {
  onBypass: () => void;
  disabled?: boolean;
};

/** Prominent alternative to turn-by-turn — GPS still tracks without a route on screen. */
export function LiveIncidentBypassNavigationCta({
  onBypass,
  disabled = false,
}: BypassNavigationCtaProps) {
  return (
    <Button
      type="button"
      size="lg"
      variant="outline"
      className="w-full py-5 h-auto min-h-[3.25rem] text-base font-semibold border-2 border-blue-600/80 bg-blue-50 text-blue-800 hover:bg-blue-100 hover:text-blue-900 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60 shadow-md"
      disabled={disabled}
      onClick={onBypass}
      data-testid="button-bypass-navigation"
    >
      <Signpost className="h-5 w-5 mr-2 shrink-0" />
      <span className="text-left leading-tight">
        I know where I&apos;m going
        <span className="block text-xs font-normal opacity-80 mt-0.5">Skip route — GPS stays live</span>
      </span>
    </Button>
  );
}

type DestinationSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  search: string;
  onSearchChange: (value: string) => void;
  suggestions: NavPlaceSuggestion[];
  loadingSuggestions: boolean;
  searchHint?: string | null;
  searchServicesLoading?: boolean;
  searchServicesUnavailable?: boolean;
  onRetrySearchServices?: () => void;
  onSelectSuggestion: (suggestion: NavPlaceSuggestion) => void;
  incidentLocation?: { name: string } | null;
  onUseIncidentLocation?: () => void;
};

export function LiveIncidentDestinationSheet({
  open,
  onOpenChange,
  search,
  onSearchChange,
  suggestions,
  loadingSuggestions,
  searchHint,
  searchServicesLoading = false,
  searchServicesUnavailable = false,
  onRetrySearchServices,
  onSelectSuggestion,
  incidentLocation,
  onUseIncidentLocation,
}: DestinationSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        overlayClassName="bg-black/40"
        className="rounded-t-3xl border-t border-border px-0 pb-0 pt-1 max-h-[min(92vh,720px)] flex flex-col gap-0 shadow-2xl bg-background text-foreground"
        style={{ backgroundColor: "hsl(var(--background))" }}
        data-testid="sheet-destination-picker"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-muted-foreground/25 shrink-0" aria-hidden />

        <div className="flex flex-col min-h-0 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="text-center space-y-1 pb-3 shrink-0 items-center">
            <SheetTitle className="text-lg font-semibold tracking-tight text-foreground">Set destination</SheetTitle>
            <SheetDescription className="text-xs leading-relaxed max-w-[300px] mx-auto text-muted-foreground">
              Search an address below, or use your incident GPS as the destination.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-3 w-full max-w-md mx-auto min-h-0">
            {(searchServicesLoading || searchServicesUnavailable) ? (
              <div
                className={cn(
                  "rounded-xl border px-3.5 py-3 text-sm space-y-2",
                  searchServicesUnavailable
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100"
                    : "border-border bg-muted/40 text-muted-foreground",
                )}
                data-testid="banner-destination-search-status"
              >
                <p>
                  {searchServicesLoading
                    ? "Loading address search…"
                    : "Address search is unavailable. Use incident location below, or retry."}
                </p>
                {searchServicesUnavailable && onRetrySearchServices ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={onRetrySearchServices}
                    data-testid="button-retry-destination-search"
                  >
                    Retry search
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="relative shrink-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-10 h-12 rounded-2xl bg-white dark:bg-muted border-2 border-primary/30 text-base text-foreground placeholder:text-muted-foreground shadow-sm"
                placeholder="Search address or place…"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                data-testid="input-destination-search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                name="omt-destination-search"
                inputMode="search"
                enterKeyHint="search"
                disabled={searchServicesUnavailable && !searchServicesLoading}
              />
              {loadingSuggestions ? (
                <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              ) : null}
            </div>

            {suggestions.length > 0 ? (
              <div
                className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden divide-y max-h-40 overflow-y-auto shrink-0"
                data-testid="list-suggestions"
              >
                {suggestions.map((s) => (
                  <button
                    key={s.place_id}
                    type="button"
                    className="w-full text-left px-4 py-3.5 text-sm text-foreground hover:bg-accent/50 flex items-start gap-3 transition-colors"
                    onClick={() => onSelectSuggestion(s)}
                    data-testid={`suggestion-${s.place_id}`}
                  >
                    <MapPin className="h-4 w-4 shrink-0 mt-0.5 text-primary/70" />
                    <span className="line-clamp-2 leading-snug">{s.description}</span>
                  </button>
                ))}
              </div>
            ) : searchHint ? (
              <p className="text-sm text-center text-muted-foreground py-1 px-1 shrink-0" data-testid="text-search-hint">
                {searchHint}
              </p>
            ) : null}

            {incidentLocation && onUseIncidentLocation ? (
              <>
                <div className="relative flex items-center gap-3 py-0.5 shrink-0">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground shrink-0">
                    Or use GPS
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <button
                  type="button"
                  className="group w-full rounded-2xl border-2 border-primary/30 bg-primary/5 px-4 py-3.5 text-left shadow-sm transition-all hover:border-primary/50 hover:bg-primary/10 active:scale-[0.99] flex items-center gap-3 shrink-0"
                  onClick={onUseIncidentLocation}
                  data-testid="button-use-incident-location"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/25">
                    <MapPin className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">Use incident location</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{incidentLocation.name}</p>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

type JoinerNavSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinationName: string;
  acquiringGps: boolean;
  onDirect: () => void;
  onGuided: () => void;
  onBypass: () => void;
  gpsBlockedGuide?: ReactNode;
};

export function LiveIncidentJoinerNavSheet({
  open,
  onOpenChange,
  destinationName,
  acquiringGps,
  onDirect,
  onGuided,
  onBypass,
  gpsBlockedGuide,
}: JoinerNavSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl px-4 pb-6 pt-2 max-h-[78vh] flex flex-col gap-0 border-t shadow-2xl"
        data-testid="sheet-joiner-nav-picker"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30 shrink-0" aria-hidden />
        <SheetHeader className="text-left space-y-1 pb-3 shrink-0">
          <SheetTitle className="text-base font-semibold tracking-tight">Navigate to</SheetTitle>
          <SheetDescription className="text-sm font-medium text-foreground truncate">
            {destinationName}
          </SheetDescription>
        </SheetHeader>

        <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onDirect}
            disabled={acquiringGps}
            className={cn(
              "flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-colors",
              "border-primary/50 bg-primary/5 shadow-sm hover:bg-primary/10 active:bg-primary/15",
              acquiringGps && "opacity-60 pointer-events-none",
            )}
            data-testid="button-joiner-navigate-direct"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
              {acquiringGps ? <Loader2 className="h-5 w-5 animate-spin" /> : <Navigation className="h-5 w-5" />}
            </span>
            <span className="text-base font-semibold text-foreground">
              {acquiringGps ? "Getting your location…" : "I know the way"}
            </span>
            <span className="text-sm text-muted-foreground leading-snug">Use my own route / shortcuts</span>
          </button>
          <button
            type="button"
            onClick={onGuided}
            disabled={acquiringGps}
            className={cn(
              "flex flex-col items-start gap-2 rounded-xl border-2 border-border bg-card p-4 text-left transition-colors",
              "hover:bg-muted/40 active:bg-muted/60",
              acquiringGps && "opacity-60 pointer-events-none",
            )}
            data-testid="button-joiner-navigate-guided"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground">
              <Route className="h-5 w-5" />
            </span>
            <span className="text-base font-semibold text-foreground">Need directions</span>
            <span className="text-sm text-muted-foreground leading-snug">Turn-by-turn with voice guidance</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onBypass}
          className="mt-3 w-full rounded-xl border-2 border-blue-600/80 bg-blue-50 px-4 py-3.5 text-left shadow-md transition-colors hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-950/60 flex items-center gap-3"
          data-testid="button-joiner-bypass-navigation"
        >
          <Signpost className="h-5 w-5 shrink-0 text-blue-700 dark:text-blue-300" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-blue-900 dark:text-blue-100">I know where I&apos;m going</span>
            <span className="block text-xs text-blue-800/80 dark:text-blue-200/80 mt-0.5">Skip route — GPS stays live for investigation</span>
          </span>
        </button>

        {gpsBlockedGuide ? <div className="pt-3">{gpsBlockedGuide}</div> : null}
      </SheetContent>
    </Sheet>
  );
}
