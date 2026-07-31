import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../replit_integrations/object_storage/objectStorage";

function toObjectEntityPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/objects/")) {
    return trimmed.split("?")[0] || null;
  }
  try {
    const url = new URL(trimmed, "https://omtpulse.com");
    const idx = url.pathname.indexOf("/objects/");
    if (idx >= 0) return url.pathname.slice(idx).split("?")[0] || null;
  } catch {
    /* ignore */
  }
  return null;
}

/** Best-effort delete of a stored object URL or `/objects/...` path. */
export async function tryDeleteStoredObject(urlOrPath: string | null | undefined): Promise<void> {
  if (!urlOrPath) return;
  const objectPath = toObjectEntityPath(urlOrPath);
  if (!objectPath) return;
  try {
    const service = new ObjectStorageService();
    const file = await service.getObjectEntityFile(objectPath);
    await file.delete({ ignoreNotFound: true });
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return;
    // Storage may be unconfigured in some environments — never fail the purge.
    if (err instanceof Error && /PRIVATE_OBJECT_DIR|not set/i.test(err.message)) return;
    console.warn(
      "[retention] object delete failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
