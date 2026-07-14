import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { pathDistanceKm } from "@/lib/fleet-intelligence";
import { cn } from "@/lib/utils";

export type FleetHistoryPoint = {
  id: number;
  latitude: number;
  longitude: number;
  recordedAt: string;
  gpsValid?: boolean;
  speedKph?: number | null;
};

type Props = {
  positions: FleetHistoryPoint[];
  className?: string;
  testId?: string;
};

const MAP_HEIGHT = "min(52vh, 420px)";

export function FleetHistoryMap({ positions, className, testId = "fleet-history-map" }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const startMarkerRef = useRef<google.maps.Marker | null>(null);
  const endMarkerRef = useRef<google.maps.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  const path = useMemo(() => {
    return [...positions]
      .filter((p) => p.gpsValid !== false)
      .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
      .map((p) => ({ lat: p.latitude, lng: p.longitude }));
  }, [positions]);

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
        center: path[0] ?? { lat: -26.2041, lng: 28.0473 },
        zoom: 14,
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

    if (path.length === 0) return;

    if (path.length === 1) {
      startMarkerRef.current = new google.maps.Marker({
        position: path[0],
        map,
        title: "Position",
        zIndex: 20,
      });
      map.setCenter(path[0]);
      map.setZoom(15);
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
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: "#16a34a",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
      zIndex: 20,
    });

    endMarkerRef.current = new google.maps.Marker({
      position: path[path.length - 1],
      map,
      title: "Latest",
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#2563eb",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
      zIndex: 21,
    });

    const bounds = new google.maps.LatLngBounds();
    for (const pt of path) bounds.extend(pt);
    map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
  }, [ready, path]);

  const shellStyle = { height: MAP_HEIGHT };

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

  if (path.length === 0) {
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
    <div
      ref={mapRef}
      className={cn("w-full rounded-lg border shadow-sm", className)}
      style={shellStyle}
      data-testid={testId}
    />
  );
}

export function estimatePathDistanceKm(path: Array<{ lat: number; lng: number }>): number | null {
  const km = pathDistanceKm(path);
  return km != null && km > 0 ? km : null;
}
