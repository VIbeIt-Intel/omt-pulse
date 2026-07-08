import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, Layers, Car, Crosshair } from "lucide-react";
import { loadGoogleMaps, resetGoogleMapsLoader } from "@/lib/google-maps-loader";
import {
  MOTION_STATUS,
  formatFreshnessAgo,
  headingLabel,
  ignitionLabel,
  type VehicleMotionStatus,
} from "@/lib/fleet-intelligence";
import { cn } from "@/lib/utils";
import { PREMISE_COVERAGE_RADIUS_M } from "@shared/premises-geofence";

export { PREMISE_COVERAGE_RADIUS_M };

export type OnlineUserMapMarker = {
  id: string;
  firstName: string;
  lastName: string;
  lat: number;
  lng: number;
  lastPositionAt: string | null;
};

export type TrackerMapMarker = {
  id: number;
  label: string;
  imei: string;
  lat: number;
  lng: number;
  speedKph: number | null;
  heading: number | null;
  ignitionOn: boolean | null;
  lastPositionAt: string | null;
  lastSeenAt: string | null;
  driverName?: string | null;
  registration?: string | null;
  motionStatus?: "moving" | "idle" | "offline";
};

/** Group / site premises shown on control-room and live-monitor maps. */
export type PremiseMapMarker = {
  id: string;
  name: string;
  groupName?: string | null;
  address?: string | null;
  lat: number;
  lng: number;
  locationId?: number | null;
  commandId?: number | null;
};

