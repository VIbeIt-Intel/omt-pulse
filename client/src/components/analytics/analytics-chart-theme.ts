/** Shared Recharts theme + colour helpers for Analytics. */

import type { CSSProperties } from "react";

export const ANALYTICS_TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
};

export const ANALYTICS_GRID = {
  strokeDasharray: "3 3",
  stroke: "hsl(var(--border))",
  opacity: 0.45,
} as const;

export const ANALYTICS_ANIMATION_MS = 650;

/** Rolex-green intensity scale for count-based bars (higher count = brighter). */
export function intensityFill(value: number, max: number): string {
  if (max <= 0 || value <= 0) return "hsl(155 40% 18%)";
  const t = Math.min(1, value / max);
  const lightness = 18 + t * 28; // 18% → 46%
  const sat = 70 + t * 30;
  return `hsl(155 ${sat}% ${lightness}%)`;
}

export function chartOpacity(selected: boolean, anySelected: boolean): number {
  if (!anySelected) return 1;
  return selected ? 1 : 0.28;
}

/** Dark control-room basemap for Analytics Map View (Rolex-green water tint). */
export const ANALYTICS_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#121a18" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8fa89c" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#121a18" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#2a3d35" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1e2c27" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2d463c" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#006039" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a1612" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#15221c" }] },
] as google.maps.MapTypeStyle[];

export const ANALYTICS_MAP_HEIGHT = "min(70vh, 720px)";
