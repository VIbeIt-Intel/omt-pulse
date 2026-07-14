import { Capacitor, registerPlugin } from "@capacitor/core";

export interface OmtAppSettingsPlugin {
  openAppDetails(): Promise<void>;
  openLocationSources(): Promise<void>;
  isLocationEnabled(): Promise<{ enabled: boolean }>;
}

const OmtAppSettings = registerPlugin<OmtAppSettingsPlugin>("OmtAppSettings");

export function hasOmtAppSettingsPlugin(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("OmtAppSettings");
}

/**
 * System Location on/off (not app permission).
 * null = plugin/method unavailable (web or older APK) — caller must use heuristics.
 */
export async function getOmtLocationServicesEnabled(): Promise<boolean | null> {
  if (!hasOmtAppSettingsPlugin()) return null;
  try {
    const { enabled } = await OmtAppSettings.isLocationEnabled();
    return Boolean(enabled);
  } catch {
    return null;
  }
}

/** Open this app's permission screen (Android) or app settings (iOS via other fallbacks). */
export async function openOmtAppDetailsSettings(): Promise<boolean> {
  if (!hasOmtAppSettingsPlugin()) return false;
  try {
    await OmtAppSettings.openAppDetails();
    return true;
  } catch {
    return false;
  }
}

/** Open system Location on/off screen (Android). */
export async function openOmtLocationSourcesSettings(): Promise<boolean> {
  if (!hasOmtAppSettingsPlugin()) return false;
  try {
    await OmtAppSettings.openLocationSources();
    return true;
  } catch {
    return false;
  }
}
