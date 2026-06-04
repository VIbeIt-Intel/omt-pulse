import { Capacitor } from "@capacitor/core";
import {
  NativeSettings,
  AndroidSettings,
  IOSSettings,
} from "capacitor-native-settings";
import {
  openOmtAppDetailsSettings,
  openOmtLocationSourcesSettings,
} from "@/lib/omt-app-settings";

export type OpenLocationSettingsResult =
  | "opened"
  | "prompted"
  | "unavailable"
  | "manual";

export type OpenLocationSettingsResponse = {
  result: OpenLocationSettingsResult;
  /** User-visible line shown on the panic overlay (toasts sit behind z-300). */
  message: string;
};

const ANDROID_PACKAGE = "com.intelafri.omtpulse";

export function preloadLocationSettingsModule(): void {
  /* no-op — settings helpers are statically imported */
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

/** Try intent: links via synthetic anchor (WebView handles these better than location.assign). */
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
      /* try next */
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

async function openViaNativeSettingsPlugin(platform: "android" | "ios"): Promise<boolean> {
  if (platform === "android") {
    for (const option of [
      AndroidSettings.ApplicationDetails,
      AndroidSettings.Location,
    ]) {
      try {
        await withTimeout(NativeSettings.openAndroid({ option }), 3_000);
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
        3_000,
      );
      return true;
    } catch {
      return false;
    }
  }

  try {
    await withTimeout(NativeSettings.openIOS({ option: IOSSettings.App }), 3_000);
    return true;
  } catch {
    return false;
  }
}

async function openViaCapacitorNative(platform: "android" | "ios"): Promise<boolean> {
  if (platform === "android") {
    if (await openOmtAppDetailsSettings()) return true;
    if (await openOmtLocationSourcesSettings()) return true;
  }
  return openViaNativeSettingsPlugin(platform);
}

async function promptBrowserLocation(): Promise<boolean> {
  if (!navigator.geolocation) return false;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      (err) => resolve(err.code !== 1),
      { enableHighAccuracy: false, timeout: 2_500, maximumAge: 60_000 },
    );
  });
}

/**
 * Open app/location settings on native; on web, permission retry then manual steps.
 */
export async function openLocationSettings(): Promise<OpenLocationSettingsResponse> {
  const openedMsg =
    "Settings should be open — turn on Location for OMT Pulse, then return here.";
  const platform = nativePlatform();

  if (platform === "android" || platform === "ios") {
    if (await openViaCapacitorNative(platform)) {
      return { result: "opened", message: openedMsg };
    }
    if (platform === "android" && openAndroidIntentFallback()) {
      return { result: "opened", message: openedMsg };
    }
    if (platform === "ios" && openIosUrlFallback()) {
      return { result: "opened", message: openedMsg };
    }
    return {
      result: "manual",
      message: `Could not open Settings automatically. ${locationSettingsHint()}`,
    };
  }

  if (detectPlatform() === "android" && openAndroidIntentFallback()) {
    return { result: "opened", message: openedMsg };
  }

  if (await promptBrowserLocation()) {
    return {
      result: "prompted",
      message: "If you allowed location, GPS should work when you send.",
    };
  }

  return {
    result: "manual",
    message: locationSettingsHint(),
  };
}
