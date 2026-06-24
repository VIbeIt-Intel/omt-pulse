import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { GoogleMap, MapType } from '@capacitor/google-maps';
import { CapacitorGoogleMaps } from '@capacitor/google-maps/dist/esm/implementation';
import { registerPlugin } from '@capacitor/core';
import { pathFromDirectionsRoute } from '@/lib/decode-polyline';

// Direct handle to the native plugin so we can call OMT-patched methods
// (e.g. setGestures) that the upstream JS wrapper doesn't expose. Safe to
// call on web too — registerPlugin returns a stub that resolves no-ops.
const NativeMapsPlugin = registerPlugin<{
  setGestures(opts: {
    id: string;
    tiltGestures?: boolean;
    rotateGestures?: boolean;
    zoomGestures?: boolean;
    scrollGestures?: boolean;
  }): Promise<void>;
  getRenderer(): Promise<{ renderer: string }>;
}>('CapacitorGoogleMaps');

const NATIVE_MAP_ID = 'cap-live-map';

// ─── Exported types ────────────────────────────────────────────────────────────

/**
 * LatLng wrapper with .lat()/.lng() methods so NativeStep is drop-in
 * compatible with google.maps.DirectionsStep inside live-incident.tsx.
 */
export interface LatLngLike {
  lat: () => number;
  lng: () => number;
}

/**
 * Step shape that mirrors the google.maps.DirectionsStep fields that
 * live-incident.tsx actually reads — instructions, distance, start/end_location,
 * and maneuver.  Cast to google.maps.DirectionsStep when stored in stepsRef.
 */
export interface NativeStep {
  instructions: string;
  distance: { value: number; text: string };
  duration: { value: number; text: string };
  start_location: LatLngLike;
  end_location: LatLngLike;
  maneuver?: string;
}

export interface NativeRouteResult {
  steps: NativeStep[];
  distance: number;  // metres
  duration: number;  // seconds
  /** Road-following path used for the drawn polyline (off-route detection). */
  path: Array<{ lat: number; lng: number }>;
}

/** Methods exposed to live-incident.tsx via ref */
export interface CapacitorMapHandle {
  setCamera(opts: {
    animationDuration?: number;
    lat: number;
    lng: number;
    zoom?: number;
    bearing?: number;
    tilt?: number;
    animate?: boolean;
  }): Promise<void>;

  drawRoute(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
    skipFitBounds?: boolean,
  ): Promise<NativeRouteResult | null>;

  clearRoute(): Promise<void>;

  addMarker(opts: {
    lat: number;
    lng: number;
    title?: string;
    tintColor?: { r: number; g: number; b: number; a: number };
  }): Promise<string>;

  removeMarker(id: string): Promise<void>;

  /** Place or update the "you are here" blue dot. Idempotent. */
  setUserLocation(lat: number, lng: number): Promise<void>;

  /**
   * Per-gesture lock. Pass `false` to disable a specific gesture, `true` to
   * re-enable, omit to leave unchanged. Used by nav mode to disable tilt+rotate
   * gestures so the Android Maps SDK's gesture-settle deceleration can't
   * flatten the camera tilt back to 0° after each setCamera. Native-only —
   * no-op on web (web map uses the JS API, which doesn't have this issue).
   */
  setGestures(opts: {
    tilt?: boolean;
    rotate?: boolean;
    zoom?: boolean;
    scroll?: boolean;
  }): Promise<void>;

  /**
   * Set the base map tile style — "Normal" (default streets), "Hybrid"
   * (satellite imagery + road labels), or "Satellite" (pure imagery, no
   * labels). Works on both native and the JS fallback map.
   */
  setMapType(type: "Normal" | "Hybrid" | "Satellite"): Promise<void>;

  /** Re-sync native MapView bounds after DOM layout moves (Capacitor only tracks size, not position). */
  syncBounds(): Promise<void>;
}

