import { Capacitor } from "@capacitor/core";

export type OpenLocationSettingsResult = "opened" | "prompted" | "unavailable";

type NativeSettingsModule = typeof import("capacitor-native-settings");

let settingsModulePromise: Promise<NativeSettingsModule> | null = null;

/** Warm the native-settings chunk while SOS overlay is open (first tap feels instant). */
export function preloadLocationSettingsModule(): void {
  if (!Capacitor.isNativePlatform()) return;
  settingsModulePromise ??= import("capacitor-native-settings");
}

async function loadNativeSettings(): Promise<NativeSettingsModule | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await (settingsModulePromise ?? import("capacitor-native-settings"));
  } catch {
    return null;
  }
}

function detectPlatform(): "ios" | "android" | "desktop" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream) return "ios";
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
 * Open app settings on native immediately; on web, a quick permission retry only.
 */
export async function openLocationSettings(): Promise<OpenLocationSettingsResult> {
  const mod = await loadNativeSettings();
  if (mod) {
    try {
      const { NativeSettings, AndroidSettings, IOSSettings } = mod;
      await NativeSettings.open({
        optionAndroid: AndroidSettings.ApplicationDetails,
        optionIOS: IOSSettings.App,
      });
      return "opened";
    } catch {
      /* fall through to browser prompt on hybrid failures */
    }
  }

  if (await promptBrowserLocation()) {
    return "prompted";
  }

  return "unavailable";
}
