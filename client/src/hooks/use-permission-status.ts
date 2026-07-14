import { useState, useEffect } from "react";

export type PermissionState = "granted" | "denied" | "prompt" | "unsupported";

export interface PermissionStatus {
  camera: PermissionState;
  microphone: PermissionState;
  location: PermissionState;
}

const NAMES: Array<{ key: keyof PermissionStatus; name: PermissionName }> = [
  { key: "camera", name: "camera" as PermissionName },
  { key: "microphone", name: "microphone" as PermissionName },
  { key: "location", name: "geolocation" as PermissionName },
];

const isPermissionsSupported =
  typeof window !== "undefined" &&
  window.isSecureContext &&
  !!navigator.permissions;

// Probe actual geolocation access — more reliable than the Permissions API
// in Capacitor WebView where navigator.permissions may lag or lie.
// External safety-net timer ensures this never hangs forever (Capacitor's
// WebView sometimes ignores the built-in `timeout` option).
function probeGeolocation(): Promise<PermissionState> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve("unsupported");
      return;
    }
    let settled = false;
    const settle = (state: PermissionState) => {
      if (!settled) { settled = true; resolve(state); }
    };

    // External safety net: if getCurrentPosition hangs (Capacitor quirk),
    // treat as still pending — do not falsely clear the location overlay.
    const safetyTimer = setTimeout(() => settle("prompt"), 6000);

    navigator.geolocation.getCurrentPosition(
      () => { clearTimeout(safetyTimer); settle("granted"); },
      (err) => {
        clearTimeout(safetyTimer);
        if (err.code === 1 /* PERMISSION_DENIED */) {
          settle("denied");
        } else {
          // POSITION_UNAVAILABLE or TIMEOUT — permission may be OK but phone GPS is off.
          settle("prompt");
        }
      },
      { timeout: 5000, maximumAge: Infinity, enableHighAccuracy: false }
    );
  });
}

export function usePermissionStatus(): PermissionStatus {
  const [status, setStatus] = useState<PermissionStatus>({
    camera: "prompt",
    microphone: "prompt",
    location: "prompt",
  });

  useEffect(() => {
    if (!isPermissionsSupported) {
      setStatus({ camera: "unsupported", microphone: "unsupported", location: "unsupported" });
      return;
    }

    let cancelled = false;
    const cleanups: Array<() => void> = [];

    let resolvedResults: Array<{ key: keyof PermissionStatus; permStatus: globalThis.PermissionStatus | null }> = [];

    async function checkAll() {
      // 1. Query the Permissions API
      const results = await Promise.all(
        NAMES.map(async ({ key, name }) => {
          try {
            const permStatus = await navigator.permissions.query({ name });
            return { key, permStatus };
          } catch {
            return { key, permStatus: null };
          }
        })
      );

      if (cancelled) return;
      resolvedResults = results;

      const initial: PermissionStatus = { camera: "prompt", microphone: "prompt", location: "prompt" };
      for (const { key, permStatus } of results) {
        initial[key] = permStatus ? (permStatus.state as PermissionState) : "unsupported";
      }

      // 2. If Permissions API says location is "prompt", probe actual access.
      //    Capacitor WebView often reports "prompt" even after the user has
      //    already granted the native permission.
      if (initial.location === "prompt") {
        const probed = await probeGeolocation();
        if (!cancelled) initial.location = probed;
      }

      if (!cancelled) setStatus(initial);

      // 3. Listen for browser-level permission change events (Chrome/Android)
      for (const { key, permStatus } of results) {
        if (!permStatus) continue;
        const handler = () => {
          if (!cancelled) {
            setStatus((prev) => ({ ...prev, [key]: permStatus.state as PermissionState }));
          }
        };
        permStatus.addEventListener("change", handler);
        cleanups.push(() => permStatus.removeEventListener("change", handler));
      }

      // 4. Visibility-change fallback — re-probe on every app foreground.
      //    Capacitor on Android doesn't fire the Permissions `change` event
      //    after the native dialog closes, so we re-probe here.
      const onVisibility = async () => {
        if (cancelled || document.visibilityState !== "visible") return;
        const updated: PermissionStatus = { camera: "prompt", microphone: "prompt", location: "prompt" };
        for (const { key, permStatus } of resolvedResults) {
          updated[key] = permStatus ? (permStatus.state as PermissionState) : "unsupported";
        }
        // Always re-probe actual geolocation on foreground in case native
        // permission was granted/revoked while the app was backgrounded.
        const probed = await probeGeolocation();
        if (!cancelled) updated.location = probed;
        if (!cancelled) setStatus(updated);
      };
      document.addEventListener("visibilitychange", onVisibility);
      cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));

      // 5. Listen for the custom event fired by the Allow button after a
      //    successful getCurrentPosition call.
      const onGranted = () => {
        if (!cancelled) setStatus((prev) => ({ ...prev, location: "granted" }));
      };
      window.addEventListener("omt:location-granted", onGranted);
      cleanups.push(() => window.removeEventListener("omt:location-granted", onGranted));
    }

    checkAll();

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return status;
}
