import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import type { AuthUser } from "@/lib/auth-user";
import { FarmerFireChoice, fireAwayText, metresBetween } from "@/components/farmer-fire-choice";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import { isFarmerQuiet } from "@/lib/farmer-quiet";
import { ignoreFire, isFireIgnored, subscribeFireIgnored, syncIgnoredFiresFromPhone } from "@/lib/farmer-fire-ignore";
import { hasPanicCoordinates, quickPanicLocationCheck } from "@/lib/panic-location";

type FireRow = {
  id: number;
  userId: string | null;
  reporterFirstName: string | null;
  reporterLastName: string | null;
  fireLat?: number | null;
  fireLng?: number | null;
};

const SEEN_KEY = "omt_fire_heard";

function heardIds(): number[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

/**
 * In-app tone for a new vuur. Distinct from the panic siren.
 * The lock-screen alert is the push; this covers an open app.
 */
export function FireAlertBanner() {
  const { data: user } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const { data: fires = [], isFetched } = useQuery<FireRow[]>({
    queryKey: ["/api/fire/active"],
    refetchInterval: 5000,
  });
  const primed = useRef(false);
  const [location, navigate] = useLocation();
  const [choosing, setChoosing] = useState(false);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [, setIgnoredTick] = useState(0);
  const { t, lang } = useFarmerLang();
  useEffect(() => {
    void syncIgnoredFiresFromPhone();
    return subscribeFireIgnored(() => setIgnoredTick((n) => n + 1));
  }, []);
  useEffect(() => {
    void quickPanicLocationCheck().then((loc) => {
      if (hasPanicCoordinates(loc)) setHere({ lat: loc.lat, lng: loc.lng });
    });
  }, []);
  const incoming = fires.filter((f) => f.userId !== user?.id && !isFireIgnored(f.id));
  const incomingKey = incoming.map((f) => f.id).join(",");

  useEffect(() => {
    if (!user || !isFetched) return;
    const heard = new Set(heardIds());
    const current = incomingKey ? incomingKey.split(",").map((id) => Number(id)) : [];
    if (!primed.current) {
      primed.current = true;
      for (const id of current) heard.add(id);
      sessionStorage.setItem(SEEN_KEY, JSON.stringify([...heard]));
      return;
    }
    const fresh = current.filter((id) => !heard.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) heard.add(id);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...heard]));
    if (!isFarmerQuiet()) {
    try {
      const audio = new Audio("/alarm.mp3");
      audio.volume = 1;
      let plays = 0;
      audio.onended = () => {
        plays += 1;
        if (plays < 3) {
          audio.currentTime = 0;
          void audio.play().catch(() => {});
        }
      };
      void audio.play().catch(() => {});
    } catch { /* autoplay */ }
    }
  }, [incomingKey, isFetched, user]);

  if (incoming.length === 0) return null;
  // The alarm above still runs. Home already shows "Daar brand 'n vuur",
  // and a second bar collapses the dashboard tiles.
  if (import.meta.env.VITE_FARMER_PHONE === "1" && location === "/dashboard") return null;
  const latest = incoming[0];
  const name = [latest.reporterFirstName, latest.reporterLastName].filter(Boolean).join(" ");

  return (
    <>
      <button
        type="button"
        onClick={() => setChoosing(true)}
        className="flex w-full items-center gap-2 bg-orange-600 px-4 py-2 text-left text-sm font-semibold text-white"
        data-testid="banner-fire-alert"
      >
        <Flame className="h-4 w-4 shrink-0" />
        <span className="truncate">VUUR{name ? ` — ${name}` : ""}</span>
      </button>
      {choosing && (
        <FarmerFireChoice
          name={name}
          distance={(() => {
            const away = metresBetween(here, latest.fireLat, latest.fireLng);
            return away == null ? null : fireAwayText(away, lang, t);
          })()}
          onClose={() => setChoosing(false)}
          onReport={() => navigate(`/vuur?report=${latest.id}`)}
          onGo={() => navigate(`/live-incident?join=${latest.id}`)}
          onIgnore={() => {
            ignoreFire(latest.id);
            setChoosing(false);
          }}
        />
      )}
    </>
  );
}
