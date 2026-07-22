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
