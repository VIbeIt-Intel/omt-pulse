/** Pathname for session-auth `/objects/...` URLs, including absolute hosts. */
export function toObjectPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed;

  const idx = trimmed.indexOf("/objects/");
  if (idx >= 0) {
    return trimmed.slice(idx).split("?")[0] || null;
  }

  if (trimmed.startsWith("/")) return trimmed.split("?")[0] || null;
  return trimmed;
}
