import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import {
  detectTripMapEvents,
  formatDurationMinutes,
  formatTripClock,
  pathDistanceKm,
  segmentTripLegs,
  type TripMapEvent,
} from "@/lib/fleet-intelligence";
import { Button } from "@/components/ui/button";
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

type PlaybackPoint = {
  lat: number;
  lng: number;
  at: number;
  speedKph: number | null;
};

const MAP_HEIGHT = "min(52vh, 420px)";
const STATIONARY_ZOOM = 16;
const MAX_ROUTE_ZOOM = 17;
const STATIONARY_SPAN_M = 50;
const GEOFENCE_COLOR = "#22c55e";
const STOP_COLOR = "#f59e0b";
const IGNITION_OFF_COLOR = "#f97316";
const PLAYBACK_MS_PER_POINT = 80;

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function eventInfoHtml(event: TripMapEvent): string {
  const title = event.kind === "stop" ? "Stop / parked" : "Ignition off";
  const from = formatTripClock(event.at);
  const until = event.until ? formatTripClock(event.until) : null;
  const duration =
    event.kind === "stop" && event.durationMinutes != null
      ? formatDurationMinutes(event.durationMinutes)
      : null;
  const lines = [
    `<div style="max-width:240px;font:12px/1.45 system-ui,sans-serif;color:#111">`,
    `<strong>${escapeHtml(title)}</strong>`,
  ];
  if (event.kind === "stop" && until) {
    lines.push(
      `<div style="margin-top:6px">From <strong>${escapeHtml(from)}</strong> to <strong>${escapeHtml(until)}</strong></div>`,
    );
  } else {
    lines.push(`<div style="margin-top:6px">At <strong>${escapeHtml(from)}</strong></div>`);
  }
  if (duration) {
    lines.push(`<div style="margin-top:4px">Total duration <strong>${escapeHtml(duration)}</strong></div>`);
  }
  lines.push(
    `<div style="margin-top:6px;color:#555;font-size:11px">${event.lat.toFixed(5)}, ${event.lng.toFixed(5)}</div>`,
    `</div>`,
  );
  return lines.join("");
}

