import { useState } from "react";
import { Loader2, MapPin, Settings } from "lucide-react";
import {
  acquirePanicLocation,
  hasPanicCoordinates,
  type PanicLocationResult,
} from "@/lib/panic-location";
import { openLocationSettings } from "@/lib/open-location-settings";

type Props = {
  variant?: "dark" | "light";
  onLocationUpdated?: (loc: PanicLocationResult) => void;
  testIdPrefix?: string;
};

/**
 * GPS help for panic / SOS — works with the current Play Store APK (web deploy only).
 * Primary path: Android permission prompt via geolocation on tap.
 * Secondary: try existing capacitor-native-settings plugin in the installed APK.
 */
export function LocationPermissionGuide({
  variant = "dark",
  onLocationUpdated,
  testIdPrefix = "location-guide",
}: Props) {
  const [requesting, setRequesting] = useState(false);
  const [openingSettings, setOpeningSettings] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const isDark = variant === "dark";
  const panelClass = isDark
    ? "rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-left space-y-3"
    : "rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-left space-y-3";
  const textClass = isDark ? "text-sm text-amber-100/95" : "text-sm text-amber-950 dark:text-amber-100";
  const stepClass = isDark ? "text-xs text-white/80 leading-relaxed" : "text-xs leading-relaxed";

  async function onAllowAccess() {
    setRequesting(true);
    setStatus(null);
    try {
      const loc = await acquirePanicLocation();
      onLocationUpdated?.(loc);
      if (hasPanicCoordinates(loc)) {
        setStatus("GPS is on — you can send with your location.");
        return;
      }
      if (loc.issue === "denied") {
        setStatus(
          "Location was blocked. Use the steps below in your phone Settings app (no app update needed).",
        );
        return;
      }
      setStatus(
        "Could not get GPS yet. Turn on Location for OMT Pulse in Settings (steps below), then tap Allow again.",
      );
    } finally {
      setRequesting(false);
    }
  }

  async function onTrySettings() {
    setOpeningSettings(true);
    try {
      const { message } = await openLocationSettings();
      setStatus(message);
    } finally {
      setOpeningSettings(false);
    }
  }

  const primaryBtn = isDark
    ? "w-full h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm disabled:opacity-60 inline-flex items-center justify-center gap-2 touch-manipulation"
    : "w-full h-11 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm disabled:opacity-60 inline-flex items-center justify-center gap-2 touch-manipulation";

  const secondaryBtn = isDark
    ? "w-full h-11 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-medium text-sm disabled:opacity-60 inline-flex items-center justify-center gap-2 touch-manipulation"
    : "w-full h-10 rounded-lg border border-amber-600/50 text-amber-950 dark:text-amber-100 font-medium text-sm disabled:opacity-60 inline-flex items-center justify-center gap-2 touch-manipulation";

  const statusClass = isDark
    ? "text-xs text-emerald-100/90 rounded-xl bg-emerald-950/40 border border-emerald-500/30 px-3 py-2 leading-relaxed"
    : "text-xs rounded-lg bg-emerald-500/15 border border-emerald-600/30 px-3 py-2 leading-relaxed";

  return (
    <div className={panelClass} data-testid={`${testIdPrefix}-panel`}>
      <div className="flex items-start gap-2">
        <MapPin className={`h-4 w-4 shrink-0 mt-0.5 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
        <div className="space-y-1">
          <p className={`font-semibold ${isDark ? "text-white" : "text-amber-950 dark:text-amber-50"}`}>
            Turn on GPS — current app, no update
          </p>
          <p className={textClass}>
            Your installed OMT Pulse can ask for location below. If you previously denied it, use
            Android Settings manually.
          </p>
        </div>
      </div>
      <ol className={`list-decimal list-inside space-y-1.5 ${stepClass}`}>
        <li>
          Tap <strong className={isDark ? "text-white" : ""}>Allow location access</strong> — if Android
          shows a popup, choose <strong className={isDark ? "text-white" : ""}>While using the app</strong> or{" "}
          <strong className={isDark ? "text-white" : ""}>Allow</strong>.
        </li>
        <li>
          If there is no popup: open your phone <strong className={isDark ? "text-white" : ""}>Settings</strong>{" "}
          app → <strong className={isDark ? "text-white" : ""}>Apps</strong> →{" "}
          <strong className={isDark ? "text-white" : ""}>OMT Pulse</strong> →{" "}
          <strong className={isDark ? "text-white" : ""}>Permissions</strong> →{" "}
          <strong className={isDark ? "text-white" : ""}>Location</strong> → Allow.
        </li>
        <li>Return here — the green GPS line appears when ready.</li>
      </ol>
      <div className="space-y-2 pt-1">
        <button
          type="button"
          disabled={requesting}
          onClick={() => void onAllowAccess()}
          className={primaryBtn}
          data-testid={`${testIdPrefix}-allow`}
        >
          {requesting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MapPin className="h-4 w-4" />
          )}
          {requesting ? "Checking GPS…" : "Allow location access"}
        </button>
        <button
          type="button"
          disabled={openingSettings}
          onClick={() => void onTrySettings()}
          className={secondaryBtn}
          data-testid={`${testIdPrefix}-try-settings`}
        >
          {openingSettings ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Settings className="h-4 w-4" />
          )}
          {openingSettings ? "Trying Settings…" : "Try opening Settings (optional)"}
        </button>
      </div>
      {status ? (
        <p className={statusClass} role="status" data-testid={`${testIdPrefix}-status`}>
          {status}
        </p>
      ) : null}
    </div>
  );
}
