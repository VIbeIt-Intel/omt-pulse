const CACHE_NAME = "omt-v120";

// When the page asks us to nuke everything (after a new deploy), wipe all
// caches and tell every controlled tab to reload. The page also unregisters
// the SW separately so the next load installs a fresh worker.
self.addEventListener("message", (event) => {
  // Reply to diagnostic ping with the current cache version so the in-app
  // debug overlay can show which SW build is actually running on the device.
  if (event.data?.type === "GET_VERSION") {
    const port = event.ports?.[0];
    if (port) port.postMessage({ version: CACHE_NAME });
    return;
  }
  if (event.data?.type === "CLEAR_ALL_CACHES_AND_RELOAD") {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      cs.forEach((c) => c.postMessage({ type: "RELOAD_NOW" }));
    })());
  }
});

// During install we pre-cache the entire app shell by:
//  1. Fetching the root HTML page.
//  2. Parsing every <script src> and <link href> to discover Vite's
//     fingerprinted JS/CSS bundles (unknown at SW-write time).
//  3. Caching all of them so the very next launch is instant.
// API routes and streamed files are never cached.
async function precacheAppShell(cache) {
  // Fetch and cache the root HTML.
  const rootResponse = await fetch("/");
  if (!rootResponse.ok) return;
  await cache.put("/", rootResponse.clone());
  const html = await rootResponse.text();

  // Extract Vite-generated asset URLs referenced in the HTML.
  const assetUrls = new Set([
    "/manifest.webmanifest",
    "/icon-192.png",
    "/icon-512.png",
  ]);
  for (const [, src] of html.matchAll(/\ssrc="(\/[^"]+)"/g)) {
    if (!src.startsWith("/api/") && !src.startsWith("/objects/")) assetUrls.add(src);
  }
  for (const [, href] of html.matchAll(/\shref="(\/[^"]+)"/g)) {
    if (!href.startsWith("/api/") && !href.startsWith("/objects/")) assetUrls.add(href);
  }

  // Cache all discovered assets in parallel; ignore individual failures.
  await Promise.allSettled(
    [...assetUrls].map((url) =>
      fetch(url).then((r) => { if (r.ok) cache.put(url, r); })
    )
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(precacheAppShell)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Never cache API calls or streamed object/file responses.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/objects/")) return;

  // Always fetch a fresh service worker script so CACHE_NAME bumps propagate.
  if (url.pathname === "/sw.js") {
    event.respondWith(fetch(event.request));
    return;
  }

  // Navigation requests (full-page loads / Android WebView restores) must always
  // receive the cached app shell so the SPA can boot even after a process kill.
  // Serve the cached "/" response for every navigate request; update the shell
  // in the background so future loads get the latest version.
  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        // Network-first for HTML shell so deploys pick up new hashed JS bundles.
        try {
          const networkResponse = await fetch("/");
          if (networkResponse.ok) {
            await cache.put("/", networkResponse.clone());
            return networkResponse;
          }
        } catch {
          // offline — fall back to cached shell below
        }
        const shell = await cache.match("/");
        return shell || Response.error();
      })
    );
    return;
  }

  // Hashed Vite bundles: network-first so deploys reach devices without stale JS.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse.ok) {
            await cache.put(event.request, networkResponse.clone());
            return networkResponse;
          }
        } catch {
          const cached = await cache.match(event.request);
          if (cached) return cached;
        }
        return Response.error();
      }),
    );
    return;
  }

  // Cache-first: serve from cache instantly if available; otherwise fetch from
  // network and store the result for subsequent visits.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      const networkFetch = fetch(event.request).then((response) => {
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      });
      return cached || networkFetch;
    })
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    console.error("[SW] Push payload parse error", e);
  }

  // Clear badge signal
  if (data.type === "clearBadge") {
    event.waitUntil(
      Promise.all([
        self.registration.getNotifications().then((ns) => ns.forEach((n) => n.close())),
        navigator.clearAppBadge ? navigator.clearAppBadge() : Promise.resolve(),
      ])
    );
    return;
  }

  // Tell open windows to refresh
  if (data.type === "incident_started" || data.type === "incident_closed" || data.type === "incident_update") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true })
        .then((clients) => clients.forEach((client) => client.postMessage({ type: "INVALIDATE_LIVE" })))
    );
  }
  if (data.type === "panic" || data.type === "panic_acknowledged" || data.type === "panic_ack_update") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true })
        .then((clients) => clients.forEach((client) => client.postMessage({ type: "INVALIDATE_PANIC" })))
    );
  }

  // Silent updates
  if (data.silent === true) {
    event.waitUntil(
      self.registration.showNotification(data.title ?? "🚨 Update", {
        body: data.body ?? "Status changed",
        icon: "/icon-192.png",
        badge: "/panic-dot.png",
        tag: "panic-update",
        requireInteraction: true,
      })
    );
    return;
  }

  // Set app badge
  if (navigator.setAppBadge) {
    navigator.setAppBadge(1).catch(() => {});
  }

  const isPanic = data.type === "panic";
  const isChat = data.type === "chat_message";

  event.waitUntil(
    self.registration.showNotification(data.title ?? "🚨 Live Incident", {
      body: data.body ?? "A live incident has been triggered.",
      icon: "/icon-192.png",
      badge: isPanic ? "/panic-dot.png" : "/icon-192.png",
      tag: isPanic ? `panic-${Date.now()}` : `incident-${data.incidentId || Date.now()}`,
      requireInteraction: !isChat,
      vibrate: isPanic
        ? [600, 150, 600, 150, 600, 150, 1000]
        : isChat
        ? [100]
        : [300, 100, 300, 100, 600],
      // data is required so notificationclick can read the deep-link URL.
      data: { url: data.url ?? "/" },
    })
  );
});

function rewritePushDeepLinkPath(url) {
  if (typeof url !== "string" || !url.startsWith("/")) return "/";
  const m = url.match(/^\/live-monitor\?incidentId=(\d+)/);
  if (m) return `/live-incident?join=${m[1]}`;
  return url;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = event.notification.data?.url ?? "/";
  const path = rewritePushDeepLinkPath(rawUrl);
  const isExternal = rawUrl.startsWith("http") && !rawUrl.startsWith(self.location.origin);
  const inAppUrl = new URL(path, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      if (isExternal) {
        if (clients.openWindow) return clients.openWindow(rawUrl);
        return;
      }
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          if ("navigate" in client) client.navigate(path);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(inAppUrl);
    })
  );
});
