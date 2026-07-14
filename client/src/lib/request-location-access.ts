import {
  probeLocationForAllowTap,
  probeLocationQuickDetect,
  acquirePanicLocation,
  acquireSettlingLocation,
  hasPanicCoordinates,
  type PanicLocationIssue,
  type PanicLocationResult,
} from "@/lib/panic-location";
import {
  openLocationSettings,
  locationSettingsHint,
  locationSettingsUserMessage,
  type LocationSettingsTarget,
} from "@/lib/open-location-settings";
import { getOmtLocationServicesEnabled } from "@/lib/omt-app-settings";
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
   * settle: Location-off → open Location screen; Location on → wait for GPS (Report Incident).
   */
  probeMode?: "allow-tap" | "settle";
};

const SETTINGS_OPENED_AT_KEY = "omt_loc_settings_opened_at";
const SETTINGS_REOPEN_COOLDOWN_MS = 120_000;

const LOCATION_OFF_MESSAGE =
  "Location is off. On your phone open Settings, search “Location”, turn it on, return here and tap Use current location again — or use Pick on map.";

const GPS_SLOW_MESSAGE =
  "GPS timed out. Wait a few seconds outdoors with Location on, tap again, or use Pick on map.";

function settingsTargetForIssue(issue?: PanicLocationIssue): LocationSettingsTarget {
  return issue === "denied" ? "app-permissions" : "phone-location";
}

function issueMessage(issue?: PanicLocationIssue): string {
  const target = settingsTargetForIssue(issue);
  switch (issue) {
    case "denied":
      return `Location is blocked for OMT Pulse. ${locationSettingsHint(target)}`;
    case "timeout":
      return GPS_SLOW_MESSAGE;
    case "unsupported":
      return "This device cannot report GPS.";
    case "unavailable":
    default:
      return LOCATION_OFF_MESSAGE;
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

async function openSettingsForIssue(issue?: PanicLocationIssue): Promise<{
  result: LocationAccessResult;
  message: string;
}> {
  const target = settingsTargetForIssue(issue);
  const settings = await openLocationSettings({ target });
  if (settings.result === "opened" || settings.result === "prompted") {
    markLocationSettingsOpened();
    return {
      result: "settings-opened",
      message: locationSettingsUserMessage(target),
    };
  }
  if (issue === "denied") {
    return { result: "denied", message: settings.message || issueMessage("denied") };
  }
  return { result: "unavailable", message: settings.message || issueMessage(issue) };
}

function granted(lat: number, lng: number) {
  window.dispatchEvent(new CustomEvent("omt:location-granted"));
  return {
    result: "granted" as const,
    message: "GPS is on — tracking your position.",
    lat,
    lng,
  };
}

/**
 * User-tap handler for live incident / map / report screens.
 * Location off → open Location settings (OMT plugin — not root Settings).
 * Location on → wait for a real GPS fix.
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
    return openSettingsForIssue("denied");
  }

  let loc: PanicLocationResult;
  let locationServicesLikelyOn = false;

  if (probeMode === "settle") {
    loc = await probeLocationQuickDetect();
    if (hasPanicCoordinates(loc)) {
      return granted(loc.lat, loc.lng);
    }
    if (loc.issue === "unsupported") {
      return { result: "unsupported", message: issueMessage("unsupported") };
    }
    if (loc.issue === "denied") {
      return openSettingsForIssue("denied");
    }

    const servicesOn = await getOmtLocationServicesEnabled();
    const justFromSettings = recentlyOpenedLocationSettings();

    // Native confirmed Location off → open Location toggle screen (not root Settings).
    if (servicesOn === false && !justFromSettings) {
      return openSettingsForIssue("unavailable");
    }

    locationServicesLikelyOn = servicesOn === true || justFromSettings;

    if (locationServicesLikelyOn) {
      loc = await acquirePanicLocation();
    } else {
      // Plugin missing / web: wait briefly, then open Location settings once.
      loc = await acquireSettlingLocation();
      if (
        !hasPanicCoordinates(loc) &&
        !justFromSettings &&
        loc.issue !== "denied" &&
        loc.issue !== "unsupported"
      ) {
        return openSettingsForIssue(loc.issue);
      }
    }
  } else {
    loc = await probeLocationForAllowTap(
      permissionHint === "unsupported" ? "prompt" : permissionHint,
    );
  }

  if (hasPanicCoordinates(loc)) {
    return granted(loc.lat!, loc.lng!);
  }

  if (loc.issue === "unsupported") {
    return { result: "unsupported", message: issueMessage("unsupported") };
  }

  if (loc.issue === "denied") {
    return openSettingsForIssue("denied");
  }

  // After waiting with Location known-on: GPS problem, not "Location off".
  if (locationServicesLikelyOn || loc.issue === "timeout") {
    return { result: "unavailable", message: GPS_SLOW_MESSAGE };
  }

  return { result: "unavailable", message: LOCATION_OFF_MESSAGE };
}
