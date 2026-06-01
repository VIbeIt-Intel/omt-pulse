import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ToastAction } from "@/components/ui/toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Radio,
  MapPin,
  Clock,
  CheckCircle2,
  FileText,
  Loader2,
  ShieldAlert,
  Tag,
  Navigation,
  UserPlus,
  Layers,
  Car,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

type LiveResponderSummary = {
  id: number;
  userId: string;
  firstName: string;
  lastName: string;
  lastLat: number | null;
  lastLng: number | null;
  lastPositionAt: string | null;
  joinedAt: string;
  arrivedAt: string | null;
  arrivalNote: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  destinationName: string | null;
};

type LiveIncident = {
  id: number;
  organizationId: string;
  userId: string | null;
  incidentDate: string;
  incidentTime: string;
  locationId: number | null;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  customMapId: number | null;
  customMapX: number | null;
  customMapY: number | null;
  categoryId: number | null;
  otherCategoryNote: string | null;
  description: string | null;
  customFields: Record<string, string | number | null> | null;
  importBatchId: number | null;
  isLive: boolean;
  isEscalated: boolean;
  liveStartedAt: string | null;
  responderLat: number | null;
  responderLng: number | null;
  responderPositionUpdatedAt: string | null;
  responderArrivedAt: string | null;
  destinationName: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  createdAt: string;
  responderFirstName: string | null;
  responderLastName: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  responders: LiveResponderSummary[];
  severity: string | null;
  panicAcknowledgedAt: string | null;
  panicAcknowledgedByUserId: string | null;
};

function formatDuration(startedAt: string | null): string {
  if (!startedAt) return "—";
  const diffMs = Date.now() - new Date(startedAt).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function formatTime(ts: string | null): string {
  if (!ts) return "Unknown";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getResponderName(inc: LiveIncident): string {
  const full = `${inc.responderFirstName ?? ""} ${inc.responderLastName ?? ""}`.trim();
  return full || `Incident #${inc.id}`;
}

function getMarkerColor(inc: LiveIncident): string {
  if (inc.isEscalated) return "#ef4444";
  if (inc.responderArrivedAt) return "#2563eb";
  return inc.categoryColor ?? "#22c55e";
}

/** True when a hex colour reads as yellow/gold (category + severity would double-stack). */
function isYellowishHex(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return r > 170 && g > 130 && b < 140;
}

function getSeverityRingColor(severity: string | null, categoryColor?: string | null): string | null {
  if (severity === "red") return "#ef4444";
  if (severity === "orange") return "#f97316";
  if (severity === "yellow") {
    // Yellow category + yellow severity ring = unreadable blob; category colour is enough.
    if (categoryColor && isYellowishHex(categoryColor)) return null;
    return "#92400e";
  }
  return null;
}

function isPanicIncident(inc: LiveIncident): boolean {
  return (inc.categoryName ?? "").toLowerCase().includes("panic");
}

function makePanicMarkerIcon(label?: string | null): google.maps.Icon {
  const dotSize = 52;
  const cx = dotSize / 2;
  const labelText = label ? label.replace(/[<>&]/g, "") : null;
  const pillWidth = labelText ? Math.max(44, labelText.length * 7 + 14) : 0;
  const svgW = labelText ? Math.max(dotSize, pillWidth + 4) : dotSize;
  const svgH = labelText ? dotSize + 16 : dotSize;
  const pillX = labelText ? (svgW - pillWidth) / 2 : 0;
  const namePill = labelText
    ? `<rect x="${pillX}" y="${dotSize}" width="${pillWidth}" height="14" rx="7" fill="#dc2626" stroke="#ffffff" stroke-width="1"/>
       <text x="${svgW / 2}" y="${dotSize + 10}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#ffffff">${labelText}</text>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
    <circle cx="${cx}" cy="${cx}" r="12" fill="#dc2626" opacity="0.55">
      <animate attributeName="r" values="12;26;12" dur="0.55s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.55;0;0.55" dur="0.55s" repeatCount="indefinite"/>
    </circle>
    <circle cx="${cx}" cy="${cx}" r="14" fill="#dc2626" stroke="white" stroke-width="2.5"/>
    <text x="${cx}" y="${cx + 4}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="900" fill="white">SOS</text>
    ${namePill}
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(svgW, svgH),
    anchor: new google.maps.Point(cx, cx),
  };
}

function makeMarkerIcon(
  color: string,
  escalated: boolean,
  severity?: string | null,
  label?: string | null,
  categoryColor?: string | null,
): google.maps.Icon {
  const dur = escalated ? "0.7s" : "1.4s";
  const ringColor = getSeverityRingColor(severity ?? null, categoryColor);
  const dotSize = ringColor ? 48 : 40;
  const cx = dotSize / 2;
  const pulseOpacity = severity === "yellow" ? "0.22" : "0.4";
  const warning = escalated
    ? `<line x1="${cx}" y1="${cx - 6}" x2="${cx}" y2="${cx + 1}" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
       <circle cx="${cx}" cy="${cx + 5}" r="1.2" fill="white"/>`
    : "";
  const severityRing = ringColor
    ? `<circle cx="${cx}" cy="${cx}" r="16" fill="none" stroke="${ringColor}" stroke-width="3" stroke-dasharray="4 2" opacity="0.9"/>`
    : "";

  // Name pill — same style as joiner markers so the map is consistent
  const labelText = label ? label.replace(/[<>&]/g, "") : null;
  const pillWidth = labelText ? Math.max(44, labelText.length * 7 + 14) : 0;
  const svgW = labelText ? Math.max(dotSize, pillWidth + 4) : dotSize;
  const svgH = labelText ? dotSize + 16 : dotSize;
  const pillX = labelText ? (svgW - pillWidth) / 2 : 0;
  const namePill = labelText
    ? `<rect x="${pillX}" y="${dotSize}" width="${pillWidth}" height="14" rx="7" fill="${color}" stroke="#ffffff" stroke-width="1"/>
       <text x="${svgW / 2}" y="${dotSize + 10}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#ffffff">${labelText}</text>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
    ${severityRing}
    <circle cx="${cx}" cy="${cx}" r="10" fill="${color}" opacity="${pulseOpacity}">
      <animate attributeName="r" values="10;20;10" dur="${dur}" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="${pulseOpacity};0;${pulseOpacity}" dur="${dur}" repeatCount="indefinite"/>
    </circle>
    <circle cx="${cx}" cy="${cx}" r="10" fill="${color}" stroke="white" stroke-width="2.5"/>
    ${warning}
    ${namePill}
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(svgW, svgH),
    anchor: new google.maps.Point(cx, cx),
  };
}

function makeDestinationIcon(): google.maps.Icon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
    <path d="M14 2C7.373 2 2 7.373 2 14c0 7.5 12 20 12 20s12-12.5 12-20C26 7.373 20.627 2 14 2z" fill="#dc2626" stroke="white" stroke-width="2.5"/>
    <circle cx="14" cy="14" r="4" fill="white"/>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(28, 36),
    anchor: new google.maps.Point(14, 36),
  };
}

