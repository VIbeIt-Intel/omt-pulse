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

const MAP_HEIGHT = "min(58vh, 420px)";

function GeoMapPreview({
  lat,
  lng,
  label,
  open,
}: {
  lat: number;
  lng: number;
  label: string;
  open: boolean;
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
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
    });
    new google.maps.Marker({ position: { lat, lng }, map, title: label });
    mapInstanceRef.current = map;
  }, [ready, lat, lng, label]);

  // Re-fit after the sheet animation so the map fills the larger panel.
  useEffect(() => {
    if (!open || !ready || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const timer = window.setTimeout(() => {
      google.maps.event.trigger(map, "resize");
      map.setCenter({ lat, lng });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [open, ready, lat, lng]);

  const shellStyle = { height: MAP_HEIGHT };

  if (error) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground px-4 text-center"
        style={shellStyle}
      >
        Map unavailable — {lat.toFixed(5)}, {lng.toFixed(5)}
      </div>
    );
  }

  if (!ready) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border bg-muted/30"
        style={shellStyle}
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      ref={mapRef}
      className="w-full rounded-lg border shadow-sm"
      style={shellStyle}
      data-testid="incident-location-geo-map"
    />
  );
}

export type GeoMapView = { lat: number; lng: number; title: string };

export function formatCoordLabel(lat: number, lng: number, decimals = 5): string {
  return `${Number(lat).toFixed(decimals)}, ${Number(lng).toFixed(decimals)}`;
}

/** In-app map for any lat/lng (live timeline, responder GPS, etc.). */
export function GeoLocationSheet({
  view,
  onClose,
}: {
  view: GeoMapView | null;
  onClose: () => void;
}) {
  const open = view != null;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {view && (
          <>
            <SheetHeader className="mb-4">
              <SheetTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                {view.title}
              </SheetTitle>
            </SheetHeader>
            <GeoMapPreview lat={view.lat} lng={view.lng} label={view.title} open={open} />
            <p className="mt-3 text-xs text-muted-foreground font-mono">
              {formatCoordLabel(view.lat, view.lng)}
            </p>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
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
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
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
            height={MAP_HEIGHT}
          />
        ) : coords ? (
          <GeoMapPreview lat={coords.lat} lng={coords.lng} label={locationLabel} open={open} />
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
