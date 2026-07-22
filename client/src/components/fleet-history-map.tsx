import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import {
  detectTripMapEvents,
  pathDistanceKm,
  type TripMapEvent,
} from "@/lib/fleet-intelligence";
import { cn } from "@/lib/utils";

export type FleetHistoryPoint = {
  id: number;
  latitude: number;
  longitude: number;
  recordedAt: string;
  gpsValid?: boolean;
  speedKph?: number | null;
  ignitionOn?: boolean | null;
};

export type FleetMapGeofence = {
  lat: number;
  lng: number;
  radiusM: number;
};

type Props = {
  positions: FleetHistoryPoint[];
  geofence?: FleetMapGeofence | null;
  className?: string;
  testId?: string;
};

const MAP_HEIGHT = "min(52vh, 420px)";
/** Street / neighbourhood view for a parked or single-point vehicle. */
const STATIONARY_ZOOM = 16;
/** Cap after fitBounds so a tight GPS cluster doesn't zoom to building level. */
const MAX_ROUTE_ZOOM = 17;
/** Paths that never leave this radius are treated as stationary (GPS jitter). */
const STATIONARY_SPAN_M = 50;
const GEOFENCE_COLOR = "#22c55e";
const STOP_COLOR = "#f59e0b";
const IGNITION_OFF_COLOR = "#f97316";

function pathSpanM(path: Array<{ lat: number; lng: number }>): number {
  if (path.length < 2) return 0;
  let minLat = path[0]!.lat;
  let maxLat = path[0]!.lat;
  let minLng = path[0]!.lng;
  let maxLng = path[0]!.lng;
  for (const p of path) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const midLat = (minLat + maxLat) / 2;
  const latM = (maxLat - minLat) * 111_320;
  const lngM = (maxLng - minLng) * 111_320 * Math.cos((midLat * Math.PI) / 180);
  return Math.hypot(latM, lngM);
}

function clampZoomAfterFit(map: google.maps.Map, maxZoom: number): void {
  const apply = () => {
    const z = map.getZoom() ?? 0;
    if (z > maxZoom) map.setZoom(maxZoom);
  };
  google.maps.event.addListenerOnce(map, "idle", apply);
  window.setTimeout(apply, 400);
}

function vehicleDotIcon(color: string, scale: number): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
  };
}

function eventIcon(kind: TripMapEvent["kind"]): google.maps.Symbol {
  if (kind === "ignition_off") {
    return {
      path: "M -4,-4 4,-4 4,4 -4,4 z",
      scale: 1.35,
      fillColor: IGNITION_OFF_COLOR,
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 1.5,
    };
  }
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 6,
    fillColor: STOP_COLOR,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
  };
}

function extendBoundsForGeofence(
  bounds: google.maps.LatLngBounds,
  geofence: FleetMapGeofence,
): void {
  const latDelta = geofence.radiusM / 111_320;
  const lngDelta =
    geofence.radiusM / (111_320 * Math.max(0.2, Math.cos((geofence.lat * Math.PI) / 180)));
  bounds.extend({ lat: geofence.lat + latDelta, lng: geofence.lng + lngDelta });
  bounds.extend({ lat: geofence.lat - latDelta, lng: geofence.lng - lngDelta });
}