function makeJoinerMarkerIcon(label: string, pendingGps: boolean): google.maps.Icon {
  const labelText = label.replace(/[<>&]/g, "") || "Joiner";
  const pillWidth = Math.max(44, labelText.length * 7 + 14);
  const svgW = Math.max(44, pillWidth);
  const svgH = 50;
  const dotCx = svgW / 2;
  const pillX = (svgW - pillWidth) / 2;
  const fill = pendingGps ? "#64748b" : "#2563eb";
  const pulse = pendingGps
    ? ""
    : `<circle cx="${dotCx}" cy="16" r="10" fill="${fill}" fill-opacity="0.25"><animate attributeName="r" from="10" to="15" dur="1.4s" repeatCount="indefinite"/><animate attributeName="fill-opacity" from="0.25" to="0" dur="1.4s" repeatCount="indefinite"/></circle>`;
  const dot = pendingGps
    ? `<circle cx="${dotCx}" cy="16" r="9" fill="none" stroke="${fill}" stroke-width="2" stroke-dasharray="3 2"/><circle cx="${dotCx}" cy="16" r="4" fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>`
    : `<circle cx="${dotCx}" cy="16" r="7" fill="${fill}" stroke="#ffffff" stroke-width="2"/>`;
  const jSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">${pulse}${dot}<rect x="${pillX}" y="32" width="${pillWidth}" height="14" rx="7" fill="${fill}" stroke="#ffffff" stroke-width="1"/><text x="${dotCx}" y="42" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#ffffff">${labelText}</text></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(jSvg)}`,
    scaledSize: new google.maps.Size(svgW, svgH),
    anchor: new google.maps.Point(dotCx, 16),
  };
}

