import { MapPin } from "lucide-react";
import { formatCoordLabel, type GeoMapView } from "@/components/incident-location-sheet";

type Props = {
  lat: number;
  lng: number;
  /** Display text; defaults to formatted coordinates. */
  label?: string;
  onOpenMap: (view: GeoMapView) => void;
  className?: string;
  decimals?: number;
  testId?: string;
  align?: "left" | "right";
};

export function CoordinateLink({
  lat,
  lng,
  label,
  onOpenMap,
  className = "",
  decimals = 5,
  testId,
  align = "left",
}: Props) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;

  const text = label ?? formatCoordLabel(la, ln, decimals);
  const mapTitle = label && !label.includes(",") ? `${label} — ${formatCoordLabel(la, ln, decimals)}` : text;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenMap({ lat: la, lng: ln, title: mapTitle });
      }}
      className={`text-primary hover:underline inline-flex items-center gap-1 touch-manipulation ${align === "right" ? "text-right ml-auto" : ""} ${className}`}
      data-testid={testId}
    >
      <span className="truncate">{text}</span>
      <MapPin className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
    </button>
  );
}
