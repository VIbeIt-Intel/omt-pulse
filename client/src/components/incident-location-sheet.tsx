import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Incident, Category, CustomMap, Location } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  open,
}: {
  lat: number;
  lng: number;
  label: string;
  open: boolean;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
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
    if (!open) {
      mapInstanceRef.current = null;
      markerRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !ready || !mapRef.current) return;
    if (!mapInstanceRef.current) {
      const map = new google.maps.Map(mapRef.current, {
        center: { lat, lng },
        zoom: 16,
        mapTypeControl: true,
        streetViewControl: true,
        fullscreenControl: true,
        zoomControl: true,
      });
      markerRef.current = new google.maps.Marker({
        position: { lat, lng },
        map,
        title: label,
      });
      mapInstanceRef.current = map;
    } else {
      mapInstanceRef.current.setCenter({ lat, lng });
      markerRef.current?.setPosition({ lat, lng });
      markerRef.current?.setTitle(label);
    }
  }, [open, ready, lat, lng, label]);

  // Re-fit after the dialog opens so tiles fill the large panel.
  useEffect(() => {
    if (!open || !ready || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const timer = window.setTimeout(() => {
      google.maps.event.trigger(map, "resize");
      map.setCenter({ lat, lng });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [open, ready, lat, lng]);

  if (error) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center rounded-lg border bg-muted/30 px-4 text-center text-sm text-muted-foreground">
        Map unavailable — {lat.toFixed(5)}, {lng.toFixed(5)}
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center rounded-lg border bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      ref={mapRef}
      className="h-full min-h-[280px] w-full rounded-lg border shadow-sm"
      data-testid="incident-location-geo-map"
    />
  );
}

export type GeoMapView = { lat: number; lng: number; title: string };

export function formatCoordLabel(lat: number, lng: number, decimals = 5): string {
  return `${Number(lat).toFixed(decimals)}, ${Number(lng).toFixed(decimals)}`;
}

function LocationMapDialogShell({
  open,
  onOpenChange,
  title,
  coordsLine,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  coordsLine?: string | null;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(92vh,900px)] w-[min(96vw,1100px)] max-w-[min(96vw,1100px)] flex-col gap-0 overflow-hidden p-0"
        data-testid="incident-location-map-dialog"
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{title}</span>
          </DialogTitle>
          {coordsLine ? (
            <p className="font-mono text-xs text-muted-foreground">{coordsLine}</p>
          ) : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 p-3">{children}</div>
      </DialogContent>
    </Dialog>
  );
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
    <LocationMapDialogShell
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={view?.title ?? "Location"}
      coordsLine={view ? formatCoordLabel(view.lat, view.lng) : null}
    >
      {view && (
        <GeoMapPreview lat={view.lat} lng={view.lng} label={view.title} open={open} />
      )}
    </LocationMapDialogShell>
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
    <LocationMapDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={locationLabel}
      coordsLine={coords && !hasCustomPin ? formatCoordLabel(coords.lat, coords.lng) : null}
    >
      {hasCustomPin && customMap ? (
        <div className="h-full min-h-[280px]">
          <CustomMapLayerView
            customMap={customMap}
            incidents={[incident]}
            categories={categories}
            height="100%"
          />
        </div>
      ) : coords ? (
        <GeoMapPreview lat={coords.lat} lng={coords.lng} label={locationLabel} open={open} />
      ) : (
        <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
          No map coordinates recorded for this location.
        </p>
      )}
    </LocationMapDialogShell>
  );
}
