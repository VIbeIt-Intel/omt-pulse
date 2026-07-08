import { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import html2canvas from "html2canvas";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Incident, Category, Location, FormField, CustomMap } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  BarChart3,
  AlertTriangle,
  MapPin,
  Clock,
  Calendar,
  Tag,
  X,
  Download,
  TrendingUp,
  CalendarDays,
  FileText,
  Loader2,
  Maximize2,
  Globe,
  Layers,
  ScanSearch,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Dot,
} from "recharts";
import { getIconSvg, buildMarkerSvgUrl } from "@/lib/incident-icons";
import { CustomMapLayerView } from "@/components/custom-map-layer-view";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

const severityLabels: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

function formatIncidentDateTime(incident: Incident): string {
  const date = incident.incidentDate ?? "";
  const time = incident.incidentTime ?? "";
  return [date, time].filter(Boolean).join(" ") || "—";
}

function AnalyticsIncidentDetail({
  incident,
  categories,
  onClear,
  compact = false,
}: {
  incident: Incident;
  categories: Category[];
  onClear?: () => void;
  compact?: boolean;
}) {
  const getCategoryName = (id: number | null) => categories.find((c) => c.id === id)?.name || "Unknown";
  const getCategoryColor = (id: number | null) => categories.find((c) => c.id === id)?.color || "#3B82F6";
  const getCategoryIcon = (id: number | null) => categories.find((c) => c.id === id)?.icon || "alert";

  return (
    <div className={compact ? "space-y-2" : "space-y-3"} data-testid="analytics-selected-incident">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`${compact ? "w-7 h-7" : "w-8 h-8"} rounded-full flex items-center justify-center shrink-0`}
            style={{ backgroundColor: getCategoryColor(incident.categoryId) }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={compact ? 12 : 14}
              height={compact ? 12 : 14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              dangerouslySetInnerHTML={{ __html: getIconSvg(getCategoryIcon(incident.categoryId)) }}
            />
          </div>
          <div className="min-w-0">
            <p className={`font-semibold leading-tight ${compact ? "text-sm" : "text-sm"}`}>
              {getCategoryName(incident.categoryId)}
            </p>
            {incident.severity ? (
              <p className="text-xs text-muted-foreground">
                Severity: {severityLabels[incident.severity] ?? incident.severity}
              </p>
            ) : null}
          </div>
        </div>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="text-muted-foreground hover:text-foreground p-0.5 rounded shrink-0"
            aria-label="Clear selection"
            data-testid="button-clear-selected-incident"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div className={`space-y-2 ${compact ? "text-xs" : "text-sm"}`}>
        <div className="flex items-start gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-muted-foreground">Date & time</p>
            <p className="font-medium">{formatIncidentDateTime(incident)}</p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Location</p>
            <p className="font-medium break-words">{incident.locationName?.trim() || "Not recorded"}</p>
          </div>
        </div>
        {incident.description?.trim() ? (
          <div className="flex items-start gap-2">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Description</p>
              <p className={`leading-relaxed whitespace-pre-wrap break-words ${compact ? "text-xs line-clamp-3" : "text-sm"}`}>
                {incident.description.trim()}
              </p>
            </div>
          </div>
        ) : null}
      </div>
      <Button asChild variant="outline" size="sm" className="w-full" data-testid="button-view-occurrence-from-map">
        <Link href={`/occurrence-book?incident=${incident.id}`}>View in Occurrence Book</Link>
      </Button>
    </div>
  );
}

function MapPanel({ incidents, categories, locations, customMaps }: {
  incidents: Incident[];
  categories: Category[];
  locations: Location[];
  customMaps: CustomMap[];
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const incidentMarkersRef = useRef<Map<number, google.maps.Marker>>(new Map());
  const onIncidentClickRef = useRef<(id: number) => void>(() => {});
  const heatmapMapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const leafletHeatRef = useRef<L.HeatLayer | null>(null);
  const userInteractedRef = useRef(false);
  const leafletUserInteractedRef = useRef(false);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [mapMode, setMapMode] = useState<"markers" | "heatmap">("markers");
  const [selectedTypeIds, setSelectedTypeIds] = useState<Set<number>>(new Set());
  const [showIncidents, setShowIncidents] = useState(true);
  const [showLocations, setShowLocations] = useState(true);
  const [selectedLayer, setSelectedLayer] = useState<"geographic" | number>("geographic");
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);

  const isCustomMap = typeof selectedLayer === "number";
  const activeCustomMap = isCustomMap ? customMaps.find((m) => m.id === selectedLayer) ?? null : null;

  const customMapIncidents = isCustomMap
    ? incidents.filter((i) => i.customMapId === selectedLayer && (selectedTypeIds.size === 0 || (i.categoryId != null && selectedTypeIds.has(i.categoryId))))
    : [];

  const getCategoryName = (id: number | null) => categories.find((c) => c.id === id)?.name || "Unknown";
  const getCategoryColor = (id: number | null) => categories.find((c) => c.id === id)?.color || "#3B82F6";
  const getCategoryIcon = (id: number | null) => categories.find((c) => c.id === id)?.icon || "alert";

  function resolveLatLng(inc: Incident): { lat: number; lng: number } | null {
    if (inc.latitude != null && inc.longitude != null) {
      return { lat: inc.latitude, lng: inc.longitude };
    }
    if (inc.locationId != null) {
      const loc = locations.find((l) => l.id === inc.locationId);
      if (loc?.latitude != null && loc?.longitude != null) {
        return { lat: loc.latitude, lng: loc.longitude };
      }
    }
    if (inc.liveStartLat != null && inc.liveStartLng != null) {
      return { lat: inc.liveStartLat, lng: inc.liveStartLng };
    }
    // Last resort: use the destination the responder declared they were heading to.
    // Ensures incidents where GPS never acquired still appear on the map.
    if (inc.destinationLat != null && inc.destinationLng != null) {
      return { lat: Number(inc.destinationLat), lng: Number(inc.destinationLng) };
    }
    return null;
  }


  const allGeoIncidents = incidents.filter((i) => resolveLatLng(i) !== null);
  const visibleGeoIncidents = selectedTypeIds.size === 0
    ? allGeoIncidents
    : allGeoIncidents.filter((i) => i.categoryId != null && selectedTypeIds.has(i.categoryId));

  const selectedIncident = useMemo(
    () => (selectedIncidentId != null ? incidents.find((i) => i.id === selectedIncidentId) ?? null : null),
    [incidents, selectedIncidentId],
  );

  onIncidentClickRef.current = (id: number) => {
    userInteractedRef.current = true;
    setSelectedIncidentId(id);
    const incident = incidents.find((i) => i.id === id);
    const map = mapInstanceRef.current;
    if (!incident || !map) return;
    const coords = resolveLatLng(incident);
    if (coords) {
      map.panTo(coords);
      if ((map.getZoom() ?? 0) < 14) map.setZoom(14);
    }
  };

  useEffect(() => {
    if (selectedIncidentId == null) return;
    if (!showIncidents) {
      setSelectedIncidentId(null);
      return;
    }
    const stillVisible = incidents.some((i) => {
      if (i.id !== selectedIncidentId || resolveLatLng(i) === null) return false;
      return selectedTypeIds.size === 0 || (i.categoryId != null && selectedTypeIds.has(i.categoryId));
    });
    if (!stillVisible) setSelectedIncidentId(null);
  }, [selectedIncidentId, incidents, selectedTypeIds, showIncidents]);

  function toggleType(id: number) {
    setSelectedTypeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    loadGoogleMaps()
      .then(() => setMapsReady(true))
      .catch(() => setMapsError(true));
  }, []);

  useEffect(() => {
    if (!mapsReady || !mapRef.current || mapInstanceRef.current) return;
    const gmap = new google.maps.Map(mapRef.current, {
      center: { lat: -26.2041, lng: 28.0473 },
      zoom: 6,
      mapTypeControl: true,
      mapTypeControlOptions: {
        style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
        position: google.maps.ControlPosition.TOP_RIGHT,
        mapTypeIds: ["roadmap", "satellite", "terrain"],
      },
      streetViewControl: false,
      fullscreenControl: true,
    });
    mapInstanceRef.current = gmap;
    gmap.addListener("dragend", () => { userInteractedRef.current = true; });
    gmap.addListener("zoom_changed", () => { userInteractedRef.current = true; });
    return () => {
      incidentMarkersRef.current.forEach((m) => m.setMap(null));
      incidentMarkersRef.current.clear();
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      mapInstanceRef.current = null;
    };
  }, [mapsReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapsReady) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    if (mapMode === "heatmap") {
      incidentMarkersRef.current.forEach((m) => m.setMap(null));
      incidentMarkersRef.current.clear();
      return;
    }

    const incidentCoordKeys = showIncidents
      ? new Set(visibleGeoIncidents.map((i) => { const c = resolveLatLng(i); return c ? `${c.lat},${c.lng}` : null; }).filter((v): v is string => v !== null))
      : new Set<string>();
    const geoLocations = locations.filter(
      (loc) => loc.latitude != null && loc.longitude != null && !incidentCoordKeys.has(`${loc.latitude},${loc.longitude}`)
    );

    if (showLocations) {
      geoLocations.forEach((loc) => {
        const marker = new google.maps.Marker({
          position: { lat: loc.latitude!, lng: loc.longitude! },
          map,
          icon: {
            url: buildMarkerSvgUrl(loc.color ?? "#6B7280", getIconSvg(loc.icon ?? "map-pin")),
            scaledSize: new google.maps.Size(36, 36),
            anchor: new google.maps.Point(18, 18),
          },
          zIndex: 1,
          title: loc.address ? `${loc.name} — ${loc.address}` : loc.name,
        });
        markersRef.current.push(marker);
      });
    }

    const visibleIds = new Set(showIncidents ? visibleGeoIncidents.map((i) => i.id) : []);
    for (const [id, marker] of incidentMarkersRef.current) {
      if (!visibleIds.has(id)) {
        marker.setMap(null);
        incidentMarkersRef.current.delete(id);
      }
    }

    if (showIncidents) {
      visibleGeoIncidents.forEach((incident) => {
        const coords = resolveLatLng(incident);
        if (!coords) return;
        const catColor = getCategoryColor(incident.categoryId);
        const catIconKey = getCategoryIcon(incident.categoryId);
        const icon = {
          url: buildMarkerSvgUrl(catColor, getIconSvg(catIconKey)),
          scaledSize: new google.maps.Size(36, 36),
          anchor: new google.maps.Point(18, 18),
        };
        let marker = incidentMarkersRef.current.get(incident.id);
        if (!marker) {
          marker = new google.maps.Marker({
            position: coords,
            map,
            icon,
            zIndex: 2,
            title: getCategoryName(incident.categoryId),
            clickable: true,
          });
          const incidentId = incident.id;
          marker.addListener("click", () => onIncidentClickRef.current(incidentId));
          incidentMarkersRef.current.set(incident.id, marker);
        } else {
          marker.setPosition(coords);
          marker.setMap(map);
          marker.setIcon(icon);
          marker.setTitle(getCategoryName(incident.categoryId));
        }
      });
    } else {
      incidentMarkersRef.current.forEach((m) => m.setMap(null));
      incidentMarkersRef.current.clear();
    }

    const incidentCoords = showIncidents
      ? visibleGeoIncidents.map((i) => resolveLatLng(i)).filter((c): c is { lat: number; lng: number } => c !== null)
      : [];
    const allCoords = [
      ...(showLocations ? geoLocations.map((loc) => ({ lat: loc.latitude!, lng: loc.longitude! })) : []),
      ...incidentCoords,
    ];
    if (allCoords.length > 0 && !userInteractedRef.current) {
      const bounds = new google.maps.LatLngBounds();
      allCoords.forEach((c) => bounds.extend(c));
      map.fitBounds(bounds, 50);
    }
  }, [incidents, categories, locations, selectedTypeIds, showIncidents, showLocations, mapMode, mapsReady]);

  useEffect(() => {
    for (const [id, marker] of incidentMarkersRef.current) {
      const incident = incidents.find((i) => i.id === id);
      if (!incident) continue;
      const catColor = getCategoryColor(incident.categoryId);
      const catIconKey = getCategoryIcon(incident.categoryId);
      const isSelected = id === selectedIncidentId;
      marker.setIcon({
        url: buildMarkerSvgUrl(catColor, getIconSvg(catIconKey)),
        scaledSize: new google.maps.Size(isSelected ? 44 : 36, isSelected ? 44 : 36),
        anchor: new google.maps.Point(isSelected ? 22 : 18, isSelected ? 22 : 18),
      });
      marker.setZIndex(isSelected ? 10 : 2);
    }
  }, [selectedIncidentId, incidents, categories]);

  // Leaflet heatmap — replaces the removed Google Maps HeatmapLayer (deprecated in v3.65).
  // The map container is always mounted (display:none when hidden) so the Leaflet
  // instance persists across marker↔heatmap toggles; invalidateSize() fixes tile gaps.
  useEffect(() => {
    if (mapMode !== "heatmap" || isCustomMap) return;
    const container = heatmapMapRef.current;
    if (!container) return;

    if (!leafletMapRef.current) {
      const lmap = L.map(container, { center: [-29, 25], zoom: 5, preferCanvas: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(lmap);
      leafletMapRef.current = lmap;
      lmap.on("dragend zoomend", () => { leafletUserInteractedRef.current = true; });
    }
    // Re-measure after display:none → display:block transition
    setTimeout(() => leafletMapRef.current?.invalidateSize(), 60);

    const allGeoIncs = incidents.filter((i) => resolveLatLng(i) !== null);
    const visibleIncs = selectedTypeIds.size === 0
      ? allGeoIncs
      : allGeoIncs.filter((i) => i.categoryId != null && selectedTypeIds.has(i.categoryId));

    const points: [number, number][] = (showIncidents ? visibleIncs : [])
      .map((i) => resolveLatLng(i))
      .filter((c): c is { lat: number; lng: number } => c !== null)
      .map((p) => [p.lat, p.lng] as [number, number]);

    if (!leafletHeatRef.current) {
      leafletHeatRef.current = L.heatLayer(points, {
        radius: 35,
        blur: 20,
        minOpacity: 0.35,
        gradient: { 0.0: "rgba(0,0,0,0)", 0.3: "#006039", 0.65: "#ffed4a", 1.0: "#e53e3e" },
      }).addTo(leafletMapRef.current);
    } else {
      leafletHeatRef.current.setLatLngs(points);
      leafletHeatRef.current.redraw();
    }

    if (points.length > 0 && !leafletUserInteractedRef.current) {
      const bounds = L.latLngBounds(points.map((p) => L.latLng(p[0], p[1])));
      leafletMapRef.current.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [incidents, selectedTypeIds, showIncidents, mapMode, isCustomMap]);

  // Trigger Google Maps resize when switching back to markers so tiles fill correctly.
  useEffect(() => {
    if (mapMode === "markers" && !isCustomMap && mapInstanceRef.current && mapsReady) {
      setTimeout(() => google.maps.event.trigger(mapInstanceRef.current!, "resize"), 60);
    }
  }, [mapMode, isCustomMap, mapsReady]);

  // Destroy Leaflet map on component unmount.
  useEffect(() => {
    return () => { leafletMapRef.current?.remove(); };
  }, []);

  useEffect(() => {
    if (!isCustomMap && mapInstanceRef.current) {
      setTimeout(() => google.maps.event.trigger(mapInstanceRef.current!, "resize"), 50);
    }
  }, [isCustomMap]);

  const someSelected = selectedTypeIds.size > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <div className="lg:col-span-3">
        <Card>
          <CardContent className="p-0">
            {mapsError && !isCustomMap ? (
              <div style={{ height: "500px" }} className="rounded-md flex items-center justify-center bg-muted">
                <div className="text-center space-y-2 p-6">
                  <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm font-medium">Map unavailable</p>
                  <p className="text-xs text-muted-foreground">Contact your administrator to configure Google Maps.</p>
                </div>
              </div>
            ) : (
              <>
                {/* Google Maps — markers mode */}
                <div
                  style={{ height: "500px", display: (isCustomMap || mapMode === "heatmap") ? "none" : "block" }}
                  className="relative rounded-md overflow-hidden"
                >
                  <div ref={mapRef} className="absolute inset-0" data-testid="map-incidents" />
                  {selectedIncident && mapMode === "markers" && !isCustomMap ? (
                    <div className="absolute bottom-0 left-0 right-0 z-[5] p-3 pointer-events-none">
                      <div className="pointer-events-auto max-w-lg rounded-lg border bg-background/95 backdrop-blur-sm shadow-lg p-3">
                        <AnalyticsIncidentDetail
                          incident={selectedIncident}
                          categories={categories}
                          onClear={() => setSelectedIncidentId(null)}
                          compact
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
                {/* Leaflet heatmap — always mounted so the map instance persists;
                    display:none when not in use, invalidateSize() handles the reveal. */}
                <div
                  ref={heatmapMapRef}
                  style={{ height: "500px", display: (!isCustomMap && mapMode === "heatmap") ? "block" : "none" }}
                  className="rounded-md"
                  data-testid="map-heatmap"
                />
              </>
            )}
            {isCustomMap && activeCustomMap && (
              <CustomMapLayerView
                key={activeCustomMap.id}
                customMap={activeCustomMap}
                incidents={customMapIncidents}
                categories={categories}
                height="500px"
              />
            )}
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        {!isCustomMap && mapMode === "markers" && showIncidents ? (
          selectedIncident ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Selected incident</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <AnalyticsIncidentDetail
                  incident={selectedIncident}
                  categories={categories}
                  onClear={() => setSelectedIncidentId(null)}
                />
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground text-center">
                  Tap an incident marker on the map to view its details.
                </p>
              </CardContent>
            </Card>
          )
        ) : null}
        {customMaps.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                Map Layer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-1">
              <button
                onClick={() => setSelectedLayer("geographic")}
                className={`w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left transition-colors ${
                  selectedLayer === "geographic"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-foreground"
                }`}
                data-testid="analytics-layer-geographic"
              >
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Geographic Map</span>
              </button>
              {customMaps.map((cm) => (
                <button
                  key={cm.id}
                  onClick={() => setSelectedLayer(cm.id)}
                  className={`w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left transition-colors ${
                    selectedLayer === cm.id
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted text-foreground"
                  }`}
                  data-testid={`analytics-layer-custom-map-${cm.id}`}
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{cm.name}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}
        {!isCustomMap && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">View Mode</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => setMapMode("markers")}
                className={`flex-1 px-3 py-1.5 text-sm font-medium transition-colors ${
                  mapMode === "markers"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
                data-testid="button-mode-markers"
              >
                Markers
              </button>
              <button
                onClick={() => setMapMode("heatmap")}
                className={`flex-1 px-3 py-1.5 text-sm font-medium transition-colors border-l border-border ${
                  mapMode === "heatmap"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
                data-testid="button-mode-heatmap"
              >
                Heatmap
              </button>
            </div>
          </CardContent>
        </Card>
        )}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Show</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer select-none" data-testid="toggle-show-incidents">
              <Checkbox
                checked={showIncidents}
                onCheckedChange={(v) => setShowIncidents(!!v)}
                id="chk-incidents"
              />
              <span className="text-sm">Incidents</span>
            </label>
            <label
              className={`flex items-center gap-2.5 select-none ${mapMode === "heatmap" && !isCustomMap ? "opacity-40 pointer-events-none cursor-not-allowed" : "cursor-pointer"}`}
              data-testid="toggle-show-locations"
            >
              <Checkbox
                checked={showLocations}
                onCheckedChange={(v) => setShowLocations(!!v)}
                id="chk-locations"
                disabled={mapMode === "heatmap" && !isCustomMap}
              />
              <span className="text-sm">Locations</span>
            </label>
          </CardContent>
        </Card>
        <div className={!isCustomMap && !showIncidents && mapMode === "markers" ? "opacity-40 pointer-events-none" : ""}>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Type</CardTitle>
              {someSelected && (
                <button
                  onClick={() => setSelectedTypeIds(new Set())}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  data-testid="button-show-all-types"
                >
                  Show all
                </button>
              )}
            </div>
            {someSelected && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedTypeIds.size} of {categories.length} shown
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-1">
            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground">No categories defined</p>
            ) : (
              categories.map((cat) => {
                const isSelected = selectedTypeIds.has(cat.id);
                const dimmed = someSelected && !isSelected;
                return (
                  <div
                    key={cat.id}
                    onClick={() => toggleType(cat.id)}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer select-none transition-all ${
                      isSelected
                        ? "bg-muted ring-1 ring-border"
                        : "hover:bg-muted/50"
                    }`}
                    style={{ opacity: dimmed ? 0.4 : 1 }}
                    data-testid={`type-filter-${cat.id}`}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: cat.color || "#3B82F6" }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        dangerouslySetInnerHTML={{ __html: getIconSvg(cat.icon) }}
                      />
                    </div>
                    <span className="text-sm flex-1">{cat.name}</span>
                    {isSelected && (
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color || "#3B82F6" }} />
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
        </div>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {isCustomMap ? "On This Map" : "Visible Incidents"}
              </span>
              <span className="text-sm font-medium" data-testid="text-mapped-count">
                {isCustomMap ? customMapIncidents.length : visibleGeoIncidents.length}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Incidents</span>
              <span className="text-sm font-medium">{incidents.length}</span>
            </div>
            {!isCustomMap && allGeoIncidents.length < incidents.length && (
              <div className="flex items-start gap-1.5 pt-2 border-t">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  {incidents.length - allGeoIncidents.length} incident(s) without map coordinates
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  fontSize: "12px",
};

type DateGrouping = "daily" | "weekly" | "monthly" | "yearly";

function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getDateBucketKey(dateStr: string, grouping: DateGrouping): string {
  const d = new Date(dateStr + "T00:00:00");
  if (grouping === "daily") return dateStr;
  if (grouping === "weekly") {
    const wk = getISOWeek(d);
    return `${d.getFullYear()}-W${String(wk).padStart(2, "0")}`;
  }
  if (grouping === "monthly") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return String(d.getFullYear());
}

function bucketKeyToLabel(key: string, grouping: DateGrouping): string {
  if (grouping === "daily") return key.slice(5);
  if (grouping === "weekly") {
    const [yr, wPart] = key.split("-W");
    return `W${wPart} ${yr}`;
  }
  if (grouping === "monthly") {
    const d = new Date(key + "-01T00:00:00");
    return d.toLocaleString("default", { month: "short", year: "numeric" });
  }
  return key;
}

interface ActiveFilters {
  dateKey: string | null;
  hour: number | null;
  categoryId: number | null;
  location: string | null;
  dow: number | null;
}

export default function AnalyticsPage() {
  const { toast } = useToast();
  const [view, setView] = useState<"charts" | "map">("charts");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dateGrouping, setDateGrouping] = useState<DateGrouping>("daily");
  const [dateChartType, setDateChartType] = useState<"bar" | "line">("bar");
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState(0);
  const [geocodeTotal, setGeocodeTotal] = useState(0);
  const [timeChartType, setTimeChartType] = useState<"bar" | "line">("bar");
  const [dowChartType, setDowChartType] = useState<"bar" | "line">("bar");
  const [expandType, setExpandType] = useState(false);
  const [expandLocation, setExpandLocation] = useState(false);
  const chartRefLocation = useRef<HTMLDivElement>(null);
  const chartRefType = useRef<HTMLDivElement>(null);
  const chartRefTime = useRef<HTMLDivElement>(null);
  const chartRefDate = useRef<HTMLDivElement>(null);
  const chartRefDow = useRef<HTMLDivElement>(null);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({
    dateKey: null,
    hour: null,
    categoryId: null,
    location: null,
    dow: null,
  });

  const { data: allIncidents = [], isLoading: incidentsLoading } = useQuery<Incident[]>({
    queryKey: ["/api/incidents"],
  });
  // Include regular incidents AND ended live incidents (liveEndedAt != null).
  // Excludes only currently-active live sessions so the analytics charts/map
  // reflect fully-recorded incidents. Live GPS coords are picked up by
  // resolveLatLng's liveStartLat/liveStartLng fallback.
  const incidents = allIncidents.filter((inc) => inc.liveStartedAt == null || inc.liveEndedAt != null);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: formFields = [] } = useQuery<FormField[]>({
    queryKey: ["/api/form-fields"],
  });

  const { data: customMaps = [] } = useQuery<CustomMap[]>({
    queryKey: ["/api/custom-maps"],
  });

  const { data: meData } = useQuery<{ orgName: string | null; role: string }>({
    queryKey: ["/api/auth/me"],
  });

  const { data: statsData } = useQuery<{ liveCount: number; avgResponseTimeMinutes: number | null }>({
    queryKey: ["/api/stats", startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const res = await fetch(`/api/stats?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  function isFieldVisible(key: string) {
    const f = formFields.find((ff) => ff.fieldKey === key);
    return f ? f.isVisible : true;
  }

  const getEffectiveLocationName = (inc: Incident): string | null => {
    const name = inc.locationName && inc.locationName !== "Live Incident"
      ? inc.locationName
      : null;
    return name ||
      locations.find((l) => l.id === inc.locationId)?.name ||
      customMaps.find((m) => m.id === inc.customMapId)?.name ||
      // For live incidents with no meaningful location name, use the destination
      // (where the responder was dispatched to) — this tells the story of where
      // incidents are occurring, not just where the GPS happened to be.
      (inc.destinationName && inc.destinationName !== "Live Incident" ? inc.destinationName : null) ||
      null;
  };

  // Display-only label truncation for location chart Y-axis.
  // Coordinate strings (e.g. "-25.8196, 28.4243 Some Address...") are collapsed
  // to a short "GPS Location" label; other long names are clipped with an ellipsis.
  // The underlying data `name` key is untouched so cross-filtering still works.
  const GPS_COORD_RE = /^-?\d{1,3}\.\d+,\s*-?\d{1,3}\.\d+/;
  const truncateLocLabel = (name: string, max = 22): string => {
    if (GPS_COORD_RE.test(name)) return "GPS Location";
    return name.length > max ? name.slice(0, max) + "\u2026" : name;
  };

  function handleExport() {
    const getCategoryName = (inc: Incident) => {
      const cat = categories.find((c) => c.id === inc.categoryId);
      if (!cat) return "-";
      if (inc.otherCategoryNote) return `${cat.name} (${inc.otherCategoryNote})`;
      return cat.name;
    };
    const getLocationName = (inc: Incident) => getEffectiveLocationName(inc) ?? "-";

    const showDateTime = isFieldVisible("incidentDate") || isFieldVisible("incidentTime");
    const showCategory = isFieldVisible("categoryId");
    const showLocation = isFieldVisible("location");
    const visibleCustomFields = formFields.filter((f) => !f.isSystem && f.isVisible);

    const headers: string[] = [];
    if (showDateTime) { headers.push("Date"); headers.push("Time"); }
    if (showCategory) headers.push("Type");
    if (showLocation) headers.push("Location");
    visibleCustomFields.forEach((cf) => headers.push(cf.label));

    const rows = dateRangeFiltered.map((inc) => {
      const customData = (inc.customFields as Record<string, string | number | null>) || {};
      const row: (string | number)[] = [];
      if (showDateTime) { row.push(inc.incidentDate ?? "-"); row.push(inc.incidentTime ?? "-"); }
      if (showCategory) row.push(getCategoryName(inc));
      if (showLocation) row.push(getLocationName(inc));
      visibleCustomFields.forEach((cf) => row.push(customData[cf.fieldKey]?.toString() ?? "-"));
      return row;
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Incidents");

    const from = startDate || "all";
    const to = endDate || "all";
    const filename = `incidents_${from}_to_${to}.xlsx`;
    XLSX.writeFile(wb, filename);
  }

  function toggleFilter<K extends keyof ActiveFilters>(key: K, value: ActiveFilters[K]) {
    setActiveFilters((prev) => ({ ...prev, [key]: prev[key] === value ? null : value }));
  }

  function clearAllFilters() {
    setActiveFilters({ dateKey: null, hour: null, categoryId: null, location: null, dow: null });
  }

  const dateRangeFiltered = useMemo(() => {
    return incidents.filter((i) => {
      if (startDate && i.incidentDate < startDate) return false;
      if (endDate && i.incidentDate > endDate) return false;
      return true;
    });
  }, [incidents, startDate, endDate]);

  const filteredIncidents = useMemo(() => {
    return dateRangeFiltered.filter((i) => {
      if (activeFilters.categoryId !== null && i.categoryId !== activeFilters.categoryId) return false;
      if (activeFilters.location !== null && getEffectiveLocationName(i) !== activeFilters.location) return false;
      if (activeFilters.hour !== null) {
        const h = parseInt((i.incidentTime || "00:00").split(":")[0], 10);
        if (h !== activeFilters.hour) return false;
      }
      if (activeFilters.dateKey !== null) {
        const bucket = getDateBucketKey(i.incidentDate, dateGrouping);
        if (bucket !== activeFilters.dateKey) return false;
      }
      if (activeFilters.dow !== null) {
        const d = new Date(i.incidentDate + "T00:00:00");
        const dayMon = (d.getDay() + 6) % 7;
        if (dayMon !== activeFilters.dow) return false;
      }
      return true;
    });
  }, [dateRangeFiltered, activeFilters, dateGrouping, customMaps, locations]);

  const dateData = useMemo(() => {
    const map = new Map<string, number>();
    const base = activeFilters.dateKey === null ? dateRangeFiltered : filteredIncidents;
    const pool = activeFilters.categoryId !== null || activeFilters.hour !== null || activeFilters.location !== null || activeFilters.dow !== null
      ? filteredIncidents
      : dateRangeFiltered;
    pool.forEach((i) => {
      const key = getDateBucketKey(i.incidentDate, dateGrouping);
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => ({
        key,
        label: bucketKeyToLabel(key, dateGrouping),
        incidents: count,
        selected: activeFilters.dateKey === key,
      }));
  }, [dateRangeFiltered, filteredIncidents, activeFilters, dateGrouping]);

  const timeData = useMemo(() => {
    const pool = activeFilters.hour !== null
      ? filteredIncidents
      : (activeFilters.categoryId !== null || activeFilters.dateKey !== null || activeFilters.location !== null || activeFilters.dow !== null
          ? filteredIncidents
          : dateRangeFiltered);
    const counts = new Array(24).fill(0);
    pool.forEach((i) => {
      const h = parseInt((i.incidentTime || "00:00").split(":")[0], 10);
      if (h >= 0 && h < 24) counts[h]++;
    });
    return counts.map((count, h) => ({
      hour: `${String(h).padStart(2, "0")}:00`,
      hourNum: h,
      incidents: count,
      selected: activeFilters.hour === h,
    }));
  }, [dateRangeFiltered, filteredIncidents, activeFilters]);

  const typeData = useMemo(() => {
    const pool = activeFilters.categoryId !== null
      ? filteredIncidents
      : (activeFilters.hour !== null || activeFilters.dateKey !== null || activeFilters.location !== null || activeFilters.dow !== null
          ? filteredIncidents
          : dateRangeFiltered);
    const map = new Map<string, { name: string; color: string; count: number; categoryId: number | null }>();
    categories.forEach((c) => {
      if (!c.isOther) {
        map.set(String(c.id), { name: c.name, color: c.color || "#3B82F6", count: 0, categoryId: c.id });
      }
    });
    pool.forEach((i) => {
      if (i.categoryId == null) return;
      const cat = categories.find((c) => c.id === i.categoryId);
      if (!cat) return;
      if (cat.isOther) {
        const note = i.otherCategoryNote?.trim() || "";
        const key = note ? `${i.categoryId}|${note}` : String(i.categoryId);
        const label = note ? `${cat.name} (${note})` : cat.name;
        const existing = map.get(key);
        if (existing) {
          existing.count++;
        } else {
          map.set(key, { name: label, color: cat.color || "#6B7280", count: 1, categoryId: cat.id });
        }
      } else {
        const entry = map.get(String(i.categoryId));
        if (entry) entry.count++;
      }
    });
    const panicOriginCount = pool.filter((i) => i.panicClosedAt != null).length;
    if (panicOriginCount > 0) {
      map.set("__panic_origin__", { name: "Panic (origin)", color: "#ef4444", count: panicOriginCount, categoryId: null });
    }
    return Array.from(map.values())
      .filter((e) => e.count > 0 || activeFilters.categoryId !== null)
      .sort((a, b) => b.count - a.count)
      .map((e) => ({
        name: e.name,
        incidents: e.count,
        color: e.color,
        categoryId: e.categoryId,
        selected: activeFilters.categoryId !== null && activeFilters.categoryId === e.categoryId,
      }));
  }, [dateRangeFiltered, filteredIncidents, activeFilters, categories]);

  const locationData = useMemo(() => {
    const pool = activeFilters.location !== null
      ? filteredIncidents
      : (activeFilters.categoryId !== null || activeFilters.hour !== null || activeFilters.dateKey !== null || activeFilters.dow !== null
          ? filteredIncidents
          : dateRangeFiltered);
    const map = new Map<string, number>();
    pool.forEach((i) => {
      const name = getEffectiveLocationName(i);
      if (!name) return;
      map.set(name, (map.get(name) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => ({
        name,
        incidents: count,
        selected: activeFilters.location === name,
        color: locations.find((l) => l.name === name)?.color || "hsl(var(--primary))",
      }));
  }, [dateRangeFiltered, filteredIncidents, activeFilters, locations, customMaps]);

  const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const dowData = useMemo(() => {
    const pool = activeFilters.dow !== null
      ? filteredIncidents
      : (activeFilters.categoryId !== null || activeFilters.hour !== null || activeFilters.dateKey !== null || activeFilters.location !== null
          ? filteredIncidents
          : dateRangeFiltered);
    const counts = new Array(7).fill(0);
    pool.forEach((i) => {
      const d = new Date(i.incidentDate + "T00:00:00");
      const dayMon = (d.getDay() + 6) % 7;
      counts[dayMon]++;
    });
    return counts.map((count, idx) => ({
      day: DOW_LABELS[idx],
      dayIdx: idx,
      incidents: count,
      selected: activeFilters.dow === idx,
    }));
  }, [dateRangeFiltered, filteredIncidents, activeFilters]);

  const kpiData = useMemo(() => {
    const total = dateRangeFiltered.length;

    const locMap = new Map<string, number>();
    dateRangeFiltered.forEach((i) => {
      const loc = getEffectiveLocationName(i);
      if (loc) locMap.set(loc, (locMap.get(loc) || 0) + 1);
    });
    const sortedLocs = [...locMap.entries()].sort(([, a], [, b]) => b - a);
    // Null when no data or when two or more locations are tied at the top (no clear winner)
    const topLoc =
      sortedLocs.length === 0 ? null
      : sortedLocs.length === 1 || sortedLocs[0][1] > sortedLocs[1][1]
        ? sortedLocs[0][0]
        : null;

    const catMap = new Map<string, { label: string; count: number }>();
    dateRangeFiltered.forEach((i) => {
      if (i.categoryId == null) return;
      const cat = categories.find((c) => c.id === i.categoryId);
      if (!cat) return;
      const note = cat.isOther && i.otherCategoryNote?.trim() ? i.otherCategoryNote.trim() : null;
      const key = note ? `${i.categoryId}|${note}` : String(i.categoryId);
      const label = note ? `${cat.name} (${note})` : cat.name;
      const existing = catMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        catMap.set(key, { label, count: 1 });
      }
    });
    const sortedCats = [...catMap.values()].sort((a, b) => b.count - a.count);
    // Null when no data or when two or more categories are tied at the top (no clear winner)
    const topCat =
      sortedCats.length === 0 ? null
      : sortedCats.length === 1 || sortedCats[0].count > sortedCats[1].count
        ? sortedCats[0].label
        : null;

    const hourCounts = new Array(24).fill(0);
    dateRangeFiltered.forEach((i) => {
      const h = parseInt((i.incidentTime || "00:00").split(":")[0], 10);
      if (h >= 0 && h < 24) hourCounts[h]++;
    });
    const maxHourCount = Math.max(...hourCounts);
    const tiedHours = hourCounts.filter((c) => c === maxHourCount).length;
    // Null when no data or when multiple hours share the peak count (no clear winner)
    const peakHour =
      maxHourCount === 0 ? null
      : tiedHours === 1
        ? `${String(hourCounts.indexOf(maxHourCount)).padStart(2, "0")}:00`
        : null;

    return { total, topLoc, topCat, peakHour };
  }, [dateRangeFiltered, categories]);

  async function handleExportPdf() {
    setIsPdfExporting(true);
    try {
      const from = startDate || "all";
      const to = endDate || "all";
      const title = "Occurrence Report";
      const periodLine = `Period: ${from === "all" && to === "all" ? "All dates" : `${from} → ${to}`}`;

      const filterParts: string[] = [];
      if (activeFilters.dow !== null) filterParts.push(DOW_LABELS[activeFilters.dow]);
      if (activeFilters.categoryId !== null) {
        const cat = categories.find((c) => c.id === activeFilters.categoryId);
        if (cat) filterParts.push(cat.name);
      }
      if (activeFilters.location !== null) filterParts.push(activeFilters.location);
      if (activeFilters.hour !== null) filterParts.push(`${String(activeFilters.hour).padStart(2, "0")}:00`);
      if (activeFilters.dateKey !== null) filterParts.push(bucketKeyToLabel(activeFilters.dateKey, dateGrouping));
      const filtersLine = filterParts.length > 0 ? `Filters: ${filterParts.join(" · ")}` : null;

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const marginX = 14;
      const usableW = pageW - marginX * 2;

      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text(title, marginX, 20);
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.text(periodLine, marginX, 28);
      if (filtersLine) {
        doc.text(filtersLine, marginX, 34);
      }

      const chartsStartY = filtersLine ? 42 : 36;

      const chartRefs = [
        { ref: chartRefLocation, label: "Location" },
        { ref: chartRefType, label: "Type" },
        { ref: chartRefTime, label: "Incident Time" },
        { ref: chartRefDate, label: "Incident Date" },
        { ref: chartRefDow, label: "Day of Week" },
      ];

      const chartImages: { dataUrl: string; aspectRatio: number; label: string }[] = [];
      for (const { ref, label } of chartRefs) {
        if (!ref.current) continue;
        try {
          const canvas = await html2canvas(ref.current, {
            scale: 2,
            backgroundColor: "#ffffff",
            useCORS: true,
            logging: false,
          });
          chartImages.push({
            dataUrl: canvas.toDataURL("image/png"),
            aspectRatio: canvas.height / canvas.width,
            label,
          });
        } catch {
          // skip chart if capture fails
        }
      }

      let chartsEndY = chartsStartY;

      if (chartImages.length > 0) {
        let curY = chartsStartY;
        doc.setFontSize(13);
        doc.setFont("helvetica", "bold");
        doc.text("Charts", marginX, curY);
        curY += 6;
        doc.setFont("helvetica", "normal");

        const colW = (usableW - 8) / 2;
        const pageH = doc.internal.pageSize.getHeight();
        const bottomMargin = 14;

        const dowImg = chartImages.find((img) => img.label === "Day of Week") ?? null;
        const pairImgs = chartImages.filter((img) => img.label !== "Day of Week");

        const labelH = 5;

        for (let i = 0; i < pairImgs.length; i += 2) {
          const imgA = pairImgs[i];
          const imgB = pairImgs[i + 1];
          const hA = colW * imgA.aspectRatio;
          const hB = imgB ? colW * imgB.aspectRatio : 0;
          const rowH = Math.max(hA, hB);

          if (curY + labelH + rowH > pageH - bottomMargin) {
            doc.addPage();
            curY = 14;
          }

          doc.setFontSize(10);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(60, 60, 60);
          doc.text(imgA.label, marginX, curY + 3);
          if (imgB) {
            doc.text(imgB.label, marginX + colW + 8, curY + 3);
          }
          doc.setTextColor(0, 0, 0);
          doc.setFont("helvetica", "normal");
          curY += labelH;

          doc.addImage(imgA.dataUrl, "PNG", marginX, curY, colW, hA);

          if (imgB) {
            const xB = marginX + colW + 8;
            doc.addImage(imgB.dataUrl, "PNG", xB, curY, colW, hB);
          }

          curY += rowH + 8;
        }

        if (dowImg) {
          const dowH = usableW * dowImg.aspectRatio;
          if (curY + labelH + dowH > pageH - bottomMargin) {
            doc.addPage();
            curY = 14;
          }
          doc.setFontSize(10);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(60, 60, 60);
          doc.text(dowImg.label, marginX, curY + 3);
          doc.setTextColor(0, 0, 0);
          doc.setFont("helvetica", "normal");
          curY += labelH;
          doc.addImage(dowImg.dataUrl, "PNG", marginX, curY, usableW, dowH);
          curY += dowH + 8;
        }
        chartsEndY = curY;
      }

      if (chartImages.length > 0) {
        doc.addPage();
      }

      const getPdfCategoryName = (inc: Incident) => {
        const cat = categories.find((c) => c.id === inc.categoryId);
        if (!cat) return "-";
        if (inc.otherCategoryNote) return `${cat.name} (${inc.otherCategoryNote})`;
        return cat.name;
      };
      const getPdfLocationName = (inc: Incident) => getEffectiveLocationName(inc) ?? "-";

      const tableBody = filteredIncidents.map((inc) => [
        inc.incidentDate ?? "-",
        inc.incidentTime ?? "-",
        getPdfCategoryName(inc),
        getPdfLocationName(inc),
        inc.description ? inc.description.substring(0, 80) : "-",
      ]);

      const occListStartY = chartImages.length > 0 ? 14 : chartsEndY;
      autoTable(doc, {
        startY: occListStartY,
        head: [["Date", "Time", "Type", "Location", "Description"]],
        body: tableBody,
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fillColor: [0, 96, 57] },
        columnStyles: { 4: { cellWidth: 60 } },
        margin: { left: marginX, right: marginX },
      });

      const kpiHeadingY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text("Total Key Metrics", marginX, kpiHeadingY);
      doc.setFont("helvetica", "normal");

      autoTable(doc, {
        startY: kpiHeadingY + 5,
        head: [["Total Incidents", "Most Affected Location", "Most Common Type", "Peak Hour"]],
        body: [[
          String(kpiData.total),
          kpiData.topLoc || "TBD",
          kpiData.topCat || "TBD",
          kpiData.peakHour || "TBD",
        ]],
        styles: { fontSize: 10 },
        headStyles: { fillColor: [0, 96, 57] },
        margin: { left: marginX, right: marginX },
      });

      doc.save(`incidents_${from}_to_${to}.pdf`);
    } finally {
      setIsPdfExporting(false);
    }
  }

  async function handleGeocodeAll() {
    const unmapped = allIncidents.filter((i) => {
      if (i.latitude != null || i.longitude != null) return false;
      if (i.locationName && !i.locationId) return true;
      if (i.locationId != null) {
        const loc = locations.find((l) => l.id === i.locationId);
        return loc != null && loc.latitude == null && loc.longitude == null;
      }
      return false;
    });
    if (unmapped.length === 0) {
      toast({ title: "Nothing to geocode", description: "All incidents with location names already have coordinates." });
      return;
    }
    setIsGeocoding(true);
    setGeocodeProgress(0);
    setGeocodeTotal(unmapped.length);
    try {
      await loadGoogleMaps();
      const geocoder = new google.maps.Geocoder();
      let done = 0;
      let succeeded = 0;
      for (const incident of unmapped) {
        try {
          const addressStr = incident.locationName
            || locations.find((l) => l.id === incident.locationId)?.name
            || null;
          if (!addressStr) { done++; setGeocodeProgress(done); continue; }
          const coords = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
            geocoder.geocode({ address: addressStr, componentRestrictions: { country: "za" } }, (results, status) => {
              if (status === google.maps.GeocoderStatus.OK && results?.[0]) {
                const loc = results[0].geometry.location;
                resolve({ lat: loc.lat(), lng: loc.lng() });
              } else {
                resolve(null);
              }
            });
          });
          if (coords) {
            await apiRequest("PATCH", `/api/incidents/${incident.id}`, { latitude: coords.lat, longitude: coords.lng });
            succeeded++;
          }
        } catch {
          // skip individual failures
        }
        done++;
        setGeocodeProgress(done);
        await new Promise((r) => setTimeout(r, 150));
      }
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      toast({
        title: "Geocoding complete",
        description: `${succeeded} of ${unmapped.length} incidents now have coordinates and will appear on the map.`,
      });
    } catch (e) {
      toast({ title: "Geocoding failed", description: String(e), variant: "destructive" });
    } finally {
      setIsGeocoding(false);
      setGeocodeProgress(0);
      setGeocodeTotal(0);
    }
  }

  const activeFilterChips = useMemo(() => {
    const chips: { label: string; onRemove: () => void }[] = [];
    if (activeFilters.dateKey) {
      chips.push({
        label: `Date: ${bucketKeyToLabel(activeFilters.dateKey, dateGrouping)}`,
        onRemove: () => setActiveFilters((p) => ({ ...p, dateKey: null })),
      });
    }
    if (activeFilters.hour !== null) {
      chips.push({
        label: `Time: ${String(activeFilters.hour).padStart(2, "0")}:00`,
        onRemove: () => setActiveFilters((p) => ({ ...p, hour: null })),
      });
    }
    if (activeFilters.categoryId !== null) {
      const cat = categories.find((c) => c.id === activeFilters.categoryId);
      chips.push({
        label: `Type: ${cat?.name ?? activeFilters.categoryId}`,
        onRemove: () => setActiveFilters((p) => ({ ...p, categoryId: null })),
      });
    }
    if (activeFilters.location) {
      chips.push({
        label: `Location: ${activeFilters.location}`,
        onRemove: () => setActiveFilters((p) => ({ ...p, location: null })),
      });
    }
    if (activeFilters.dow !== null) {
      chips.push({
        label: `Day: ${DOW_LABELS[activeFilters.dow]}`,
        onRemove: () => setActiveFilters((p) => ({ ...p, dow: null })),
      });
    }
    return chips;
  }, [activeFilters, categories, dateGrouping]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 space-y-6 overflow-y-auto flex-1">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-analytics-title">
              <BarChart3 className="inline h-6 w-6 mr-2 -mt-0.5" />
              Analytics & Reports
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Incident statistics and trend analysis
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant={view === "charts" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("charts")}
              data-testid="button-view-charts"
            >
              <BarChart3 className="h-4 w-4 mr-1.5" />
              Charts
            </Button>
            <Button
              variant={view === "map" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("map")}
              data-testid="button-view-map"
            >
              <MapPin className="h-4 w-4 mr-1.5" />
              Map View
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-muted-foreground">Between</span>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">From</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="input-start-date"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">To</label>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="input-end-date"
            />
          </div>
          {(startDate || endDate) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setStartDate(""); setEndDate(""); }}
              data-testid="button-clear-dates"
            >
              Clear
            </Button>
          )}
          {(startDate || endDate) && (
            <span className="text-xs text-muted-foreground">
              {startDate && endDate ? `${startDate} → ${endDate}` : startDate ? `From ${startDate}` : `Until ${endDate}`}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={dateRangeFiltered.length === 0}
            data-testid="button-export-excel"
          >
            <Download className="h-4 w-4 mr-1.5" />
            Download Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            disabled={dateRangeFiltered.length === 0 || isPdfExporting}
            data-testid="button-export-pdf"
          >
            {isPdfExporting ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 mr-1.5" />
            )}
            {isPdfExporting ? "Generating PDF..." : "Download PDF"}
          </Button>
          {meData?.role === "administrator" && (() => {
            const unmappedCount = allIncidents.filter((i) => {
              if (i.latitude != null || i.longitude != null) return false;
              if (i.locationName && !i.locationId) return true;
              if (i.locationId != null) {
                const loc = locations.find((l) => l.id === i.locationId);
                return loc != null && loc.latitude == null && loc.longitude == null;
              }
              return false;
            }).length;
            return unmappedCount > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleGeocodeAll}
                disabled={isGeocoding}
                data-testid="button-geocode-missing"
                title={`${unmappedCount} incident${unmappedCount !== 1 ? "s" : ""} have a location name but no map coordinates`}
              >
                {isGeocoding ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <ScanSearch className="h-4 w-4 mr-1.5" />
                )}
                {isGeocoding
                  ? `Geocoding ${geocodeProgress}/${geocodeTotal}…`
                  : `Geocode ${unmappedCount} missing`}
              </Button>
            ) : null;
          })()}
        </div>

        {activeFilterChips.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap" data-testid="active-filter-chips">
            <span className="text-xs text-muted-foreground font-medium">Filtering by:</span>
            {activeFilterChips.map((chip) => (
              <Badge
                key={chip.label}
                variant="secondary"
                className="gap-1 pl-2 pr-1 py-0.5 text-xs cursor-default"
                data-testid={`chip-filter-${chip.label}`}
              >
                {chip.label}
                <button
                  onClick={chip.onRemove}
                  className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                  data-testid={`button-remove-filter-${chip.label}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={clearAllFilters}
              data-testid="button-clear-all-filters"
            >
              Clear all
            </Button>
          </div>
        )}

        {view === "charts" && !incidentsLoading && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4" data-testid="kpi-cards">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <BarChart3 className="h-4 w-4" />
                  <span className="text-xs font-medium">Total Incidents</span>
                </div>
                <p className="text-xl font-bold" data-testid="kpi-total">{kpiData.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <MapPin className="h-4 w-4" />
                  <span className="text-xs font-medium">Most Affected Location</span>
                </div>
                <p className="text-xl font-bold truncate" data-testid="kpi-location">{kpiData.topLoc || "TBD"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Tag className="h-4 w-4" />
                  <span className="text-xs font-medium">Most Common Type</span>
                </div>
                <p className="text-xl font-bold truncate" data-testid="kpi-type">{kpiData.topCat || "TBD"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Clock className="h-4 w-4" />
                  <span className="text-xs font-medium">Peak Hour</span>
                </div>
                <p className="text-xl font-bold" data-testid="kpi-peak-hour">{kpiData.peakHour || "TBD"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
                  <span className="text-xs font-medium">Live Incidents</span>
                </div>
                <p className="text-xl font-bold" data-testid="kpi-live-count">{statsData?.liveCount ?? 0}</p>
                {statsData?.avgResponseTimeMinutes != null && (
                  <p className="text-xs text-muted-foreground mt-0.5" data-testid="kpi-avg-response">
                    {statsData.avgResponseTimeMinutes < 1 ? "< 1 min avg" : `${statsData.avgResponseTimeMinutes} min avg`} response
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {view === "map" ? (
          incidentsLoading ? (
            <Skeleton className="h-[500px] rounded-md" />
          ) : (
            <MapPanel incidents={filteredIncidents} categories={categories} locations={locations} customMaps={customMaps} />
          )
        ) : incidentsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-64" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className={activeFilters.location !== null ? "ring-2 ring-primary/40" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    <MapPin className="h-4 w-4 inline-block align-middle mr-2" />
                    <span className="align-middle">Location</span>
                    {activeFilters.location !== null && <span className="text-xs font-normal text-primary align-middle ml-1">(filtered)</span>}
                  </CardTitle>
                  {locationData.length > 0 && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setExpandLocation(true)} data-testid="btn-expand-location" title="Show all locations">
                      <Maximize2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent ref={chartRefLocation}>
                {locationData.length === 0 ? (
                  <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">No data available</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(160, locationData.slice(0, 8).length * 44)}>
                    <BarChart data={locationData.slice(0, 8)} layout="vertical" style={{ cursor: "pointer" }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} tickFormatter={(v) => truncateLocLabel(v)} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [value, "Incidents"]} labelFormatter={(label) => label} />
                      <Bar dataKey="incidents" name="Incidents" radius={[0, 4, 4, 0]} onClick={(entry) => toggleFilter("location", entry.name)}>
                        {locationData.slice(0, 8).map((entry, index) => (
                          <Cell key={`cell-loc-${index}`} fill={entry.color} opacity={activeFilters.location === null || entry.selected ? 1 : 0.35} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {locationData.length > 8 && (
                  <p className="text-xs text-center text-muted-foreground mt-1">
                    Showing top 8 of {locationData.length} — <button className="underline" onClick={() => setExpandLocation(true)}>see all</button>
                  </p>
                )}
                {activeFilters.location !== null && (
                  <p className="text-xs text-center text-muted-foreground mt-1">
                    Click the same bar to deselect
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Location expand dialog */}
            <Dialog open={expandLocation} onOpenChange={setExpandLocation}>
              <DialogContent className="max-w-5xl w-full" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Location — all {locationData.length} entries
                    {activeFilters.location !== null && <span className="text-xs font-normal text-primary">(filtered)</span>}
                  </DialogTitle>
                </DialogHeader>
                {locationData.length === 0 ? (
                  <div className="h-[60vh] flex items-center justify-center text-sm text-muted-foreground">No data available</div>
                ) : (
                  <div className="overflow-y-auto" style={{ height: "70vh" }}>
                    <ResponsiveContainer width="100%" height={Math.max(locationData.length * 48, 400)}>
                      <BarChart data={locationData} layout="vertical" style={{ cursor: "pointer" }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={160} tickFormatter={(v) => truncateLocLabel(v, 28)} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [value, "Incidents"]} labelFormatter={(label) => label} />
                        <Bar dataKey="incidents" name="Incidents" radius={[0, 4, 4, 0]} onClick={(entry) => toggleFilter("location", entry.name)}>
                          {locationData.map((entry, index) => (
                            <Cell key={`cell-loc-exp-${index}`} fill={entry.color} opacity={activeFilters.location === null || entry.selected ? 1 : 0.35} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {activeFilters.location !== null && (
                  <p className="text-xs text-center text-muted-foreground mt-2">Click the same bar to deselect</p>
                )}
              </DialogContent>
            </Dialog>

            <Card className={activeFilters.categoryId !== null ? "ring-2 ring-primary/40" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    <Tag className="h-4 w-4 inline-block align-middle mr-2" />
                    <span className="align-middle">Type</span>
                    {activeFilters.categoryId !== null && <span className="text-xs font-normal text-primary align-middle ml-1">(filtered)</span>}
                  </CardTitle>
                  {typeData.length > 0 && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setExpandType(true)} data-testid="btn-expand-type" title="Show all types">
                      <Maximize2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent ref={chartRefType}>
                {typeData.length === 0 ? (
                  <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">No data available</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(160, typeData.slice(0, 5).length * 44)}>
                    <BarChart data={typeData.slice(0, 5)} layout="vertical" style={{ cursor: "pointer" }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar dataKey="incidents" name="Incidents" radius={[0, 4, 4, 0]} onClick={(entry) => { if (entry.categoryId !== null) toggleFilter("categoryId", entry.categoryId); }}>
                        {typeData.slice(0, 5).map((entry, index) => (
                          <Cell key={`cell-type-${index}`} fill={entry.color} opacity={activeFilters.categoryId === null || entry.selected ? 1 : 0.35} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {typeData.length > 5 && (
                  <p className="text-xs text-center text-muted-foreground mt-1">
                    Showing top 5 of {typeData.length} — <button className="underline" onClick={() => setExpandType(true)}>see all</button>
                  </p>
                )}
                {activeFilters.categoryId !== null && (
                  <p className="text-xs text-center text-muted-foreground mt-1">
                    Click the same bar to deselect
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Type expand dialog */}
            <Dialog open={expandType} onOpenChange={setExpandType}>
              <DialogContent className="max-w-5xl w-full" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    Type — all {typeData.length} entries
                    {activeFilters.categoryId !== null && <span className="text-xs font-normal text-primary">(filtered)</span>}
                  </DialogTitle>
                </DialogHeader>
                {typeData.length === 0 ? (
                  <div className="h-[60vh] flex items-center justify-center text-sm text-muted-foreground">No data available</div>
                ) : (
                  <div className="overflow-y-auto" style={{ height: "70vh" }}>
                    <ResponsiveContainer width="100%" height={Math.max(typeData.length * 48, 400)}>
                      <BarChart data={typeData} layout="vertical" style={{ cursor: "pointer" }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={160} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                        <Bar dataKey="incidents" name="Incidents" radius={[0, 4, 4, 0]} onClick={(entry) => { if (entry.categoryId !== null) toggleFilter("categoryId", entry.categoryId); }}>
                          {typeData.map((entry, index) => (
                            <Cell key={`cell-type-exp-${index}`} fill={entry.color} opacity={activeFilters.categoryId === null || entry.selected ? 1 : 0.35} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {activeFilters.categoryId !== null && (
                  <p className="text-xs text-center text-muted-foreground mt-2">Click the same bar to deselect</p>
                )}
              </DialogContent>
            </Dialog>

            <Card className={activeFilters.hour !== null ? "ring-2 ring-primary/40" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base">
                    <Clock className="h-4 w-4 inline-block align-middle mr-2" />
                    <span className="align-middle">Incident Time</span>
                    {activeFilters.hour !== null && <span className="text-xs font-normal text-primary align-middle ml-1">(filtered)</span>}
                  </CardTitle>
                  <div className="flex items-center rounded-md border overflow-hidden text-xs" data-testid="time-chart-type-toggle">
                    <button
                      onClick={() => setTimeChartType("bar")}
                      className={`px-2.5 py-1 transition-colors flex items-center gap-1 ${timeChartType === "bar" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-muted"}`}
                      data-testid="button-time-chart-bar"
                    >
                      <BarChart3 className="h-3 w-3" /> Bar
                    </button>
                    <button
                      onClick={() => setTimeChartType("line")}
                      className={`px-2.5 py-1 transition-colors border-l border-border flex items-center gap-1 ${timeChartType === "line" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-muted"}`}
                      data-testid="button-time-chart-line"
                    >
                      <TrendingUp className="h-3 w-3" /> Line
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent ref={chartRefTime}>
                {timeData.every(d => d.incidents === 0) ? (
                  <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">No data available</div>
                ) : timeChartType === "line" ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={timeData} style={{ cursor: "pointer" }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={3} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => `Hour: ${v}`} />
                      <Line
                        type="monotone"
                        dataKey="incidents"
                        name="Incidents"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 0 }}
                        activeDot={(props: { cx?: number; cy?: number; payload?: { hourNum: number; incidents: number } }) => (
                          <Dot
                            cx={props.cx ?? 0}
                            cy={props.cy ?? 0}
                            r={7}
                            fill="hsl(var(--primary))"
                            stroke="hsl(var(--foreground))"
                            strokeWidth={1}
                            style={{ cursor: "pointer" }}
                            onClick={() => props.payload && props.payload.incidents > 0 && toggleFilter("hour", props.payload.hourNum)}
                          />
                        )}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={timeData} style={{ cursor: "pointer" }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={3} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => `Hour: ${v}`} />
                      <Bar
                        dataKey="incidents"
                        name="Incidents"
                        radius={[4, 4, 0, 0]}
                        onClick={(entry) => { if (entry.incidents > 0) toggleFilter("hour", entry.hourNum); }}
                      >
                        {timeData.map((entry, index) => (
                          <Cell
                            key={`cell-time-${index}`}
                            fill="hsl(var(--primary))"
                            opacity={activeFilters.hour === null || entry.selected ? 1 : 0.35}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {activeFilters.hour !== null && (
                  <p className="text-xs text-center text-muted-foreground mt-1">
                    Click the same bar to deselect
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className={activeFilters.dateKey ? "ring-2 ring-primary/40" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base">
                    <Calendar className="h-4 w-4 inline-block align-middle mr-2" />
                    <span className="align-middle">Incident Date</span>
                    {activeFilters.dateKey && <span className="text-xs font-normal text-primary align-middle ml-1">(filtered)</span>}
                  </CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center rounded-md border overflow-hidden text-xs" data-testid="date-chart-type-toggle">
                      <button
                        onClick={() => setDateChartType("bar")}
                        className={`px-2.5 py-1 transition-colors flex items-center gap-1 ${dateChartType === "bar" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-muted"}`}
                        data-testid="button-chart-bar"
                      >
                        <BarChart3 className="h-3 w-3" /> Bar
                      </button>
                      <button
                        onClick={() => setDateChartType("line")}
                        className={`px-2.5 py-1 transition-colors border-l border-border flex items-center gap-1 ${dateChartType === "line" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-muted"}`}
                        data-testid="button-chart-line"
                      >
                        <TrendingUp className="h-3 w-3" /> Line
                      </button>
                    </div>
                    <div className="flex items-center rounded-md border overflow-hidden text-xs" data-testid="date-grouping-toggle">
                      {(["daily", "weekly", "monthly", "yearly"] as DateGrouping[]).map((g, idx) => (
                        <button
                          key={g}
                          onClick={() => { setDateGrouping(g); setActiveFilters((p) => ({ ...p, dateKey: null })); }}
                          className={`px-2.5 py-1 capitalize transition-colors ${idx > 0 ? "border-l border-border" : ""} ${
                            dateGrouping === g
                              ? "bg-primary text-primary-foreground font-medium"
                              : "text-muted-foreground hover:bg-muted"
                          }`}
                          data-testid={`button-grouping-${g}`}
                        >
                          {g.charAt(0).toUpperCase() + g.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent ref={chartRefDate}>
                {dateData.length === 0 ? (
                  <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">No data available</div>
                ) : dateChartType === "line" ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={dateData} style={{ cursor: "pointer" }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Line
                        type="monotone"
                        dataKey="incidents"
                        name="Incidents"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 0 }}
                        activeDot={(props: { cx?: number; cy?: number; payload?: { key: string } }) => (
                          <Dot
                            cx={props.cx ?? 0}
                            cy={props.cy ?? 0}
                            r={7}
                            fill="hsl(var(--primary))"
                            stroke="hsl(var(--foreground))"
                            strokeWidth={1}
                            style={{ cursor: "pointer" }}
                            onClick={() => props.payload && toggleFilter("dateKey", props.payload.key)}
                          />
                        )}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={dateData} style={{ cursor: "pointer" }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => `${v}`} />
                      <Bar
                        dataKey="incidents"
                        name="Incidents"
                        radius={[4, 4, 0, 0]}
                        onClick={(entry) => toggleFilter("dateKey", entry.key)}
                      >
                        {dateData.map((entry, index) => (
                          <Cell
                            key={`cell-date-${index}`}
                            fill="hsl(var(--primary))"
                            opacity={activeFilters.dateKey === null || entry.selected ? 1 : 0.35}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {activeFilters.dateKey && (
                  <p className="text-xs text-center text-muted-foreground mt-1">
                    Click the same bar to deselect
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className={`lg:col-span-2 ${activeFilters.dow !== null ? "ring-2 ring-primary/40" : ""}`}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base">
                    <CalendarDays className="h-4 w-4 inline-block align-middle mr-2" />
                    <span className="align-middle">Day of Week</span>
                    {activeFilters.dow !== null && <span className="text-xs font-normal text-primary align-middle ml-1">(filtered)</span>}
                  </CardTitle>
                  <div className="flex items-center rounded-md border overflow-hidden text-xs" data-testid="dow-chart-type-toggle">
                    <button
                      onClick={() => setDowChartType("bar")}
                      className={`px-2.5 py-1 transition-colors flex items-center gap-1 ${dowChartType === "bar" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-muted"}`}
                      data-testid="button-dow-chart-bar"
                    >
                      <BarChart3 className="h-3 w-3" /> Bar
                    </button>
                    <button
                      onClick={() => setDowChartType("line")}
                      className={`px-2.5 py-1 transition-colors border-l border-border flex items-center gap-1 ${dowChartType === "line" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-muted"}`}
                      data-testid="button-dow-chart-line"
                    >
                      <TrendingUp className="h-3 w-3" /> Line
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent ref={chartRefDow}>
                {dowData.every((d) => d.incidents === 0) ? (
                  <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">No data available</div>
                ) : dowChartType === "line" ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={dowData} style={{ cursor: "pointer" }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Line
                        type="monotone"
                        dataKey="incidents"
                        name="Incidents"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 0 }}
                        activeDot={(props: { cx?: number; cy?: number; payload?: { dayIdx: number; incidents: number } }) => (
                          <Dot
                            cx={props.cx ?? 0}
                            cy={props.cy ?? 0}
                            r={7}
                            fill="hsl(var(--primary))"
                            stroke="hsl(var(--foreground))"
                            strokeWidth={1}
                            style={{ cursor: "pointer" }}
                            onClick={() => props.payload && props.payload.incidents > 0 && toggleFilter("dow", props.payload.dayIdx)}
                          />
                        )}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={dowData} style={{ cursor: "pointer" }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar
                        dataKey="incidents"
                        name="Incidents"
                        radius={[4, 4, 0, 0]}
                        onClick={(entry) => { if (entry.incidents > 0) toggleFilter("dow", entry.dayIdx); }}
                      >
                        {dowData.map((entry, index) => (
                          <Cell
                            key={`cell-dow-${index}`}
                            fill="hsl(var(--primary))"
                            opacity={activeFilters.dow === null || entry.selected ? 1 : 0.35}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {activeFilters.dow !== null && (
                  <p className="text-xs text-center text-muted-foreground mt-1">
                    Click the same bar to deselect
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
