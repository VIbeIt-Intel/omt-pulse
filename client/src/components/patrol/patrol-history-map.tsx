import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PatrolCheckpoint, PatrolCheckpointLogWithCheckpoint } from "@shared/schema";
import type { PatrolReportTrackPoint } from "@/lib/patrol-types";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { SA_MAP_DEFAULT } from "@/components/live-incidents-map";
import { hasCheckpointCoords } from "@/lib/patrol-route-draft";
import { Button } from "@/components/ui/button";
import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

type PatrolHistoryMapProps = {
  checkpoints: PatrolCheckpoint[];
  logs: PatrolCheckpointLogWithCheckpoint[];
  trackPoints: PatrolReportTrackPoint[];
  /** When false, tear down the map so it re-inits at the correct size when shown again. */
  active?: boolean;
  className?: string;
};

type PlaybackPoint = {
  lat: number;
  lng: number;
  at: number;
  label?: string;
};

type SelectedClock = {
  name: string;
  clockedAt: string;
  distanceM: number | null;
  outside: boolean;
  lat: number;
  lng: number;
};

function formatClockTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function PatrolHistoryMap({
  checkpoints,
  logs,
  trackPoints,
  active = true,
  className,
}: PatrolHistoryMapProps) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedClock, setSelectedClock] = useState<SelectedClock | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState(0);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const playMarkerRef = useRef<google.maps.Marker | null>(null);
  const playTrailRef = useRef<google.maps.Polyline | null>(null);
  const playTimerRef = useRef<number | null>(null);

  const playbackPoints = useMemo<PlaybackPoint[]>(() => {
    if (trackPoints.length >= 2) {
      return trackPoints
        .map((p) => ({
          lat: p.latitude,
          lng: p.longitude,
          at: new Date(p.recordedAt).getTime(),
        }))
        .filter((p) => Number.isFinite(p.at))
        .sort((a, b) => a.at - b.at);
    }
    // Fallback: animate between clocked GPS points in time order.
    return logs
      .filter((l) => l.latitude != null && l.longitude != null)
      .map((l) => ({
        lat: l.latitude!,
        lng: l.longitude!,
        at: new Date(l.clockedAt).getTime(),
        label: l.checkpointName,
      }))
      .filter((p) => Number.isFinite(p.at))
      .sort((a, b) => a.at - b.at);
  }, [trackPoints, logs]);

  const playbackMode =
    trackPoints.length >= 2 ? "track" : playbackPoints.length >= 2 ? "clocks" : "none";

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

  useEffect(() => {
    if (!active) {
      setPlaying(false);
      setPlayIndex(0);
      setSelectedClock(null);
      clearPlaybackOverlays();
      if (mapInstanceRef.current) {
        google.maps.event.clearInstanceListeners(mapInstanceRef.current);
        mapInstanceRef.current = null;
      }
    }
  }, [active, clearPlaybackOverlays]);

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
    infoWindowRef.current = new google.maps.InfoWindow();

    const bounds = new google.maps.LatLngBounds();
    let hasBounds = false;

    const plannedPath: google.maps.LatLngLiteral[] = [];
    checkpoints.forEach((cp, i) => {
      if (!hasCheckpointCoords(cp)) return;
      const pos = { lat: cp.latitude!, lng: cp.longitude! };
      plannedPath.push(pos);
      bounds.extend(pos);
      hasBounds = true;
      const log = logs.find((l) => l.checkpointId === cp.id);
      const marker = new google.maps.Marker({
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
      marker.addListener("click", () => {
        const lines = [
          `<div style="max-width:220px;font:12px/1.4 system-ui,sans-serif;color:#111">`,
          `<strong>${escapeHtml(cp.name)}</strong>`,
          `<div style="margin-top:4px;color:#555">Planned checkpoint #${i + 1}</div>`,
        ];
        if (log) {
          lines.push(
            `<div style="margin-top:6px"><strong>Clocked</strong><br/>${escapeHtml(formatClockTime(log.clockedAt))}</div>`,
          );
          if (log.distanceM != null) {
            lines.push(`<div>${Math.round(log.distanceM)} m from pin</div>`);
          }
          if (log.withinGeofence === false) {
            lines.push(`<div style="color:#b91c1c;font-weight:600">Outside radius</div>`);
          }
          setSelectedClock({
            name: cp.name,
            clockedAt: String(log.clockedAt),
            distanceM: log.distanceM ?? null,
            outside: log.withinGeofence === false,
            lat: log.latitude ?? pos.lat,
            lng: log.longitude ?? pos.lng,
          });
        } else {
          lines.push(`<div style="margin-top:6px;color:#777">Not clocked</div>`);
          setSelectedClock(null);
        }
        lines.push(`</div>`);
        infoWindowRef.current?.setContent(lines.join(""));
        infoWindowRef.current?.open({ map, anchor: marker });
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
      const marker = new google.maps.Marker({
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
      marker.addListener("click", () => {
        const dist =
          log.distanceM != null ? `${Math.round(log.distanceM)} m from pin` : "Distance unknown";
        infoWindowRef.current?.setContent(
          [
            `<div style="max-width:220px;font:12px/1.4 system-ui,sans-serif;color:#111">`,
            `<strong>${escapeHtml(log.checkpointName)}</strong>`,
            `<div style="margin-top:6px"><strong>Clocked</strong><br/>${escapeHtml(formatClockTime(log.clockedAt))}</div>`,
            `<div>${escapeHtml(dist)}</div>`,
            outside ? `<div style="color:#b91c1c;font-weight:600">Outside radius</div>` : "",
            `<div style="margin-top:4px;color:#666;font-size:11px">${log.latitude!.toFixed(5)}, ${log.longitude!.toFixed(5)}</div>`,
            `</div>`,
          ].join(""),
        );
        infoWindowRef.current?.open({ map, anchor: marker });
        setSelectedClock({
          name: log.checkpointName,
          clockedAt: String(log.clockedAt),
          distanceM: log.distanceM ?? null,
          outside,
          lat: log.latitude,
          lng: log.longitude,
        });
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
      setPlaying(false);
      clearPlaybackOverlays();
      infoWindowRef.current?.close();
      infoWindowRef.current = null;
      if (mapInstanceRef.current) {
        google.maps.event.clearInstanceListeners(mapInstanceRef.current);
        mapInstanceRef.current = null;
      }
    };
  }, [active, ready, checkpoints, logs, trackPoints, clearPlaybackOverlays]);

  const playIndexRef = useRef(0);

  const ensurePlayOverlays = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || playbackPoints.length === 0) return;
    if (!playMarkerRef.current) {
      playMarkerRef.current = new google.maps.Marker({
        map,
        position: playbackPoints[0],
        title: "Playback",
        zIndex: 10,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: "#10b981",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
      });
    }
    if (!playTrailRef.current) {
      playTrailRef.current = new google.maps.Polyline({
        map,
        path: [],
        geodesic: true,
        strokeColor: "#34d399",
        strokeOpacity: 0.95,
        strokeWeight: 5,
        zIndex: 9,
      });
    }
  }, [playbackPoints]);

  const showPlayFrame = useCallback(
    (index: number) => {
      const map = mapInstanceRef.current;
      if (!map || playbackPoints.length === 0) return;
      ensurePlayOverlays();
      const clamped = Math.max(0, Math.min(index, playbackPoints.length - 1));
      const point = playbackPoints[clamped]!;
      playIndexRef.current = clamped;
      playMarkerRef.current?.setPosition(point);
      playTrailRef.current?.setPath(
        playbackPoints.slice(0, clamped + 1).map((p) => ({ lat: p.lat, lng: p.lng })),
      );
      map.panTo(point);
      if (point.label) {
        playMarkerRef.current?.setTitle(point.label);
      }
      setPlayIndex(clamped);
    },
    [ensurePlayOverlays, playbackPoints],
  );

  useEffect(() => {
    if (!playing) {
      if (playTimerRef.current != null) {
        window.clearTimeout(playTimerRef.current);
        playTimerRef.current = null;
      }
      return;
    }
    if (playbackPoints.length < 2) {
      setPlaying(false);
      return;
    }

    let cancelled = false;
    ensurePlayOverlays();

    const step = () => {
      if (cancelled) return;
      const fromIndex = playIndexRef.current;
      if (fromIndex >= playbackPoints.length - 1) {
        setPlaying(false);
        return;
      }
      const next = fromIndex + 1;
      const cur = playbackPoints[fromIndex]!;
      const nxt = playbackPoints[next]!;
      const realGap = Math.max(0, nxt.at - cur.at);
      const delay =
        playbackMode === "clocks"
          ? 900
          : Math.min(1200, Math.max(40, realGap / 25));
      playTimerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        showPlayFrame(next);
        step();
      }, delay);
    };

    if (playIndexRef.current >= playbackPoints.length - 1) {
      showPlayFrame(0);
    } else {
      showPlayFrame(playIndexRef.current);
    }
    step();

    return () => {
      cancelled = true;
      if (playTimerRef.current != null) {
        window.clearTimeout(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [playing, playbackPoints, playbackMode, ensurePlayOverlays, showPlayFrame]);

  function handlePlayToggle() {
    if (playbackMode === "none") return;
    if (playing) {
      setPlaying(false);
      return;
    }
    setPlaying(true);
  }

  function handleReset() {
    setPlaying(false);
    showPlayFrame(0);
    playTrailRef.current?.setPath([]);
  }

  if (error) {
    return <p className="p-3 text-xs text-destructive">{error}</p>;
  }

  const mapShell =
    "relative h-[min(48vh,440px)] min-h-[300px] w-full overflow-hidden rounded-xl border border-border/80 bg-muted/30";

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

  const currentPlay = playbackPoints[playIndex];

  return (
    <div className={cn("space-y-3", className)}>
      <div className={mapShell}>
        <div ref={mapRef} className="absolute inset-0 h-full w-full" data-testid="patrol-history-map" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={playing ? "secondary" : "default"}
          className="gap-1.5"
          disabled={playbackMode === "none"}
          onClick={handlePlayToggle}
          data-testid="button-patrol-playback"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing ? "Pause" : "Play route"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={playbackMode === "none"}
          onClick={handleReset}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
        <p className="text-[11px] text-muted-foreground">
          {playbackMode === "track"
            ? `GPS track · ${playIndex + 1}/${playbackPoints.length}`
            : playbackMode === "clocks"
              ? `Checkpoint clocks (no GPS track) · ${playIndex + 1}/${playbackPoints.length}`
              : "No path to play — need a GPS track or at least two clocked pins"}
          {currentPlay?.label ? ` · ${currentPlay.label}` : ""}
          {currentPlay && Number.isFinite(currentPlay.at)
            ? ` · ${formatClockTime(new Date(currentPlay.at))}`
            : ""}
        </p>
      </div>

      {selectedClock && (
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs space-y-0.5">
          <p className="font-medium text-sm">{selectedClock.name}</p>
          <p className="text-muted-foreground">
            Clocked {formatClockTime(selectedClock.clockedAt)}
            {selectedClock.distanceM != null ? ` · ${Math.round(selectedClock.distanceM)} m from pin` : ""}
            {selectedClock.outside ? " · Outside radius" : ""}
          </p>
          <p className="tabular-nums text-muted-foreground">
            {selectedClock.lat.toFixed(5)}, {selectedClock.lng.toFixed(5)}
          </p>
        </div>
      )}

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
        <span className="text-[10px] opacity-80">Tip: click a pin or orange marker for clock time</span>
      </div>
    </div>
  );
}
