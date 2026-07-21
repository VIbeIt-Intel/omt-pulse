import { useEffect, useMemo, useRef, useState } from "react";
import type { PatrolCheckpoint } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { SA_MAP_DEFAULT } from "@/components/live-incidents-map";
import { hasCheckpointCoords } from "@/lib/patrol-route-draft";
import { cn } from "@/lib/utils";
import { ChevronDown, Loader2, Map } from "lucide-react";

type PatrolActiveMapProps = {
  checkpoints: PatrolCheckpoint[];
  loggedCheckpointIds: Set<number>;
  nextCheckpointId: number | null;
  /** Live breadcrumb from patrol tracking (actual path). */
  trackTrail?: Array<{ lat: number; lng: number }>;
  className?: string;
};

type MarkerKind = "completed" | "next" | "upcoming";

function checkpointMarkerIcon(kind: MarkerKind): google.maps.Symbol {
  const colors = {
    completed: "#94a3b8",
    next: "#f59e0b",
    upcoming: "#2563eb",
  };
  const scales = {
    completed: 11,
    next: 15,
    upcoming: 12,
  };
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: scales[kind],
    fillColor: colors[kind],
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
    labelOrigin: new google.maps.Point(0, 0),
  };
}

function markerKindFor(
  cp: PatrolCheckpoint,
  loggedIds: Set<number>,
  nextId: number | null,
): MarkerKind {
  if (loggedIds.has(cp.id)) return "completed";
  if (cp.id === nextId) return "next";
  return "upcoming";
}