interface CapacitorMapProps {
  apiKey: string;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  className?: string;
  style?: React.CSSProperties;
  onReady?: () => void;
  onError?: (err: unknown) => void;
  /** Called once after map ready with the actual Maps SDK renderer name ("LATEST", "LEGACY", or "unknown"). */
  onRendererKnown?: (renderer: string) => void;
  /** Called every time the camera settles with the actual tilt/zoom/bearing reported by the SDK. */
  onCameraIdle?: (data: { tilt: number; zoom: number; bearing: number }) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Surface a native-map failure to the diagnostic overlay.
 *
 * The overlay in live-incident.tsx listens on `window` for `error` events and
 * displays the last few in its "Recent errors" panel. By dispatching a
 * synthetic ErrorEvent here we get visibility into Capacitor plugin failures
 * (silent marker rejections, polyline schema errors, tilt/angle rejections)
 * that would otherwise vanish into a `.catch(() => {})` and leave us blind.
 */
function reportNativeError(op: string, err: unknown) {
  const msg = `[CapacitorMap.${op}] ${err instanceof Error ? err.message : String(err)}`;
  // Browser console for `adb logcat`
  console.warn(msg, err);
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new ErrorEvent('error', { message: msg }));
  } catch {
    // Some WebViews don't allow constructing ErrorEvent directly — fall back
    // to a plain Event so the listener at least fires.
    try { window.dispatchEvent(new Event('error')); } catch { /* give up */ }
  }
}

/** Rough zoom level from a lat/lng bounding box (good enough for route fit) */
function zoomFromBounds(
  minLat: number, maxLat: number,
  minLng: number, maxLng: number,
): number {
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  const maxSpan = Math.max(latSpan, lngSpan / 2);
  if (maxSpan <= 0) return 15;
  const zoom = Math.floor(Math.log2(180 / maxSpan));
  return Math.min(Math.max(zoom, 8), 15);
}

// ─── Component ─────────────────────────────────────────────────────────────────

