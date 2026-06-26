import {
  probeLocationAccess,
  probeLocationPermissionGesture,
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
};

function settingsTargetForIssue(issue?: PanicLocationIssue): LocationSettingsTarget {
  return issue === "denied" ? "app-permissions" : "phone-location";
}

function issueMessage(issue?: PanicLocationIssue): string {
  const target = settingsTargetForIssue(issue);
  switch (issue) {
    case "denied":
      return `Location is blocked for OMT Pulse. ${locationSettingsHint(target)}`;
    case "timeout":
      return "GPS timed out. Turn on phone Location, wait a few seconds, then tap Allow again.";
    case "unsupported":
      return "This device cannot report GPS.";
    case "unavailable":
    default:
      return `Turn on Location in your phone settings. ${locationSettingsHint(target)}`;
  }
}

/**
 * User-tap handler for live incident / map screens.
 * 1) Try the Android/iOS permission prompt via geolocation.
 * 2) If blocked or GPS is off, open app/location Settings (no APK update needed).
 */
export async function requestLocationAccess(
  options: RequestLocationAccessOptions = {},
): Promise<{
  result: LocationAccessResult;
  message: string;
}> {
  const permissionHint = options.permissionHint ?? "prompt";

  if (permissionHint === "denied") {
    const settings = await openLocationSettings({ target: "app-permissions" });
    if (settings.result === "opened" || settings.result === "prompted") {
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
    permissionHint === "prompt"
      ? await probeLocationPermissionGesture()
      : await probeLocationAccess();

  if (hasPanicCoordinates(loc)) {
    window.dispatchEvent(new CustomEvent("omt:location-granted"));
    return { result: "granted", message: "GPS is on — tracking your position." };
  }

  if (loc.issue === "unsupported") {
    return { result: "unsupported", message: issueMessage("unsupported") };
  }

  const target = settingsTargetForIssue(loc.issue);
  const settings = await openLocationSettings({ target });
  if (settings.result === "opened" || settings.result === "prompted") {
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
