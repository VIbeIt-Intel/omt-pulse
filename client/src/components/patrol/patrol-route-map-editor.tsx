import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { SA_MAP_DEFAULT } from "@/components/live-incidents-map";
import {
  hasCheckpointCoords,
  type PatrolCheckpointDraft,
} from "@/lib/patrol-route-draft";
import { cn } from "@/lib/utils";

type PlaceSuggestion = { place_id: string; description: string };

type PatrolRouteMapEditorProps = {
  checkpoints: PatrolCheckpointDraft[];
  selectedIndex: number | null;
  onSelectCheckpoint: (index: number | null) => void;
  onUpdateCheckpoint: (index: number, patch: Partial<PatrolCheckpointDraft>) => void;
  onAddCheckpoint: (draft: PatrolCheckpointDraft) => void;
  /** When false, tear down the map so it re-inits at the correct size when shown again. */
  active?: boolean;
  /** Optional premises center used when the route has no checkpoint pins yet. */
  initialCenter?: { lat: number; lng: number } | null;
  className?: string;
};

function markerIcon(selected: boolean): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: selected ? 14 : 12,
    fillColor: selected ? "#f59e0b" : "#2563eb",
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
    labelOrigin: new google.maps.Point(0, 0),
  };
}

export function PatrolRouteMapEditor({
  checkpoints,
  selectedIndex,
  onSelectCheckpoint,
  onUpdateCheckpoint,
  onAddCheckpoint,
  active = true,
  initialCenter = null,
  className,
}: PatrolRouteMapEditorProps) {
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const autocompleteRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkpointsRef = useRef(checkpoints);
  const selectedIndexRef = useRef(selectedIndex);
  const onUpdateCheckpointRef = useRef(onUpdateCheckpoint);
  const onAddCheckpointRef = useRef(onAddCheckpoint);
  const onSelectCheckpointRef = useRef(onSelectCheckpoint);

  useEffect(() => {
    checkpointsRef.current = checkpoints;
    selectedIndexRef.current = selectedIndex;
    onUpdateCheckpointRef.current = onUpdateCheckpoint;
    onAddCheckpointRef.current = onAddCheckpoint;
    onSelectCheckpointRef.current = onSelectCheckpoint;
  }, [checkpoints, selectedIndex, onUpdateCheckpoint, onAddCheckpoint, onSelectCheckpoint]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled) return;
        autocompleteRef.current = new google.maps.places.AutocompleteService();
        geocoderRef.current = new google.maps.Geocoder();
        setMapsReady(true);
        setMapsError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setMapsError(err.message || "Google Maps could not load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyLatLng = useCallback((lat: number, lng: number, address?: string) => {
    const idx = selectedIndexRef.current;
    if (idx != null && idx >= 0 && idx < checkpointsRef.current.length) {
      onUpdateCheckpointRef.current(idx, { latitude: lat, longitude: lng });
      return;
    }
    const nextIndex = checkpointsRef.current.length;
    onAddCheckpointRef.current({
      name: address?.split(",")[0]?.trim() || `Checkpoint ${nextIndex + 1}`,
      instructions: "",
      photoRequired: false,
      latitude: lat,
      longitude: lng,
    });
    onSelectCheckpointRef.current(nextIndex);
  }, []);

  const runSearch = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || !autocompleteRef.current) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      autocompleteRef.current?.getPlacePredictions(
        { input: query, componentRestrictions: { country: "za" } },
        (results, status) => {
          setSearching(false);
          if (status === google.maps.places.PlacesServiceStatus.OK && results) {
            setSuggestions(
              results.map((r) => ({ place_id: r.place_id!, description: r.description })),
            );
          } else {
            setSuggestions([]);
          }
        },
      );
    }, 300);
  }, []);

  function selectSuggestion(suggestion: PlaceSuggestion) {
    setSearch(suggestion.description);
    setSuggestions([]);
    geocoderRef.current?.geocode({ placeId: suggestion.place_id }, (results, status) => {
      if (status !== google.maps.GeocoderStatus.OK || !results?.[0]) return;
      const loc = results[0].geometry.location;
      const lat = loc.lat();
      const lng = loc.lng();
      applyLatLng(lat, lng, suggestion.description);
      mapInstanceRef.current?.panTo({ lat, lng });
      mapInstanceRef.current?.setZoom(16);
    });
  }

  useEffect(() => {
    if (!active) {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      polylineRef.current?.setMap(null);
      polylineRef.current = null;
      if (mapInstanceRef.current) {
        google.maps.event.clearInstanceListeners(mapInstanceRef.current);
        mapInstanceRef.current = null;
      }
    }
  }, [active]);

  useEffect(() => {
    if (!active || !mapsReady || !mapRef.current || mapInstanceRef.current) return;

    const withCoords = checkpointsRef.current.filter(hasCheckpointCoords);
    const center =
      withCoords.length > 0
        ? { lat: withCoords[0]!.latitude!, lng: withCoords[0]!.longitude! }
        : initialCenter
          ? { lat: initialCenter.lat, lng: initialCenter.lng }
          : { lat: SA_MAP_DEFAULT.lat, lng: SA_MAP_DEFAULT.lng };
    const zoom =
      withCoords.length > 0 ? 14 : initialCenter ? 16 : SA_MAP_DEFAULT.zoom;

    const map = new google.maps.Map(mapRef.current, {
      center,
      zoom,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      gestureHandling: "greedy",
    });
    mapInstanceRef.current = map;

    // Force correct tile layout after the dialog finishes laying out.
    requestAnimationFrame(() => {
      google.maps.event.trigger(map, "resize");
      map.setCenter(center);
    });

    map.addListener("click", (e: google.maps.MapMouseEvent) => {
      const latLng = e.latLng;
      if (!latLng) return;
      const lat = latLng.lat();
      const lng = latLng.lng();
      applyLatLng(lat, lng);
      if (geocoderRef.current) {
        setGeocoding(true);
        geocoderRef.current.geocode({ location: { lat, lng } }, () => {
          setGeocoding(false);
        });
      }
    });

    const fitMap = () => {
      if (!mapInstanceRef.current || !mapRef.current) return;
      google.maps.event.trigger(mapInstanceRef.current, "resize");
      mapInstanceRef.current.setCenter(center);
    };

    const resizeObserver = new ResizeObserver(() => {
      fitMap();
    });
    resizeObserver.observe(mapRef.current);

    // Sheet/dialog animation often finishes after first paint — re-fit a few times.
    const t0 = window.setTimeout(fitMap, 50);
    const t1 = window.setTimeout(fitMap, 200);
    const t2 = window.setTimeout(fitMap, 450);

    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      resizeObserver.disconnect();
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      polylineRef.current?.setMap(null);
      polylineRef.current = null;
      if (mapInstanceRef.current) {
        google.maps.event.clearInstanceListeners(mapInstanceRef.current);
        mapInstanceRef.current = null;
      }
    };
  }, [active, mapsReady, applyLatLng, initialCenter?.lat, initialCenter?.lng]);

  useEffect(() => {
    if (!active || !mapsReady || !mapInstanceRef.current || !initialCenter) return;
    const withCoords = checkpoints.some(hasCheckpointCoords);
    if (withCoords) return;
    mapInstanceRef.current.panTo(initialCenter);
    mapInstanceRef.current.setZoom(16);
  }, [active, mapsReady, initialCenter?.lat, initialCenter?.lng, checkpoints]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapsReady || !active) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const path: google.maps.LatLngLiteral[] = [];
    checkpoints.forEach((cp, i) => {
      if (!hasCheckpointCoords(cp)) return;
      const position = { lat: cp.latitude!, lng: cp.longitude! };
      path.push(position);
      const marker = new google.maps.Marker({
        position,
        map,
        title: cp.name || `Checkpoint ${i + 1}`,
        label: {
          text: String(i + 1),
          color: "#ffffff",
          fontWeight: "bold",
          fontSize: "11px",
        },
        icon: markerIcon(selectedIndex === i),
        zIndex: selectedIndex === i ? 2 : 1,
      });
      marker.addListener("click", () => onSelectCheckpoint(i));
      markersRef.current.push(marker);
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
        strokeOpacity: 0.85,
        strokeWeight: 3,
        map,
      });
    }

    if (path.length >= 2) {
      const bounds = new google.maps.LatLngBounds();
      path.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
    } else if (path.length === 1) {
      map.setCenter(path[0]!);
      map.setZoom(15);
    }
  }, [checkpoints, selectedIndex, mapsReady, active, onSelectCheckpoint]);

  useEffect(() => {
    if (!active || !mapsReady || !mapInstanceRef.current) return;
    const timer = window.setTimeout(() => {
      if (mapInstanceRef.current) {
        google.maps.event.trigger(mapInstanceRef.current, "resize");
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [active, mapsReady, checkpoints.length, selectedIndex]);

  const selectedCp = selectedIndex != null ? checkpoints[selectedIndex] : null;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Map</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Select a checkpoint, then click the map to set its pin — or click empty map to add one.
          </p>
        </div>
        {geocoding && (
          <span className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0">
            <Loader2 className="h-3 w-3 animate-spin" />
            Updating…
          </span>
        )}
      </div>

      <div className="relative">
        <Input
          value={search}
          disabled={!mapsReady}
          placeholder="Search address or place…"
          onChange={(e) => {
            const next = e.target.value;
            setSearch(next);
            runSearch(next);
          }}
          data-testid="input-patrol-route-search"
        />
        {searching && (
          <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {suggestions.length > 0 && (
          <ul className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-40 overflow-y-auto">
            {suggestions.map((s) => (
              <li key={s.place_id}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted truncate"
                  onClick={() => selectSuggestion(s)}
                >
                  {s.description}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {mapsError ? (
        <p className="text-xs text-destructive">{mapsError}</p>
      ) : !mapsReady || !active ? (
        <div className="relative h-[min(52vh,480px)] min-h-[300px] w-full overflow-hidden rounded-xl border border-border/80 bg-muted/30">
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading map…
          </div>
        </div>
      ) : (
        <div className="relative h-[min(52vh,480px)] min-h-[300px] w-full overflow-hidden rounded-xl border border-border/80 bg-muted/30">
          <div ref={mapRef} className="absolute inset-0 h-full w-full" data-testid="patrol-route-map" />
        </div>
      )}

      {selectedCp && hasCheckpointCoords(selectedCp) && (
        <div className="rounded-lg border bg-card/60 px-3 py-2 text-xs flex items-start gap-2">
          <MapPin className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium truncate">
              {selectedCp.name || `Checkpoint ${(selectedIndex ?? 0) + 1}`}
            </p>
            <p className="text-muted-foreground tabular-nums">
              {selectedCp.latitude!.toFixed(5)}, {selectedCp.longitude!.toFixed(5)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
