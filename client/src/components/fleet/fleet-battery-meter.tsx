import { useId } from "react";
import { cn } from "@/lib/utils";
import { batteryLevelTone } from "@/lib/fleet-intelligence";

type FleetBatteryMeterProps = {
  percent: number | null | undefined;
  size?: "sm" | "md";
  className?: string;
};

const TONE = {
  ok: {
    fill: "#34d399",
    stroke: "#34d399",
    glow: "0 0 8px rgba(52,211,153,0.55)",
    text: "text-emerald-400",
  },
  warn: {
    fill: "#fbbf24",
    stroke: "#fbbf24",
    glow: "0 0 8px rgba(251,191,36,0.5)",
    text: "text-amber-400",
  },
  crit: {
    fill: "#ef4444",
    stroke: "#ef4444",
    glow: "0 0 8px rgba(239,68,68,0.55)",
    text: "text-red-400",
  },
  unknown: {
    fill: "#64748b",
    stroke: "#94a3b8",
    glow: "none",
    text: "text-muted-foreground",
  },
} as const;

/**
 * Phone-style battery: outline, nub, and a fill bar.
 * Green above 40%, amber to 20%, then red.
 */
export function FleetBatteryMeter({ percent, size = "md", className }: FleetBatteryMeterProps) {
  const uid = `batt-${useId().replace(/:/g, "")}`;
  const tone = batteryLevelTone(percent);
  const palette = TONE[tone];
  const known = percent != null && Number.isFinite(percent);
  const clamped = known ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  const isSm = size === "sm";

  const bodyW = isSm ? 22 : 48;
  const bodyH = isSm ? 12 : 22;
  const stroke = isSm ? 1.4 : 2;
  const nubW = isSm ? 2 : 3;
  const nubH = isSm ? 5 : 9;
  const svgW = bodyW + nubW + 1;
  const pad = stroke + 1.2;
  const innerW = Math.max(0, bodyW - pad * 2);
  const innerH = Math.max(0, bodyH - pad * 2);
  const fillW = known ? (innerW * clamped) / 100 : 0;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <svg
        width={svgW}
        height={bodyH}
        viewBox={`0 0 ${svgW} ${bodyH}`}
        className={cn(tone === "crit" && known && "animate-pulse")}
        style={{ filter: known ? `drop-shadow(${palette.glow})` : undefined }}
        aria-label={known ? `Battery ${clamped} percent` : "Battery unknown"}
        role="img"
      >
        <defs>
          <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="55%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect
          x={stroke / 2}
          y={stroke / 2}
          width={bodyW - stroke}
          height={bodyH - stroke}
          rx={isSm ? 2.2 : 4}
          ry={isSm ? 2.2 : 4}
          fill="rgba(0,0,0,0.45)"
          stroke={palette.stroke}
          strokeWidth={stroke}
        />
        {fillW > 0.4 && (
          <rect
            x={pad}
            y={pad}
            width={fillW}
            height={innerH}
            rx={isSm ? 1 : 2}
            ry={isSm ? 1 : 2}
            fill={palette.fill}
          />
        )}
        {fillW > 0.4 && (
          <rect
            x={pad}
            y={pad}
            width={fillW}
            height={innerH * 0.45}
            rx={isSm ? 1 : 2}
            fill={`url(#${uid}-sheen)`}
          />
        )}
        {!isSm && (
          <text
            x={bodyW / 2}
            y={bodyH / 2 + 0.5}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="11"
            fontWeight="700"
            fill="#fff"
            stroke="rgba(0,0,0,0.55)"
            strokeWidth="2.4"
            paintOrder="stroke"
            style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
          >
            {known ? clamped : "—"}
          </text>
        )}
        <rect
          x={bodyW - 0.4}
          y={(bodyH - nubH) / 2}
          width={nubW}
          height={nubH}
          rx={1}
          fill={palette.stroke}
        />
      </svg>
      {isSm && (
        <span className={cn("text-xs font-bold tabular-nums leading-none", palette.text)}>
          {known ? clamped : "—"}
          {known && <span className="text-[9px] font-semibold">%</span>}
        </span>
      )}
    </span>
  );
}
