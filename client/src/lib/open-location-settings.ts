import { Capacitor } from "@capacitor/core";
import {
  NativeSettings,
  AndroidSettings,
  IOSSettings,
} from "capacitor-native-settings";

export type OpenLocationSettingsResult = "opened" | "prompted" | "unavailable";

const ANDROID_PACKAGE = "com.intelafri.omtpulse";

/** Warm native-settings (bundled statically; no-op kept for overlay preload hook). */
export function preloadLocationSettingsModule(): void {
  /* chunk is in main bundle */
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

/** Short hint when we cannot open system settings programmatically. */
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

/** Android intent fallback when the native plugin is missing or fails. */
function openAndroidIntentFallback(): boolean {
  const intents = [
    `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:${ANDROID_PACKAGE};end`,
    `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;package=${ANDROID_PACKAGE};end`,
    "intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end",
  ];
  for (const uri of intents) {
    try {
      window.location.href = uri;
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

function openIosUrlFallback(): boolean {
  try {
    window.location.href = "app-settings:";
    return true;
  } catch {
    return false;
  }
}

async function openViaNativePlugin(platform: "android" | "ios"): Promise<boolean> {
  if (!Capacitor.isPluginAvailable("NativeSettings")) return false;

  const androidOptions = [
    AndroidSettings.ApplicationDetails,
    AndroidSettings.Location,
  ];

  if (platform === "android") {
    for (const option of androidOptions) {
      try {
        await withTimeout(NativeSettings.openAndroid({ option }), 4_000);
        return true;
      } catch {
        /* try next screen */
      }
    }
    return false;
  }

  try {
    await withTimeout(
      NativeSettings.openIOS({ option: IOSSettings.App }),
      4_000,
    );
    return true;
  } catch {
    return false;
  }
}

/** Short browser permission retry — not used on native (Settings opens instead). */
async function promptBrowserLocation(): Promise<boolean> {
  if (!navigator.geolocation) return false;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      (err) => resolve(err.code !== 1),
      { enableHighAccuracy: false, timeout: 3_000, maximumAge: 60_000 },
    );
  });
}

/**
 * Open app/location settings on native; on web, a quick permission retry only.
 */
export async function openLocationSettings(): Promise<OpenLocationSettingsResult> {
  const platform = Capacitor.getPlatform();
  const isNative = Capacitor.isNativePlatform();

  if (isNative && (platform === "android" || platform === "ios")) {
    if (await openViaNativePlugin(platform)) return "opened";

    if (platform === "android" && openAndroidIntentFallback()) return "opened";
    if (platform === "ios" && openIosUrlFallback()) return "opened";
  } else if (!isNative && detectPlatform() === "android") {
    if (openAndroidIntentFallback()) return "opened";
  }

  if (await promptBrowserLocation()) {
    return "prompted";
  }

  return "unavailable";
}
