import { Capacitor } from "@capacitor/core";

/** User-facing steps when mic access fails in the native Android/iOS shell. */
export function nativeMicDeniedHint(): string {
  if (Capacitor.isNativePlatform()) {
    return "Settings → Apps → OMT Pulse → Permissions → Microphone → Allow, then try again.";
  }
  return "Enable microphone access in your browser or device settings and try again.";
}
