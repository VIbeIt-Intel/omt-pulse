import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-base";
import { toObjectPath } from "@shared/object-url";

/** Pathname for /objects/… so credentialed fetch works on the site and Capacitor. */
export function mediaSrc(url: string): string {
  return toObjectPath(url) ?? url;
}

/**
 * Media behind session-auth /objects/. Bare &lt;img&gt;/&lt;audio&gt; src
 * breaks on the local Capacitor shell — fetch with credentials, then blob URL.
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

      const path = mediaSrc(rawUrl);
      if (path.startsWith("data:") || path.startsWith("blob:")) {
        setSrc(path);
        setError(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(false);
      try {
        const res = await fetch(apiUrl(path), { credentials: "include" });
        if (!res.ok) throw new Error(`media ${res.status}`);
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(objectUrl);
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
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [rawUrl]);

  return { src, loading, error };
}
