import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import type { AuthUser } from "@/lib/auth-user";

type FireRow = {
  id: number;
  userId: string | null;
  reporterFirstName: string | null;
  reporterLastName: string | null;
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
  const incoming = fires.filter((f) => f.userId !== user?.id);
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
  }, [incomingKey, isFetched, user]);

  if (incoming.length === 0) return null;
  const latest = incoming[0];
  const name = [latest.reporterFirstName, latest.reporterLastName].filter(Boolean).join(" ");

  return (
    <Link
      href={`/live-incident?join=${latest.id}`}
      className="flex items-center gap-2 bg-orange-600 text-white px-4 py-2 text-sm font-semibold"
      data-testid="banner-fire-alert"
    >
      <Flame className="h-4 w-4 shrink-0" />
      <span className="truncate">VUUR{name ? ` — ${name}` : ""}</span>
    </Link>
  );
}
