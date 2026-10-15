import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Flame, MessageSquare, ShieldAlert, Siren } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { clearCachedAuthUser } from "@/lib/auth-cache";
import type { AuthUser } from "@/lib/auth-user";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import { PanicConfirmOverlay } from "@/components/panic-confirm-overlay";

type FireRow = { id: number };

export default function FarmerHome() {
  const { t, toggle } = useFarmerLang();
  const [, navigate] = useLocation();
  const [panicOpen, setPanicOpen] = useState(false);
  const { data: user } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const { data: fires = [] } = useQuery<FireRow[]>({
    queryKey: ["/api/fire/active"],
    refetchInterval: 5000,
  });
  const { data: convos = [] } = useQuery<Array<{ unreadCount: number }>>({
    queryKey: ["/api/chat/conversations"],
    refetchInterval: 8000,
  });
  const unread = convos.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  async function signOut() {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
    } catch { /* still leave */ }
    clearCachedAuthUser();
    queryClient.clear();
    navigate("/login");
  }

  return (
    <div className="h-full overflow-y-auto bg-background" data-testid="page-farmer-home">
      <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">OMT</p>
          <h1 className="text-lg font-semibold truncate" data-testid="text-farmer-org">
            {user?.orgName || "Boerevereniging"}
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggle}
            className="h-9 px-3 rounded-full border border-border text-xs font-semibold"
            data-testid="button-farmer-lang"
          >
            {t.langLabel}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="h-9 px-3 rounded-full text-xs font-medium text-muted-foreground"
            data-testid="button-farmer-sign-out"
          >
            {t.signOut}
          </button>
        </div>
      </header>

      {fires.length > 0 && (
        <Link
          href="/vuur"
          className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl bg-orange-600 text-white px-4 py-3"
          data-testid="banner-active-fire"
        >
          <span className="flex items-center gap-2 font-semibold">
            <Flame className="h-5 w-5" />
            {t.activeFire}
          </span>
          <span className="text-sm">{t.openFire}</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 p-4">
        <Link
          href="/vuur"
          className="flex flex-col items-start justify-between min-h-[9.5rem] rounded-3xl bg-orange-600 text-white p-4 active:scale-[0.98] transition-transform"
          data-testid="tile-vuur"
        >
          <Flame className="h-8 w-8" />
          <span>
            <span className="block text-2xl font-bold">{t.vuur}</span>
            <span className="block text-sm text-white/80 mt-0.5">{t.vuurHint}</span>
          </span>
        </Link>
        <Link
          href="/misdaad"
          className="flex flex-col items-start justify-between min-h-[9.5rem] rounded-3xl bg-zinc-800 text-white p-4 active:scale-[0.98] transition-transform"
          data-testid="tile-misdaad"
        >
          <ShieldAlert className="h-8 w-8" />
          <span>
            <span className="block text-2xl font-bold">{t.misdaad}</span>
            <span className="block text-sm text-white/70 mt-0.5">{t.misdaadHint}</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setPanicOpen(true)}
          className="flex flex-col items-start justify-between min-h-[9.5rem] rounded-3xl bg-red-600 text-white p-4 text-left active:scale-[0.98] transition-transform"
          data-testid="tile-paniek"
        >
          <Siren className="h-8 w-8" />
          <span>
            <span className="block text-2xl font-bold">{t.paniek}</span>
            <span className="block text-sm text-white/80 mt-0.5">{t.paniekHint}</span>
          </span>
        </button>
        <Link
          href="/chat"
          className="relative flex flex-col items-start justify-between min-h-[9.5rem] rounded-3xl bg-primary text-primary-foreground p-4 active:scale-[0.98] transition-transform"
          data-testid="tile-chat"
        >
            {unread > 0 && (
              <span className="absolute top-3 right-3 min-w-6 h-6 px-1.5 rounded-full bg-white text-primary text-xs font-bold flex items-center justify-center">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
            <MessageSquare className="h-8 w-8" />
            <span>
              <span className="block text-2xl font-bold">{t.chat}</span>
              <span className="block text-sm opacity-80 mt-0.5">{t.chatHint}</span>
            </span>
        </Link>
      </div>

      <PanicConfirmOverlay
        open={panicOpen}
        onOpenChange={setPanicOpen}
        confirmTestId="button-farmer-panic-confirm"
        labels={{
          title: t.panicTitle,
          before: t.panicBefore,
          emphasis: t.panicEmphasis,
          after: t.panicAfter,
          confirm: t.panicConfirm,
          sending: t.panicSending,
          cancel: t.panicCancel,
          gpsReady: t.panicGps,
          locationOff: t.panicLocationOff,
          sendWithoutGps: t.panicSendAnyway,
          goBack: t.panicGoBack,
        }}
      />
    </div>
  );
}
