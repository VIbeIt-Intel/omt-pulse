let loadPromise: Promise<void> | null = null;

/** Reset after a failed load so callers can retry. */
export function resetGoogleMapsLoader(): void {
  loadPromise = null;
  delete (window as any).gm_authFailure;
}

export function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps?.Map) return Promise.resolve();
  if (loadPromise) return loadPromise;

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "";
  if (!key) {
    return Promise.reject(new Error("Google Maps API key is not configured in this build"));
  }

  loadPromise = new Promise((resolve, reject) => {
    const callbackName = "__gmapsLoaded";
    let settled = false;

    function fail(reason: string) {
      if (settled) return;
      settled = true;
      loadPromise = null;
      clearTimeout(timer);
      delete (window as any)[callbackName];
      delete (window as any).gm_authFailure;
      reject(new Error(reason));
    }

    function succeed() {
      if (settled) return;
      if (!window.google?.maps?.Map) {
        fail("Google Maps loaded but Map constructor is missing");
        return;
      }
      settled = true;
      clearTimeout(timer);
      delete (window as any)[callbackName];
      delete (window as any).gm_authFailure;
      resolve();
    }

    (window as any)[callbackName] = succeed;
    (window as any).gm_authFailure = () =>
      fail("Google Maps authentication failed — check API key restrictions for https://omtpulse.com");

    const timer = setTimeout(() => fail("Google Maps load timed out after 15s"), 15000);

    const existing = document.querySelector('script[data-omt-gmaps="1"]');
    if (existing) {
      existing.addEventListener("load", () => succeed(), { once: true });
      existing.addEventListener("error", () => fail("Failed to load Google Maps script"), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.dataset.omtGmaps = "1";
    // places + geometry only (directions, geocoding, search). No visualization —
    // analytics heatmaps use Leaflet; loading visualization was blocking/hanging
    // the bootstrap on some clients.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=places,geometry&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => fail("Failed to load Google Maps script (network or CSP block)");
    document.head.appendChild(script);
  });

  return loadPromise;
}
