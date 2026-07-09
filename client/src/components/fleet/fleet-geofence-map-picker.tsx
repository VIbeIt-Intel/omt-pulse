import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { SA_MAP_DEFAULT } from "@/components/live-incidents-map";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { cn } from "@/lib/utils";
import { Crosshair, Loader2, MapPin, Search } from "lucide-react";

const GEOFENCE_COLOR = "#22c55e";
const MIN_RADIUS_M = 50;
const MAX_RADIUS_M = 10_000;

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#334155" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f172a" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
];

type PlaceSuggestion = { place_id: string; description: string };

export type FleetGeofenceValue = {
  lat: number | null;
  lng: number | null;
  radiusM: number;
};

type FleetGeofenceMapPickerProps = {
  value: FleetGeofenceValue;
  onChange: (value: FleetGeofenceValue) => void;
  vehicleLatLng?: { lat: number; lng: number } | null;
  className?: string;
  height?: string;
};

function hasCentre(value: FleetGeofenceValue): value is FleetGeofenceValue & { lat: number; lng: number } {
  return value.lat != null && value.lng != null && Number.isFinite(value.lat) && Number.isFinite(value.lng);
}

export function FleetGeofenceMapPicker({
  value,
  onChange,
  vehicleLatLng,
  className,
  height = "280px",
}: FleetGeofenceMapPickerProps) {
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const autocompleteRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  }, [value, onChange]);

  const applyCentre = useCallback((lat: number, lng: number, radiusM?: number) => {
    onChangeRef.current({
      lat,
      lng,
      radiusM: radiusM ?? valueRef.current.radiusM,
    });
  }, []);

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
        setMapsError(err.message || "Map could not load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapsReady || !mapRef.current || mapInstanceRef.current) return;

    const initial = hasCentre(valueRef.current)
      ? { lat: valueRef.current.lat, lng: valueRef.current.lng }
      : vehicleLatLng ?? { lat: SA_MAP_DEFAULT.lat, lng: SA_MAP_DEFAULT.lng };

    const map = new google.maps.Map(mapRef.current, {
      center: initial,
      zoom: hasCentre(valueRef.current) || vehicleLatLng ? 14 : SA_MAP_DEFAULT.zoom,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      gestureHandling: "greedy",
      styles: DARK_MAP_STYLES,
    });
    mapInstanceRef.current = map;

    map.addListener("click", (e: google.maps.MapMouseEvent) => {
      const latLng = e.latLng;
      if (!latLng) return;
      applyCentre(latLng.lat(), latLng.lng());
    });

    return () => {
      markerRef.current?.setMap(null);
      circleRef.current?.setMap(null);
      mapInstanceRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
  }, [mapsReady, applyCentre, vehicleLatLng]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapsReady) return;

    if (!hasCentre(value)) {
      markerRef.current?.setMap(null);
      circleRef.current?.setMap(null);
      markerRef.current = null;
      circleRef.current = null;
      return;
    }

    const centre = { lat: value.lat, lng: value.lng };
    const radius = Math.min(Math.max(value.radiusM, MIN_RADIUS_M), MAX_RADIUS_M);

    if (circleRef.current) {
      circleRef.current.setCenter(centre);
      circleRef.current.setRadius(radius);
    } else {
      circleRef.current = new google.maps.Circle({
        map,
        center: centre,
        radius,
        strokeColor: GEOFENCE_COLOR,
        strokeOpacity: 0.95,
        strokeWeight: 2,
        fillColor: GEOFENCE_COLOR,
        fillOpacity: 0.12,
        clickable: false,
        zIndex: 4,
      });
    }

    if (markerRef.current) {
      markerRef.current.setPosition(centre);
    } else {
      markerRef.current = new google.maps.Marker({
        map,
        position: centre,
        draggable: true,
        title: "Geofence centre — drag to move",
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: GEOFENCE_COLOR,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        zIndex: 20,
      });
      markerRef.current.addListener("dragend", () => {
        const pos = markerRef.current?.getPosition();
        if (!pos) return;
        applyCentre(pos.lat(), pos.lng());
      });
    }

    map.panTo(centre);
  }, [value.lat, value.lng, value.radiusM, mapsReady, applyCentre]);

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
            setSuggestions(results.map((r) => ({ place_id: r.place_id!, description: r.description })));
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
      applyCentre(lat, lng);
      mapInstanceRef.current?.panTo({ lat, lng });
      mapInstanceRef.current?.setZoom(15);
    });
  }

  function centreOnVehicle() {
    if (!vehicleLatLng) return;
    applyCentre(vehicleLatLng.lat, vehicleLatLng.lng);
    mapInstanceRef.current?.panTo(vehicleLatLng);
    mapInstanceRef.current?.setZoom(15);
  }

  const radiusKm = (value.radiusM / 1000).toFixed(value.radiusM >= 1000 ? 1 : 2);

  if (mapsError) {
    return (
      <p className="text-sm text-destructive rounded-md border border-dashed p-4">{mapsError}</p>
    );
  }

  return (
    <div className={cn("space-y-3", className)} data-testid="fleet-geofence-map-picker">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9 h-10"
          placeholder="Search address or site in South Africa…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            runSearch(e.target.value);
          }}
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {suggestions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-40 overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s.place_id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 border-b last:border-0"
                onClick={() => selectSuggestion(s)}
              >
                {s.description}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {vehicleLatLng && (
          <Button type="button" variant="outline" size="sm" onClick={centreOnVehicle}>
            <Crosshair className="h-4 w-4 mr-1" />
            Use vehicle position
          </Button>
        )}
        <p className="text-xs text-muted-foreground flex items-center gap-1 self-center">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          Tap the map or drag the pin to set the zone centre
        </p>
      </div>

      <div className="relative rounded-lg border overflow-hidden bg-muted/20">
        {!mapsReady && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-muted/50"
            style={{ height }}
          >
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <div ref={mapRef} style={{ height, width: "100%" }} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <Label>Radius</Label>
          <span className="text-muted-foreground tabular-nums">
            {value.radiusM} m ({radiusKm} km)
          </span>
        </div>
        <Slider
          min={MIN_RADIUS_M}
          max={MAX_RADIUS_M}
          step={50}
          value={[Math.min(Math.max(value.radiusM, MIN_RADIUS_M), MAX_RADIUS_M)]}
          onValueChange={([r]) =>
            onChange({ ...value, radiusM: r ?? value.radiusM })
          }
        />
      </div>

      {hasCentre(value) && (
        <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground font-mono">
          <span>Lat {value.lat.toFixed(6)}</span>
          <span>Lng {value.lng.toFixed(6)}</span>
        </div>
      )}
    </div>
  );
}
