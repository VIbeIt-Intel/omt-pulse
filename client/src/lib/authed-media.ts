import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-base";
import { toObjectPath } from "@shared/object-url";

/** Pathname for /objects/… so credentialed fetch works on the site and Capacitor. */
export function mediaSrc(url: string): string {
  return toObjectPath(url) ?? url;
}

function revokeQuietly(url: string | null) {
  if (url?.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
}

/** Ensure the blob actually decodes as an image before we hand it to &lt;img&gt;. */
function createDecodableImageUrl(blob: Blob): Promise<string> {
  const objectUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(objectUrl);
    img.onerror = () => {
      revokeQuietly(objectUrl);
      reject(new Error("image decode failed"));
    };
    img.src = objectUrl;
  });
}

function shouldDecodeAsImage(path: string, blob: Blob): boolean {
  const type = (blob.type || "").toLowerCase();
  if (type.startsWith("audio/") || type.startsWith("video/")) return false;
  if (type.startsWith("image/")) return true;
  if (path.startsWith("data:image/")) return true;
  // GCS sometimes stores uploads as octet-stream; try decode for those.
  return type === "" || type === "application/octet-stream";
}

/**
 * Media behind session-auth /objects/. Bare &lt;img&gt;/&lt;audio&gt; src
 * breaks on the local Capacitor shell — fetch with credentials, then blob URL.
 *
 * Also converts data: URLs to blob URLs (Android WebView often fails large data: imgs)
 * and clears stale src while reloading so a revoked blob never shows as a broken icon.
 */
export function useAuthedMediaUrl(
  rawUrl: string | null | undefined,
): { src: string | null; loading: boolean; error: boolean } {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function load() {
      if (!rawUrl) {
        setSrc(null);
        setError(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(false);
      // Drop any previous src immediately so a revoked blob URL cannot paint
      // the browser's broken-image icon while the next fetch runs.
      setSrc(null);

      try {
        const path = mediaSrc(rawUrl);
        let blob: Blob;

        if (path.startsWith("blob:") || path.startsWith("data:")) {
          const res = await fetch(path);
          if (!res.ok) throw new Error(`media ${res.status}`);
          blob = await res.blob();
        } else {
          const res = await fetch(apiUrl(path), { credentials: "include" });
          if (!res.ok) throw new Error(`media ${res.status}`);
          blob = await res.blob();
        }

        if (shouldDecodeAsImage(path, blob)) {
          objectUrl = await createDecodableImageUrl(blob);
        } else {
          objectUrl = URL.createObjectURL(blob);
        }

        if (cancelled) {
          revokeQuietly(objectUrl);
          objectUrl = null;
          return;
        }
        setSrc(objectUrl);
      } catch {
        if (!cancelled) {
          setError(true);
          setSrc(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      revokeQuietly(objectUrl);
    };
  }, [rawUrl]);

  return { src, loading, error };
}
