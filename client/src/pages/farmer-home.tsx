import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Flame, MessageSquare, PawPrint, ShieldAlert, Siren } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { clearCachedAuthUser } from "@/lib/auth-cache";
import type { AuthUser } from "@/lib/auth-user";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import { FarmerWeatherStrip } from "@/components/farmer-weather-strip";
import { PanicConfirmOverlay } from "@/components/panic-confirm-overlay";
import { OmtShield } from "@/components/omt-shield";
import { scheduleFarmerAlertCardPrompt } from "@/lib/omt-app-settings";
import { isOpenPanic, type LivePanicRow } from "@/lib/open-panic";
import { FarmerFireChoice, fireAwayText, metresBetween } from "@/components/farmer-fire-choice";
import { FarmerQuietButton } from "@/components/farmer-quiet-sheet";
import { FarmerProfileButton } from "@/components/farmer-profile-sheet";
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

export default function FarmerHome() {
  const { t, lang, toggle } = useFarmerLang();
  const [, navigate] = useLocation();
  const [panicOpen, setPanicOpen] = useState(false);
  const [fireChoiceId, setFireChoiceId] = useState<number | null>(null);
  const [previewIgnored, setPreviewIgnored] = useState(false);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [localName, setLocalName] = useState<string | null>(null);
  const [, setIgnoredTick] = useState(0);
  useEffect(() => {
    void syncIgnoredFiresFromPhone();
    return subscribeFireIgnored(() => setIgnoredTick((n) => n + 1));
  }, []);
  useEffect(() => {
    void quickPanicLocationCheck().then((loc) => {
      if (hasPanicCoordinates(loc)) setHere({ lat: loc.lat, lng: loc.lng });
    });
  }, []);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (new URLSearchParams(window.location.search).get("gps") === "off") setPanicOpen(true);
  }, []);
  useEffect(() => {
    scheduleFarmerAlertCardPrompt();
  }, []);
  const { data: user } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const { data: fires = [] } = useQuery<FireRow[]>({
    queryKey: ["/api/fire/active"],
    refetchInterval: 5000,
  });
  const { data: live = [] } = useQuery<LivePanicRow[]>({
    queryKey: ["/api/incidents/live"],
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });
  const previewBase = import.meta.env.DEV && window.location.pathname.startsWith("/preview/farmer");
  const vuurHref = previewBase ? "/preview/farmer/vuur" : "/vuur";
  const visibleFires = fires.filter((fire) => fire.userId === user?.id || !isFireIgnored(fire.id));
  const incomingFire = visibleFires.find((fire) => fire.userId !== user?.id);
  const openPanics = live.filter(isOpenPanic);
  const incomingPanic = openPanics.find((panic) => panic.userId !== user?.id) ?? openPanics[0];
  const { data: convos = [] } = useQuery<Array<{ unreadCount: number }>>({
    queryKey: ["/api/chat/conversations"],
    refetchInterval: 8000,
  });
  const unread = convos.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  const previewSent = import.meta.env.DEV && new URLSearchParams(window.location.search).get("sent") === "1";
  const previewParams = previewBase ? new URLSearchParams(window.location.search) : null;
  const previewFireChoice = previewParams?.get("fire") === "1";
  const previewPanic = previewParams?.get("panic") === "1";

  async function signOut() {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
    } catch { /* still leave */ }
    clearCachedAuthUser();
    queryClient.clear();
    navigate("/login");
  }

  if (previewSent) return <PanicSentPreview />;

  return (
    <div className="relative flex h-full w-full max-w-full flex-col overflow-hidden bg-[#f4f1ea] text-zinc-900" data-testid="page-farmer-home">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
      <div className="flex min-h-full flex-col">
      <header className="relative flex shrink-0 items-center gap-3.5 px-5 pt-6">
        <OmtShield className="h-16 w-16 rounded-[1.15rem] shadow-[0_10px_28px_rgba(0,96,57,0.28)] ring-1 ring-[#006039]/20" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#006039]">{t.appName}</p>
          <h1 className="truncate text-[1.35rem] font-semibold leading-tight tracking-tight" data-testid="text-farmer-welcome">
            {(user?.firstName?.trim() || localName || (previewBase ? "Nico" : ""))
              ? `${t.welcome} ${user?.firstName?.trim() || localName || "Nico"}`
              : t.welcome}
          </h1>
        </div>
        <FarmerQuietButton />
      </header>

      <div className="relative mt-4 flex shrink-0 items-center justify-end gap-2 px-5">
        <button
          type="button"
          onClick={toggle}
          className="h-9 rounded-full border border-zinc-300 bg-white px-3.5 text-xs font-semibold text-zinc-800"
          data-testid="button-farmer-lang"
        >
          {t.langLabel}
        </button>
        <FarmerProfileButton user={user} onLocalName={setLocalName} />
        <button
          type="button"
          onClick={() => void signOut()}
          className="h-9 rounded-full px-3 text-xs font-medium text-zinc-500"
          data-testid="button-farmer-sign-out"
        >
          {t.signOut}
        </button>
      </div>

      {(incomingPanic || previewPanic || visibleFires.length > 0 || (previewFireChoice && !previewIgnored)) && (
        <div className="relative mx-5 mt-4 flex shrink-0 flex-col gap-3">
          {(incomingPanic || previewPanic) && (
            <Link
              href={incomingPanic ? `/live-incident?join=${incomingPanic.id}` : "/preview/farmer/paniek"}
              className="flex items-center justify-between gap-3 rounded-2xl bg-red-600 px-4 py-3 text-white"
              data-testid="banner-active-panic"
            >
              <span className="flex items-center gap-2 font-semibold">
                <Siren className="h-5 w-5" />
                {t.activePanic}
              </span>
              <span className="text-sm">{t.openPanic}</span>
            </Link>
          )}
          {visibleFires.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (!incomingFire) {
                  navigate(vuurHref);
                  return;
                }
                setFireChoiceId(incomingFire.id);
              }}
              className="flex items-center justify-between gap-3 rounded-2xl bg-orange-600 px-4 py-3 text-left text-white"
              data-testid="banner-active-fire"
            >
              <span className="flex items-center gap-2 font-semibold">
                <Flame className="h-5 w-5" />
                {t.activeFire}
              </span>
              <span className="text-sm">{t.openFire}</span>
            </button>
          )}
          {previewFireChoice && visibleFires.length === 0 && !previewIgnored && (
            <button
              type="button"
              onClick={() => setFireChoiceId(-1)}
              className="flex items-center justify-between gap-3 rounded-2xl bg-orange-600 px-4 py-3 text-left text-white"
              data-testid="banner-active-fire"
            >
              <span className="flex items-center gap-2 font-semibold">
                <Flame className="h-5 w-5" />
                {t.activeFire}
              </span>
              <span className="text-sm">{t.openFire}</span>
            </button>
          )}
        </div>
      )}

      <FarmerWeatherStrip />

      {/* Keep a readable tile height when panic and fire notices are open.
          The page scrolls instead of crushing the labels. */}
      <div className="grid w-full min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] grid-rows-[minmax(9.25rem,1fr)_minmax(9.25rem,1fr)_auto] gap-3 px-4 pb-4 pt-4 min-h-[26.25rem]">
        <Link
          href={vuurHref}
          className="farmer-tile flex h-full min-h-[9.25rem] min-w-0 flex-col justify-between overflow-hidden rounded-[1.6rem] bg-gradient-to-br from-[#ff9a2e] to-[#c2410c] p-4 text-white shadow-[0_16px_40px_-18px_rgba(234,88,12,0.9)] active:scale-[0.98] transition-transform"
          data-testid="tile-vuur"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-black/15">
            <Flame className="h-6 w-6" />
          </span>
          <span className="min-w-0 shrink-0">
            <span className="farmer-tile-title block font-bold">{t.vuur}</span>
            <span className="farmer-tile-hint mt-1 block text-white/85">{t.vuurHint}</span>
          </span>
        </Link>
        <Link
          href={previewBase ? "/preview/farmer/misdaad" : "/misdaad"}
          className="farmer-tile flex h-full min-h-[9.25rem] min-w-0 flex-col justify-between overflow-hidden rounded-[1.6rem] bg-white p-4 text-zinc-900 shadow-[0_16px_40px_-24px_rgba(0,0,0,0.35)] ring-1 ring-zinc-200 active:scale-[0.98] transition-transform"
          data-testid="tile-misdaad"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-100">
            <ShieldAlert className="h-6 w-6" />
          </span>
          <span className="min-w-0 shrink-0">
            <span className="farmer-tile-title block font-bold">{t.misdaad}</span>
            <span className="farmer-tile-hint mt-1 block text-zinc-500">{t.misdaadHint}</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setPanicOpen(true)}
          className="farmer-tile flex h-full min-h-[9.25rem] min-w-0 flex-col justify-between overflow-hidden rounded-[1.6rem] bg-gradient-to-br from-[#f43f3f] to-[#9f1239] p-4 text-left text-white shadow-[0_16px_40px_-16px_rgba(220,38,38,0.85)] active:scale-[0.98] transition-transform"
          data-testid="tile-paniek"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-black/15">
            <Siren className="h-6 w-6" />
          </span>
          <span className="min-w-0 shrink-0">
            <span className="farmer-tile-title block font-bold">{t.paniek}</span>
            <span className="farmer-tile-hint mt-1 block text-white/85">{t.paniekHint}</span>
          </span>
        </button>
        <Link
          href={previewBase ? "/preview/farmer/boodskap" : "/chat"}
          className="farmer-tile relative flex h-full min-h-[9.25rem] min-w-0 flex-col justify-between overflow-hidden rounded-[1.6rem] bg-gradient-to-br from-[#14915a] to-[#006039] p-4 text-white shadow-[0_16px_40px_-16px_rgba(0,96,57,0.9)] active:scale-[0.98] transition-transform"
          data-testid="tile-chat"
        >
          {unread > 0 && (
            <span className="absolute right-3 top-3 flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-[#006039]">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-black/15">
            <MessageSquare className="h-6 w-6" />
          </span>
          <span className="min-w-0 shrink-0">
            <span className="farmer-tile-title block font-bold">{t.chat}</span>
            <span className="farmer-tile-hint mt-1 block text-white/80">{t.chatHint}</span>
          </span>
        </Link>
        <Link
          href={previewBase ? "/preview/farmer/misdaad?kind=roaming_livestock" : "/misdaad?kind=roaming_livestock"}
          className="farmer-tile col-span-2 flex min-h-0 min-w-0 shrink-0 items-center gap-3 overflow-hidden rounded-[1.6rem] bg-gradient-to-r from-[#b45309] to-[#92400e] px-4 py-3 text-white shadow-[0_16px_40px_-18px_rgba(180,83,9,0.85)] active:scale-[0.98] transition-transform"
          data-testid="tile-vee"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-black/15">
            <PawPrint className="h-6 w-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="farmer-vee-title block font-bold">{t.vee}</span>
            <span className="farmer-tile-hint mt-0.5 block text-white/85">{t.veeHint}</span>
          </span>
        </Link>
      </div>
      </div>
      </div>

      {(() => {
        if (previewFireChoice && fireChoiceId === -1) {
          return (
            <FarmerFireChoice
              name="Martin Engels"
              distance={t.crimeKmAway.replace("{n}", "84")}
              onClose={() => setFireChoiceId(null)}
              onReport={() => navigate("/preview/farmer/vuur?report=1")}
              onGo={() => navigate("/preview/farmer/vuur?going=1")}
              onIgnore={() => {
                setFireChoiceId(null);
                setPreviewIgnored(true);
              }}
            />
          );
        }
        const chosen = fires.find((fire) => fire.id === fireChoiceId);
        if (!chosen) return null;
        const name = [chosen.reporterFirstName, chosen.reporterLastName].filter(Boolean).join(" ");
        const reportHref = previewBase ? `/preview/farmer/vuur?report=${chosen.id}` : `/vuur?report=${chosen.id}`;
        const away = metresBetween(here, chosen.fireLat, chosen.fireLng);
        return (
          <FarmerFireChoice
            name={name}
            distance={away == null ? null : fireAwayText(away, lang, t)}
            onClose={() => setFireChoiceId(null)}
            onReport={() => navigate(reportHref)}
            onGo={() => navigate(`/live-incident?join=${chosen.id}`)}
            onIgnore={() => {
              ignoreFire(chosen.id);
              setFireChoiceId(null);
            }}
          />
        );
      })()}

      <PanicConfirmOverlay
        open={panicOpen}
        onOpenChange={setPanicOpen}
        light
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
          whereHelp: t.panicWhereHelp,
          whereButton: t.panicWhereButton,
          whereWait: t.panicWhereWait,
          sendWithoutGps: t.panicSendAnyway,
          goBack: t.panicGoBack,
        }}
      />
    </div>
  );
}

