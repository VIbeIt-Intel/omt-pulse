import {
  probeLocationForAllowTap,
  probeLocationQuickDetect,
  acquirePanicLocation,
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
   * settle: quick off-detect, then longer wait only after returning from Settings.
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

/**
 * User-tap handler for live incident / map / report screens.
 * Location-off should open Settings in ~2s; cold GPS after return gets a longer wait.
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

  if (probeMode === "settle") {
    // 1) Fail-fast (~2s): Location off / denied → Settings immediately (no 30s spinner).
    loc = await probeLocationQuickDetect();
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
    if (loc.issue === "denied") {
      return openSettingsForIssue("denied");
    }
    // First attempt with Location likely off → open Settings quickly.
    if (!recentlyOpenedLocationSettings()) {
      return openSettingsForIssue(loc.issue);
    }
    // 2) User just returned from Settings — give cold GPS a real chance.
    loc = await acquirePanicLocation();
  } else {
    loc = await probeLocationForAllowTap(
      permissionHint === "unsupported" ? "prompt" : permissionHint,
    );
  }

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

  return openSettingsForIssue(loc.issue);
}
