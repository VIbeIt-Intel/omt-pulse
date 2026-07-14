import {
  probeLocationForAllowTap,
  acquirePanicLocation,
  hasPanicCoordinates,
  type PanicLocationIssue,
} from "@/lib/panic-location";
import {
  openLocationSettings,
  locationSettingsHint,
  locationSettingsUserMessage,
  type LocationSettingsTarget,
} from "@/lib/open-location-settings";
import type { PermissionState } from "@/hooks/use-permission-status";

export type LocationAccessResult =
  | "granted"
  | "denied"
  | "unavailable"
  | "unsupported"
  | "settings-opened";

export type RequestLocationAccessOptions = {
  /** From usePermissionStatus — first-time joiners need the permission dialog, not a 1s timeout. */
  permissionHint?: PermissionState;
  /**
   * allow-tap: short probe (live incident Allow Location).
   * settle: longer multi-attempt fix (Report Incident Use current location).
   */
  probeMode?: "allow-tap" | "settle";
};

const SETTINGS_OPENED_AT_KEY = "omt_loc_settings_opened_at";
const SETTINGS_REOPEN_COOLDOWN_MS = 120_000;

function settingsTargetForIssue(issue?: PanicLocationIssue): LocationSettingsTarget {
  return issue === "denied" ? "app-permissions" : "phone-location";
}

function issueMessage(issue?: PanicLocationIssue): string {
  const target = settingsTargetForIssue(issue);
  switch (issue) {
    case "denied":
      return `Location is blocked for OMT Pulse. ${locationSettingsHint(target)}`;
    case "timeout":
      return "GPS timed out. Wait a few seconds with Location on, then try again — or pick on the map.";
    case "unsupported":
      return "This device cannot report GPS.";
    case "unavailable":
    default:
      return `Turn on Location in your phone settings. ${locationSettingsHint(target)}`;
  }
}

function recentlyOpenedLocationSettings(): boolean {
  try {
    const raw = sessionStorage.getItem(SETTINGS_OPENED_AT_KEY);
    const at = raw ? Number(raw) : 0;
    return Number.isFinite(at) && Date.now() - at < SETTINGS_REOPEN_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markLocationSettingsOpened(): void {
  try {
    sessionStorage.setItem(SETTINGS_OPENED_AT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * User-tap handler for live incident / map / report screens.
 * 1) Try GPS.
 * 2) If blocked, open the right Settings screen.
 * 3) Do not reopen Location settings in a loop after the user just turned GPS on.
 */
export async function requestLocationAccess(
  options: RequestLocationAccessOptions = {},
): Promise<{
  result: LocationAccessResult;
  message: string;
  lat?: number;
  lng?: number;
}> {
  const permissionHint = options.permissionHint ?? "prompt";
  const probeMode = options.probeMode ?? "allow-tap";

  if (permissionHint === "denied") {
    const settings = await openLocationSettings({ target: "app-permissions" });
    if (settings.result === "opened" || settings.result === "prompted") {
      markLocationSettingsOpened();
      return {
        result: "settings-opened",
        message: locationSettingsUserMessage("app-permissions"),
      };
    }
    return {
      result: "denied",
      message: settings.message || issueMessage("denied"),
    };
  }

  const loc =
    probeMode === "settle"
      ? await acquirePanicLocation()
      : await probeLocationForAllowTap(
          permissionHint === "unsupported" ? "prompt" : permissionHint,
        );

  if (hasPanicCoordinates(loc)) {
    window.dispatchEvent(new CustomEvent("omt:location-granted"));
    return {
      result: "granted",
      message: "GPS is on — tracking your position.",
      lat: loc.lat,
      lng: loc.lng,
    };
  }

  if (loc.issue === "unsupported") {
    return { result: "unsupported", message: issueMessage("unsupported") };
  }

  // Cold GPS after enabling Location often times out briefly — don't bounce back
  // into Settings if we already sent the user there recently.
  if (
    (loc.issue === "timeout" || loc.issue === "unavailable") &&
    recentlyOpenedLocationSettings()
  ) {
    return {
      result: "unavailable",
      message:
        "Location looks on, but a GPS fix is still coming in. Wait a few seconds outdoors, tap again, or use Pick on map.",
    };
  }

  const target = settingsTargetForIssue(loc.issue);
  const settings = await openLocationSettings({ target });
  if (settings.result === "opened" || settings.result === "prompted") {
    markLocationSettingsOpened();
    return {
      result: "settings-opened",
      message: locationSettingsUserMessage(target),
    };
  }

  const base = issueMessage(loc.issue);
  if (loc.issue === "denied") {
    return {
      result: "denied",
      message: settings.message || base,
    };
  }

  return {
    result: "unavailable",
    message: settings.message || base,
  };
}
