import { probeLocationAccess, hasPanicCoordinates, type PanicLocationIssue } from "@/lib/panic-location";
import {
  openLocationSettings,
  locationSettingsHint,
  type LocationSettingsTarget,
} from "@/lib/open-location-settings";

export type LocationAccessResult = "granted" | "denied" | "unavailable" | "unsupported";

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
export async function requestLocationAccess(): Promise<{
  result: LocationAccessResult;
  message: string;
}> {
  const loc = await probeLocationAccess();
  if (hasPanicCoordinates(loc)) {
    window.dispatchEvent(new CustomEvent("omt:location-granted"));
    return { result: "granted", message: "GPS is on — tracking your position." };
  }

  if (loc.issue === "unsupported") {
    return { result: "unsupported", message: issueMessage("unsupported") };
  }

  const settings = await openLocationSettings({
    target: settingsTargetForIssue(loc.issue),
  });
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
