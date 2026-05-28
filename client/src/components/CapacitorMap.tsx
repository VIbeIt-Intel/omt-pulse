import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { GoogleMap } from '@capacitor/google-maps';

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
  }): Promise<string>;

  removeMarker(id: string): Promise<void>;

  /** Place or update the "you are here" blue dot. Idempotent. */
  setUserLocation(lat: number, lng: number): Promise<void>;
}

interface CapacitorMapProps {
  apiKey: string;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  className?: string;
  style?: React.CSSProperties;
  onReady?: () => void;
  onError?: (err: unknown) => void;
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
     className, style, onReady, onError }, ref) => {

    const elementRef = useRef<HTMLDivElement>(null);
    const mapRef     = useRef<GoogleMap | null>(null);
    const polyIdsRef = useRef<string[]>([]);
    const userMarkerIdRef = useRef<string>('');
    // Coalesced GPS updates — see setUserLocation for the race-avoidance rationale.
    const pendingUserPosRef = useRef<{ lat: number; lng: number } | null>(null);
    const userMarkerBusyRef = useRef<boolean>(false);

    // Create the native map once on mount; destroy on unmount.
    // Includes a 3-second readiness timeout: if GoogleMap.create() succeeds but
    // the native view never paints (silent failure mode), we treat it as an
    // error so the caller can fall back to the web map.
    useEffect(() => {
      let cancelled = false;
      let succeeded = false;

      const timeoutId = setTimeout(() => {
        if (!succeeded && !cancelled) {
          console.warn('[CapacitorMap] native map readiness timeout (3s) — assuming failure');
          onError?.(new Error('Native map readiness timeout'));
        }
      }, 3000);

      (async () => {
        if (!elementRef.current) return;
        const map = await GoogleMap.create({
          id: 'cap-live-map',
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

        // Ask the JS-API DirectionsService for a driving route
        const ds = new google.maps.DirectionsService();
        const result = await new Promise<google.maps.DirectionsResult | null>((resolve) => {
          ds.route(
            {
              origin,
              destination,
              travelMode: google.maps.TravelMode.DRIVING,
            },
            (res, status) => {
              if (status === google.maps.DirectionsStatus.OK && res) resolve(res);
              else resolve(null);
            },
          );
        });
        if (!result) return null;

        const route = result.routes[0];
        const leg   = route?.legs?.[0];
        if (!route || !leg) return null;

        // overview_path is an array of google.maps.LatLng — convert to plain pairs
        const path = (route.overview_path ?? []).map((ll) => ({
          lat: ll.lat(),
          lng: ll.lng(),
        }));
        if (path.length < 2) return null;

        let ids: string[] = [];
        try {
          ids = await map.addPolylines([{
            path,
            strokeColor:   '#4285F4',
            strokeWeight:  7,
            strokeOpacity: 0.95,
            zIndex: 1,
          }]);
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
            if (userMarkerIdRef.current) {
              const idToRemove = userMarkerIdRef.current;
              userMarkerIdRef.current = ''; // clear FIRST so nothing else sees the stale id
              await map.removeMarker(idToRemove).catch((e) => reportNativeError('setUserLocation:removeMarker', e));
            }
            const ids = await map.addMarkers([{
              coordinate: { lat: next.lat, lng: next.lng },
              title: 'You',
              // Google blue, fully opaque
              tintColor: { r: 66, g: 133, b: 244, a: 255 },
              zIndex: 100,
            }]).catch((e) => { reportNativeError('setUserLocation:addMarkers', e); return [] as string[]; });
            userMarkerIdRef.current = ids[0] ?? '';
          }
        } finally {
          userMarkerBusyRef.current = false;
        }
      },

    }), [apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
