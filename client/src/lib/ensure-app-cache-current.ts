import { APP_CACHE_VERSION } from "@shared/cache-version";

async function querySwCacheVersion(): Promise<string | null> {
  if (!("serviceWorker" in navigator)) return null;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return null;

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(null), 800);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      resolve(typeof event.data?.version === "string" ? event.data.version : null);
    };
    try {
      controller.postMessage({ type: "GET_VERSION" }, [channel.port2]);
    } catch {
      window.clearTimeout(timer);
      resolve(null);
    }
  });
}

async function nukeCachesAndReload(): Promise<void> {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }

  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.active) {
        reg.active.postMessage({ type: "CLEAR_ALL_CACHES_AND_RELOAD" });
      }
      await reg?.unregister().catch(() => {});
    }
  } catch {
    /* ignore */
  }

  window.location.reload();
}

/**
 * If the active service worker or cache buckets are from an older build,
 * wipe everything and reload once so deploys actually reach the device.
 */
export async function ensureAppCacheCurrent(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("caches" in window)) return;

  try {
    // Server truth — works even before the service worker has taken control.
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { cacheVersion?: string };
        if (data.cacheVersion && data.cacheVersion !== APP_CACHE_VERSION) {
          await nukeCachesAndReload();
          return;
        }
      }
    } catch {
      /* offline — fall through to SW cache checks */
    }

    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();

    const swVersion = await querySwCacheVersion();
    const cacheKeys = await caches.keys();
    const staleBuckets = cacheKeys.filter(
      (k) => k.startsWith("omt-v") && k !== APP_CACHE_VERSION,
    );

    if (staleBuckets.length > 0 || (swVersion && swVersion !== APP_CACHE_VERSION)) {
      await nukeCachesAndReload();
    }
  } catch {
    /* never block app boot */
  }
}
