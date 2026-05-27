let loadPromise: Promise<void> | null = null;

export function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (loadPromise) return loadPromise;
  if (window.google?.maps) return Promise.resolve();

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "";
  if (!key) {
    loadPromise = Promise.reject(new Error("Google Maps API key is not configured"));
    return loadPromise;
  }

  loadPromise = new Promise((resolve, reject) => {
    const callbackName = "__gmapsLoaded";
    let settled = false;

    function fail(reason: string) {
      if (settled) return;
      settled = true;
      loadPromise = null;
      delete (window as any)[callbackName];
      delete (window as any).gm_authFailure;
      reject(new Error(reason));
    }

    async function succeed() {
      if (settled) return;
      try {
        // In newer Google Maps bootstrap versions, google.maps.visualization is
        // NOT synchronously populated even when libraries=visualization is in the
        // URL. Calling importLibrary here forces the namespace to fully register
        // before any component tries to access HeatmapLayer.
        if (typeof (google.maps as any).importLibrary === "function") {
          await (google.maps as any).importLibrary("visualization");
        }
      } catch {
        // Very old API version without importLibrary — visualization should
        // already be available synchronously via the libraries= parameter.
      }
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      delete (window as any)[callbackName];
      delete (window as any).gm_authFailure;
      resolve();
    }

    (window as any)[callbackName] = succeed;
    (window as any).gm_authFailure = () => fail("Google Maps authentication failed — check API key");

    const timer = setTimeout(() => fail("Google Maps load timed out"), 12000);

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&v=weekly&libraries=places,geometry,visualization&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      clearTimeout(timer);
      fail("Failed to load Google Maps script");
    };

    document.head.appendChild(script);
  });

  return loadPromise;
}
