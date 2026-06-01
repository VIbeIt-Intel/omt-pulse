import { Capacitor } from "@capacitor/core";
import { CapacitorAudioRecorder } from "@capgo/capacitor-audio-recorder";

export type NativeRecordingMode = "plugin" | "legacy-apk" | "web";

export function getNativeRecordingMode(): NativeRecordingMode {
  if (!Capacitor.isNativePlatform()) return "web";
  return Capacitor.isPluginAvailable("CapacitorAudioRecorder") ? "plugin" : "legacy-apk";
}

export function isNativeAudioRecorderAvailable(): boolean {
  return getNativeRecordingMode() === "plugin";
}

export function isCapacitorNativeShell(): boolean {
  return Capacitor.isNativePlatform();
}

export async function requestNativeMicPermission(): Promise<boolean> {
  const perm = await CapacitorAudioRecorder.requestPermissions();
  return perm.recordAudio === "granted";
}

export async function startNativeRecording(): Promise<void> {
  const checked = await CapacitorAudioRecorder.checkPermissions();
  let perm = checked;
  if (checked.recordAudio !== "granted") {
    perm = await CapacitorAudioRecorder.requestPermissions();
  }
  if (perm.recordAudio !== "granted") {
    throw new DOMException("Microphone permission denied", "NotAllowedError");
  }
  await CapacitorAudioRecorder.startRecording();
}

export async function stopNativeRecording(): Promise<{ blob: Blob; mimeType: string }> {
  const result = await CapacitorAudioRecorder.stopRecording();
  if (result.blob) {
    return { blob: result.blob, mimeType: result.blob.type || "audio/webm" };
  }
  if (result.uri) {
    const url = Capacitor.convertFileSrc(result.uri);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Could not read recorded audio");
    const blob = await resp.blob();
    return { blob, mimeType: blob.type || "audio/mp4" };
  }
  throw new Error("Recording produced no audio");
}

export async function cancelNativeRecording(): Promise<void> {
  try {
    await CapacitorAudioRecorder.cancelRecording();
  } catch {
    /* ignore */
  }
}
