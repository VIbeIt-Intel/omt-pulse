/** Pick a MediaRecorder mime type; undefined → use browser default (needed on some Android WebViews). */
export function pickAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mpeg",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

export function createAudioMediaRecorder(stream: MediaStream): MediaRecorder {
  const mimeType = pickAudioMimeType();
  if (mimeType) {
    try {
      return new MediaRecorder(stream, { mimeType });
    } catch {
      /* fall through to default */
    }
  }
  return new MediaRecorder(stream);
}

export function recorderMimeType(recorder: MediaRecorder, fallback?: string): string {
  return recorder.mimeType || fallback || "audio/webm";
}

export async function openMicStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException("Audio recording is not supported on this device.", "NotSupportedError");
  }
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

export function recordingErrorMessage(err: unknown): { title: string; description: string } {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      return {
        title: "Microphone access denied",
        description: "mic-denied", // caller replaces with nativeMicDeniedHint()
      };
    }
    if (err.name === "NotSupportedError") {
      return {
        title: "Recording not supported",
        description: "This device or app version cannot record voice notes. Update the OMT Pulse app from Play Store.",
      };
    }
    if (err.name === "NotFoundError") {
      return {
        title: "No microphone found",
        description: "This device does not have a microphone available.",
      };
    }
  }
  if (err instanceof Error && err.message.trim()) {
    const msg = err.message.trim();
    if (/permission/i.test(msg)) {
      return { title: "Microphone access denied", description: "mic-denied" };
    }
    return { title: "Recording failed", description: msg };
  }
  return {
    title: "Recording failed",
    description: "needs-apk-update",
  };
}
