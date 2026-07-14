/** Estimate decoded byte length of a data: URL, or null if not derivable. */
export function byteSizeFromDataUrl(url: string): number | null {
  if (!url.startsWith("data:")) return null;
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  const meta = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  if (!/;base64/i.test(meta)) {
    try {
      return decodeURIComponent(payload).length;
    } catch {
      return payload.length;
    }
  }
  const clean = payload.replace(/\s/g, "");
  if (!clean) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/** Prefer an explicit size; otherwise derive from a data: URL. */
export function resolveAttachmentByteSize(
  url: string,
  explicit?: number | null,
): number | null {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
    return Math.floor(explicit);
  }
  return byteSizeFromDataUrl(url);
}
