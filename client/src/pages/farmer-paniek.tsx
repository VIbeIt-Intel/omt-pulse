import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import type { AuthUser } from "@/lib/auth-user";
import { hasPanicCoordinates, quickPanicLocationCheck, type PanicLocationResult } from "@/lib/panic-location";
import { haversineM } from "@shared/premises-geofence";

function formatDistance(
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

type PanicIncident = {
  id: number;
  userId?: string | null;
  isLive?: boolean;
  description?: string | null;
  createdAt?: string;
  latitude?: number | null;
  longitude?: number | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
  liveStartLat?: number | null;
  liveStartLng?: number | null;
  panicClosedAt?: string | null;
};

type PanicRecent = {
  id: number;
  userId: string | null;
  firstName: string;
  lastName: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
  panicClosedAt: string | null;
};

export default function FarmerPaniek() {
  const { t, lang } = useFarmerLang();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const reportId = Number(new URLSearchParams(search).get("report"));
  const openReportId = Number.isFinite(reportId) && reportId > 0 ? reportId : null;
  const { data: user } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const { data: incident, isLoading: incidentLoading } = useQuery<PanicIncident | null>({
    queryKey: ["/api/incidents", openReportId, "panic-view"],
    enabled: openReportId != null,
    queryFn: async () => {
      const res = await fetch(`/api/incidents/${openReportId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });
  const { data: recent = [] } = useQuery<PanicRecent[]>({
    queryKey: ["/api/panic/recent"],
    enabled: openReportId != null,
  });
  const [loc, setLoc] = useState<PanicLocationResult | null>(null);

  useEffect(() => {
    if (openReportId == null) {
      setLocation("/dashboard");
    }
  }, [openReportId, setLocation]);

  useEffect(() => {
    let cancelled = false;
    void quickPanicLocationCheck().then((next) => {
      if (!cancelled) setLoc(next);
    });
    return () => { cancelled = true; };
  }, [openReportId]);

  if (openReportId == null) return null;

  const named = recent.find((row) => row.id === openReportId) ?? null;
  const who = named ? `${named.firstName ?? ""} ${named.lastName ?? ""}`.trim() : "";
  const whenRaw = incident?.createdAt ?? named?.createdAt ?? "";
  const when = whenRaw
    ? new Date(whenRaw).toLocaleString(lang === "af" ? "af-ZA" : "en-ZA", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const lat = incident?.destinationLat ?? incident?.latitude ?? incident?.liveStartLat ?? named?.lat ?? null;
  const lng = incident?.destinationLng ?? incident?.longitude ?? incident?.liveStartLng ?? named?.lng ?? null;
  const mine = !!user?.id && (incident?.userId === user.id || named?.userId === user.id);
  const closed = !!(incident?.panicClosedAt || named?.panicClosedAt || incident?.isLive === false);
  const canGo = !mine && !closed && lat != null && lng != null;
  const loading = incidentLoading && !incident && !named;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="page-farmer-paniek">
      <div className="mx-auto min-h-0 w-full max-w-lg flex-1 overflow-y-auto overscroll-y-contain px-6 py-8">
        <AlertTriangle className="h-8 w-8 text-red-600" />
        {loading ? (
          <p className="mt-4 text-base">{t.crimeLoading}</p>
        ) : !incident && !named ? (
          <p className="mt-4 text-base">{t.crimeMissing}</p>
        ) : (
          <>
            <h1 className="mt-4 text-3xl font-bold">{t.panicView}</h1>
            {who && <p className="mt-2 text-base">{who}</p>}
            {when && <p className="mt-1 text-sm text-muted-foreground">{when}</p>}
            <p className="mt-3 text-base">{lang === "af" ? "Het paniek gestuur." : "Sent a panic."}</p>
            {lat != null && lng != null && loc?.issue !== "denied" && loc?.issue !== "unsupported" && (
              <p className="mt-2 text-lg font-semibold" data-testid="text-panic-distance">
                {loc && hasPanicCoordinates(loc)
                  ? formatDistance(haversineM({ lat: loc.lat, lng: loc.lng }, { lat, lng }), lang, t)
                  : t.crimeDistanceWait}
              </p>
            )}
            {lat == null && (
              <p className="mt-3 text-sm text-muted-foreground">
                {lang === "af" ? "Geen ligging nie." : "No location."}
              </p>
            )}
            {canGo && (
              <button
                type="button"
                onClick={() => {
                  try {
                    const pin = JSON.stringify({
                      lat,
                      lng,
                      name: who ? `🆘 ${who}` : "Paniek",
                    });
                    sessionStorage.setItem("omt_panic_target", pin);
                    localStorage.setItem("omt_panic_target", pin);
                    sessionStorage.setItem("omt_panic_go", String(openReportId));
                  } catch { /* the live page can still load the pin */ }
                  setLocation(`/live-incident?join=${openReportId}`);
                }}
                className="mt-6 h-14 w-full rounded-2xl bg-red-600 font-bold text-white"
                data-testid="button-panic-go"
              >
                {lang === "af" ? "Gaan na die paniek" : "Go to the panic"}
              </button>
            )}
          </>
        )}
        <button
          type="button"
          onClick={() => setLocation("/dashboard")}
          className="mt-8 h-14 w-full rounded-2xl bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900"
          data-testid="button-panic-look"
        >
          {canGo ? t.crimeLook : t.crimeBack}
        </button>
      </div>
    </div>
  );
}