function MapLegendItem({
  color,
  label,
  shape = "circle",
}: {
  color: string;
  label: string;
  shape?: "circle" | "square";
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span
        className={cn(
          "h-2.5 w-2.5 shrink-0 border border-white/80 shadow-sm",
          shape === "square" ? "rounded-[2px]" : "rounded-full",
        )}
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
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const startMarkerRef = useRef<google.maps.Marker | null>(null);
  const endMarkerRef = useRef<google.maps.Marker | null>(null);
  const eventMarkersRef = useRef<google.maps.Marker[]>([]);
  const geofenceCircleRef = useRef<google.maps.Circle | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const playMarkerRef = useRef<google.maps.Marker | null>(null);
  const playTrailRef = useRef<google.maps.Polyline | null>(null);
  const playTimerRef = useRef<number | null>(null);
  const playIndexRef = useRef(0);
  const playRangeRef = useRef<{ from: number; to: number } | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState(0);
  const [playSpeed, setPlaySpeed] = useState<1 | 2 | 4>(2);
  const [activeTripIndex, setActiveTripIndex] = useState<number | null>(null);

  const sortedPositions = useMemo(() => {
    return [...positions]
      .filter((p) => p.gpsValid !== false)
      .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  }, [positions]);

  const path = useMemo(
    () => sortedPositions.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    [sortedPositions],
  );

  const tripLegs = useMemo(() => segmentTripLegs(positions), [positions]);
  const tripEvents = useMemo(() => detectTripMapEvents(positions), [positions]);

  const playbackPoints = useMemo<PlaybackPoint[]>(() => {
    return sortedPositions
      .map((p) => ({
        lat: p.latitude,
        lng: p.longitude,
        at: new Date(p.recordedAt).getTime(),
        speedKph: p.speedKph ?? null,
      }))
      .filter((p) => Number.isFinite(p.at));
  }, [sortedPositions]);

  const canPlay = playbackPoints.length >= 2;

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

  const clearPlaybackOverlays = useCallback(() => {
    if (playTimerRef.current != null) {
      window.clearTimeout(playTimerRef.current);
      playTimerRef.current = null;
    }
    playMarkerRef.current?.setMap(null);
    playMarkerRef.current = null;
    playTrailRef.current?.setMap(null);
    playTrailRef.current = null;
  }, []);

  const ensurePlayOverlays = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || playbackPoints.length === 0) return;
    if (!playMarkerRef.current) {
      playMarkerRef.current = new google.maps.Marker({
        map,
        position: playbackPoints[0],
        zIndex: 40,
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 5,
          fillColor: "#f8fafc",
          fillOpacity: 1,
          strokeColor: "#0f172a",
          strokeWeight: 1.5,
          rotation: 0,
        },
      });
    }
    if (!playTrailRef.current) {
      playTrailRef.current = new google.maps.Polyline({
        map,
        path: [],
        strokeColor: "#f8fafc",
        strokeOpacity: 0.85,
        strokeWeight: 3,
        zIndex: 30,
      });
    }
  }, [playbackPoints]);

  const showPlayFrame = useCallback(
    (index: number) => {
      const map = mapInstanceRef.current;
      if (!map || playbackPoints.length === 0) return;
      ensurePlayOverlays();
      const range = playRangeRef.current;
      const min = range?.from ?? 0;
      const max = range?.to ?? playbackPoints.length - 1;
      const clamped = Math.max(min, Math.min(index, max));
      const point = playbackPoints[clamped]!;
      const next = playbackPoints[Math.min(clamped + 1, max)]!;
      playMarkerRef.current?.setPosition(point);
      const heading = google.maps.geometry?.spherical?.computeHeading
        ? google.maps.geometry.spherical.computeHeading(point, next)
        : 0;
      playMarkerRef.current?.setIcon({
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 5,
        fillColor: "#f8fafc",
        fillOpacity: 1,
        strokeColor: "#0f172a",
        strokeWeight: 1.5,
        rotation: heading,
      });
      playTrailRef.current?.setPath(
        playbackPoints.slice(min, clamped + 1).map((p) => ({ lat: p.lat, lng: p.lng })),
      );
      playIndexRef.current = clamped;
      setPlayIndex(clamped);
    },
    [ensurePlayOverlays, playbackPoints],
  );

  const playFullDay = useCallback(() => {
    playRangeRef.current = null;
    setActiveTripIndex(null);
    if (playbackPoints.length < 2) return;
    showPlayFrame(0);
    playTrailRef.current?.setPath([]);
    setPlaying(true);
  }, [playbackPoints.length, showPlayFrame]);

  const playTripLeg = useCallback(
    (legIndex: number) => {
      const leg = tripLegs.find((l) => l.index === legIndex);
      if (!leg || playbackPoints.length < 2) return;
      const startMs = new Date(leg.startAt).getTime();
      const endMs = new Date(leg.endAt).getTime();
      let from = playbackPoints.findIndex((p) => p.at >= startMs);
      if (from < 0) from = 0;
      let to = from;
      for (let i = playbackPoints.length - 1; i >= from; i--) {
        if (playbackPoints[i]!.at <= endMs) {
          to = i;
          break;
        }
      }
      if (to <= from) to = Math.min(from + 1, playbackPoints.length - 1);
      playRangeRef.current = { from, to };
      setActiveTripIndex(leg.index);
      infoWindowRef.current?.close();
      ensurePlayOverlays();
      playTrailRef.current?.setOptions({ strokeColor: leg.color });
      showPlayFrame(from);
      setPlaying(true);
    },
    [ensurePlayOverlays, playbackPoints, showPlayFrame, tripLegs],
  );

  const playTripLegRef = useRef(playTripLeg);
  playTripLegRef.current = playTripLeg;

  useEffect(() => {
    if (!playing || !canPlay) {
      if (playTimerRef.current != null) {
        window.clearTimeout(playTimerRef.current);
        playTimerRef.current = null;
      }
      return;
    }

    const tick = () => {
      const from = playIndexRef.current;
      const max = playRangeRef.current?.to ?? playbackPoints.length - 1;
      if (from >= max) {
        setPlaying(false);
        return;
      }
      const next = from + 1;
      showPlayFrame(next);
      playTimerRef.current = window.setTimeout(tick, PLAYBACK_MS_PER_POINT / playSpeed);
    };

    playTimerRef.current = window.setTimeout(tick, PLAYBACK_MS_PER_POINT / playSpeed);
    return () => {
      if (playTimerRef.current != null) {
        window.clearTimeout(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [playing, canPlay, playbackPoints.length, playSpeed, showPlayFrame]);

  useEffect(() => {
    setPlaying(false);
    setPlayIndex(0);
    playIndexRef.current = 0;
    playRangeRef.current = null;
    setActiveTripIndex(null);
    clearPlaybackOverlays();
  }, [positions, clearPlaybackOverlays]);

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
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    const map = mapInstanceRef.current;
    infoWindowRef.current?.close();

    for (const line of polylinesRef.current) line.setMap(null);
    polylinesRef.current = [];
    startMarkerRef.current?.setMap(null);
    endMarkerRef.current?.setMap(null);
    for (const marker of eventMarkersRef.current) marker.setMap(null);
    eventMarkersRef.current = [];
    geofenceCircleRef.current?.setMap(null);
    geofenceCircleRef.current = null;
    clearPlaybackOverlays();

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
          cursor: "pointer",
        });
        marker.addListener("click", () => {
          infoWindowRef.current?.setContent(eventInfoHtml(event));
          infoWindowRef.current?.open({ map, anchor: marker });
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

    for (const leg of tripLegs) {
      if (leg.path.length < 2) continue;
      const line = new google.maps.Polyline({
        path: leg.path,
        map,
        strokeColor: leg.color,
        strokeWeight: 5,
        strokeOpacity: 0.92,
        zIndex: 10,
        clickable: true,
      });
      line.addListener("click", () => {
        playTripLegRef.current(leg.index);
      });
      polylinesRef.current.push(line);
    }

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
  }, [ready, path, tripLegs, tripEvents, geofence, clearPlaybackOverlays]);

  const shellStyle = { height: MAP_HEIGHT };
  const stopCount = tripEvents.filter((e) => e.kind === "stop").length;
  const ignitionOffCount = tripEvents.filter((e) => e.kind === "ignition_off").length;
  const currentPlay = playbackPoints[playIndex];

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

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={playing ? "secondary" : "default"}
          className="gap-1.5"
          disabled={!canPlay}
          onClick={() => {
            if (!canPlay) return;
            if (playing) {
              setPlaying(false);
              return;
            }
            const range = playRangeRef.current;
            const max = range?.to ?? playbackPoints.length - 1;
            if (playIndexRef.current >= max) {
              if (activeTripIndex != null) playTripLeg(activeTripIndex);
              else playFullDay();
              return;
            }
            ensurePlayOverlays();
            showPlayFrame(playIndexRef.current);
            setPlaying(true);
          }}
          data-testid="button-fleet-playback"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing ? "Pause" : "Play route"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={!canPlay}
          onClick={() => {
            setPlaying(false);
            playRangeRef.current = null;
            setActiveTripIndex(null);
            playTrailRef.current?.setOptions({ strokeColor: "#f8fafc" });
            showPlayFrame(0);
            playTrailRef.current?.setPath([]);
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
        <div className="flex items-center gap-1">
          {([1, 2, 4] as const).map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={playSpeed === s ? "secondary" : "ghost"}
              className="h-8 px-2 text-[11px]"
              disabled={!canPlay}
              onClick={() => setPlaySpeed(s)}
            >
              {s}×
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {canPlay
            ? activeTripIndex != null
              ? `Trip ${activeTripIndex} · ${playIndex + 1}/${playbackPoints.length}`
              : `GPS · ${playIndex + 1}/${playbackPoints.length}`
            : "Need at least two GPS points to play"}
          {currentPlay && Number.isFinite(currentPlay.at)
            ? ` · ${new Date(currentPlay.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
            : ""}
          {currentPlay?.speedKph != null ? ` · ${Math.round(currentPlay.speedKph)} km/h` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-0.5">
        <MapLegendItem color="#16a34a" label="Start" />
        <MapLegendItem color="#2563eb" label="Latest" />
        {stopCount > 0 && (
          <MapLegendItem color={STOP_COLOR} label={`Stop (${stopCount}) — tap for duration`} />
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

      {tripLegs.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground px-0.5">
            Trips (movement only — tap to play)
          </p>
          <div className="flex flex-wrap items-center gap-2 px-0.5">
            {tripLegs.map((leg) => (
              <button
                key={leg.index}
                type="button"
                onClick={() => playTripLeg(leg.index)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
                  activeTripIndex === leg.index
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/80"
                  style={{ backgroundColor: leg.color }}
                />
                Trip {leg.index} · {formatTripClock(leg.startAt)}–{formatTripClock(leg.endAt)}
                {leg.distanceKm != null ? ` · ${leg.distanceKm.toFixed(1)} km` : ""}
              </button>
            ))}
            {tripLegs.length > 0 && (
              <button
                type="button"
                onClick={playFullDay}
                className="inline-flex items-center rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              >
                Play full day
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function estimatePathDistanceKm(path: Array<{ lat: number; lng: number }>): number | null {
  const km = pathDistanceKm(path);
  return km != null && km > 0 ? km : null;
}