function MapLegendItem({ color, label, shape = "circle" }: { color: string; label: string; shape?: "circle" | "square" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span
        className={cn("h-2.5 w-2.5 shrink-0 border border-white/80 shadow-sm", shape === "square" ? "rounded-[2px]" : "rounded-full")}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

export function FleetHistoryMap({
  positions,
  geofence = null,
  className,
  testId = "fleet-history-map",
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const startMarkerRef = useRef<google.maps.Marker | null>(null);
  const endMarkerRef = useRef<google.maps.Marker | null>(null);
  const eventMarkersRef = useRef<google.maps.Marker[]>([]);
  const geofenceCircleRef = useRef<google.maps.Circle | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  const path = useMemo(() => {
    return [...positions]
      .filter((p) => p.gpsValid !== false)
      .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
      .map((p) => ({ lat: p.latitude, lng: p.longitude }));
  }, [positions]);

  const tripEvents = useMemo(() => detectTripMapEvents(positions), [positions]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new google.maps.Map(mapRef.current, {
        center: path[0] ?? geofence ?? { lat: -26.2041, lng: 28.0473 },
        zoom: STATIONARY_ZOOM,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        styles: [
          { elementType: "geometry", stylers: [{ color: "#1e293b" }] },
          { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
          { featureType: "road", elementType: "geometry", stylers: [{ color: "#334155" }] },
          { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f172a" }] },
          { featureType: "poi", stylers: [{ visibility: "off" }] },
        ],
      });
    }

    const map = mapInstanceRef.current;

    polylineRef.current?.setMap(null);
    startMarkerRef.current?.setMap(null);
    endMarkerRef.current?.setMap(null);
    for (const marker of eventMarkersRef.current) marker.setMap(null);
    eventMarkersRef.current = [];
    geofenceCircleRef.current?.setMap(null);
    geofenceCircleRef.current = null;

    if (geofence) {
      geofenceCircleRef.current = new google.maps.Circle({
        map,
        center: { lat: geofence.lat, lng: geofence.lng },
        radius: geofence.radiusM,
        strokeColor: GEOFENCE_COLOR,
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: GEOFENCE_COLOR,
        fillOpacity: 0.12,
        clickable: false,
        zIndex: 5,
      });
    }

    if (path.length === 0) {
      if (geofence) {
        map.setCenter({ lat: geofence.lat, lng: geofence.lng });
        map.setZoom(STATIONARY_ZOOM);
      }
      return;
    }

    const last = path[path.length - 1]!;
    const spanM = pathSpanM(path);
    const stationary = path.length === 1 || spanM < STATIONARY_SPAN_M;

    const placeEventMarkers = () => {
      for (const event of tripEvents) {
        const marker = new google.maps.Marker({
          position: { lat: event.lat, lng: event.lng },
          map,
          title: event.label,
          icon: eventIcon(event.kind),
          zIndex: event.kind === "ignition_off" ? 18 : 17,
        });
        eventMarkersRef.current.push(marker);
      }
    };

    if (stationary) {
      endMarkerRef.current = new google.maps.Marker({
        position: last,
        map,
        title: "Vehicle location",
        icon: vehicleDotIcon("#2563eb", 9),
        zIndex: 21,
      });
      placeEventMarkers();

      if (geofence) {
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(last);
        extendBoundsForGeofence(bounds, geofence);
        map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
        clampZoomAfterFit(map, MAX_ROUTE_ZOOM);
      } else {
        map.setCenter(last);
        map.setZoom(STATIONARY_ZOOM);
      }
      return;
    }

    polylineRef.current = new google.maps.Polyline({
      path,
      map,
      strokeColor: "#3b82f6",
      strokeWeight: 5,
      strokeOpacity: 0.92,
      zIndex: 10,
    });

    startMarkerRef.current = new google.maps.Marker({
      position: path[0],
      map,
      title: "Start",
      icon: vehicleDotIcon("#16a34a", 7),
      zIndex: 20,
    });

    endMarkerRef.current = new google.maps.Marker({
      position: last,
      map,
      title: "Latest",
      icon: vehicleDotIcon("#2563eb", 8),
      zIndex: 21,
    });

    placeEventMarkers();

    const bounds = new google.maps.LatLngBounds();
    for (const pt of path) bounds.extend(pt);
    if (geofence) extendBoundsForGeofence(bounds, geofence);
    map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
    clampZoomAfterFit(map, MAX_ROUTE_ZOOM);
  }, [ready, path, tripEvents, geofence]);

  const shellStyle = { height: MAP_HEIGHT };
  const stopCount = tripEvents.filter((e) => e.kind === "stop").length;
  const ignitionOffCount = tripEvents.filter((e) => e.kind === "ignition_off").length;

  if (error) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground px-4 text-center",
          className,
        )}
        style={shellStyle}
        data-testid={testId}
      >
        Map unavailable for this route.
      </div>
    );
  }

  if (!ready) {
    return (
      <div
        className={cn("flex items-center justify-center rounded-lg border bg-muted/30", className)}
        style={shellStyle}
        data-testid={testId}
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (path.length === 0 && !geofence) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground",
          className,
        )}
        style={shellStyle}
        data-testid={testId}
      >
        No GPS points to show on the map for this day.
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)} data-testid={testId}>
      <div
        ref={mapRef}
        className="w-full rounded-lg border shadow-sm"
        style={shellStyle}
        data-testid={`${testId}-canvas`}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-0.5">
        <MapLegendItem color="#16a34a" label="Start" />
        <MapLegendItem color="#2563eb" label="Latest" />
        {stopCount > 0 && (
          <MapLegendItem color={STOP_COLOR} label={`Stop (${stopCount})`} />
        )}
        {ignitionOffCount > 0 && (
          <MapLegendItem
            color={IGNITION_OFF_COLOR}
            label={`Ignition off (${ignitionOffCount})`}
            shape="square"
          />
        )}
        {geofence && <MapLegendItem color={GEOFENCE_COLOR} label="Geofence" />}
      </div>
    </div>
  );
}

export function estimatePathDistanceKm(path: Array<{ lat: number; lng: number }>): number | null {
  const km = pathDistanceKm(path);
  return km != null && km > 0 ? km : null;
}
