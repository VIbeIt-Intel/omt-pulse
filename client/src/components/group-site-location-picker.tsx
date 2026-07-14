import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Map, MapPin } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { cn } from "@/lib/utils";

export type GroupSiteLocationValue = {
  siteName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

export function emptyGroupSiteLocation(): GroupSiteLocationValue {
  return { siteName: "", address: "", latitude: null, longitude: null };
}

type PlaceSuggestion = { place_id: string; description: string };

type Props = {
  value: GroupSiteLocationValue;
  onChange: (value: GroupSiteLocationValue) => void;
  groupNameHint?: string;
  disabled?: boolean;
};

export function GroupSiteLocationPicker({ value, onChange, groupNameHint = "", disabled }: Props) {
  const [search, setSearch] = useState(value.address);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapDraft, setMapDraft] = useState<GroupSiteLocationValue | null>(null);
  const [mapGeocoding, setMapGeocoding] = useState(false);

  const autocompleteRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const mapInitRef = useRef<{ lat: number; lng: number; hasCoords: boolean } | null>(null);
  const valueRef = useRef(value);
  const groupNameHintRef = useRef(groupNameHint);

  useEffect(() => {
    valueRef.current = value;
    groupNameHintRef.current = groupNameHint;
  }, [value, groupNameHint]);

  useEffect(() => {
    setSearch(value.address);
  }, [value.address]);

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
      const siteName = value.siteName.trim() || groupNameHint.trim() || suggestion.description.split(",")[0]?.trim() || "";
      onChange({
        siteName,
        address: suggestion.description,
        latitude: loc.lat(),
        longitude: loc.lng(),
      });
    });
  }

  function clearSite() {
    setSearch("");
    setSuggestions([]);
    onChange(emptyGroupSiteLocation());
  }

  function openMapDialog() {
    const hasCoords = value.latitude != null && value.longitude != null;
    mapInitRef.current = {
      lat: value.latitude ?? -26.2041,
      lng: value.longitude ?? 28.0473,
      hasCoords,
    };
    setMapDraft(
      hasCoords
        ? { ...value }
        : {
            siteName: value.siteName.trim() || groupNameHint.trim(),
            address: value.address,
            latitude: null,
            longitude: null,
          },
    );
    setMapOpen(true);
  }

  function closeMapDialog() {
    setMapOpen(false);
    setMapDraft(null);
    setMapGeocoding(false);
  }

  function confirmMapSelection() {
    if (mapDraft?.latitude != null && mapDraft.longitude != null) {
      onChange(mapDraft);
      setSearch(mapDraft.address);
    }
    closeMapDialog();
  }

  useEffect(() => {
    if (!mapOpen || !mapsReady || !geocoderRef.current) return;

    let cancelled = false;
    const init = mapInitRef.current ?? { lat: -26.2041, lng: 28.0473, hasCoords: false };

    const timer = window.setTimeout(() => {
      if (cancelled || !mapRef.current || mapInstanceRef.current) return;

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: init.lat, lng: init.lng },
        zoom: init.hasCoords ? 14 : 6,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: "greedy",
      });
      mapInstanceRef.current = map;

      if (init.hasCoords) {
        markerRef.current = new google.maps.Marker({
          position: { lat: init.lat, lng: init.lng },
          map,
          title: "Site location",
        });
      }

      map.addListener("click", (e: google.maps.MapMouseEvent) => {
        const latLng = e.latLng;
        if (!latLng || !geocoderRef.current) return;
        const lat = latLng.lat();
        const lng = latLng.lng();
        const position = { lat, lng };
        if (markerRef.current) {
          markerRef.current.setPosition(position);
        } else {
          markerRef.current = new google.maps.Marker({ position, map, title: "Site location" });
        }
        map.setCenter(position);
        map.setZoom(14);
        setMapGeocoding(true);
        geocoderRef.current.geocode({ location: position }, (results, status) => {
          setMapGeocoding(false);
          const address =
            status === google.maps.GeocoderStatus.OK && results?.[0]
              ? results[0].formatted_address
              : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          const currentValue = valueRef.current;
          const hint = groupNameHintRef.current;
          setMapDraft((prev) => ({
            siteName:
              prev?.siteName.trim() ||
              currentValue.siteName.trim() ||
              hint.trim() ||
              address.split(",")[0]?.trim() ||
              "",
            address,
            latitude: lat,
            longitude: lng,
          }));
          if (markerRef.current) {
            markerRef.current.setTitle(address);
          }
        });
      });
    }, 50);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
      if (mapInstanceRef.current) {
        google.maps.event.clearInstanceListeners(mapInstanceRef.current);
        mapInstanceRef.current = null;
      }
    };
  }, [mapOpen, mapsReady]);

  return (
    <div className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <MapPin className="h-4 w-4 text-primary shrink-0" />
        Premises location
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        Pin the site on Google Maps so the control room knows where this group operates.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="group-site-name" className="text-xs">
          Site name
        </Label>
        <Input
          id="group-site-name"
          value={value.siteName}
          disabled={disabled}
          placeholder={groupNameHint ? `e.g. ${groupNameHint}` : "e.g. Main gate"}
          onChange={(e) => onChange({ ...value, siteName: e.target.value })}
          data-testid="input-group-site-name"
        />
      </div>

      <div className="space-y-1.5 relative">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="group-site-search" className="text-xs">
            Search address
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs shrink-0"
            disabled={disabled || !mapsReady}
            onClick={openMapDialog}
            data-testid="button-group-choose-on-map"
          >
            <Map className="h-3.5 w-3.5 mr-1.5" />
            Choose on map
          </Button>
        </div>
        <div className="relative">
          <Input
            id="group-site-search"
            value={search}
            disabled={disabled || !mapsReady}
            placeholder="Search street, estate, or business…"
            onChange={(e) => {
              const next = e.target.value;
              setSearch(next);
              onChange({ ...value, address: next, latitude: null, longitude: null });
              runSearch(next);
            }}
            data-testid="input-group-site-search"
          />
          {searching && (
            <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
        {mapsError && (
          <p className="text-xs text-destructive">{mapsError}</p>
        )}
        {!mapsReady && !mapsError && (
          <p className="text-xs text-muted-foreground">Loading Google Maps search…</p>
        )}
        {suggestions.length > 0 && (
          <ul className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
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

      {value.address && value.latitude != null && value.longitude != null && (
        <div className="rounded-md border bg-card/60 px-3 py-2 text-xs space-y-1">
          <p className="font-medium text-foreground truncate">{value.address}</p>
          <p className="text-muted-foreground tabular-nums">
            {value.latitude.toFixed(5)}, {value.longitude.toFixed(5)}
          </p>
          <button
            type="button"
            className={cn("text-[11px] text-muted-foreground hover:text-foreground underline")}
            onClick={clearSite}
          >
            Clear location
          </button>
        </div>
      )}

      <Dialog open={mapOpen} onOpenChange={(open) => !open && closeMapDialog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose premises on map</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Click anywhere on the map to place the site pin. The address will be filled automatically.
            </p>
            <div
              ref={mapRef}
              className="h-[min(55vh,420px)] w-full rounded-md border bg-muted/30"
              data-testid="group-site-map-picker"
            />
            <div className="rounded-md border bg-card/60 px-3 py-2 text-xs space-y-1 min-h-[3rem]">
              {mapGeocoding ? (
                <p className="text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Looking up address…
                </p>
              ) : mapDraft?.latitude != null && mapDraft.longitude != null ? (
                <>
                  <p className="font-medium text-foreground">{mapDraft.address}</p>
                  <p className="text-muted-foreground tabular-nums">
                    {mapDraft.latitude.toFixed(5)}, {mapDraft.longitude.toFixed(5)}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground italic">No pin selected — click the map</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeMapDialog}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={confirmMapSelection}
              disabled={mapGeocoding || mapDraft?.latitude == null || mapDraft.longitude == null}
              data-testid="button-confirm-group-map"
            >
              Confirm location
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
