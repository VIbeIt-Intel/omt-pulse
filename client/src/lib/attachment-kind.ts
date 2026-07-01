/** Infer attachment kind when MIME is missing or generic (common on mobile voice notes). */
export function resolveAttachmentKind(
  mimeType?: string | null,
  filename?: string | null,
): "audio" | "image" | "file" {
  const mime = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const name = (filename ?? "").toLowerCase();

  const audioExt = /\.(webm|m4a|mp3|ogg|wav|aac|caf)(\?|$)/.test(name);
  const voiceHint = name.includes("voice-note") || name.includes("voice_note");

  if (mime.startsWith("audio/")) return "audio";
  if (mime === "video/webm" && (voiceHint || audioExt)) return "audio";
  if ((mime === "application/octet-stream" || mime === "" || mime === "video/webm") && (audioExt || voiceHint)) {
    return "audio";
  }
  if (mime.startsWith("image/")) return "image";
  if (/\.(jpe?g|png|gif|webp|heic|heif)(\?|$)/.test(name)) return "image";
  return "file";
}

export function normalizeAudioMimeType(mimeType: string, filename?: string): string {
  const mime = mimeType.split(";")[0]?.trim().toLowerCase() || "";
  const name = (filename ?? "").toLowerCase();
  if (mime.startsWith("audio/")) return mime;
  if (mime === "video/webm" || name.endsWith(".webm")) return "audio/webm";
  if (name.endsWith(".m4a") || name.endsWith(".mp4")) return "audio/mp4";
  if (name.endsWith(".ogg")) return "audio/ogg";
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  return "audio/webm";
}
