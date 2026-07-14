import { Capacitor } from "@capacitor/core";
import {
  NativeSettings,
  AndroidSettings,
  IOSSettings,
} from "capacitor-native-settings";
import {
  hasOmtAppSettingsPlugin,
  openOmtAppDetailsSettings,
  openOmtLocationSourcesSettings,
} from "@/lib/omt-app-settings";
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
      return "Settings → Location (top search) → turn Location on. Also: Apps → OMT Pulse → Permissions → Location → Allow.";
    }
    return "Settings → search “Location” → open Location → turn it on → return to OMT Pulse.";
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
  return "Find Location in Settings, turn it on, then return and tap again.";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("settings open timeout")), ms),
    ),
  ]);
}

function openIntentUrl(href: string): boolean {
  try {
    const a = document.createElement("a");
    a.href = href;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

/** Location-only intents — never ACTION_SETTINGS (Samsung often dumps to root Settings). */
function openAndroidLocationIntents(): boolean {
  const urls = [
    "intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end",
    "intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;package=com.android.settings;end",
  ];
  for (const href of urls) {
    if (openIntentUrl(href)) return true;
  }
  return false;
}

function openAndroidAppDetailsIntent(): boolean {
  return openIntentUrl(
    `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:${ANDROID_PACKAGE};end`,
  );
}

function openIosUrlFallback(): boolean {
  return openIntentUrl("app-settings:");
}

/**
 * Custom Capacitor plugin — preferred for Location. Does not fall back to root Settings.
 */
async function openViaOmtAppSettings(target: LocationSettingsTarget): Promise<boolean> {
  if (!hasOmtAppSettingsPlugin()) return false;
  if (target === "app-permissions") {
    return openOmtAppDetailsSettings();
  }
  return openOmtLocationSourcesSettings();
}

/** App-permissions / iOS only — never used for Android phone-location (OEM falls back to root Settings). */
async function openViaNativeSettingsPlugin(
  platform: "android" | "ios",
  target: LocationSettingsTarget,
): Promise<boolean> {
  if (platform === "android") {
    if (target !== "app-permissions") return false;
    try {
      await withTimeout(
        NativeSettings.openAndroid({ option: AndroidSettings.ApplicationDetails }),
        2_500,
      );
      return true;
    } catch {
      return false;
    }
  }

  try {
    await withTimeout(
      NativeSettings.openIOS({
        option: target === "app-permissions" ? IOSSettings.App : IOSSettings.LocationServices,
      }),
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

/**
 * Open phone Location settings only — never root Settings.
 * On failure returns manual steps (user searches “Location” themselves).
 */
export async function openLocationSettings(
  options: OpenLocationSettingsOptions = {},
): Promise<OpenLocationSettingsResponse> {
  const target = options.target ?? "phone-location";
  const manualMsg = locationSettingsHint(target);
  const platform = nativePlatform();

  if (platform === "android") {
    if (target === "phone-location") {
      // 1) Our native plugin (APK)
      if (await openViaOmtAppSettings("phone-location")) {
        return { result: "opened", message: locationSettingsUserMessage(target) };
      }
      // 2) Location intent only — never NativeSettings.Location (Samsung → root Settings)
      if (openAndroidLocationIntents()) {
        return { result: "opened", message: locationSettingsUserMessage(target) };
      }
      return { result: "manual", message: manualMsg };
    }

    // app-permissions
    if (await openViaOmtAppSettings("app-permissions")) {
      return { result: "opened", message: locationSettingsUserMessage(target) };
    }
    if (await openViaNativeSettingsPlugin("android", "app-permissions")) {
      return { result: "opened", message: locationSettingsUserMessage(target) };
    }
    if (openAndroidAppDetailsIntent()) {
      return { result: "opened", message: locationSettingsUserMessage(target) };
    }
    return { result: "manual", message: manualMsg };
  }

  if (platform === "ios") {
    if (await openViaNativeSettingsPlugin("ios", target)) {
      return { result: "opened", message: locationSettingsUserMessage(target) };
    }
    if (openIosUrlFallback()) {
      return { result: "opened", message: locationSettingsUserMessage(target) };
    }
    return { result: "manual", message: manualMsg };
  }

  // Android browser / PWA (no Capacitor shell)
  if (detectPlatform() === "android") {
    if (target === "phone-location" && openAndroidLocationIntents()) {
      return { result: "opened", message: locationSettingsUserMessage(target) };
    }
    if (target === "app-permissions" && openAndroidAppDetailsIntent()) {
      return { result: "opened", message: locationSettingsUserMessage(target) };
    }
  }

  if (await promptBrowserLocation()) {
    return {
      result: "prompted",
      message: "If you allowed location, tap Use current location again.",
    };
  }

  return { result: "manual", message: manualMsg };
}
