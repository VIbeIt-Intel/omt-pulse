import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Flame, Sun, Wind } from "lucide-react";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import { hasPanicCoordinates, quickPanicLocationCheck } from "@/lib/panic-location";

type WeatherCondition = "clear" | "partly" | "cloudy" | "fog" | "rain" | "snow" | "thunder";
type WeatherWarning = "thunder" | "heavyRain" | "rain" | "wind" | "fire";

type WeatherBody = {
  tempC: number;
  condition: WeatherCondition;
  warning: WeatherWarning | null;
  place: string | null;
};

function weatherPicture(shown: { condition: WeatherCondition; warning: WeatherWarning | null }) {
  if (shown.warning === "thunder" || shown.condition === "thunder") return { Icon: CloudLightning, className: "text-amber-500" };
  if (shown.warning === "heavyRain" || shown.warning === "rain" || shown.condition === "rain") return { Icon: CloudRain, className: "text-sky-600" };
  if (shown.warning === "wind") return { Icon: Wind, className: "text-sky-700" };
  if (shown.warning === "fire") return { Icon: Flame, className: "text-orange-600" };
  if (shown.condition === "clear") return { Icon: Sun, className: "text-amber-500" };
  if (shown.condition === "partly") return { Icon: CloudSun, className: "text-amber-500" };
  if (shown.condition === "fog") return { Icon: CloudFog, className: "text-zinc-500" };
  if (shown.condition === "snow") return { Icon: CloudSnow, className: "text-sky-500" };
  return { Icon: Cloud, className: "text-zinc-500" };
}

export function FarmerWeatherStrip() {
  const { t } = useFarmerLang();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void quickPanicLocationCheck().then((loc) => {
      if (cancelled || !hasPanicCoordinates(loc)) return;
      setCoords({ lat: loc.lat, lng: loc.lng });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { data } = useQuery<WeatherBody>({
    queryKey: ["/api/weather", coords?.lat.toFixed(2), coords?.lng.toFixed(2)],
    enabled: coords != null,
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const params = new URLSearchParams({
        lat: String(coords!.lat),
        lng: String(coords!.lng),
      });
      const res = await fetch(`/api/weather?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("weather");
      return res.json();
    },
  });

  const previewSample = import.meta.env.DEV
    && typeof window !== "undefined"
    && window.location.pathname.startsWith("/preview/farmer")
    && !data;
  if (!data && !previewSample) return null;
  const shown = data ?? { tempC: 28, condition: "clear" as const, warning: null, place: "Pretoria" };

  const label = shown.warning ? t.weatherWarning[shown.warning] : t.weather[shown.condition];
  const tone = shown.warning === "thunder"
    ? "border-amber-300 bg-amber-50 text-amber-950"
    : shown.warning === "heavyRain" || shown.warning === "rain"
      ? "border-sky-300 bg-sky-50 text-sky-950"
      : shown.warning === "wind"
        ? "border-zinc-300 bg-white text-zinc-800"
        : shown.warning === "fire"
          ? "border-orange-300 bg-orange-50 text-orange-950"
          : "border-zinc-200 bg-white/80 text-zinc-700";
  const picture = weatherPicture(shown);

  return (
    <div
      className={`mx-5 mt-3 flex shrink-0 items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold ${tone}`}
      data-testid="farmer-weather"
    >
      <picture.Icon className={`h-5 w-5 shrink-0 ${picture.className}`} />
      <span className="min-w-0 truncate">{label} · {shown.tempC}°{shown.place ? ` · ${shown.place}` : ""}</span>
    </div>
  );
}