export default function LiveMonitorPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<number, google.maps.Marker>>(new Map());
  const markerInfoRef = useRef<Map<number, string>>(new Map());
  const destMarkersRef = useRef<Map<number, google.maps.Marker>>(new Map());
  const destInfoRef = useRef<Map<number, string>>(new Map());
  const routeLinesRef = useRef<Map<number, google.maps.Polyline>>(new Map());
  const joinerMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const joinerInfoRef = useRef<Map<string, string>>(new Map());
  const joinerDestMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const joinerRouteLinesRef = useRef<Map<string, google.maps.Polyline>>(new Map());
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const trafficLayerRef = useRef<google.maps.TrafficLayer | null>(null);
  // Tracks the incident-ID signature we last called fitBounds for. We only
  // re-fit when the *set* of active incidents changes (one ends, a new one
  // starts) — NOT on every 5 s refetch, otherwise the admin's pan/zoom is
  // wiped every refresh. v69 fix.
  const lastFitSignatureRef = useRef<string>("");

  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [endConfirmId, setEndConfirmId] = useState<number | null>(null);
  const [noteIncidentId, setNoteIncidentId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [tick, setTick] = useState(0);
  const [showTraffic, setShowTraffic] = useState(false);
  const [mapType, setMapType] = useState<"roadmap" | "satellite">("roadmap");
  const [highlightId, setHighlightId] = useState<number | null>(() => {
    const p = new URLSearchParams(window.location.search).get("incidentId");
    return p ? parseInt(p, 10) : null;
  });
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const { data: liveIncidents = [], isLoading } = useQuery<LiveIncident[]>({
    queryKey: ["/api/incidents/live"],
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  // Scroll to the deep-linked incident once it loads
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (!highlightId || scrolledRef.current || liveIncidents.length === 0) return;
    const el = cardRefs.current.get(highlightId);
    if (!el) return;
    scrolledRef.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Auto-clear highlight after 3 s so it doesn't stay forever
    const t = setTimeout(() => setHighlightId(null), 3000);
    return () => clearTimeout(t);
  }, [highlightId, liveIncidents]);

  // Toast when a new live incident appears during polling
  const prevIncidentIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const prevIds = prevIncidentIdsRef.current;
    const newIncidents = liveIncidents.filter((inc) => !prevIds.has(inc.id));
    if (newIncidents.length > 0 && prevIds.size > 0) {
      // Only toast for incidents that appeared after the page was already loaded
      // (skip on first load where prevIds is empty)
      newIncidents.forEach((inc) => {
        const name = `${inc.responderFirstName ?? ""} ${inc.responderLastName ?? ""}`.trim() || `Incident #${inc.id}`;
        toast({
          title: `🚨 New Live Incident — ${name}`,
          description: `${name} has started a live incident.`,
          action: (
            <ToastAction altText="View" onClick={() => navigate("/live-monitor")}>
              View
            </ToastAction>
          ),
        });
      });
    }
    prevIncidentIdsRef.current = new Set(liveIncidents.map((inc) => inc.id));
  }, [liveIncidents, toast]);

  const { data: me } = useQuery<{ id: string }>({ queryKey: ["/api/auth/me"] });

  const joinMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/incidents/${id}/join-live`, {}),
    onSuccess: (_, id) => {
      localStorage.setItem("omt_joined_incident_id", String(id));
      queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
      navigate("/live-incident");
    },
    onError: () => toast({ title: "Error", description: "Could not join the incident.", variant: "destructive" }),
  });

  useEffect(() => {
    const t = setInterval(() => setTick((d) => d + 1), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    loadGoogleMaps().then(() => setMapsReady(true)).catch(() => setMapsError(true));
  }, []);

  useEffect(() => {
    if (!mapsReady || !mapRef.current || mapInstanceRef.current) return;
    const map = new google.maps.Map(mapRef.current, {
      center: { lat: -29.0, lng: 26.0 },
      zoom: 5,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    mapInstanceRef.current = map;
    infoWindowRef.current = new google.maps.InfoWindow();
    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current.clear();
      markerInfoRef.current.clear();
      destMarkersRef.current.forEach((m) => m.setMap(null));
      destMarkersRef.current.clear();
      destInfoRef.current.clear();
      routeLinesRef.current.forEach((l) => l.setMap(null));
      routeLinesRef.current.clear();
      mapInstanceRef.current = null;
    };
  }, [mapsReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (showTraffic) {
      if (!trafficLayerRef.current) {
        trafficLayerRef.current = new google.maps.TrafficLayer();
      }
      trafficLayerRef.current.setMap(map);
    } else {
      trafficLayerRef.current?.setMap(null);
    }
  }, [showTraffic, mapsReady]);

  useEffect(() => {
    mapInstanceRef.current?.setMapTypeId(mapType);
  }, [mapType, mapsReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const currentIds = new Set(liveIncidents.map((i) => i.id));
    const markerMap = markersRef.current;
    const infoMap = markerInfoRef.current;

    for (const entry of Array.from(markerMap.entries())) {
      const [id, marker] = entry;
      if (!currentIds.has(id)) {
        marker.setMap(null);
        markerMap.delete(id);
        infoMap.delete(id);
      }
    }

    const bounds = new google.maps.LatLngBounds();
    let hasBounds = false;

    for (const inc of liveIncidents) {
      const lat = inc.responderLat ?? inc.latitude;
      const lng = inc.responderLng ?? inc.longitude;
      if (lat == null || lng == null) continue;

      hasBounds = true;
      const pos = { lat, lng };
      bounds.extend(pos);

      const isPanic = isPanicIncident(inc);
      const color = isPanic ? "#dc2626" : getMarkerColor(inc);
      const icon = isPanic
        ? makePanicMarkerIcon(inc.responderFirstName ?? null)
        : makeMarkerIcon(color, inc.isEscalated, inc.severity, inc.responderFirstName ?? null, inc.categoryColor);
      const zIndex = isPanic ? 300 : (inc.isEscalated ? 200 : 100);
      const name = getResponderName(inc);
      const duration = formatDuration(inc.liveStartedAt);
      const positionSource = inc.responderLat != null
        ? `GPS live (${formatTime(inc.responderPositionUpdatedAt)})`
        : "Reported location";
      const severityLabel = inc.severity === "red" ? "🔴 RED" : inc.severity === "orange" ? "🟠 ORANGE" : inc.severity === "yellow" ? "🟡 YELLOW" : null;
      const severityColor = inc.severity === "red" ? "#ef4444" : inc.severity === "orange" ? "#f97316" : inc.severity === "yellow" ? "#b45309" : "#374151";
      const panicAckHtml = isPanic
        ? inc.panicAcknowledgedAt
          ? `<div style="color:#16a34a;font-weight:600;font-size:11px;margin-bottom:4px">✓ Acknowledged</div>`
          : `<div style="color:#dc2626;font-weight:600;font-size:11px;margin-bottom:4px">⚠ Not yet acknowledged</div>`
        : "";

      const infoHtml = `
        <div style="min-width:190px;font-family:system-ui;font-size:13px;line-height:1.5;padding:2px 0">
          ${isPanic ? `<div style="color:#dc2626;font-weight:700;font-size:12px;margin-bottom:5px;background:#fee2e2;padding:3px 7px;border-radius:4px;border:1px solid #fca5a5">🆘 SOS / PANIC ALERT</div>` : ""}
          <div style="font-weight:700;margin-bottom:4px;font-size:14px">${name}</div>
          ${panicAckHtml}
          ${inc.isEscalated ? '<div style="color:#ef4444;font-weight:600;font-size:11px;margin-bottom:4px">⚠ ESCALATED</div>' : ""}
          ${severityLabel ? `<div style="color:${severityColor};font-weight:600;font-size:11px;margin-bottom:4px">▲ Severity: ${severityLabel}</div>` : ""}
          ${inc.responderArrivedAt ? `<div style="color:#2563eb;font-weight:600;font-size:11px;margin-bottom:4px">📍 AT SCENE since ${formatTime(inc.responderArrivedAt)}</div>` : ""}
          ${inc.categoryName ? `<div style="color:#374151;font-size:11px;margin-bottom:2px">📋 ${inc.categoryName}</div>` : ""}
          <div style="color:#6b7280;font-size:11px">📍 ${inc.locationName ?? "Unknown location"}</div>
          <div style="color:#6b7280;font-size:11px">⏱ Active: ${duration}</div>
          <div style="color:#6b7280;font-size:11px">📡 ${positionSource}</div>
          ${inc.destinationName ? `<div style="color:#dc2626;font-size:11px;font-weight:600;margin-top:4px;padding-top:4px;border-top:1px solid #e5e7eb">🏁 Heading to: ${inc.destinationName}</div>` : ""}
        </div>
      `;
      infoMap.set(inc.id, infoHtml);

      const existing = markerMap.get(inc.id);
      if (existing) {
        existing.setPosition(pos);
        existing.setIcon(icon);
        existing.setTitle(name);
        existing.setZIndex(zIndex);
      } else {
        const marker = new google.maps.Marker({
          position: pos,
          map,
          icon,
          title: name,
          zIndex,
        });
        marker.addListener("click", () => {
          const iw = infoWindowRef.current;
          const html = infoMap.get(inc.id);
          if (iw && html) {
            iw.setContent(html);
            iw.open(map, marker);
          }
          if (isPanic) {
            setHighlightId(inc.id);
            const el = cardRefs.current.get(inc.id);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
        markerMap.set(inc.id, marker);
      }
    }

    // Destination markers — red pins showing where each responder is heading
    const destMarkerMap = destMarkersRef.current;
    const destInfo = destInfoRef.current;
    for (const [id, m] of Array.from(destMarkerMap.entries())) {
      if (!currentIds.has(id)) { m.setMap(null); destMarkerMap.delete(id); destInfo.delete(id); }
    }
    for (const inc of liveIncidents) {
      if (inc.destinationLat == null || inc.destinationLng == null) {
        const ex = destMarkerMap.get(inc.id);
        if (ex) { ex.setMap(null); destMarkerMap.delete(inc.id); destInfo.delete(inc.id); }
        continue;
      }
      const destPos = { lat: inc.destinationLat, lng: inc.destinationLng };
      bounds.extend(destPos);
      hasBounds = true;
      const destHtml = `<div style="min-width:160px;font-family:system-ui;font-size:13px;line-height:1.5;padding:2px 0"><div style="font-weight:700;margin-bottom:4px;font-size:14px">🏁 Destination</div><div style="color:#dc2626;font-weight:600;margin-bottom:2px">${inc.destinationName ?? "Unknown"}</div><div style="color:#6b7280;font-size:11px">Responder: ${getResponderName(inc)}</div></div>`;
      destInfo.set(inc.id, destHtml);
      const exDest = destMarkerMap.get(inc.id);
      if (exDest) {
        exDest.setPosition(destPos);
      } else {
        const dm = new google.maps.Marker({
          position: destPos,
          map,
          icon: makeDestinationIcon(),
          title: inc.destinationName ?? "Destination",
          zIndex: 50,
        });
        dm.addListener("click", () => {
          const iw = infoWindowRef.current;
          const html = destInfo.get(inc.id);
          if (iw && html) { iw.setContent(html); iw.open(map, dm); }
        });
        destMarkerMap.set(inc.id, dm);
      }
    }

    // Joiner markers — blue markers for users who have joined an incident
    const joinerMarkerMap = joinerMarkersRef.current;
    const joinerInfo = joinerInfoRef.current;
    const activeJoinerKeys = new Set<string>();
    for (const inc of liveIncidents) {
      const joiners = (inc.responders ?? []).filter((r) => r.userId !== inc.userId);
      joiners.forEach((r, idx) => {
        const key = `joiner-${inc.id}-${r.userId}`;
        activeJoinerKeys.add(key);
        const hasGps = r.lastLat != null && r.lastLng != null;
        let jPos: google.maps.LatLngLiteral | null = null;
        if (hasGps) {
          jPos = { lat: r.lastLat!, lng: r.lastLng! };
        } else {
          const baseLat = inc.responderLat ?? inc.latitude;
          const baseLng = inc.responderLng ?? inc.longitude;
          if (baseLat == null || baseLng == null) return;
          // Slight offset so pending joiners don't stack on the creator pin
          jPos = { lat: baseLat + 0.00025 * (idx + 1), lng: baseLng + 0.00018 * (idx + 1) };
        }
        bounds.extend(jPos);
        hasBounds = true;
        const arrivedStr = r.arrivedAt ? `<div style="color:#16a34a;font-size:11px;font-weight:600">✅ Arrived ${formatTime(r.arrivedAt)}</div>` : "";
        const posStr = hasGps && r.lastPositionAt && !r.arrivedAt
          ? `<div style="color:#6b7280;font-size:11px">GPS: ${formatTime(r.lastPositionAt)}</div>`
          : !hasGps && !r.arrivedAt
            ? `<div style="color:#64748b;font-size:11px;font-weight:600">Awaiting GPS — shown near incident</div>`
            : "";
        const noteStr = r.arrivalNote ? `<div style="color:#374151;font-size:11px;margin-top:2px">${r.arrivalNote}</div>` : "";
        const jHtml = `<div style="min-width:160px;font-family:system-ui;font-size:13px;line-height:1.5;padding:2px 0"><div style="font-weight:700;margin-bottom:4px;font-size:14px">👥 ${r.firstName} ${r.lastName}</div><div style="color:#2563eb;font-size:11px;font-weight:600">Joiner on Incident #${inc.id}</div>${arrivedStr}${posStr}${noteStr}</div>`;
        joinerInfo.set(key, jHtml);
        const pendingGps = !hasGps;
        const labelText = r.firstName || "Joiner";
        const icon = makeJoinerMarkerIcon(labelText, pendingGps);
        const existing = joinerMarkerMap.get(key);
        if (existing) {
          existing.setPosition(jPos);
          existing.setIcon(icon);
          existing.setZIndex(pendingGps ? 85 : 90);
        } else {
          const jm = new google.maps.Marker({
            position: jPos,
            map,
            icon,
            title: `${r.firstName} ${r.lastName}${pendingGps ? " (awaiting GPS)" : ""}`,
            zIndex: pendingGps ? 85 : 90,
          });
          jm.addListener("click", () => {
            const iw = infoWindowRef.current;
            const html = joinerInfo.get(key);
            if (iw && html) { iw.setContent(html); iw.open(map, jm); }
          });
          joinerMarkerMap.set(key, jm);
        }
      });
    }
    // Remove stale joiner markers
    for (const [key, m] of Array.from(joinerMarkerMap.entries())) {
      if (!activeJoinerKeys.has(key)) { m.setMap(null); joinerMarkerMap.delete(key); joinerInfo.delete(key); }
    }

    // Joiner destination markers — flag pin only for joiners with their OWN
    // destination (don't duplicate the incident's destination pin, which is
    // already rendered above for all joiners that reuse it).
    const joinerDestMarkerMap = joinerDestMarkersRef.current;
    const joinerRouteLineMap = joinerRouteLinesRef.current;
    const activeJoinerDestKeys = new Set<string>();
    const activeJoinerRouteKeys = new Set<string>();
    for (const inc of liveIncidents) {
      for (const r of (inc.responders ?? [])) {
        // Per-joiner destination pin: only when they set their own destination
        if (r.destinationLat != null && r.destinationLng != null) {
          const key = `jdest-${inc.id}-${r.userId}`;
          activeJoinerDestKeys.add(key);
          const destPos = { lat: r.destinationLat, lng: r.destinationLng };
          bounds.extend(destPos);
          hasBounds = true;
          const existing = joinerDestMarkerMap.get(key);
          if (existing) {
            existing.setPosition(destPos);
          } else {
            const joinerDestSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32"><path d="M12 2C6.48 2 2 6.48 2 12c0 6.5 10 18 10 18s10-11.5 10-18C22 6.48 17.52 2 12 2z" fill="#2563eb" stroke="white" stroke-width="2"/><circle cx="12" cy="12" r="3.5" fill="white"/></svg>`;
            const jdm = new google.maps.Marker({
              position: destPos,
              map,
              icon: {
                url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(joinerDestSvg)}`,
                scaledSize: new google.maps.Size(24, 32),
                anchor: new google.maps.Point(12, 32),
              },
              title: `${r.firstName} ${r.lastName} destination`,
              zIndex: 45,
            });
            jdm.addListener("click", () => {
              const iw = infoWindowRef.current;
              const html = `<div style="min-width:150px;font-family:system-ui;font-size:13px;line-height:1.5;padding:2px 0"><div style="font-weight:700;margin-bottom:4px;font-size:14px">🏁 ${r.firstName} ${r.lastName}</div><div style="color:#2563eb;font-size:11px;font-weight:600">${r.destinationName || "Destination"}</div></div>`;
              if (iw) { iw.setContent(html); iw.open(map, jdm); }
            });
            joinerDestMarkerMap.set(key, jdm);
          }
        }

        // Per-joiner route line: drawn whenever the joiner has a GPS position
        // AND an effective destination — falling back to the incident's
        // destination when the joiner hasn't set their own. Without this
        // fallback the dispatcher map shows joiner pins floating with no path,
        // even though the joiner is actively navigating to the incident.
        const effDestLat = r.destinationLat ?? inc.destinationLat;
        const effDestLng = r.destinationLng ?? inc.destinationLng;
        if (
          r.lastLat != null && r.lastLng != null &&
          effDestLat != null && effDestLng != null &&
          !r.arrivedAt
        ) {
          const routeKey = `jroute-${inc.id}-${r.userId}`;
          activeJoinerRouteKeys.add(routeKey);
          const routePath = [
            { lat: r.lastLat, lng: r.lastLng },
            { lat: Number(effDestLat), lng: Number(effDestLng) },
          ];
          const existingLine = joinerRouteLineMap.get(routeKey);
          if (existingLine) {
            existingLine.setPath(routePath);
          } else {
            const jLine = new google.maps.Polyline({
              path: routePath,
              map,
              // Purple keeps the joiner route distinguishable from the
              // creator's blue dashed route on the same map.
              strokeColor: "#a855f7",
              strokeWeight: 2,
              strokeOpacity: 0,
              icons: [{
                icon: { path: "M 0,-1 0,1", strokeOpacity: 0.7, strokeWeight: 2, scale: 3 },
                offset: "0",
                repeat: "16px",
              }],
              zIndex: 8,
            });
            joinerRouteLineMap.set(routeKey, jLine);
          }
        }
      }
    }
    // Remove stale joiner destination markers and route lines
    for (const [key, m] of Array.from(joinerDestMarkerMap.entries())) {
      if (!activeJoinerDestKeys.has(key)) { m.setMap(null); joinerDestMarkerMap.delete(key); }
    }
    for (const [key, l] of Array.from(joinerRouteLineMap.entries())) {
      if (!activeJoinerRouteKeys.has(key)) { l.setMap(null); joinerRouteLineMap.delete(key); }
    }

    // Route lines — dashed blue polyline from responder to destination
    const routeLineMap = routeLinesRef.current;
    for (const [id, line] of Array.from(routeLineMap.entries())) {
      if (!currentIds.has(id)) { line.setMap(null); routeLineMap.delete(id); }
    }
    for (const inc of liveIncidents) {
      const rLat = inc.responderLat ?? inc.latitude;
      const rLng = inc.responderLng ?? inc.longitude;
      if (rLat == null || rLng == null || inc.destinationLat == null || inc.destinationLng == null) {
        const ex = routeLineMap.get(inc.id);
        if (ex) { ex.setMap(null); routeLineMap.delete(inc.id); }
        continue;
      }
      const path = [{ lat: rLat, lng: rLng }, { lat: inc.destinationLat, lng: inc.destinationLng }];
      const existing = routeLineMap.get(inc.id);
      if (existing) {
        existing.setPath(path);
      } else {
        const line = new google.maps.Polyline({
          path,
          map,
          strokeColor: "#2563eb",
          strokeWeight: 3,
          strokeOpacity: 0,
          icons: [{
            icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeWeight: 3, scale: 4 },
            offset: "0",
            repeat: "20px",
          }],
          zIndex: 10,
        });
        routeLineMap.set(inc.id, line);
      }
    }

    if (hasBounds) {
      // Only fitBounds when the set of incident IDs has changed. The 5 s
      // refetch re-runs this effect every poll; without this guard each
      // refresh clobbers the admin's pinch/pan/zoom. Compare sorted IDs as
      // a stable signature.
      const signature = liveIncidents.map(i => i.id).sort((a, b) => a - b).join(",");
      if (signature !== lastFitSignatureRef.current) {
        lastFitSignatureRef.current = signature;
        try {
          map.fitBounds(bounds, 60);
          const listener = google.maps.event.addListenerOnce(map, "bounds_changed", () => {
            if ((map.getZoom() ?? 0) > 14) map.setZoom(14);
          });
          setTimeout(() => google.maps.event.removeListener(listener), 2000);
        } catch {}
      }
    }
  }, [liveIncidents, mapsReady]);

  const endLiveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/incidents/${id}/end-live`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      setEndConfirmId(null);
      toast({ title: "Live incident ended", description: "The incident has been closed." });
    },
    onError: () => toast({ title: "Error", description: "Could not end the incident.", variant: "destructive" }),
  });

  const escalateMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/incidents/${id}/escalate`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
      toast({ title: "Incident escalated", description: "All admins and supervisors have been notified." });
    },
    onError: () => toast({ title: "Error", description: "Could not escalate the incident.", variant: "destructive" }),
  });

  const addNoteMutation = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      apiRequest("POST", `/api/incidents/${id}/add-note`, { note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      setNoteIncidentId(null);
      setNoteText("");
      toast({ title: "Note saved", description: "The note has been appended to the incident." });
    },
    onError: () => toast({ title: "Error", description: "Could not save the note.", variant: "destructive" }),
  });

  const noteIncident = liveIncidents.find((i) => i.id === noteIncidentId) ?? null;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0 bg-background">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} data-testid="button-back-live-monitor">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Radio className="h-5 w-5 text-red-500 animate-pulse shrink-0" />
          <span className="font-semibold text-lg">Live Monitor</span>
          {liveIncidents.length > 0 && (
            <Badge className="bg-red-500 text-white ml-1 shrink-0" data-testid="badge-live-count">
              {liveIncidents.length} Active
            </Badge>
          )}
        </div>
        {liveIncidents.length > 0 && (
          <span className="text-xs text-muted-foreground hidden sm:block">Auto-refreshes every 5s</span>
        )}
      </div>

      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">
        <div className="order-2 md:order-1 flex-1 min-h-0 md:flex-none md:w-72 border-b md:border-b-0 md:border-r flex flex-col bg-background overflow-y-auto" data-testid="panel-live-incidents">
          {isLoading ? (
            <div className="flex items-center justify-center flex-1 text-muted-foreground py-12">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading…
            </div>
          ) : liveIncidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 px-6 py-10 text-center" data-testid="empty-live-monitor">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="font-semibold text-sm">All clear</p>
              <p className="text-xs text-muted-foreground">No active live incidents at this time.</p>
            </div>
          ) : (
            <div className="divide-y">
              {liveIncidents.map((inc) => {
                const isMyIncident = me?.id != null && inc.userId === me.id;
                const alreadyJoined = me?.id != null && (inc.responders ?? []).some((r) => r.userId === me.id);
                const isHighlighted = highlightId === inc.id;
                return (
                  <div
                    key={inc.id}
                    ref={(el) => {
                      if (el) cardRefs.current.set(inc.id, el);
                      else cardRefs.current.delete(inc.id);
                    }}
                    className={isHighlighted ? "ring-2 ring-primary ring-inset transition-all duration-700" : ""}
                  >
                    <LiveIncidentCard
                      incident={inc}
                      onEndClick={() => setEndConfirmId(inc.id)}
                      onNoteClick={() => { setNoteIncidentId(inc.id); setNoteText(""); }}
                      onEscalateClick={() => escalateMutation.mutate(inc.id)}
                      isEscalating={escalateMutation.isPending && (escalateMutation.variables as number) === inc.id}
                      canJoin={!isMyIncident && !alreadyJoined}
                      alreadyJoined={alreadyJoined}
                      onJoinClick={() => joinMutation.mutate(inc.id)}
                      isJoining={joinMutation.isPending && (joinMutation.variables as number) === inc.id}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="order-1 md:order-2 h-[42vh] md:h-auto md:flex-1 min-w-0 relative shrink-0 md:shrink" data-testid="map-live-monitor">
          {mapsError && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/20 z-10">
              <div className="text-center px-6 py-8 space-y-2">
                <MapPin className="h-8 w-8 mx-auto text-destructive/60" />
                <p className="text-sm text-muted-foreground">Map unavailable — contact your administrator.</p>
              </div>
            </div>
          )}
          {!mapsReady && !mapsError && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/10 z-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <div ref={mapRef} className="w-full h-full" />
          <div className="absolute top-2 right-2 flex flex-col gap-1.5 z-10">
            <button
              onClick={() => setMapType((t) => t === "roadmap" ? "satellite" : "roadmap")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium shadow transition-colors ${
                mapType === "satellite"
                  ? "bg-blue-600 text-white"
                  : "bg-white/90 dark:bg-black/70 text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-black/90"
              }`}
              title="Toggle satellite view"
              data-testid="button-toggle-satellite"
            >
              <Layers className="h-3.5 w-3.5" />
              {mapType === "satellite" ? "Satellite" : "Map"}
            </button>
            <button
              onClick={() => setShowTraffic((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium shadow transition-colors ${
                showTraffic
                  ? "bg-green-600 text-white"
                  : "bg-white/90 dark:bg-black/70 text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-black/90"
              }`}
              title="Toggle traffic layer"
              data-testid="button-toggle-traffic"
            >
              <Car className="h-3.5 w-3.5" />
              Traffic
            </button>
          </div>
        </div>
      </div>

      <AlertDialog open={endConfirmId !== null} onOpenChange={(o) => { if (!o) setEndConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End Live Incident</AlertDialogTitle>
            <AlertDialogDescription>
              This will close the live incident and stop GPS tracking for this person. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-end-live">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => endConfirmId !== null && endLiveMutation.mutate(endConfirmId)}
              disabled={endLiveMutation.isPending}
              data-testid="button-confirm-end-live"
            >
              {endLiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              End Incident
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={noteIncidentId !== null} onOpenChange={(o) => { if (!o) { setNoteIncidentId(null); setNoteText(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Note — {noteIncident ? getResponderName(noteIncident) : ""}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Notes are timestamped and appended to the incident description for the record.
          </p>
          <Textarea
            placeholder="Enter note about this incident…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={4}
            data-testid="textarea-note"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNoteIncidentId(null); setNoteText(""); }}>Cancel</Button>
            <Button
              onClick={() => noteIncidentId !== null && addNoteMutation.mutate({ id: noteIncidentId, note: noteText })}
              disabled={addNoteMutation.isPending || !noteText.trim()}
              data-testid="button-save-note"
            >
              {addNoteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LiveIncidentCard({
  incident,
  onEndClick,
  onNoteClick,
  onEscalateClick,
  isEscalating,
  canJoin,
  alreadyJoined,
  onJoinClick,
  isJoining,
}: {
  incident: LiveIncident;
  onEndClick: () => void;
  onNoteClick: () => void;
  onEscalateClick: () => void;
  isEscalating: boolean;
  canJoin: boolean;
  alreadyJoined: boolean;
  onJoinClick: () => void;
  isJoining: boolean;
}) {
  const name = getResponderName(incident);
  const duration = formatDuration(incident.liveStartedAt);
  const hasGps = incident.responderLat != null && incident.responderLng != null;
  const gpsTime = incident.responderPositionUpdatedAt
    ? `Updated ${formatTime(incident.responderPositionUpdatedAt)}`
    : "No GPS";
  const isStale = hasGps && incident.responderPositionUpdatedAt
    ? (Date.now() - new Date(incident.responderPositionUpdatedAt).getTime()) > 180000
    : false;
  const markerColor = getMarkerColor(incident);

  return (
    <div
      className={`p-4 space-y-3 ${incident.isEscalated ? "bg-red-500/5 border-l-4 border-red-500" : ""}`}
      data-testid={`card-live-incident-${incident.id}`}
    >
      <div className="space-y-1.5">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate" data-testid={`text-responder-name-${incident.id}`}>{name}</p>
            {incident.categoryName && (
              <p className="text-xs flex items-center gap-1 mt-0.5">
                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: markerColor }} />
                <Tag className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground truncate">{incident.categoryName}</span>
              </p>
            )}
            {incident.locationName && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{incident.locationName}</span>
              </p>
            )}
            {incident.destinationName && (
              <p className="text-xs flex items-center gap-1 mt-0.5">
                <Navigation className="h-3 w-3 shrink-0 text-red-500" />
                <span className="text-red-600 dark:text-red-400 font-medium truncate">→ {incident.destinationName}</span>
              </p>
            )}
          </div>
          {incident.panicAcknowledgedAt && (
            <Badge className="bg-green-600 text-white text-xs shrink-0" data-testid={`badge-panic-acknowledged-${incident.id}`}>
              ✓ Acknowledged
            </Badge>
          )}
          {incident.isEscalated && (
            <Badge className="bg-red-500 text-white text-xs shrink-0" data-testid={`badge-escalated-${incident.id}`}>
              ESCALATED
            </Badge>
          )}
          {incident.responderArrivedAt && !incident.isEscalated && (
            <Badge className="bg-blue-600 text-white text-xs shrink-0" data-testid={`badge-at-scene-${incident.id}`}>
              AT SCENE
            </Badge>
          )}
        </div>

        {incident.responderArrivedAt && (
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400" data-testid={`text-arrived-at-${incident.id}`}>
            {name} is active at incident scene · arrived {formatTime(incident.responderArrivedAt)}
          </p>
        )}

        {(() => {
          const joiners = (incident.responders ?? []).filter((r) => r.userId !== incident.userId);
          if (joiners.length === 0) return null;
          return (
            <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 mt-1" data-testid={`list-responders-${incident.id}`}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">
                Responders ({joiners.length})
              </p>
              <ul className="space-y-1">
                {joiners.map((r) => {
                  const respName = `${r.firstName} ${r.lastName}`.trim() || "Responder";
                  let statusEl;
                  if (r.arrivedAt) {
                    statusEl = (
                      <span className="text-[10px] font-semibold text-green-600 dark:text-green-400 shrink-0" data-testid={`responder-status-${incident.id}-${r.userId}`}>
                        ✅ Arrived {formatTime(r.arrivedAt)}
                      </span>
                    );
                  } else if (r.lastPositionAt) {
                    const stale = (Date.now() - new Date(r.lastPositionAt).getTime()) > 180000;
                    statusEl = (
                      <span className={`text-[10px] font-medium shrink-0 ${stale ? "text-red-500" : "text-blue-600 dark:text-blue-400"}`} data-testid={`responder-status-${incident.id}-${r.userId}`}>
                        📍 En route · GPS {formatTime(r.lastPositionAt)}{stale ? " (stale)" : ""}
                      </span>
                    );
                  } else {
                    statusEl = (
                      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 shrink-0" data-testid={`responder-status-${incident.id}-${r.userId}`}>
                        ⏳ Joined {formatTime(r.joinedAt)} · no GPS
                      </span>
                    );
                  }
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-2 text-xs" data-testid={`responder-row-${incident.id}-${r.userId}`}>
                      <span className="truncate font-medium">{respName}</span>
                      {statusEl}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })()}

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {duration}
          </span>
          <span className="flex items-center gap-1" data-testid={`text-gps-status-${incident.id}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${hasGps ? (isStale ? "bg-red-500" : "bg-green-500") : "bg-amber-400"}`} />
            <span className={isStale ? "text-red-500 font-medium" : ""}>{hasGps ? gpsTime : "No GPS"}</span>
          </span>
          {isStale && (
            <Badge className="bg-red-500 text-white text-[9px] px-1.5 py-0 leading-tight" data-testid={`badge-gps-stale-${incident.id}`}>
              GPS STALE
            </Badge>
          )}
        </div>
        {hasGps && (
          <div className="flex items-center gap-1 text-xs">
            <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
            <a
              href={`https://www.google.com/maps?q=${incident.responderLat},${incident.responderLng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
              data-testid={`link-responder-position-${incident.id}`}
            >
              {Number(incident.responderLat).toFixed(4)}, {Number(incident.responderLng).toFixed(4)} ↗
            </a>
          </div>
        )}
      </div>

      {(canJoin || alreadyJoined) && (
        <div className="pb-1">
          {canJoin ? (
            <Button
              size="sm"
              className="w-full text-xs h-8 bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
              onClick={onJoinClick}
              disabled={isJoining}
              data-testid={`button-join-incident-${incident.id}`}
            >
              {isJoining ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
              {isJoining ? "Joining…" : "Respond — Join & Track GPS"}
            </Button>
          ) : (
            <div className="flex flex-col gap-2 pb-1">
              <Link href="/live-incident" className="block">
                <Button
                  size="sm"
                  className="w-full text-xs h-10 bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
                  data-testid={`button-open-gps-tracking-${incident.id}`}
                >
                  <Navigation className="h-3.5 w-3.5" />
                  Open GPS Tracking
                </Button>
              </Link>
              <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium px-1">
                <UserPlus className="h-3 w-3" />
                You are responding — stay on Live Incident to share GPS
              </div>
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        <Button
          size="sm"
          variant="destructive"
          className="w-full text-xs h-8 px-2"
          onClick={onEndClick}
          data-testid={`button-end-incident-${incident.id}`}
        >
          <CheckCircle2 className="h-3 w-3 mr-1" />
          End
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs h-8 px-2"
          onClick={onNoteClick}
          data-testid={`button-note-incident-${incident.id}`}
        >
          <FileText className="h-3 w-3 mr-1" />
          Note
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={`w-full text-xs h-8 px-2 ${incident.isEscalated ? "opacity-50 cursor-not-allowed" : "border-red-500/50 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"}`}
          onClick={!incident.isEscalated ? onEscalateClick : undefined}
          disabled={incident.isEscalated || isEscalating}
          data-testid={`button-escalate-incident-${incident.id}`}
        >
          {isEscalating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ShieldAlert className="h-3 w-3 mr-1" />}
          {incident.isEscalated ? "Done" : "Escalate"}
        </Button>
      </div>
    </div>
  );
}