export function PatrolActiveMap({
  checkpoints,
  loggedCheckpointIds,
  nextCheckpointId,
  trackTrail = [],
  className,
}: PatrolActiveMapProps) {
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(true);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsUnavailable, setGpsUnavailable] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const checkpointMarkersRef = useRef<google.maps.Marker[]>([]);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const trackPolylineRef = useRef<google.maps.Polyline | null>(null);
  const didInitialFitRef = useRef(false);

  const pinned = checkpoints.filter(hasCheckpointCoords);
  const hasPins = pinned.length > 0;

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (!cancelled) {
          setMapsReady(true);
          setMapsError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setMapsError(err.message || "Google Maps could not load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsUnavailable(true);
      return;
    }

    // Immediate one-shot so the green "You" marker appears without waiting for watch.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        setUserPos({ lat, lng });
        setGpsUnavailable(false);
      },
      () => setGpsUnavailable(true),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 15_000 },
    );

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        setUserPos({ lat, lng });
        setGpsUnavailable(false);
      },
      () => setGpsUnavailable(true),
      { enableHighAccuracy: true, maximumAge: 8_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Prefer live WebView GPS; fall back to last accepted track point from the tracker.
  const displayPos = useMemo(() => {
    if (userPos) return userPos;
    const last = trackTrail[trackTrail.length - 1];
    return last ?? null;
  }, [userPos, trackTrail]);

  useEffect(() => {
    if (!mapsReady || !mapRef.current || mapInstanceRef.current) return;

    const pinnedList = checkpoints.filter(hasCheckpointCoords);
    const nextCp = nextCheckpointId != null
      ? checkpoints.find((c) => c.id === nextCheckpointId)
      : null;
    const center = nextCp && hasCheckpointCoords(nextCp)
      ? { lat: nextCp.latitude!, lng: nextCp.longitude! }
      : pinnedList[0]
        ? { lat: pinnedList[0].latitude!, lng: pinnedList[0].longitude! }
        : { lat: SA_MAP_DEFAULT.lat, lng: SA_MAP_DEFAULT.lng };

    const map = new google.maps.Map(mapRef.current, {
      center,
      zoom: pinnedList.length > 0 ? 15 : SA_MAP_DEFAULT.zoom,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      gestureHandling: "greedy",
    });
    mapInstanceRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        google.maps.event.trigger(mapInstanceRef.current, "resize");
      }
    });
    resizeObserver.observe(mapRef.current);

    return () => {
      resizeObserver.disconnect();
      checkpointMarkersRef.current.forEach((m) => m.setMap(null));
      checkpointMarkersRef.current = [];
      userMarkerRef.current?.setMap(null);
      userMarkerRef.current = null;
      polylineRef.current?.setMap(null);
      polylineRef.current = null;
      trackPolylineRef.current?.setMap(null);
      trackPolylineRef.current = null;
      if (mapInstanceRef.current) {
        google.maps.event.clearInstanceListeners(mapInstanceRef.current);
        mapInstanceRef.current = null;
      }
    };
  }, [mapsReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapsReady) return;

    checkpointMarkersRef.current.forEach((m) => m.setMap(null));
    checkpointMarkersRef.current = [];

    const path: google.maps.LatLngLiteral[] = [];
    checkpoints.forEach((cp, i) => {
      if (!hasCheckpointCoords(cp)) return;
      const position = { lat: cp.latitude!, lng: cp.longitude! };
      path.push(position);
      const kind = markerKindFor(cp, loggedCheckpointIds, nextCheckpointId);
      const marker = new google.maps.Marker({
        position,
        map,
        title: cp.name,
        label: {
          text: String(i + 1),
          color: "#ffffff",
          fontWeight: "bold",
          fontSize: kind === "next" ? "12px" : "11px",
        },
        icon: checkpointMarkerIcon(kind),
        zIndex: kind === "next" ? 3 : kind === "upcoming" ? 2 : 1,
      });
      checkpointMarkersRef.current.push(marker);
    });

    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }
    if (path.length >= 2) {
      polylineRef.current = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: "#2563eb",
        strokeOpacity: 0.7,
        strokeWeight: 3,
        map,
      });
    }
  }, [checkpoints, loggedCheckpointIds, nextCheckpointId, mapsReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapsReady) return;
    if (trackPolylineRef.current) {
      trackPolylineRef.current.setMap(null);
      trackPolylineRef.current = null;
    }
    if (trackTrail.length >= 2) {
      trackPolylineRef.current = new google.maps.Polyline({
        path: trackTrail,
        geodesic: true,
        strokeColor: "#16a34a",
        strokeOpacity: 0.9,
        strokeWeight: 4,
        map,
        zIndex: 2,
      });
    }
  }, [trackTrail, mapsReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapsReady) return;

    if (displayPos) {
      const position = { lat: displayPos.lat, lng: displayPos.lng };
      if (userMarkerRef.current) {
        userMarkerRef.current.setPosition(position);
      } else {
        userMarkerRef.current = new google.maps.Marker({
          position,
          map,
          title: "Your location",
          zIndex: 10,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: "#22c55e",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3,
          },
        });
      }
    }
  }, [displayPos, mapsReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapsReady || !mapOpen) return;

    const nextCp = nextCheckpointId != null
      ? checkpoints.find((c) => c.id === nextCheckpointId)
      : null;

    const timer = window.setTimeout(() => {
      if (!mapInstanceRef.current) return;
      google.maps.event.trigger(mapInstanceRef.current, "resize");

      // Once we have the patroller's fix, keep them visible with the next pin.
      if (displayPos && nextCp && hasCheckpointCoords(nextCp)) {
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(displayPos);
        bounds.extend({ lat: nextCp.latitude!, lng: nextCp.longitude! });
        map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
        didInitialFitRef.current = true;
        return;
      }

      if (nextCp && hasCheckpointCoords(nextCp) && !displayPos) {
        map.panTo({ lat: nextCp.latitude!, lng: nextCp.longitude! });
        map.setZoom(16);
        didInitialFitRef.current = true;
        return;
      }

      if (!didInitialFitRef.current && hasPins) {
        const bounds = new google.maps.LatLngBounds();
        for (const cp of checkpoints) {
          if (!hasCheckpointCoords(cp)) continue;
          bounds.extend({ lat: cp.latitude!, lng: cp.longitude! });
        }
        if (displayPos) bounds.extend(displayPos);
        map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
        didInitialFitRef.current = true;
      }
    }, 200);

    return () => window.clearTimeout(timer);
  }, [nextCheckpointId, mapsReady, mapOpen, checkpoints, hasPins, displayPos]);

  return (
    <Collapsible open={mapOpen} onOpenChange={setMapOpen} className={cn("rounded-lg border", className)}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Map className="h-4 w-4 text-primary" />
          Route map
        </div>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs">
            {mapOpen ? "Hide" : "Show"}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", mapOpen && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        {mapsError ? (
          <p className="p-3 text-xs text-destructive">{mapsError}</p>
        ) : !mapsReady ? (
          <div className="flex h-[min(32vh,260px)] items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading map…
          </div>
        ) : !hasPins ? (
          <div className="flex h-[min(24vh,180px)] items-center justify-center p-4 text-center text-xs text-muted-foreground">
            This route has no checkpoint locations on the map.
            {gpsUnavailable && " Enable location to see yourself."}
          </div>
        ) : (
          <div className="relative">
            <div
              ref={mapRef}
              className="h-[min(32vh,260px)] w-full"
              data-testid="patrol-active-map"
            />
            {(!displayPos || gpsUnavailable) && (
              <p className="absolute bottom-2 left-2 right-2 rounded bg-destructive/95 px-2 py-1.5 text-[11px] text-destructive-foreground text-center font-medium">
                {gpsUnavailable
                  ? "Location is off or blocked — turn on GPS to see your green position"
                  : "Waiting for GPS fix…"}
              </p>
            )}
          </div>
        )}
        {hasPins && (
          <div className="flex flex-wrap gap-3 px-3 py-2 text-[10px] text-muted-foreground border-t">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              Next
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
              Upcoming
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
              Done
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
              You
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-green-700" />
              Tracked path
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
              Planned
            </span>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
