import { Capacitor, registerPlugin } from "@capacitor/core";

export interface OmtAppSettingsPlugin {
  openAppDetails(): Promise<void>;
  openLocationSources(): Promise<void>;
  isLocationEnabled(): Promise<{ enabled: boolean }>;
  checkMicrophone(): Promise<{ recordAudio: string }>;
  requestMicrophone(): Promise<{ recordAudio: string }>;
  setRadioAudioSession(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
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

export type OmtMicPermission = "granted" | "denied" | "prompt" | "unavailable";

/** Check Android RECORD_AUDIO without prompting. */
export async function checkOmtMicrophonePermission(): Promise<OmtMicPermission> {
  if (!hasOmtAppSettingsPlugin()) return "unavailable";
  try {
    const { recordAudio } = await OmtAppSettings.checkMicrophone();
    if (recordAudio === "granted") return "granted";
    if (recordAudio === "denied") return "denied";
    return "prompt";
  } catch {
    return "unavailable";
  }
}

/**
 * Show the system Allow/Deny microphone dialog (Android).
 * Call from a normal tap — not from hold-to-talk.
 */
export async function requestOmtMicrophonePermission(): Promise<OmtMicPermission> {
  if (!hasOmtAppSettingsPlugin()) return "unavailable";
  try {
    const { recordAudio } = await OmtAppSettings.requestMicrophone();
    if (recordAudio === "granted") return "granted";
    if (recordAudio === "denied") return "denied";
    return "prompt";
  } catch {
    return "denied";
  }
}

/**
 * Force WebRTC radio audio through the phone loudspeaker (not earpiece).
 * No-op on web / older APKs missing the method.
 */
export async function setOmtRadioAudioSession(enabled: boolean): Promise<boolean> {
  if (!hasOmtAppSettingsPlugin()) return false;
  try {
    await OmtAppSettings.setRadioAudioSession({ enabled });
    return true;
  } catch {
    return false;
  }
}
