import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Siren, ChevronRight } from "lucide-react";
import type { PanicAlert } from "./panic-banner";

// Pages that already mount a full <PanicBanner /> — on these we suppress the
// slim global bar (sound still plays) so we don't duplicate the alert UI.
const PAGES_WITH_FULL_BANNER = ["/", "/occurrence-book", "/dashboard"];
const DISMISSED_KEY = "dismissedPanicIds";

function readDismissed(): Set<number> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x: unknown) => typeof x === "number") : []);
  } catch {
    return new Set();
  }
}

type Props = {
  currentUserId: string | null | undefined;
};

export function PanicAlertSiren({ currentUserId }: Props) {
  // Re-read dismissed list when storage changes (PanicBanner writes it from
  // other pages). Polling keeps the slim bar honest without prop drilling.
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(readDismissed);
  useEffect(() => {
    const onStorage = () => setDismissedIds(readDismissed());
    window.addEventListener("storage", onStorage);
    const t = setInterval(onStorage, 3000);
    return () => { window.removeEventListener("storage", onStorage); clearInterval(t); };
  }, []);
  const [location, navigate] = useLocation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seenIdsRef = useRef<Set<number>>(new Set());
  const seededRef = useRef(false);

  const { data: alerts = [], isSuccess } = useQuery<PanicAlert[]>({
    queryKey: ["/api/panic/recent"],
    enabled: !!currentUserId,
    refetchInterval: currentUserId ? 5000 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  // Filter to active, not-self, not-dismissed alerts
  const liveAlerts = alerts.filter(
    (a) => !a.panicClosedAt && a.userId !== currentUserId && !dismissedIds.has(a.id),
  );

  // Play sound on truly new panics. Wait until the first fetch has arrived,
  // otherwise an empty list is treated as "seen" and the panic that loads a
  // moment later sounds the alarm just because the app was opened.
  useEffect(() => {
    if (!isSuccess) return;
    if (!seededRef.current) {
      for (const a of liveAlerts) seenIdsRef.current.add(a.id);
      seededRef.current = true;
      return;
    }
    const fresh = liveAlerts.filter((a) => !seenIdsRef.current.has(a.id));
    if (fresh.length === 0) return;
    for (const a of fresh) seenIdsRef.current.add(a.id);
    // Play the alarm; browsers that block autoplay just silently fail — the
    // banner + native push notification still fire.
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio("/alarm.mp3");
        audioRef.current.volume = 1.0;
      }
      let plays = 0;
      const a = audioRef.current;
      a.currentTime = 0;
      a.onended = () => {
        plays += 1;
        if (plays < 3) { a.currentTime = 0; void a.play().catch(() => {}); }
      };
      void a.play().catch(() => {});
    } catch {
      /* autoplay blocked — banner + native push will still alert */
    }
  }, [liveAlerts, isSuccess]);

  if (liveAlerts.length === 0) return null;
  // The farmer phone has a standing PANIEK bar that stays until the panic is closed.
  if (import.meta.env.VITE_FARMER_PHONE === "1") return null;
  if (PAGES_WITH_FULL_BANNER.includes(location)) return null;

  const top = liveAlerts[0];
  const extra = liveAlerts.length - 1;
  const farmerPhone = import.meta.env.VITE_FARMER_PHONE === "1";

  return (
    <button
      type="button"
      onClick={() => navigate("/")}
      className="w-full flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white text-sm font-semibold shadow shrink-0 animate-pulse hover:bg-red-700 transition-colors"
      data-testid="banner-panic-siren"
    >
      <Siren className="h-5 w-5 shrink-0" />
      <span className="flex-1 text-left truncate">
        {farmerPhone
          ? `PANIEK: ${top.firstName} ${top.lastName} het hulp nodig`
          : `PANIC: ${top.firstName} ${top.lastName} needs help`}
        {extra > 0 ? ` (+${extra})` : ""}
      </span>
      <span className="text-xs uppercase tracking-wider opacity-90 shrink-0">{farmerPhone ? "Maak oop" : "Open"}</span>
      <ChevronRight className="h-4 w-4 shrink-0" />
    </button>
  );
}
