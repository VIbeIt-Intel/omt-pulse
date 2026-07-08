import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, MapPin } from "lucide-react";
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

  const autocompleteRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        <Label htmlFor="group-site-search" className="text-xs">
          Search address
        </Label>
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
    </div>
  );
}