/** Local look at the screen she lands on after BEVESTIG. Same layout as the live paniek page. */
function PanicSentPreview() {
  const { t, toggle } = useFarmerLang();
  const [told, setTold] = useState(false);
  const coming = new URLSearchParams(window.location.search).get("coming") === "1";
  const sentAt = new Date().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <div className="flex h-full flex-col bg-white text-zinc-900" data-testid="preview-panic-sent">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-md">
          <ArrowLeft className="h-5 w-5" />
        </span>
        <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
        <span className="whitespace-nowrap text-base font-semibold">{t.panicLiveTitle}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            className="h-8 rounded-full border px-2.5 text-xs font-semibold"
            data-testid="button-panicker-lang"
          >
            {t.langLabel}
          </button>
          <span className="animate-pulse rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-semibold text-white">SOS</span>
        </span>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="rounded-lg border-2 border-red-600 bg-red-600/10 p-4 text-center">
          <AlertTriangle className="mx-auto mb-2 h-12 w-12 text-red-600" />
          <p className="text-lg font-bold text-red-700">{t.panicLiveBody}</p>
          <p className="mt-1 text-sm text-zinc-500">{t.panicSentAt} {sentAt}</p>
          <p className="mt-2 text-sm">{t.panicHelpOnWay}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          {coming ? (
            <p className="text-sm text-zinc-600">{t.panicHelpOnWay}</p>
          ) : (
            <>
              <p className="mb-2 text-sm font-semibold">{t.panicResponders} (0)</p>
              <p className="text-sm text-zinc-500">{t.panicNoResponders}</p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setTold(true)}
          disabled={told}
          className="inline-flex h-11 w-full items-center justify-center rounded-md border text-sm font-medium disabled:opacity-70"
        >
          {told ? t.panicSafeSent : t.panicImSafe}
        </button>
        <p className="text-center text-xs text-zinc-500">
          {t.panicSafeHint}
        </p>
      </div>
    </div>
  );
}
