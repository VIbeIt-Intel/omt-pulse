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

export type OpenLocationSettingsResponse = {
  result: OpenLocationSettingsResult;
  message: string;
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

export function locationSettingsHint(): string {
  const platform = detectPlatform();
  if (platform === "android") {
    return "Settings → Apps → OMT Pulse → Permissions → Location → Allow.";
  }
  if (platform === "ios") {
    return "Settings → OMT Pulse → Location → While Using the App.";
  }
  return "Allow location in your browser site settings for omtpulse.com.";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("settings open timeout")), ms),
    ),
  ]);
}

function openAndroidIntentFallback(): boolean {
  const intents = [
    `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:${ANDROID_PACKAGE};end`,
    `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;package=${ANDROID_PACKAGE};end`,
    "intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end",
  ];
  for (const uri of intents) {
    try {
      const a = document.createElement("a");
      a.href = uri;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch {
      /* next */
    }
  }
  return false;
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

/**
 * Uses capacitor-native-settings already bundled in the Play Store APK.
 * Does not require a new APK release.
 */
async function openViaNativeSettingsPlugin(platform: "android" | "ios"): Promise<boolean> {
  if (platform === "android") {
    const options = [
      AndroidSettings.ApplicationDetails,
      AndroidSettings.Location,
      AndroidSettings.Application,
    ];
    for (const option of options) {
      try {
        await withTimeout(NativeSettings.openAndroid({ option }), 2_500);
        return true;
      } catch {
        /* next */
      }
    }
    try {
      await withTimeout(
        NativeSettings.open({
          optionAndroid: AndroidSettings.ApplicationDetails,
          optionIOS: IOSSettings.App,
        }),
        2_500,
      );
      return true;
    } catch {
      return false;
    }
  }

  try {
    await withTimeout(NativeSettings.openIOS({ option: IOSSettings.App }), 2_500);
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
export async function openLocationSettings(): Promise<OpenLocationSettingsResponse> {
  const manualMsg = `If Settings did not open, go manually: ${locationSettingsHint()}`;
  const platform = nativePlatform();

  if (platform === "android" || platform === "ios") {
    if (await openViaNativeSettingsPlugin(platform)) {
      return {
        result: "opened",
        message: `Opening Settings… ${manualMsg}`,
      };
    }
    if (platform === "android" && openAndroidIntentFallback()) {
      return { result: "opened", message: `Trying Settings… ${manualMsg}` };
    }
    if (platform === "ios" && openIosUrlFallback()) {
      return { result: "opened", message: `Trying Settings… ${manualMsg}` };
    }
    return { result: "manual", message: manualMsg };
  }

  if (detectPlatform() === "android" && openAndroidIntentFallback()) {
    return { result: "opened", message: `Trying Settings… ${manualMsg}` };
  }

  if (await promptBrowserLocation()) {
    return {
      result: "prompted",
      message: "If you allowed location, tap Allow location access again to refresh GPS.",
    };
  }

  return { result: "manual", message: manualMsg };
}
