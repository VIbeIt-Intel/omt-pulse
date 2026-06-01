import { Capacitor } from "@capacitor/core";

/** User-facing steps when mic access fails in the native Android/iOS shell. */
export function nativeMicDeniedHint(): string {
  if (Capacitor.isNativePlatform()) {
    return "Settings → Apps → OMT Pulse → Permissions → Microphone → Allow, then try again.";
  }
  return "Enable microphone access in your browser or device settings and try again.";
}

/** Shown when the installed APK lacks the native voice recorder plugin (< 1.0.3). */
export function nativeVoiceApkUpdateHint(): string {
  return "Install OMT Pulse 1.0.3 or newer (GitHub Actions → omt-test-apk), or use Attach → Audio file as a workaround.";
}
