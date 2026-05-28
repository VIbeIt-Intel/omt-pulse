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
    tintColor?: string;
  }): Promise<string>;

  removeMarker(id: string): Promise<void>;
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

/** Decode a Google encoded-polyline string into LatLng pairs */
function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const pts: Array<{ lat: number; lng: number }> = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    let b: number, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts;
}

/**
 * Wrap a plain {lat, lng} object so .lat()/.lng() work as methods —
 * matching the google.maps.LatLng interface used in live-incident.tsx.
 */
function toLatLngLike(raw: { lat: number; lng: number }): LatLngLike {
  return { lat: () => raw.lat, lng: () => raw.lng };
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
      async setCamera({ lat, lng, zoom = 17, bearing = 0, tilt = 45, animate = true }) {
        if (!mapRef.current) return;
        await mapRef.current.setCamera({
          coordinate: { lat, lng },
          zoom,
          bearing,
          angle: tilt,          // @capacitor/google-maps uses 'angle' for tilt (degrees)
          animate,
          animationDuration: animate ? 500 : 0,
        });
      },

      // Fetch route via Directions REST API, draw polyline, return typed steps
      async drawRoute(origin, destination, skipFitBounds = false) {
        const map = mapRef.current;
        if (!map) return null;

        // Remove previous polylines
        if (polyIdsRef.current.length) {
          await map.removePolylines(polyIdsRef.current).catch(() => {});
          polyIdsRef.current = [];
        }

        // Call Directions REST API
        const url =
          `https://maps.googleapis.com/maps/api/directions/json` +
          `?origin=${origin.lat},${origin.lng}` +
          `&destination=${destination.lat},${destination.lng}` +
          `&mode=driving` +
          `&key=${apiKey}`;

        let data: any;
        try {
          const res = await fetch(url);
          data = await res.json();
        } catch {
          return null;
        }
        if (data.status !== 'OK' || !data.routes?.length) return null;

        const route = data.routes[0];
        const leg   = route.legs?.[0];
        if (!leg) return null;

        // Decode polyline and draw the route line
        const path = decodePolyline(route.overview_polyline.points);
        const ids  = await map.addPolylines([{
          path,
          strokeColor:   '#4285F4',
          strokeWeight:  7,
          strokeOpacity: 0.95,
          zIndex: 1,
        }]);
        polyIdsRef.current = ids;

        // Fit camera to the route (only when NOT in nav mode)
        if (!skipFitBounds && path.length >= 2) {
          const lats = path.map(p => p.lat);
          const lngs = path.map(p => p.lng);
          const minLat = Math.min(...lats), maxLat = Math.max(...lats);
          const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
          await map.setCamera({
            coordinate: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
            zoom: zoomFromBounds(minLat, maxLat, minLng, maxLng),
            animate: true,
            animationDuration: 800,
          });
        }

        // Shape REST steps → NativeStep (with .lat()/.lng() methods on locations)
        // so live-incident.tsx step-tracking code works unchanged.
        const steps: NativeStep[] = (leg.steps ?? []).map((s: any) => ({
          instructions:   s.html_instructions ?? '',
          distance:       { value: s.distance?.value ?? 0, text: s.distance?.text ?? '' },
          duration:       { value: s.duration?.value ?? 0, text: s.duration?.text ?? '' },
          start_location: toLatLngLike(s.start_location),
          end_location:   toLatLngLike(s.end_location),
          maneuver:       s.maneuver,
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
        await mapRef.current.removePolylines(polyIdsRef.current).catch(() => {});
        polyIdsRef.current = [];
      },

      // Add a single marker, return its ID
      async addMarker({ lat, lng, title = '', tintColor }) {
        if (!mapRef.current) return '';
        const ids = await mapRef.current.addMarkers([{
          coordinate: { lat, lng },
          title,
          tintColor,
        }]);
        return ids[0] ?? '';
      },

      // Remove a marker by ID
      async removeMarker(id) {
        if (!mapRef.current || !id) return;
        await mapRef.current.removeMarkers([id]).catch(() => {});
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
