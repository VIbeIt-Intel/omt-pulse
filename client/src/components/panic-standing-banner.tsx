import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Siren } from "lucide-react";
import type { AuthUser } from "@/lib/auth-user";
import { isOpenPanic, type LivePanicRow } from "@/lib/open-panic";

/**
 * Standing reminder for an open panic. Same job as the vuur bar:
 * it stays until the panic is closed, including after the lock-screen
 * alarm was ignored.
 */
export function PanicStandingBanner() {
  const [location] = useLocation();
  const { data: user } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const { data: live = [] } = useQuery<LivePanicRow[]>({
    queryKey: ["/api/incidents/live"],
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });
  const incoming = live.filter((row) => isOpenPanic(row) && row.userId !== user?.id);
  // Home already shows the large "Daar is paniek" card. A second bar here
  // squeezes that screen until the action tiles lose their labels.
  if (incoming.length === 0 || location === "/dashboard") return null;
  const latest = incoming[0];
  const name = [latest.responderFirstName, latest.responderLastName].filter(Boolean).join(" ");

  return (
    <Link
      href={`/live-incident?join=${latest.id}`}
      className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 text-sm font-semibold"
      data-testid="banner-panic-standing"
    >
      <Siren className="h-4 w-4 shrink-0" />
      <span className="truncate">PANIEK{name ? ` — ${name}` : ""}</span>
    </Link>
  );
}
