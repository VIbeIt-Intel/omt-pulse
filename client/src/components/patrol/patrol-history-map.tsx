import { useEffect, useRef, useState } from "react";
import type { PatrolCheckpoint, PatrolCheckpointLogWithCheckpoint } from "@shared/schema";
import type { PatrolReportTrackPoint } from "@/lib/patrol-types";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { SA_MAP_DEFAULT } from "@/components/live-incidents-map";
import { hasCheckpointCoords } from "@/lib/patrol-route-draft";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type PatrolHistoryMapProps = {
  checkpoints: PatrolCheckpoint[];
  logs: PatrolCheckpointLogWithCheckpoint[];
  trackPoints: PatrolReportTrackPoint[];
  /** When false, tear down the map so it re-inits at the correct size when shown again. */
  active?: boolean;
  className?: string;
};

export function PatrolHistoryMap({
  checkpoints,
  logs,
  trackPoints,
  active = true,
  className,
}: PatrolHistoryMapProps) {
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
    if (!active) {
      if (mapInstanceRef.current) {
        google.maps.event.clearInstanceListeners(mapInstanceRef.current);
        mapInstanceRef.current = null;
      }
    }
  }, [active]);

  useEffect(() => {
    if (!active || !ready || !mapRef.current || mapInstanceRef.current) return;

    const map = new google.maps.Map(mapRef.current, {
      center: { lat: SA_MAP_DEFAULT.lat, lng: SA_MAP_DEFAULT.lng },
      zoom: SA_MAP_DEFAULT.zoom,
      mapTypeControl: true,
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

    const fitMap = () => {
      if (!mapInstanceRef.current) return;
      google.maps.event.trigger(mapInstanceRef.current, "resize");
      if (hasBounds) {
        mapInstanceRef.current.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
      }
    };

    requestAnimationFrame(fitMap);
    const resizeObserver = new ResizeObserver(() => fitMap());
    resizeObserver.observe(mapRef.current);
    const t0 = window.setTimeout(fitMap, 50);
    const t1 = window.setTimeout(fitMap, 200);
    const t2 = window.setTimeout(fitMap, 450);

    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      resizeObserver.disconnect();
      if (mapInstanceRef.current) {
        google.maps.event.clearInstanceListeners(mapInstanceRef.current);
        mapInstanceRef.current = null;
      }
    };
  }, [active, ready, checkpoints, logs, trackPoints]);

  if (error) {
    return <p className="p-3 text-xs text-destructive">{error}</p>;
  }

  const mapShell = "relative h-[min(48vh,440px)] min-h-[300px] w-full overflow-hidden rounded-xl border border-border/80 bg-muted/30";

  if (!ready || !active) {
    return (
      <div className={cn("space-y-3", className)}>
        <div className={mapShell}>
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading map…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className={mapShell}>
        <div ref={mapRef} className="absolute inset-0 h-full w-full" data-testid="patrol-history-map" />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> Planned
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-green-600" /> Actual track
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Clocked GPS
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-600" /> Outside radius
        </span>
      </div>
    </div>
  );
}
