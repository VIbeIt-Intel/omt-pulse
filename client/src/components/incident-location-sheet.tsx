import { useEffect, useRef, useState } from "react";
import type { Incident, Category, CustomMap, Location } from "@shared/schema";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CustomMapLayerView } from "@/components/custom-map-layer-view";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { resolveIncidentCoords } from "@/lib/incident-display";
import { MapPin, Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incident: Incident | null;
  locationLabel: string;
  customMaps: CustomMap[];
  categories: Category[];
  locations: Location[];
};

function GeoMapPreview({
  lat,
  lng,
  label,
}: {
  lat: number;
  lng: number;
  label: string;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

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
    if (!ready || !mapRef.current || mapInstanceRef.current) return;
    const map = new google.maps.Map(mapRef.current, {
      center: { lat, lng },
      zoom: 15,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    new google.maps.Marker({ position: { lat, lng }, map, title: label });
    mapInstanceRef.current = map;
  }, [ready, lat, lng, label]);

  if (error) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border bg-muted/30 text-sm text-muted-foreground">
        Map unavailable — {lat.toFixed(5)}, {lng.toFixed(5)}
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <div ref={mapRef} className="h-48 w-full rounded-md border" data-testid="incident-location-geo-map" />;
}

export function IncidentLocationSheet({
  open,
  onOpenChange,
  incident,
  locationLabel,
  customMaps,
  categories,
  locations,
}: Props) {
  if (!incident) return null;

  const customMap =
    incident.customMapId != null ? customMaps.find((m) => m.id === incident.customMapId) : undefined;
  const hasCustomPin =
    customMap != null && incident.customMapX != null && incident.customMapY != null;
  const coords = resolveIncidentCoords(incident, locations);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
            {locationLabel}
          </SheetTitle>
        </SheetHeader>

        {hasCustomPin && customMap ? (
          <CustomMapLayerView
            customMap={customMap}
            incidents={[incident]}
            categories={categories}
            height="280px"
          />
        ) : coords ? (
          <GeoMapPreview lat={coords.lat} lng={coords.lng} label={locationLabel} />
        ) : (
          <p className="text-sm text-muted-foreground">
            No map coordinates recorded for this location.
          </p>
        )}

        {coords && !hasCustomPin && (
          <p className="mt-3 text-xs text-muted-foreground font-mono">
            {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
