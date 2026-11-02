import { Capacitor, registerPlugin } from "@capacitor/core";

export interface OmtAppSettingsPlugin {
  openAppDetails(): Promise<void>;
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<{ opened: "already" | "dialog" | "app" }>;
  openLocationSources(): Promise<void>;
  isLocationEnabled(): Promise<{ enabled: boolean }>;
  checkMicrophone(): Promise<{ recordAudio: string }>;
  requestMicrophone(): Promise<{ recordAudio: string }>;
  setRadioAudioSession(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
  appBuild(): Promise<{ build: number }>;
  canUseFullScreenIntent(): Promise<{ allowed: boolean }>;
  requestFullScreenIntent(): Promise<{ opened: "already" | "settings" }>;
  canDrawOverlays(): Promise<{ allowed: boolean }>;
  requestOverlayPermission(): Promise<{ opened: "already" | "settings" }>;
  setQuietUntil(options: { until: number }): Promise<{ until: number }>;
  getQuietUntil(): Promise<{ until: number }>;
  ignoreFire(options: { id: number }): Promise<{ id: number }>;
  getIgnoredFires(): Promise<{ ids: number[] }>;
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

/** True when Android will deliver alerts while the screen is off. null = older app. */
export async function isIgnoringBatteryOptimizations(): Promise<boolean | null> {
  if (!hasOmtAppSettingsPlugin()) return null;
  try {
    const { ignoring } = await OmtAppSettings.isIgnoringBatteryOptimizations();
    return Boolean(ignoring);
  } catch {
    return null;
  }
}

/** Open Android's Allow dialog so alerts are not delayed. */
export async function requestIgnoreBatteryOptimizations(): Promise<"already" | "dialog" | "app" | "unavailable"> {
  if (!hasOmtAppSettingsPlugin()) return "unavailable";
  try {
    const { opened } = await OmtAppSettings.requestIgnoreBatteryOptimizations();
    return opened;
  } catch {
    return "unavailable";
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

export async function setOmtQuietUntil(until: number): Promise<void> {
  if (!hasOmtAppSettingsPlugin()) return;
  try {
    await OmtAppSettings.setQuietUntil({ until });
  } catch { /* older APK */ }
}

const CARD_PROMPT_KEY = "omt_card_prompt_build";
let cardPromptStarted = false;

/**
 * After the farmer home screen has painted, ask once per install and once per
 * update. Full screen notifications first, then Appear on top. Does not reload
 * the page and does not ask again when the app comes back to the front.
 */
export function scheduleFarmerAlertCardPrompt(): void {
  if (cardPromptStarted) return;
  if (import.meta.env.VITE_FARMER_PHONE !== "1") return;
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
  if (!hasOmtAppSettingsPlugin()) return;
  cardPromptStarted = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void runFarmerAlertCardPrompt();
    });
  });
}

async function runFarmerAlertCardPrompt(): Promise<void> {
  let build = "";
  try {
    build = String((await OmtAppSettings.appBuild()).build);
  } catch {
    return;
  }
  try {
    if (localStorage.getItem(CARD_PROMPT_KEY) === build) return;
  } catch {
    return;
  }

  const fullScreen = await allowed("full");
  const overlay = await allowed("over");
  if (fullScreen && overlay) {
    rememberCardPrompt(build);
    return;
  }

  const steps: Array<"full" | "over"> = [];
  if (!fullScreen) steps.push("full");
  if (!overlay) steps.push("over");
  let index = 0;
  let leftTheApp = false;

  const finish = () => {
    document.removeEventListener("visibilitychange", onVisible);
    rememberCardPrompt(build);
  };

  const onVisible = () => {
    if (document.visibilityState === "hidden") {
      leftTheApp = true;
      return;
    }
    if (!leftTheApp || document.visibilityState !== "visible") return;
    leftTheApp = false;
    index += 1;
    if (index >= steps.length) {
      finish();
      return;
    }
    void openCardStep(steps[index]);
  };

  document.addEventListener("visibilitychange", onVisible);
  const opened = await openCardStep(steps[0]);
  if (opened !== "settings") {
    document.removeEventListener("visibilitychange", onVisible);
    if (steps.length > 1) {
      const second = await openCardStep(steps[1]);
      if (second === "settings") {
        document.addEventListener("visibilitychange", onVisible);
        index = 1;
        return;
      }
    }
    rememberCardPrompt(build);
  }
}

function rememberCardPrompt(build: string) {
  try {
    localStorage.setItem(CARD_PROMPT_KEY, build);
  } catch { /* ignore */ }
}

async function allowed(kind: "full" | "over"): Promise<boolean> {
  try {
    if (kind === "full") return Boolean((await OmtAppSettings.canUseFullScreenIntent()).allowed);
    return Boolean((await OmtAppSettings.canDrawOverlays()).allowed);
  } catch {
    return true;
  }
}

async function openCardStep(kind: "full" | "over"): Promise<"already" | "settings" | "failed"> {
  try {
    if (kind === "full") return (await OmtAppSettings.requestFullScreenIntent()).opened;
    return (await OmtAppSettings.requestOverlayPermission()).opened;
  } catch {
    return "failed";
  }
}
