import { useEffect, useRef, useState } from "react";
import type { PatrolCheckpoint, PatrolCheckpointLogWithCheckpoint } from "@shared/schema";
import type { PatrolReportTrackPoint } from "@/lib/patrol-types";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { SA_MAP_DEFAULT } from "@/components/live-incidents-map";
import { hasCheckpointCoords } from "@/lib/patrol-route-draft";
import { Loader2 } from "lucide-react";

type PatrolHistoryMapProps = {
  checkpoints: PatrolCheckpoint[];
  logs: PatrolCheckpointLogWithCheckpoint[];
  trackPoints: PatrolReportTrackPoint[];
};

export function PatrolHistoryMap({ checkpoints, logs, trackPoints }: PatrolHistoryMapProps) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "Map failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current) return;

    const map = new google.maps.Map(mapRef.current, {
      center: { lat: SA_MAP_DEFAULT.lat, lng: SA_MAP_DEFAULT.lng },
      zoom: SA_MAP_DEFAULT.zoom,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      gestureHandling: "greedy",
    });
    mapInstanceRef.current = map;

    const bounds = new google.maps.LatLngBounds();
    let hasBounds = false;

    const plannedPath: google.maps.LatLngLiteral[] = [];
    checkpoints.forEach((cp, i) => {
      if (!hasCheckpointCoords(cp)) return;
      const pos = { lat: cp.latitude!, lng: cp.longitude! };
      plannedPath.push(pos);
      bounds.extend(pos);
      hasBounds = true;
      new google.maps.Marker({
        map,
        position: pos,
        title: `Planned: ${cp.name}`,
        label: { text: String(i + 1), color: "#fff", fontSize: "11px", fontWeight: "bold" },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: "#2563eb",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        zIndex: 2,
      });
    });

    if (plannedPath.length >= 2) {
      new google.maps.Polyline({
        map,
        path: plannedPath,
        geodesic: true,
        strokeColor: "#2563eb",
        strokeOpacity: 0.55,
        strokeWeight: 3,
      });
    }

    const actualPath = trackPoints.map((p) => ({ lat: p.latitude, lng: p.longitude }));
    for (const p of actualPath) {
      bounds.extend(p);
      hasBounds = true;
    }
    if (actualPath.length >= 2) {
      new google.maps.Polyline({
        map,
        path: actualPath,
        geodesic: true,
        strokeColor: "#16a34a",
        strokeOpacity: 0.95,
        strokeWeight: 4,
        zIndex: 3,
      });
    }
    if (actualPath[0]) {
      new google.maps.Marker({
        map,
        position: actualPath[0],
        title: "Start",
        label: { text: "S", color: "#fff", fontSize: "10px", fontWeight: "bold" },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#15803d",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        zIndex: 5,
      });
    }
    if (actualPath.length > 1) {
      const end = actualPath[actualPath.length - 1]!;
      new google.maps.Marker({
        map,
        position: end,
        title: "End",
        label: { text: "E", color: "#fff", fontSize: "10px", fontWeight: "bold" },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#b91c1c",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        zIndex: 5,
      });
    }

    for (const log of logs) {
      if (log.latitude == null || log.longitude == null) continue;
      const pos = { lat: log.latitude, lng: log.longitude };
      bounds.extend(pos);
      hasBounds = true;
      const outside = log.withinGeofence === false;
      new google.maps.Marker({
        map,
        position: pos,
        title: `Clocked: ${log.checkpointName}`,
        icon: {
          path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
          scale: 5,
          fillColor: outside ? "#dc2626" : "#f59e0b",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 1,
          rotation: 180,
        },
        zIndex: 4,
      });
    }

    if (hasBounds) {
      map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
    }

    return () => {
      mapInstanceRef.current = null;
    };
  }, [ready, checkpoints, logs, trackPoints]);

  if (error) {
    return <p className="p-3 text-xs text-destructive">{error}</p>;
  }
  if (!ready) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading map…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div ref={mapRef} className="h-56 w-full rounded-md border" data-testid="patrol-history-map" />
      <div className="flex flex-wrap gap-3 px-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> Planned
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-green-600" /> Actual track
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Clocked GPS
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-red-600" /> Outside radius
        </span>
      </div>
    </div>
  );
}
