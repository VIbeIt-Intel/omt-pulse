import { AlertTriangle, MapPin, HelpCircle, Navigation } from "lucide-react";
import { usePermissionStatus } from "@/hooks/use-permission-status";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Platform = "ios" | "android" | "desktop";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

const PLATFORM_INSTRUCTIONS: Record<Platform, { location: string }> = {
  ios: {
    location:
      "Settings → Privacy & Security → Location Services → find your browser (Safari/Chrome) → set to \"While Using\" or \"Always\".",
  },
  android: {
    location:
      "Settings → Apps → OMT Pulse → Permissions → Location → Allow.",
  },
  desktop: {
    location:
      "Click the lock icon in the address bar → Site settings → Location → Allow.",
  },
};

export function PermissionDeniedBanner() {
  const status = usePermissionStatus();
  const platform = detectPlatform();

  const locationDenied = status.location === "denied";
  const locationPrompt = status.location === "prompt";

  function requestLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      () => {
        // Permission granted and position acquired — clear the banner.
        window.dispatchEvent(new Event("omt:location-granted"));
      },
      (err) => {
        // PERMISSION_DENIED (code 1) → user said No — leave banner showing.
        // POSITION_UNAVAILABLE (code 2) or TIMEOUT (code 3) → permission WAS
        // granted but GPS couldn't get a fix (common indoors). Clear the banner.
        if (err.code !== 1) {
          window.dispatchEvent(new Event("omt:location-granted"));
        }
      },
      // Use low-accuracy (network/WiFi) so it resolves quickly indoors.
      // High-accuracy GPS can fail to acquire a fix and time out unnecessarily.
      { timeout: 10000, enableHighAccuracy: false }
    );
  }

  // ── Denied banner — persistent, no dismiss ─────────────────────────────────
  if (locationDenied) {
    return (
      <div
        className="shrink-0 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-800 px-4 py-2.5 flex items-center justify-between gap-3 text-sm"
        data-testid="banner-location-denied"
      >
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
          <span className="text-red-800 dark:text-red-300 font-medium">
            Location access is blocked
          </span>
          <span className="text-red-700 dark:text-red-400 hidden sm:inline truncate">
            — GPS tracking and incident pinning won't work.
          </span>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-red-700 dark:text-red-400 hover:text-red-900 dark:hover:text-red-200 transition-colors font-medium px-3 rounded hover:bg-red-100 dark:hover:bg-red-900/40 shrink-0 min-h-[44px]"
              style={{ touchAction: "manipulation" }}
              data-testid="button-fix-location"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              How to fix
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-4 space-y-3" data-testid="popover-location-help">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-primary" />
              Re-enable Location
            </p>
            <p className="text-xs text-muted-foreground">
              {PLATFORM_INSTRUCTIONS[platform].location}
            </p>
            <p className="text-xs text-muted-foreground">
              Once granted, return here — the warning will clear automatically.
            </p>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  // ── Prompt nudge — shown when location has never been asked ───────────────
  if (locationPrompt) {
    return (
      <div
        className="shrink-0 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center justify-between gap-3 text-sm"
        data-testid="banner-location-prompt"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Navigation className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-amber-800 dark:text-amber-300 font-medium truncate">
            Location access needed
          </span>
          <span className="text-amber-700 dark:text-amber-400 hidden sm:inline truncate">
            — required for GPS tracking during live incidents.
          </span>
        </div>
        <button
          type="button"
          className="shrink-0 min-h-[44px] min-w-[44px] px-4 text-xs font-medium rounded-md border border-amber-500/40 text-amber-700 dark:text-amber-400 bg-transparent hover:bg-amber-500/10 active:bg-amber-500/20 transition-colors"
          style={{ touchAction: "manipulation" }}
          onClick={requestLocation}
          data-testid="button-allow-location"
        >
          Allow
        </button>
      </div>
    );
  }

  return null;
}
