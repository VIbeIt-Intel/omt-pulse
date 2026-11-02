import { Flame } from "lucide-react";
import { haversineM } from "@shared/premises-geofence";
import { useFarmerLang } from "@/hooks/use-farmer-lang";

export function fireAwayText(
  metres: number,
  lang: "af" | "en",
  t: { crimeHere: string; crimeMetresAway: string; crimeKmAway: string },
): string {
  if (metres < 80) return t.crimeHere;
  const locale = lang === "af" ? "af-ZA" : "en-ZA";
  if (metres < 1000) {
    const rounded = Math.max(10, Math.round(metres / 10) * 10);
    return t.crimeMetresAway.replace("{n}", rounded.toLocaleString(locale));
  }
  const km = metres / 1000;
  const digits = km < 10 ? 1 : 0;
  const shown = km.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return t.crimeKmAway.replace("{n}", shown);
}

export function metresBetween(
  here: { lat: number; lng: number } | null,
  lat: number | null | undefined,
  lng: number | null | undefined,
): number | null {
  if (!here || lat == null || lng == null) return null;
  return haversineM(here, { lat, lng });
}

export function FarmerFireChoice({
  name,
  distance,
  onReport,
  onGo,
  onIgnore,
  onClose,
}: {
  name?: string;
  distance?: string | null;
  onReport: () => void;
  onGo: () => void;
  onIgnore: () => void;
  onClose: () => void;
}) {
  const { t } = useFarmerLang();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-5"
      data-testid="sheet-fire-choice"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[340px] rounded-[1.6rem] bg-white px-5 py-6 text-center text-zinc-900 shadow-2xl"
        data-testid="card-farmer-fire-choice"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-orange-600/15 text-orange-700">
          <Flame className="h-6 w-6" />
        </span>
        <h1 className="mt-3 text-xl font-bold tracking-tight">{t.activeFire}</h1>
        {name ? <p className="mx-auto mt-2 max-w-[300px] text-sm font-semibold text-zinc-900">{name}</p> : null}
        {distance ? (
          <p className="mt-1 text-sm text-zinc-500" data-testid="text-fire-choice-distance">{distance}</p>
        ) : null}
        <button
          type="button"
          onClick={onReport}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 text-sm font-semibold"
          data-testid="button-fire-choice-report"
        >
          {t.fireView}
        </button>
        <button
          type="button"
          onClick={onGo}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-xl bg-orange-600 text-sm font-semibold text-white"
          data-testid="button-fire-choice-go"
        >
          {t.fireGo}
        </button>
        <button
          type="button"
          onClick={onIgnore}
          className="mt-2 flex h-11 w-full items-center justify-center text-sm font-semibold text-zinc-500"
          data-testid="button-fire-choice-ignore"
        >
          {t.fireIgnore}
        </button>
        <p className="mt-1 text-xs text-zinc-400">{t.fireIgnoreHint}</p>
      </div>
    </div>
  );
}
