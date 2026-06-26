import { Capacitor } from "@capacitor/core";
import {
  NativeSettings,
  AndroidSettings,
  IOSSettings,
} from "capacitor-native-settings";

export type OpenLocationSettingsResult =
  | "opened"
  | "prompted"
  | "unavailable"
  | "manual";

/** Which Android/iOS settings screen to open — never chain multiple screens. */
export type LocationSettingsTarget = "phone-location" | "app-permissions";

export type OpenLocationSettingsResponse = {
  result: OpenLocationSettingsResult;
  message: string;
};

export type OpenLocationSettingsOptions = {
  /** GPS off / unavailable → phone Location; permission denied → app permissions. */
  target?: LocationSettingsTarget;
};

const ANDROID_PACKAGE = "com.intelafri.omtpulse";

export function preloadLocationSettingsModule(): void {
  /* static import */
}

function detectPlatform(): "ios" | "android" | "desktop" {
  const cap = Capacitor.getPlatform();
  if (cap === "ios" || cap === "android") return cap;
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream) {
    return "ios";
  }
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

function isNativeShell(): boolean {
  return (
    Capacitor.isNativePlatform() ||
    document.documentElement.classList.contains("capacitor-native")
  );
}

function nativePlatform(): "ios" | "android" | null {
  const cap = Capacitor.getPlatform();
  if (cap === "ios" || cap === "android") return cap;
  if (isNativeShell()) {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    if (/Android/i.test(ua)) return "android";
    if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  }
  return null;
}

export function locationSettingsHint(
  target: LocationSettingsTarget = "phone-location",
): string {
  const platform = detectPlatform();
  if (platform === "android") {
    if (target === "app-permissions") {
      return "Settings → Apps → OMT Pulse → Permissions → Location → Allow.";
    }
    return "Settings → Location → turn Location on, then return to OMT Pulse.";
  }
  if (platform === "ios") {
    if (target === "app-permissions") {
      return "Settings → OMT Pulse → Location → While Using the App.";
    }
    return "Settings → Privacy & Security → Location Services → On, then return to OMT Pulse.";
  }
  return "Allow location in your browser site settings for omtpulse.com.";
}

/** Short copy for toasts after we send the user to Settings — not an error message. */
export function locationSettingsUserMessage(
  target: LocationSettingsTarget = "phone-location",
): string {
  if (target === "app-permissions") {
    return "Allow Location for OMT Pulse, then return to the app.";
  }
  return "Turn on Location, then return to OMT Pulse.";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("settings open timeout")), ms),
    ),
  ]);
}

function androidIntentForTarget(target: LocationSettingsTarget): string {
  if (target === "app-permissions") {
    return `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:${ANDROID_PACKAGE};end`;
  }
  return "intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end";
}

function openAndroidIntentFallback(target: LocationSettingsTarget): boolean {
  const uri = androidIntentForTarget(target);
  try {
    window.location.assign(uri);
    return true;
  } catch {
    /* try anchor click */
  }
  try {
    const a = document.createElement("a");
    a.href = uri;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

function openIosUrlFallback(): boolean {
  try {
    const a = document.createElement("a");
    a.href = "app-settings:";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

function androidSettingForTarget(target: LocationSettingsTarget): AndroidSettings {
  return target === "app-permissions"
    ? AndroidSettings.ApplicationDetails
    : AndroidSettings.Location;
}

function iosSettingForTarget(target: LocationSettingsTarget): IOSSettings {
  return target === "app-permissions" ? IOSSettings.App : IOSSettings.LocationServices;
}

/**
 * Uses capacitor-native-settings already bundled in the Play Store APK.
 * Opens exactly one settings screen — no waterfall across Apps / Location / App info.
 */
async function openViaNativeSettingsPlugin(
  platform: "android" | "ios",
  target: LocationSettingsTarget,
): Promise<boolean> {
  if (platform === "android") {
    try {
      await withTimeout(
        NativeSettings.openAndroid({ option: androidSettingForTarget(target) }),
        2_500,
      );
      return true;
    } catch {
      return false;
    }
  }

  try {
    await withTimeout(
      NativeSettings.openIOS({ option: iosSettingForTarget(target) }),
      2_500,
    );
    return true;
  } catch {
    return false;
  }
}

async function promptBrowserLocation(): Promise<boolean> {
  if (!navigator.geolocation) return false;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      (err) => resolve(err.code !== 1),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 0 },
    );
  });
}

/** Best-effort Settings open — optional; manual steps are the reliable path without a new APK. */
export async function openLocationSettings(
  options: OpenLocationSettingsOptions = {},
): Promise<OpenLocationSettingsResponse> {
  const target = options.target ?? "phone-location";
  const manualMsg = `If Settings did not open, go manually: ${locationSettingsHint(target)}`;
  const platform = nativePlatform();

  if (platform === "android" || platform === "ios") {
    // Android WebView: intent URI is more reliable than the native-settings plugin on some devices.
    if (platform === "android" && openAndroidIntentFallback(target)) {
      return {
        result: "opened",
        message: locationSettingsUserMessage(target),
      };
    }
    if (await openViaNativeSettingsPlugin(platform, target)) {
      return {
        result: "opened",
        message: locationSettingsUserMessage(target),
      };
    }
    if (platform === "ios" && openIosUrlFallback()) {
      return { result: "opened", message: locationSettingsUserMessage(target) };
    }
    return { result: "manual", message: manualMsg };
  }

  if (detectPlatform() === "android" && openAndroidIntentFallback(target)) {
    return { result: "opened", message: locationSettingsUserMessage(target) };
  }

  if (await promptBrowserLocation()) {
    return {
      result: "prompted",
      message: "If you allowed location, tap Allow location access again to refresh GPS.",
    };
  }

  return { result: "manual", message: manualMsg };
}