const CapacitorMap = forwardRef<CapacitorMapHandle, CapacitorMapProps>(
  ({ apiKey, initialCenter = { lat: -26.2041, lng: 28.0473 }, initialZoom = 6,
     className, style, onReady, onError, onRendererKnown, onCameraIdle }, ref) => {

    const elementRef = useRef<HTMLDivElement>(null);
    const mapRef     = useRef<GoogleMap | null>(null);
    const polyIdsRef = useRef<string[]>([]);
    const userMarkerIdRef = useRef<string>('');
    // Coalesced GPS updates — see setUserLocation for the race-avoidance rationale.
    const pendingUserPosRef = useRef<{ lat: number; lng: number } | null>(null);
    const userMarkerBusyRef = useRef<boolean>(false);
    const lastSyncedBoundsRef = useRef({ x: -1, y: -1, width: -1, height: -1 });

    const syncBounds = useCallback(async () => {
      const el = elementRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const bounds = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
      const last = lastSyncedBoundsRef.current;
      if (
        last.x === bounds.x &&
        last.y === bounds.y &&
        last.width === bounds.width &&
        last.height === bounds.height
      ) {
        return;
      }
      lastSyncedBoundsRef.current = bounds;
      try {
        await CapacitorGoogleMaps.onResize({ id: NATIVE_MAP_ID, mapBounds: bounds });
      } catch (e) {
        reportNativeError('syncBounds', e);
      }
    }, []);

    // Capacitor's built-in ResizeObserver only calls onResize when width/height
    // change — not when the element moves on screen. Track position too.
    useEffect(() => {
      const el = elementRef.current;
      if (!el) return;
      let raf = 0;
      const tick = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { void syncBounds(); });
      };
      const ro = new ResizeObserver(tick);
      ro.observe(el);
      window.addEventListener('scroll', tick, true);
      window.addEventListener('resize', tick);
      const interval = window.setInterval(tick, 400);
      const stopBurst = window.setTimeout(() => window.clearInterval(interval), 4000);
      tick();
      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        window.removeEventListener('scroll', tick, true);
        window.removeEventListener('resize', tick);
        window.clearInterval(interval);
        window.clearTimeout(stopBurst);
      };
    }, [syncBounds]);

    // Create the native map once on mount; destroy on unmount.
    // Includes an 8-second readiness timeout: if GoogleMap.create() succeeds but
    // the native view never paints (silent failure mode), we treat it as an
    // error so the caller can fall back to the web map. Bumped from 3s → 8s
    // (v72): on slower Android devices native map creation can legitimately
    // take 4–6 s on first run (Maps SDK warm-up + GCP API auth round-trip).
    // A 3 s cap was tripping on real devices and falling back to the WebView
    // JS API map — which silently ignores tilt, breaking nav-mode 3D view.
    useEffect(() => {
      let cancelled = false;
      let succeeded = false;

      const timeoutId = setTimeout(() => {
        if (!succeeded && !cancelled) {
          console.warn('[CapacitorMap] native map readiness timeout (8s) — assuming failure');
          onError?.(new Error('Native map readiness timeout'));
        }
      }, 8000);

      (async () => {
        if (!elementRef.current) return;
        const map = await GoogleMap.create({
          id: NATIVE_MAP_ID,
          element: elementRef.current,
          apiKey,
          config: {
            center: initialCenter,
            zoom: initialZoom,
          },
          forceCreate: true,
        });
        if (cancelled) { map.destroy().catch(() => {}); return; }
        succeeded = true;
        clearTimeout(timeoutId);
        mapRef.current = map;
        onReady?.();
        void syncBounds();
        setTimeout(() => { void syncBounds(); }, 100);
        setTimeout(() => { void syncBounds(); }, 500);
        // Query the actual renderer chosen by the Maps SDK and surface it to
        // the caller for on-screen diagnostics (no adb needed).
        if (onRendererKnown) {
          NativeMapsPlugin.getRenderer()
            .then(({ renderer }) => onRendererKnown(renderer))
            .catch(() => onRendererKnown('unknown'));
        }
        // Subscribe to camera idle events so the caller can read back the
        // ACTUAL tilt/zoom/bearing the SDK applied (vs what we sent).
        // This is the definitive diagnostic for "is tilt being accepted?".
        if (onCameraIdle) {
          map.setOnCameraIdleListener((data) => {
            onCameraIdle({
              tilt:    typeof data.tilt    === 'number' ? data.tilt    : 0,
              zoom:    typeof data.zoom    === 'number' ? data.zoom    : 0,
              bearing: typeof data.bearing === 'number' ? data.bearing : 0,
            });
          }).catch(() => {});
        }
      })().catch((err) => {
        clearTimeout(timeoutId);
        console.error('[CapacitorMap] GoogleMap.create failed', err);
        onError?.(err);
      });

      return () => {
        cancelled = true;
        clearTimeout(timeoutId);
        mapRef.current?.destroy().catch(() => {});
        mapRef.current = null;
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useImperativeHandle(ref, () => ({

      // Per-gesture lock — used by nav mode to disable tilt+rotate gestures
      // so the Android SDK's gesture-settle physics can't flatten our tilt.
      async setGestures({ tilt, rotate, zoom, scroll }) {
        if (!mapRef.current) return;
        try {
          await NativeMapsPlugin.setGestures({
            id: NATIVE_MAP_ID,
            ...(tilt !== undefined ? { tiltGestures: tilt } : {}),
            ...(rotate !== undefined ? { rotateGestures: rotate } : {}),
            ...(zoom !== undefined ? { zoomGestures: zoom } : {}),
            ...(scroll !== undefined ? { scrollGestures: scroll } : {}),
          });
        } catch (e) {
          reportNativeError('setGestures', e);
          // Swallow — pre-patch APKs (old builds without OMTPatch) will
          // reject this call. Nav mode still works, just without the lock.
        }
      },

      // Switch base map tiles. Native + web both supported by @capacitor/google-maps.
      async setMapType(type) {
        if (!mapRef.current) return;
        try {
          const t = type === "Hybrid" ? MapType.Hybrid : type === "Satellite" ? MapType.Satellite : MapType.Normal;
          await mapRef.current.setMapType(t);
        } catch (e) {
          reportNativeError('setMapType', e);
        }
      },

      // Move the camera — called on every GPS fix during nav mode
      async setCamera({ lat, lng, zoom = 17, bearing = 0, tilt = 45, animate = true, animationDuration }) {
        if (!mapRef.current) return;
        try {
          await mapRef.current.setCamera({
            coordinate: { lat, lng },
            zoom,
            bearing,
            angle: tilt,          // @capacitor/google-maps uses 'angle' for tilt (degrees)
            animate,
            // Allow caller to specify duration. Important for nav mode:
            // animate:true with duration:0 routes through animateCamera (which
            // respects tilt on Android) while staying visually instant.
            animationDuration: animationDuration ?? (animate ? 500 : 0),
          });
        } catch (e) {
          reportNativeError('setCamera', e);
          throw e; // preserve existing caller .catch() behaviour
        }
      },

      // Fetch route via the loaded JS API DirectionsService (NOT the REST endpoint —
      // that one is CORS-blocked from any browser/WebView origin and silently fails).
      // The JS API client is loaded on every page via loadGoogleMaps() and works inside
      // Capacitor WebView. The polyline is then drawn on the NATIVE Capacitor map.
      async drawRoute(origin, destination, skipFitBounds = false) {
        const map = mapRef.current;
        if (!map) return null;
        if (typeof window === 'undefined' || !window.google?.maps) return null;

        // Remove previous polylines
        if (polyIdsRef.current.length) {
          await map.removePolylines(polyIdsRef.current).catch((e) => reportNativeError('drawRoute:removePolylines', e));
          polyIdsRef.current = [];
        }

        // Ask the JS-API DirectionsService for a driving route. On any non-OK
        // status we THROW so the caller can surface a visible toast — previously
        // every failure was silently swallowed, producing a misleading straight
        // line drawn from origin→destination markers only.
        const ds = new google.maps.DirectionsService();
        const { result, status } = await new Promise<{
          result: google.maps.DirectionsResult | null;
          status: google.maps.DirectionsStatus;
        }>((resolve) => {
          ds.route(
            { origin, destination, travelMode: google.maps.TravelMode.DRIVING },
            (res, st) => resolve({ result: res ?? null, status: st }),
          );
        });
        if (status !== google.maps.DirectionsStatus.OK || !result) {
          throw new Error(`DirectionsService:${status}`);
        }

        const route = result.routes[0];
        const leg   = route?.legs?.[0];
        if (!route || !leg) throw new Error('DirectionsService:NO_ROUTE');

        // Build geometry from per-step polylines first. In Capacitor WebView,
        // overview_path often collapses to origin→destination (straight line)
        // even when step polylines contain the full road-following path.
        const path = pathFromDirectionsRoute(route, leg);
        if (path.length < 2) throw new Error('DirectionsService:NO_PATH');

        const first = path[0], last = path[path.length - 1];
        console.log(
          `[CapacitorMap.drawRoute] status=${status} points=${path.length} steps=${leg.steps?.length ?? 0} ` +
          `first=${first.lat.toFixed(5)},${first.lng.toFixed(5)} ` +
          `last=${last.lat.toFixed(5)},${last.lng.toFixed(5)}`
        );

        // Chunk long paths into ≤100-point polylines to defeat any
        // JS→Kotlin bridge serialisation truncation on long routes. Each
        // chunk overlaps by 1 point with the next so segments visually
        // connect without gaps. Chunk IDs all tracked in polyIdsRef so
        // the next draw removes every one of them cleanly.
        // Max 100 points per chunk; advance by 99 so chunks overlap by 1 point
        // and visually connect without gaps. Examples: length 100 → 1 chunk of
        // 100; length 101 → 2 chunks (100 + 2); length 199 → 2 chunks (100 + 100).
        const MAX = 100;
        const STRIDE = MAX - 1;
        const chunks: Array<Array<{ lat: number; lng: number }>> = [];
        for (let i = 0; i < path.length - 1; i += STRIDE) {
          chunks.push(path.slice(i, Math.min(i + MAX, path.length)));
        }

        let ids: string[] = [];
        try {
          ids = await map.addPolylines(chunks.map((p) => ({
            path: p,
            strokeColor:   '#4285F4',
            strokeWeight:  7,
            strokeOpacity: 0.95,
            zIndex: 1,
          })));
        } catch (e) {
          reportNativeError('drawRoute:addPolylines', e);
        }
        polyIdsRef.current = ids;

        // Fit camera to the route (only when NOT in nav mode)
        if (!skipFitBounds) {
          const lats = path.map(p => p.lat);
          const lngs = path.map(p => p.lng);
          const minLat = Math.min(...lats), maxLat = Math.max(...lats);
          const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
          await map.setCamera({
            coordinate: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
            zoom: zoomFromBounds(minLat, maxLat, minLng, maxLng),
            animate: true,
            animationDuration: 800,
          }).catch((e) => reportNativeError('drawRoute:fitCamera', e));
        }

        // JS-API DirectionsStep already exposes .lat()/.lng() methods on
        // start_location/end_location — directly compatible with NativeStep.
        const steps: NativeStep[] = (leg.steps ?? []).map((s) => ({
          instructions:   s.instructions ?? '',
          distance:       { value: s.distance?.value ?? 0, text: s.distance?.text ?? '' },
          duration:       { value: s.duration?.value ?? 0, text: s.duration?.text ?? '' },
          start_location: s.start_location,
          end_location:   s.end_location,
          maneuver:       (s as any).maneuver,
        }));

        return {
          steps,
          distance: leg.distance?.value ?? 0,
          duration: leg.duration?.value ?? 0,
          path,
        };
      },

      // Remove route polylines
      async clearRoute() {
        if (!mapRef.current || !polyIdsRef.current.length) return;
        await mapRef.current.removePolylines(polyIdsRef.current).catch((e) => reportNativeError('clearRoute', e));
        polyIdsRef.current = [];
      },

      // Add a single marker, return its ID.
      // NOTE: tintColor is intentionally NOT forwarded. The @capacitor/google-maps
      // plugin requires tintColor to be {r,g,b,a} (0-255) — passing a hex string
      // makes it silently reject the marker entirely. The default native pin is
      // red, which is what the only caller (destination marker) needs anyway.
      async addMarker({ lat, lng, title = '' }) {
        if (!mapRef.current) return '';
        try {
          const ids = await mapRef.current.addMarkers([{
            coordinate: { lat, lng },
            title,
          }]);
          return ids[0] ?? '';
        } catch (e) {
          reportNativeError('addMarker', e);
          return '';
        }
      },

      // Remove a marker by ID
      async removeMarker(id) {
        if (!mapRef.current || !id) return;
        await mapRef.current.removeMarkers([id]).catch((e) => reportNativeError('removeMarker', e));
      },

      // Place or update the "you are here" blue dot. Idempotent and
      // race-safe: GPS fixes can fire faster than the remove→add round-trip
      // completes, so overlapping calls used to throw "Marker not found"
      // when both tried to remove the same stale ID. Now we serialize: if a
      // call is already running, the new one just updates `pendingUserPos`
      // and the running one will pick up the latest coords on its next loop.
      async setUserLocation(lat, lng) {
        const map = mapRef.current;
        if (!map) return;
        pendingUserPosRef.current = { lat, lng };
        if (userMarkerBusyRef.current) return; // existing loop will handle it
        userMarkerBusyRef.current = true;
        try {
          // Loop until pending is drained so the final marker reflects the
          // newest GPS fix, not a stale one that was queued before us.
          while (pendingUserPosRef.current) {
            const next = pendingUserPosRef.current;
            pendingUserPosRef.current = null;
            // ADD the new marker FIRST, then remove the old one.
            // The previous order (remove → add) left a gap where no marker
            // existed, causing a visible flicker on every GPS update.
            // Swapping the order keeps the marker always visible.
            const ids = await map.addMarkers([{
              coordinate: { lat: next.lat, lng: next.lng },
              title: 'You',
              tintColor: { r: 66, g: 133, b: 244, a: 255 },
              zIndex: 100,
            }]).catch((e) => { reportNativeError('setUserLocation:addMarkers', e); return [] as string[]; });
            const idToRemove = userMarkerIdRef.current;
            userMarkerIdRef.current = ids[0] ?? '';
            if (idToRemove) {
              await map.removeMarker(idToRemove).catch((e) => reportNativeError('setUserLocation:removeMarker', e));
            }
          }
        } finally {
          userMarkerBusyRef.current = false;
        }
      },

      syncBounds,

    }), [apiKey, syncBounds]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
      <div
        ref={elementRef}
        id="cap-live-map"
        className={className}
        style={style}
      />
    );
  },
);

CapacitorMap.displayName = 'CapacitorMap';
export default CapacitorMap;