export type LiveIncidentMapResponder = {
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

export type LiveIncidentMapItem = {
  id: number;
  userId: string | null;
  responderLat: number | null;
  responderLng: number | null;
  latitude: number | null;
  longitude: number | null;
  destinationLat: number | null;
  destinationLng: number | null;
  destinationName: string | null;
  locationName: string | null;
  liveStartedAt: string | null;
  responderFirstName: string | null;
  responderLastName: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  severity: string | null;
  isEscalated: boolean;
  responderArrivedAt: string | null;
  responderPositionUpdatedAt: string | null;
  panicAcknowledgedAt?: string | null;
  responders: LiveIncidentMapResponder[];
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

function getResponderName(inc: LiveIncidentMapItem): string {
  const full = `${inc.responderFirstName ?? ""} ${inc.responderLastName ?? ""}`.trim();
  return full || `Incident #${inc.id}`;
}

function getMarkerColor(inc: LiveIncidentMapItem): string {
  if (inc.isEscalated) return "#ef4444";
  if (inc.responderArrivedAt) return "#2563eb";
  return inc.categoryColor ?? "#22c55e";
}

function isYellowishHex(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return r > 170 && g > 130 && b < 140;
}

function mapMarkerDotColor(color: string): string {
  if (isYellowishHex(color)) return "#b45309";
  return color;
}

function markerNamePillSvg(
  pillX: number,
  pillY: number,
  pillWidth: number,
  textX: number,
  textY: number,
  labelText: string,
  accentColor: string,
): string {
  const accent = accentColor.replace(/[<>&"]/g, "");
  return `<rect x="${pillX}" y="${pillY}" width="${pillWidth}" height="14" rx="7" fill="#1e293b" stroke="#ffffff" stroke-width="1"/>
     <rect x="${pillX + 2}" y="${pillY + 3}" width="3" height="8" rx="1.5" fill="${accent}"/>
     <text x="${textX}" y="${textY}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#f8fafc">${labelText}</text>`;
}

function getSeverityRingColor(severity: string | null, categoryColor?: string | null): string | null {
  if (severity === "red") return "#ef4444";
  if (severity === "orange") return "#f97316";
  if (severity === "yellow") {
    if (categoryColor && isYellowishHex(categoryColor)) return null;
    return "#92400e";
  }
  return null;
}

function isPanicIncident(inc: LiveIncidentMapItem): boolean {
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
  const dotColor = mapMarkerDotColor(color);
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
  const labelText = label ? label.replace(/[<>&]/g, "") : null;
  const pillWidth = labelText ? Math.max(44, labelText.length * 7 + 14) : 0;
  const svgW = labelText ? Math.max(dotSize, pillWidth + 4) : dotSize;
  const svgH = labelText ? dotSize + 16 : dotSize;
  const pillX = labelText ? (svgW - pillWidth) / 2 : 0;
  const namePill = labelText
    ? markerNamePillSvg(pillX, dotSize, pillWidth, svgW / 2, dotSize + 10, labelText, dotColor)
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
    ${severityRing}
    <circle cx="${cx}" cy="${cx}" r="10" fill="${dotColor}" opacity="${pulseOpacity}">
      <animate attributeName="r" values="10;20;10" dur="${dur}" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="${pulseOpacity};0;${pulseOpacity}" dur="${dur}" repeatCount="indefinite"/>
    </circle>
    <circle cx="${cx}" cy="${cx}" r="10" fill="${dotColor}" stroke="white" stroke-width="2.5"/>
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

const PREMISE_MAP_COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4"];

function premiseColorForIndex(index: number): string {
  return PREMISE_MAP_COLORS[index % PREMISE_MAP_COLORS.length];
}

function makePremiseMarkerIcon(color: string): google.maps.Icon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 30 38">
    <path d="M15 0C6.75 0 0 6.75 0 15c0 9.5 15 23 15 23s15-13.5 15-23C30 6.75 23.25 0 15 0z" fill="${color}" stroke="white" stroke-width="2"/>
    <circle cx="15" cy="15" r="5.5" fill="white" fill-opacity="0.95"/>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(26, 33),
    anchor: new google.maps.Point(13, 33),
  };
}

function buildPremiseInfoHtml(premise: PremiseMapMarker, darkTheme: boolean): string {
  const safeName = premise.name.replace(/[<>&]/g, "");
  const group = premise.groupName?.replace(/[<>&]/g, "") ?? "";
  const address = premise.address?.replace(/[<>&]/g, "") ?? "";
  const radiusKm = (PREMISE_COVERAGE_RADIUS_M / 1000).toFixed(0);
  if (darkTheme) {
    return `<div class="omt-map-iw-card" style="background:#0c1220;border:1px solid #2d3a4f;border-radius:10px;padding:11px 13px;min-width:190px;box-shadow:0 10px 28px rgba(0,0,0,0.5);font-family:system-ui,-apple-system,sans-serif;">
      <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#f8fafc">${safeName}</p>
      ${group ? `<p style="margin:0 0 6px;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">${group}</p>` : ""}
      ${address ? `<p style="margin:0 0 8px;font-size:11px;color:#cbd5e1;line-height:1.35">${address}</p>` : ""}
      <p style="margin:0;font-size:10px;color:#64748b">${radiusKm} km coverage radius</p>
    </div>`;
  }
  return `<div style="min-width:180px;font-family:system-ui,sans-serif;padding:2px 0">
    <div style="font-weight:700;font-size:14px;color:#111827">${safeName}</div>
    ${group ? `<div style="font-size:11px;color:#6b7280;margin-top:2px">${group}</div>` : ""}
    ${address ? `<div style="font-size:11px;color:#374151;margin-top:4px">${address}</div>` : ""}
    <div style="font-size:10px;color:#9ca3af;margin-top:6px">${radiusKm} km radius</div>
  </div>`;
}

function makeTeamMarkerIcon(firstName: string, lastName: string): google.maps.Icon {
  const initials =
    `${(firstName.charAt(0) || "").toUpperCase()}${(lastName.charAt(0) || "").toUpperCase()}` || "?";
  const size = 38;
  const cx = size / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cx}" r="16" fill="#10b981" opacity="0.12"/>
    <circle cx="${cx}" cy="${cx}" r="13" fill="#0c1220" stroke="#34d399" stroke-width="1.75"/>
    <text x="${cx}" y="${cx + 4}" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="10.5" font-weight="700" fill="#ecfdf5" letter-spacing="0.5">${initials}</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(cx, cx),
  };
}

function buildTeamInfoHtml(name: string, gpsTime: string, darkTheme: boolean): string {
  const safeName = name.replace(/[<>&]/g, "");
  if (darkTheme) {
    return `<div class="omt-map-iw-card" style="background:#0c1220;border:1px solid #2d3a4f;border-radius:10px;padding:11px 13px;min-width:176px;box-shadow:0 10px 28px rgba(0,0,0,0.5);font-family:system-ui,-apple-system,sans-serif;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#f1f5f9;letter-spacing:-0.01em;line-height:1.3">${safeName}</p>
      <div style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px 3px 6px;border-radius:999px;background:rgba(16,185,129,0.1);border:1px solid rgba(52,211,153,0.3);margin-bottom:7px">
        <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#34d399;box-shadow:0 0 6px rgba(52,211,153,0.8)"></span>
        <span style="font-size:9px;font-weight:700;color:#6ee7b7;text-transform:uppercase;letter-spacing:0.08em">On duty</span>
      </div>
      <p style="margin:0;font-size:10px;color:#64748b;font-variant-numeric:tabular-nums">GPS · ${gpsTime}</p>
    </div>`;
  }
  return `<div style="min-width:160px;font-family:system-ui,sans-serif;font-size:13px;line-height:1.5;padding:2px 0">
    <div style="font-weight:700;margin-bottom:4px;font-size:14px;color:#111827">${safeName}</div>
    <div style="color:#059669;font-size:11px;font-weight:600">On duty</div>
    <div style="color:#6b7280;font-size:11px">GPS · ${gpsTime}</div>
  </div>`;
}

function makeVehicleMarkerIcon(
  status: VehicleMotionStatus,
  heading: number | null,
  shortLabel?: string | null,
): google.maps.Icon {
  const cfg = MOTION_STATUS[status];
  const labelText = shortLabel ? shortLabel.replace(/[<>&]/g, "").slice(0, 14) : null;
  const dotSize = 44;
  const cx = dotSize / 2;
  const rot = heading != null ? heading : 0;
  const pulse =
    status === "moving"
      ? `<circle cx="${cx}" cy="${cx}" r="14" fill="${cfg.mapAccent}" opacity="0.25">
           <animate attributeName="r" values="14;22;14" dur="1.6s" repeatCount="indefinite"/>
           <animate attributeName="opacity" values="0.25;0;0.25" dur="1.6s" repeatCount="indefinite"/>
         </circle>`
      : status === "idle"
        ? `<circle cx="${cx}" cy="${cx}" r="14" fill="${cfg.mapAccent}" opacity="0.18"/>`
        : "";
  const pillWidth = labelText ? Math.max(48, labelText.length * 7 + 16) : 0;
  const svgW = labelText ? Math.max(dotSize, pillWidth + 4) : dotSize;
  const svgH = labelText ? dotSize + 18 : dotSize;
  const pillX = labelText ? (svgW - pillWidth) / 2 : 0;
  const namePill = labelText
    ? `<rect x="${pillX}" y="${dotSize}" width="${pillWidth}" height="15" rx="7.5" fill="#0f172a" stroke="${cfg.mapAccent}" stroke-width="1"/>
       <text x="${svgW / 2}" y="${dotSize + 10}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" font-weight="700" fill="#f1f5f9">${labelText}</text>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
    ${pulse}
    <g transform="rotate(${rot} ${cx} ${cx})">
      <circle cx="${cx}" cy="${cx}" r="15" fill="#0c1220" stroke="${cfg.mapAccent}" stroke-width="2"/>
      <path d="M${cx} ${cx - 7} L${cx + 4.5} ${cx + 5} L${cx} ${cx + 2.5} L${cx - 4.5} ${cx + 5} Z" fill="${cfg.mapAccent}"/>
      <rect x="${cx - 5}" y="${cx + 4}" width="10" height="4" rx="1.2" fill="${cfg.mapAccent}" opacity="0.85"/>
    </g>
    ${namePill}
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(svgW, svgH),
    anchor: new google.maps.Point(cx, cx),
  };
}

function buildVehicleInfoHtml(
  tracker: TrackerMapMarker,
  darkTheme: boolean,
): string {
  const safeLabel = tracker.label.replace(/[<>&]/g, "");
  const status = tracker.motionStatus ?? "offline";
  const cfg = MOTION_STATUS[status];
  const statusLabel = cfg.label;
  const speedLine =
    tracker.speedKph != null ? `${Math.round(tracker.speedKph)} km/h` : "—";
  const headLine = headingLabel(tracker.heading);
  const accLine = ignitionLabel(tracker.ignitionOn);
  const updatedIso = tracker.lastPositionAt ?? tracker.lastSeenAt;
  const updatedAgo = formatFreshnessAgo(updatedIso);
  const driverLine = tracker.driverName?.trim() || null;
  const regLine = tracker.registration?.trim() || null;

  const row = (label: string, value: string, valueColor = "#e2e8f0") =>
    `<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:6px">
      <span style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em">${label}</span>
      <span style="font-size:11px;font-weight:600;color:${valueColor};font-variant-numeric:tabular-nums">${value}</span>
    </div>`;

  if (darkTheme) {
    return `<div class="omt-map-iw-card" style="background:#0c1220;border:1px solid #2d3a4f;border-radius:12px;padding:12px 14px;min-width:210px;box-shadow:0 12px 32px rgba(0,0,0,0.55);font-family:system-ui,-apple-system,sans-serif;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
        <div style="min-width:0">
          <p style="margin:0;font-size:14px;font-weight:700;color:#f8fafc;letter-spacing:-0.02em;line-height:1.25">${safeLabel}</p>
          ${regLine ? `<p style="margin:2px 0 0;font-size:10px;color:#94a3b8;font-weight:500">${regLine.replace(/[<>&]/g, "")}</p>` : ""}
        </div>
        <span style="flex-shrink:0;display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;background:${cfg.mapGlow};border:1px solid ${cfg.mapAccent};font-size:9px;font-weight:700;color:${cfg.mapAccent};text-transform:uppercase;letter-spacing:0.08em">${statusLabel}</span>
      </div>
      ${driverLine ? `<p style="margin:0 0 10px;font-size:11px;color:#93c5fd">Driver · ${driverLine.replace(/[<>&]/g, "")}</p>` : '<div style="height:4px"></div>'}
      <div style="border-top:1px solid #1e293b;padding-top:8px">
        ${row("Speed", speedLine, status === "moving" ? "#4ade80" : "#e2e8f0")}
        ${row("Heading", headLine)}
        ${row("Ignition", accLine, tracker.ignitionOn ? "#fbbf24" : "#94a3b8")}
        ${row("Updated", updatedAgo, "#60a5fa")}
      </div>
    </div>`;
  }

  return `<div style="min-width:188px;font-family:system-ui,sans-serif;padding:2px 0">
    <div style="font-weight:700;font-size:14px;color:#111827;margin-bottom:2px">${safeLabel}</div>
    <div style="font-size:11px;color:#2563eb;font-weight:600;margin-bottom:6px">${statusLabel}</div>
    <div style="font-size:11px;color:#374151">Speed ${speedLine} · ${headLine} · ${accLine}</div>
    <div style="font-size:11px;color:#6b7280;margin-top:4px">Updated ${updatedAgo}</div>
  </div>`;
}

function ensureDarkInfoWindowStyles(): void {
  const id = "omt-map-iw-dark";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .gm-style .gm-style-iw-c { padding: 0 !important; background: transparent !important; box-shadow: none !important; }
    .gm-style .gm-style-iw-d { overflow: hidden !important; max-height: none !important; }
    .gm-style .gm-style-iw-tc::after { background: #0c1220 !important; box-shadow: 0 2px 6px rgba(0,0,0,0.35) !important; }
    .gm-style button.gm-ui-hover-effect { opacity: 0.55 !important; top: 2px !important; right: 2px !important; }
    .gm-style button.gm-ui-hover-effect > span { background: #94a3b8 !important; }
  `;
  document.head.appendChild(style);
}

type Props = {
  incidents: LiveIncidentMapItem[];
  onlineUsers?: OnlineUserMapMarker[];
  trackers?: TrackerMapMarker[];
  premises?: PremiseMapMarker[];
  highlightId?: number | null;
  highlightTrackerId?: number | null;
  highlightPremiseId?: string | null;
  focusedPremiseId?: string | null;
  onIncidentMarkerClick?: (incidentId: number) => void;
  onTrackerMarkerClick?: (trackerId: number) => void;
  onPremiseMarkerClick?: (premiseId: string) => void;
  className?: string;
  testId?: string;
  showMapControls?: boolean;
  overlay?: ReactNode;
  /** Default map centre when no incidents (control room: South Africa). */
  initialCenter?: google.maps.LatLngLiteral;
  initialZoom?: number;
  darkTheme?: boolean;
};

/** Subdued dark basemap for control-room dashboards. */
const CONTROL_ROOM_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1a2332" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8b9cb3" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a2332" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2a3544" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3d4f66" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1624" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

export const SA_MAP_DEFAULT = { lat: -29.0, lng: 25.0, zoom: 6 };

export function LiveIncidentsMap({
  incidents,
  onlineUsers = [],
  trackers = [],
  premises = [],
  highlightId,
  highlightTrackerId,
  highlightPremiseId,
  focusedPremiseId,
  onIncidentMarkerClick,
  onTrackerMarkerClick,
  onPremiseMarkerClick,
  className,
  testId = "map-live-incidents",
  showMapControls = false,
  overlay,
  initialCenter = SA_MAP_DEFAULT,
  initialZoom = SA_MAP_DEFAULT.zoom,
  darkTheme = false,
}: Props) {
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
  const teamMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const teamInfoRef = useRef<Map<string, string>>(new Map());
  const vehicleMarkersRef = useRef<Map<number, google.maps.Marker>>(new Map());
  const vehicleInfoRef = useRef<Map<number, string>>(new Map());
  const premiseCirclesRef = useRef<Map<string, google.maps.Circle>>(new Map());
  const premiseMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const premiseInfoRef = useRef<Map<string, string>>(new Map());
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const trafficLayerRef = useRef<google.maps.TrafficLayer | null>(null);
  const lastFitSignatureRef = useRef<string>("");
  /** After the user pans/zooms, do not auto-reset the viewport on poll ticks. */
  const userViewportLockedRef = useRef(false);
  const initialCenterRef = useRef(initialCenter);
  const initialZoomRef = useRef(initialZoom);

  useEffect(() => {
    initialCenterRef.current = initialCenter;
    initialZoomRef.current = initialZoom;
  }, [initialCenter, initialZoom]);

  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [mapsErrorMsg, setMapsErrorMsg] = useState<string | null>(null);
  const [mapsLoadAttempt, setMapsLoadAttempt] = useState(0);
  const [showTraffic, setShowTraffic] = useState(false);
  const [mapType, setMapType] = useState<"roadmap" | "hybrid">("roadmap");

  useEffect(() => {
    let cancelled = false;
    setMapsReady(false);
    setMapsError(false);
    setMapsErrorMsg(null);
    loadGoogleMaps()
      .then(() => {
        if (!cancelled) setMapsReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMapsError(true);
          setMapsErrorMsg(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mapsLoadAttempt]);

  useEffect(() => {
    if (!mapsReady || !mapRef.current || mapInstanceRef.current) return;
    if (darkTheme) ensureDarkInfoWindowStyles();
    const map = new google.maps.Map(mapRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      styles: darkTheme ? CONTROL_ROOM_MAP_STYLES : undefined,
    });
    mapInstanceRef.current = map;
    infoWindowRef.current = new google.maps.InfoWindow();
    map.addListener("dragstart", () => {
      userViewportLockedRef.current = true;
    });
    map.addListener("zoom_changed", () => {
      userViewportLockedRef.current = true;
    });
    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current.clear();
      markerInfoRef.current.clear();
      destMarkersRef.current.forEach((m) => m.setMap(null));
      destMarkersRef.current.clear();
      destInfoRef.current.clear();
      routeLinesRef.current.forEach((l) => l.setMap(null));
      routeLinesRef.current.clear();
      joinerMarkersRef.current.forEach((m) => m.setMap(null));
      joinerMarkersRef.current.clear();
      joinerInfoRef.current.clear();
      joinerDestMarkersRef.current.forEach((m) => m.setMap(null));
      joinerDestMarkersRef.current.clear();
      joinerRouteLinesRef.current.forEach((l) => l.setMap(null));
      joinerRouteLinesRef.current.clear();
      teamMarkersRef.current.forEach((m) => m.setMap(null));
      teamMarkersRef.current.clear();
      teamInfoRef.current.clear();
      premiseCirclesRef.current.forEach((c) => c.setMap(null));
      premiseCirclesRef.current.clear();
      premiseMarkersRef.current.forEach((m) => m.setMap(null));
      premiseMarkersRef.current.clear();
      premiseInfoRef.current.clear();
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
    const map = mapInstanceRef.current;
    if (!map) return;
    map.setMapTypeId(mapType);
    if (darkTheme) {
      map.setOptions({
        styles: mapType === "roadmap" ? CONTROL_ROOM_MAP_STYLES : [],
      });
    }
  }, [mapType, mapsReady, darkTheme]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const currentIds = new Set(incidents.map((i) => i.id));
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

    for (const inc of incidents) {
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
      const zIndex = isPanic ? 300 : inc.isEscalated ? 200 : 100;
      const name = getResponderName(inc);
      const duration = formatDuration(inc.liveStartedAt);
      const positionSource =
        inc.responderLat != null
          ? `GPS live (${formatTime(inc.responderPositionUpdatedAt)})`
          : "Reported location";
      const severityLabel =
        inc.severity === "red"
          ? "🔴 RED"
          : inc.severity === "orange"
            ? "🟠 ORANGE"
            : inc.severity === "yellow"
              ? "🟡 YELLOW"
              : null;
      const severityColor =
        inc.severity === "red"
          ? "#ef4444"
          : inc.severity === "orange"
            ? "#f97316"
            : inc.severity === "yellow"
              ? "#b45309"
              : "#374151";
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
          onIncidentMarkerClick?.(inc.id);
        });
        markerMap.set(inc.id, marker);
      }
    }

    const destMarkerMap = destMarkersRef.current;
    const destInfo = destInfoRef.current;
    for (const [id, m] of Array.from(destMarkerMap.entries())) {
      if (!currentIds.has(id)) {
        m.setMap(null);
        destMarkerMap.delete(id);
        destInfo.delete(id);
      }
    }
    for (const inc of incidents) {
      if (inc.destinationLat == null || inc.destinationLng == null) {
        const ex = destMarkerMap.get(inc.id);
        if (ex) {
          ex.setMap(null);
          destMarkerMap.delete(inc.id);
          destInfo.delete(inc.id);
        }
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
          if (iw && html) {
            iw.setContent(html);
            iw.open(map, dm);
          }
        });
        destMarkerMap.set(inc.id, dm);
      }
    }

    const joinerMarkerMap = joinerMarkersRef.current;
    const joinerInfo = joinerInfoRef.current;
    const activeJoinerKeys = new Set<string>();
    for (const inc of incidents) {
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
          jPos = { lat: baseLat + 0.00025 * (idx + 1), lng: baseLng + 0.00018 * (idx + 1) };
        }
        bounds.extend(jPos);
        hasBounds = true;
        const arrivedStr = r.arrivedAt
          ? `<div style="color:#16a34a;font-size:11px;font-weight:600">✅ Arrived ${formatTime(r.arrivedAt)}</div>`
          : "";
        const posStr =
          hasGps && r.lastPositionAt && !r.arrivedAt
            ? `<div style="color:#6b7280;font-size:11px">GPS: ${formatTime(r.lastPositionAt)}</div>`
            : !hasGps && !r.arrivedAt
              ? `<div style="color:#64748b;font-size:11px;font-weight:600">Awaiting GPS — shown near incident</div>`
              : "";
        const noteStr = r.arrivalNote
          ? `<div style="color:#374151;font-size:11px;margin-top:2px">${r.arrivalNote}</div>`
          : "";
        const jHtml = `<div style="min-width:160px;font-family:system-ui;font-size:13px;line-height:1.5;padding:2px 0"><div style="font-weight:700;margin-bottom:4px;font-size:14px">👥 ${r.firstName} ${r.lastName}</div><div style="color:#2563eb;font-size:11px;font-weight:600">Joiner on Incident #${inc.id}</div>${arrivedStr}${posStr}${noteStr}</div>`;
        joinerInfo.set(key, jHtml);
        const pendingGps = !hasGps;
        const labelText = r.firstName || "Joiner";
        const icon = makeJoinerMarkerIcon(labelText, pendingGps);
        const existingJ = joinerMarkerMap.get(key);
        if (existingJ) {
          existingJ.setPosition(jPos);
          existingJ.setIcon(icon);
          existingJ.setZIndex(pendingGps ? 85 : 90);
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
            if (iw && html) {
              iw.setContent(html);
              iw.open(map, jm);
            }
          });
          joinerMarkerMap.set(key, jm);
        }
      });
    }
    for (const [key, m] of Array.from(joinerMarkerMap.entries())) {
      if (!activeJoinerKeys.has(key)) {
        m.setMap(null);
        joinerMarkerMap.delete(key);
        joinerInfo.delete(key);
      }
    }

    const joinerDestMarkerMap = joinerDestMarkersRef.current;
    const joinerRouteLineMap = joinerRouteLinesRef.current;
    const activeJoinerDestKeys = new Set<string>();
    const activeJoinerRouteKeys = new Set<string>();
    for (const inc of incidents) {
      for (const r of inc.responders ?? []) {
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
              if (iw) {
                iw.setContent(html);
                iw.open(map, jdm);
              }
            });
            joinerDestMarkerMap.set(key, jdm);
          }
        }

        const effDestLat = r.destinationLat ?? inc.destinationLat;
        const effDestLng = r.destinationLng ?? inc.destinationLng;
        if (
          r.lastLat != null &&
          r.lastLng != null &&
          effDestLat != null &&
          effDestLng != null &&
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
              strokeColor: "#a855f7",
              strokeWeight: 2,
              strokeOpacity: 0,
              icons: [
                {
                  icon: { path: "M 0,-1 0,1", strokeOpacity: 0.7, strokeWeight: 2, scale: 3 },
                  offset: "0",
                  repeat: "16px",
                },
              ],
              zIndex: 8,
            });
            joinerRouteLineMap.set(routeKey, jLine);
          }
        }
      }
    }
    for (const [key, m] of Array.from(joinerDestMarkerMap.entries())) {
      if (!activeJoinerDestKeys.has(key)) {
        m.setMap(null);
        joinerDestMarkerMap.delete(key);
      }
    }
    for (const [key, l] of Array.from(joinerRouteLineMap.entries())) {
      if (!activeJoinerRouteKeys.has(key)) {
        l.setMap(null);
        joinerRouteLineMap.delete(key);
      }
    }

    const routeLineMap = routeLinesRef.current;
    for (const [id, line] of Array.from(routeLineMap.entries())) {
      if (!currentIds.has(id)) {
        line.setMap(null);
        routeLineMap.delete(id);
      }
    }
    for (const inc of incidents) {
      const rLat = inc.responderLat ?? inc.latitude;
      const rLng = inc.responderLng ?? inc.longitude;
      if (rLat == null || rLng == null || inc.destinationLat == null || inc.destinationLng == null) {
        const ex = routeLineMap.get(inc.id);
        if (ex) {
          ex.setMap(null);
          routeLineMap.delete(inc.id);
        }
        continue;
      }
      const path = [{ lat: rLat, lng: rLng }, { lat: inc.destinationLat, lng: inc.destinationLng }];
      const existingLine = routeLineMap.get(inc.id);
      if (existingLine) {
        existingLine.setPath(path);
      } else {
        const line = new google.maps.Polyline({
          path,
          map,
          strokeColor: "#2563eb",
          strokeWeight: 3,
          strokeOpacity: 0,
          icons: [
            {
              icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeWeight: 3, scale: 4 },
              offset: "0",
              repeat: "20px",
            },
          ],
          zIndex: 10,
        });
        routeLineMap.set(inc.id, line);
      }
    }

    if (hasBounds) {
      const signature = incidents
        .map((i) => i.id)
        .sort((a, b) => a - b)
        .join(",");
      if (signature !== lastFitSignatureRef.current) {
        lastFitSignatureRef.current = signature;
        userViewportLockedRef.current = false;
        try {
          map.fitBounds(bounds, 60);
          const listener = google.maps.event.addListenerOnce(map, "bounds_changed", () => {
            if ((map.getZoom() ?? 0) > 14) map.setZoom(14);
          });
          setTimeout(() => google.maps.event.removeListener(listener), 2000);
        } catch {
          /* ignore */
        }
      }
    } else if (incidents.length === 0 && !userViewportLockedRef.current) {
      if (lastFitSignatureRef.current !== "__empty__") {
        lastFitSignatureRef.current = "__empty__";
        map.setCenter(initialCenterRef.current);
        map.setZoom(initialZoomRef.current);
      }
    }
  }, [incidents, mapsReady, onIncidentMarkerClick]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapsReady) return;

    const teamMap = teamMarkersRef.current;
    const teamInfo = teamInfoRef.current;
    const activeIds = new Set(onlineUsers.map((u) => u.id));

    for (const [id, marker] of Array.from(teamMap.entries())) {
      if (!activeIds.has(id)) {
        marker.setMap(null);
        teamMap.delete(id);
        teamInfo.delete(id);
      }
    }

    for (const user of onlineUsers) {
      const pos = { lat: user.lat, lng: user.lng };
      const name = `${user.firstName} ${user.lastName}`.trim();
      const updated = user.lastPositionAt
        ? formatTime(user.lastPositionAt)
        : "Recently";
      const html = buildTeamInfoHtml(name, updated, darkTheme);
      teamInfo.set(user.id, html);

      const existing = teamMap.get(user.id);
      const icon = makeTeamMarkerIcon(user.firstName, user.lastName);
      if (existing) {
        existing.setPosition(pos);
        existing.setIcon(icon);
      } else {
        const marker = new google.maps.Marker({
          position: pos,
          map,
          icon,
          title: name,
          zIndex: 40,
        });
        marker.addListener("click", () => {
          const iw = infoWindowRef.current;
          const content = teamInfo.get(user.id);
          if (iw && content) {
            iw.setContent(content);
            iw.open(map, marker);
          }
        });
        teamMap.set(user.id, marker);
      }
    }
  }, [onlineUsers, mapsReady, darkTheme]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapsReady) return;

    const vehicleMap = vehicleMarkersRef.current;
    const vehicleInfo = vehicleInfoRef.current;
    const activeIds = new Set(trackers.map((t) => t.id));

    for (const [id, marker] of Array.from(vehicleMap.entries())) {
      if (!activeIds.has(id)) {
        marker.setMap(null);
        vehicleMap.delete(id);
        vehicleInfo.delete(id);
      }
    }

    for (const tracker of trackers) {
      const pos = { lat: tracker.lat, lng: tracker.lng };
      const status = tracker.motionStatus ?? "offline";
      const icon = makeVehicleMarkerIcon(
        status,
        tracker.heading,
        tracker.registration?.slice(0, 10) ?? tracker.label.split(" ")[0],
      );
      const html = buildVehicleInfoHtml(tracker, darkTheme);
      vehicleInfo.set(tracker.id, html);

      const existing = vehicleMap.get(tracker.id);
      if (existing) {
        existing.setPosition(pos);
        existing.setIcon(icon);
        existing.setZIndex(status === "moving" ? 42 : status === "idle" ? 40 : 36);
      } else {
        const marker = new google.maps.Marker({
          position: pos,
          map,
          icon,
          title: tracker.label,
          zIndex: status === "moving" ? 42 : status === "idle" ? 40 : 36,
        });
        marker.addListener("click", () => {
          onTrackerMarkerClick?.(tracker.id);
          const iw = infoWindowRef.current;
          const content = vehicleInfo.get(tracker.id);
          if (iw && content) {
            iw.setContent(content);
            iw.open(map, marker);
          }
        });
        vehicleMap.set(tracker.id, marker);
      }
    }
  }, [trackers, mapsReady, darkTheme, onTrackerMarkerClick]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapsReady) return;

    const circleMap = premiseCirclesRef.current;
    const markerMap = premiseMarkersRef.current;
    const infoMap = premiseInfoRef.current;
    const activeIds = new Set(premises.map((p) => p.id));

    for (const [id, circle] of Array.from(circleMap.entries())) {
      if (!activeIds.has(id)) {
        circle.setMap(null);
        circleMap.delete(id);
      }
    }
    for (const [id, marker] of Array.from(markerMap.entries())) {
      if (!activeIds.has(id)) {
        marker.setMap(null);
        markerMap.delete(id);
        infoMap.delete(id);
      }
    }

    premises.forEach((premise, index) => {
      const pos = { lat: premise.lat, lng: premise.lng };
      const color = premiseColorForIndex(index);
      const isFocused = focusedPremiseId === premise.id;
      const isDimmed = focusedPremiseId != null && !isFocused;
      const html = buildPremiseInfoHtml(premise, darkTheme);
      infoMap.set(premise.id, html);

      const existingCircle = circleMap.get(premise.id);
      const circleOpts = {
        strokeColor: color,
        strokeOpacity: isDimmed ? 0.25 : isFocused ? 1 : 0.9,
        strokeWeight: isFocused ? 3 : 2,
        fillColor: color,
        fillOpacity: isDimmed ? 0.03 : isFocused ? 0.18 : 0.1,
      };
      if (existingCircle) {
        existingCircle.setCenter(pos);
        existingCircle.setOptions(circleOpts);
      } else {
        const circle = new google.maps.Circle({
          map,
          center: pos,
          radius: PREMISE_COVERAGE_RADIUS_M,
          ...circleOpts,
          clickable: false,
          zIndex: isFocused ? 6 : 4,
        });
        circleMap.set(premise.id, circle);
      }

      const icon = makePremiseMarkerIcon(color);
      const existingMarker = markerMap.get(premise.id);
      if (existingMarker) {
        existingMarker.setPosition(pos);
        existingMarker.setIcon(icon);
        existingMarker.setTitle(premise.name);
      } else {
        const marker = new google.maps.Marker({
          position: pos,
          map,
          icon,
          title: premise.name,
          zIndex: 20,
        });
        marker.addListener("click", () => {
          onPremiseMarkerClick?.(premise.id);
          const iw = infoWindowRef.current;
          const content = infoMap.get(premise.id);
          if (iw && content) {
            iw.setContent(content);
            iw.open(map, marker);
          }
        });
        markerMap.set(premise.id, marker);
      }
    });
  }, [premises, mapsReady, darkTheme, onPremiseMarkerClick, focusedPremiseId]);

  useEffect(() => {
    if (!focusedPremiseId) return;
    const map = mapInstanceRef.current;
    const premise = premises.find((p) => p.id === focusedPremiseId);
    if (!map || !premise) return;
    const circle = new google.maps.Circle({
      center: { lat: premise.lat, lng: premise.lng },
      radius: PREMISE_COVERAGE_RADIUS_M,
    });
    const bounds = circle.getBounds();
    if (bounds) {
      userViewportLockedRef.current = false;
      map.fitBounds(bounds, 56);
      const listener = google.maps.event.addListenerOnce(map, "bounds_changed", () => {
        if ((map.getZoom() ?? 0) > 15) map.setZoom(15);
      });
      setTimeout(() => google.maps.event.removeListener(listener), 2000);
    }
  }, [focusedPremiseId, premises, mapsReady]);

  useEffect(() => {
    if (highlightId == null) return;
    const map = mapInstanceRef.current;
    const marker = markersRef.current.get(highlightId);
    if (!map || !marker) return;
    map.panTo(marker.getPosition()!);
    if ((map.getZoom() ?? 0) < 12) map.setZoom(12);
  }, [highlightId, incidents]);

  useEffect(() => {
    if (highlightTrackerId == null) return;
    const map = mapInstanceRef.current;
    const marker = vehicleMarkersRef.current.get(highlightTrackerId);
    if (!map || !marker) return;
    map.panTo(marker.getPosition()!);
    if ((map.getZoom() ?? 0) < 14) map.setZoom(14);
    const iw = infoWindowRef.current;
    const content = vehicleInfoRef.current.get(highlightTrackerId);
    if (iw && content) {
      iw.setContent(content);
      iw.open(map, marker);
    }
  }, [highlightTrackerId, trackers]);

  useEffect(() => {
    if (highlightPremiseId == null) return;
    const map = mapInstanceRef.current;
    const marker = premiseMarkersRef.current.get(highlightPremiseId);
    if (!map || !marker) return;
    map.panTo(marker.getPosition()!);
    if ((map.getZoom() ?? 0) < 12) map.setZoom(12);
    const iw = infoWindowRef.current;
    const content = premiseInfoRef.current.get(highlightPremiseId);
    if (iw && content) {
      iw.setContent(content);
      iw.open(map, marker);
    }
  }, [highlightPremiseId, premises]);

  const resetToDefaultView = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    userViewportLockedRef.current = false;
    lastFitSignatureRef.current = "__empty__";
    map.setCenter(initialCenterRef.current);
    map.setZoom(initialZoomRef.current);
  };

  const controlBtnClass = (active: boolean) =>
    cn(
      "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium shadow transition-colors border",
      darkTheme
        ? active
          ? "bg-emerald-700/90 text-white border-emerald-600/50"
          : "bg-slate-900/90 text-slate-200 border-slate-700/80 hover:bg-slate-800"
        : active
          ? "bg-blue-600 text-white border-transparent"
          : "bg-white/90 dark:bg-black/70 text-gray-700 dark:text-gray-200 border-transparent hover:bg-white dark:hover:bg-black/90",
    );

  return (
    <div className={cn("relative w-full h-full min-h-[200px]", className)} data-testid={testId}>
      {mapsError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/20 z-10">
          <div className="text-center px-6 py-8 space-y-3 max-w-sm">
            <MapPin className="h-8 w-8 mx-auto text-destructive/60" />
            <p className="text-sm font-medium">Map unavailable</p>
            <p className="text-xs text-muted-foreground break-words">
              {mapsErrorMsg ?? "Google Maps failed to load — contact your administrator."}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                resetGoogleMapsLoader();
                mapInstanceRef.current = null;
                setMapsLoadAttempt((n) => n + 1);
              }}
              data-testid="button-retry-map"
            >
              Retry map
            </Button>
          </div>
        </div>
      )}
      {!mapsReady && !mapsError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/10 z-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <div ref={mapRef} className="w-full h-full" />
      {mapsReady && !mapsError && incidents.length === 0 && onlineUsers.length === 0 && trackers.length === 0 && (
        <div
          className={cn(
            "absolute z-[5] pointer-events-none",
            darkTheme ? "bottom-3 left-3" : "inset-0 flex items-center justify-center",
          )}
          data-testid="map-empty-state"
        >
          {darkTheme ? (
            <div className="flex items-center gap-2 rounded-lg bg-slate-900/90 border border-slate-700/60 px-3 py-1.5 shadow-md">
              <MapPin className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              <p className="text-[11px] text-slate-400">No active incidents on map</p>
            </div>
          ) : (
            <div className="text-center px-6 py-5 rounded-xl bg-background/80 border max-w-[280px] shadow-lg">
              <MapPin className="h-8 w-8 mx-auto text-muted-foreground/60 mb-2" />
              <p className="text-sm font-medium">No active incidents</p>
              <p className="text-xs text-muted-foreground mt-1">
                Markers appear when responders go live.
              </p>
            </div>
          )}
        </div>
      )}
      {showMapControls && (
        <div className="absolute top-2 right-2 flex flex-col gap-1.5 z-10">
          <button
            type="button"
            onClick={() => setMapType((t) => (t === "roadmap" ? "hybrid" : "roadmap"))}
            className={controlBtnClass(mapType === "hybrid")}
            title="Satellite imagery with road and place labels"
            data-testid="button-toggle-satellite"
          >
            <Layers className="h-3.5 w-3.5" />
            {mapType === "hybrid" ? "Hybrid" : "Map"}
          </button>
          <button
            type="button"
            onClick={() => setShowTraffic((v) => !v)}
            className={controlBtnClass(showTraffic)}
            title="Toggle traffic layer"
            data-testid="button-toggle-traffic"
          >
            <Car className="h-3.5 w-3.5" />
            Traffic
          </button>
          <button
            type="button"
            onClick={resetToDefaultView}
            className={controlBtnClass(false)}
            title="Centre map on South Africa"
            data-testid="button-reset-map-view"
          >
            <Crosshair className="h-3.5 w-3.5" />
            Reset view
          </button>
        </div>
      )}
      {overlay}
    </div>
  );
}
