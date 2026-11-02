import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, MapPin } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import { MapPicker } from "@/components/map-picker";
import type { AuthUser } from "@/lib/auth-user";
import { acquirePanicLocation, hasPanicCoordinates, quickPanicLocationCheck, type PanicLocationResult } from "@/lib/panic-location";
import { openLocationSettings } from "@/lib/open-location-settings";
import { enqueueOutboxJob, isNetworkFailure } from "@/lib/offline-outbox";
import { FarmerPhotoPicker } from "@/components/farmer-photo-picker";
import { attachScenePhotos, queueScenePhotos, uploadScenePhotos } from "@/lib/scene-photos";
import { AttachmentPreview } from "@/components/attachment-preview";
import { haversineM } from "@shared/premises-geofence";
import { FarmerBrandverslag } from "@/components/farmer-brandverslag";

function formatFireDistance(
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

function fireStory(description: string | null): string {
  return (description ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("Vuur —") && !line.startsWith("Rapporteerder") && !line.startsWith("Vuur:"))
    .join("\n");
}

function firePlace(name: string | null | undefined): string {
  const place = name?.trim() ?? "";
  if (!place || place.toLowerCase() === "vuur") return "";
  if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(place)) return "";
  return place;
}

type FireRow = {
  id: number;
  userId: string | null;
  reporterFirstName: string | null;
  reporterLastName: string | null;
  description: string | null;
  locationName: string | null;
  createdAt: string;
  fireLat: number | null;
  fireLng: number | null;
};

export default function FarmerVuur() {
  const { t, lang } = useFarmerLang();
  const { toast } = useToast();
  const qc = useQueryClient();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const reportId = Number(new URLSearchParams(search).get("report"));
  const openReportId = Number.isFinite(reportId) && reportId > 0 ? reportId : null;
  const { data: user } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const { data: fires = [], isLoading: firesLoading } = useQuery<FireRow[]>({
    queryKey: ["/api/fire/active"],
    refetchInterval: 5000,
  });
  const { data: incidentDetail, isLoading: detailLoading } = useQuery<{
    description?: string | null;
    locationName?: string | null;
    destinationLat?: number | null;
    destinationLng?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    userId?: string | null;
    createdAt?: string;
  } | null>({
    queryKey: ["/api/incidents", openReportId],
    enabled: openReportId != null,
    queryFn: async () => {
      const res = await fetch(`/api/incidents/${openReportId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });
  const { data: reportFiles = [] } = useQuery<Array<{ id: number; url: string; mimeType: string | null; filename: string }>>({
    queryKey: ["/api/incidents", openReportId ?? 0, "attachments"],
    enabled: openReportId != null,
    queryFn: async () => {
      const res = await fetch(`/api/incidents/${openReportId}/attachments`, { credentials: "include", cache: "no-store" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const [going, setGoing] = useState(false);
  const [mode, setMode] = useState<"farm" | "smoke">("farm");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [wind, setWind] = useState<keyof typeof t.wind | null>(null);
  const [loc, setLoc] = useState<PanicLocationResult | null>(null);
  const [finding, setFinding] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [justSent, setJustSent] = useState<{ id: number; joined: boolean } | null>(null);
  const [verslag, setVerslag] = useState(() => import.meta.env.DEV && new URLSearchParams(window.location.search).get("verslag") === "1");
  const locationReady = loc != null && hasPanicCoordinates(loc);
  const ownFire = fires.find((fire) => fire.userId != null && fire.userId === user?.id) ?? null;

  useEffect(() => {
    if (import.meta.env.DEV) {
      const gps = new URLSearchParams(window.location.search).get("gps");
      if (gps === "off") {
        setLoc({ issue: "denied" });
        return;
      }
      if (gps === "on") {
        setLoc({ lat: -30.99, lng: 26.33 });
        return;
      }
    }
    let cancelled = false;
    const look = () => {
      void quickPanicLocationCheck().then((next) => {
        if (!cancelled) setLoc(next);
      });
    };
    look();
    const onVisible = () => {
      if (document.visibilityState === "visible") look();
    };
    document.addEventListener("visibilitychange", onVisible);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  async function showWhereIAm() {
    setFinding(true);
    try {
      const next = await acquirePanicLocation();
      setLoc(next);
      if (hasPanicCoordinates(next)) return;
      await openLocationSettings();
    } finally {
      setFinding(false);
    }
  }

  const send = useMutation({
    mutationFn: async () => {
      const foundPromise = acquirePanicLocation();
      let queuedPromise: ReturnType<typeof queueScenePhotos> | null = null;
      const queuePhotos = () => {
        queuedPromise ??= photos.length > 0 ? queueScenePhotos(photos) : Promise.resolve([]);
        return queuedPromise;
      };
      const reporterFrom = (found: PanicLocationResult) =>
        hasPanicCoordinates(found) ? { reporterLat: found.lat, reporterLng: found.lng } : {};
      const droppedFrom = (found: PanicLocationResult) =>
        mode === "smoke" && pin
          ? { fireLat: pin.lat, fireLng: pin.lng }
          : mode === "smoke" && hasPanicCoordinates(found)
            ? { fireLat: found.lat, fireLng: found.lng }
            : {};
      const keep = async () => {
        const [found, queuedPhotos] = await Promise.all([foundPromise, queuePhotos()]);
        await enqueueOutboxJob({
          type: "fire",
          ...reporterFrom(found),
          ...droppedFrom(found),
          note: note.trim() || undefined,
          wind: wind ?? undefined,
          photos: queuedPhotos,
          photoDataUrl: queuedPhotos[0]?.dataUrl,
          photoName: queuedPhotos[0]?.name,
        });
        return { joined: false, incidentId: 0, queued: true as const };
      };
      if (!navigator.onLine) return keep();
      try {
        const [found, uploaded] = await Promise.all([
          foundPromise,
          photos.length > 0 ? uploadScenePhotos(photos) : Promise.resolve([]),
        ]);
        const first = uploaded[0];
        const body = {
          ...reporterFrom(found),
          ...droppedFrom(found),
          note: note.trim() || undefined,
          wind: wind ?? undefined,
        };
        const res = await apiRequest("POST", "/api/fire", first ? { ...body, photo: first } : body);
        const data = await res.json() as { joined: boolean; incidentId: number; photoStored?: boolean };
        if (data.incidentId && uploaded.length > 0) {
          await attachScenePhotos(data.incidentId, uploaded, Boolean(data.photoStored));
        }
        return { ...data, queued: false as const };
      } catch (err) {
        if (!isNetworkFailure(err)) throw err;
        return keep();
      }
    },
    onSuccess: (data) => {
      setNote("");
      setWind(null);
      setPhotos([]);
      if (data.queued) {
        toast({ title: t.savedOnPhone, description: t.sendsWhenSignal });
        return;
      }
      qc.invalidateQueries({ queryKey: ["/api/fire/active"] });
      if (data.incidentId) setJustSent({ id: data.incidentId, joined: data.joined });
      toast({ title: data.joined ? t.fireJoined : t.fireSent });
    },
    onError: (err: Error) => {
      toast({ title: t.vuur, description: err.message, variant: "destructive" });
    },
  });

  const close = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/fire/${id}/close`, {});
    },
    onSuccess: () => {
      setJustSent(null);
      qc.invalidateQueries({ queryKey: ["/api/fire/active"] });
    },
  });

  if (verslag) {
    const whoName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
    const phone = (user as { contactNumber?: string | null } | undefined)?.contactNumber ?? "";
    return (
      <FarmerBrandverslag
        name={whoName}
        contact={phone}
        fireAt={ownFire?.createdAt ?? null}
        onBack={() => setVerslag(false)}
      />
    );
  }

  if (openReportId != null) {
    const listed = fires.find((fire) => fire.id === openReportId) ?? null;
    const opened = listed || incidentDetail
      ? {
          id: openReportId,
          userId: listed?.userId ?? incidentDetail?.userId ?? null,
          reporterFirstName: listed?.reporterFirstName ?? null,
          reporterLastName: listed?.reporterLastName ?? null,
          description: listed?.description ?? incidentDetail?.description ?? null,
          locationName: listed?.locationName ?? incidentDetail?.locationName ?? null,
          createdAt: listed?.createdAt ?? incidentDetail?.createdAt ?? "",
          fireLat: listed?.fireLat ?? incidentDetail?.destinationLat ?? incidentDetail?.latitude ?? null,
          fireLng: listed?.fireLng ?? incidentDetail?.destinationLng ?? incidentDetail?.longitude ?? null,
        }
      : null;
    const who = opened ? [opened.reporterFirstName, opened.reporterLastName].filter(Boolean).join(" ") : "";
    const when = opened?.createdAt
      ? new Date(opened.createdAt).toLocaleString(lang === "af" ? "af-ZA" : "en-ZA", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    const place = firePlace(opened?.locationName);
    const story = fireStory(opened?.description ?? null);
    const mine = !!opened && !!user?.id && opened.userId === user.id;
    return (
      <div className="flex h-full min-h-0 flex-col bg-background" data-testid="page-farmer-vuur-report">
        <div className="mx-auto min-h-0 w-full max-w-lg flex-1 overflow-y-auto overscroll-y-contain px-6 py-8">
          <Flame className="h-8 w-8 text-orange-600" />
          {opened ? (
            <>
              <h1 className="mt-4 text-3xl font-bold">{t.vuur}</h1>
              {who && <p className="mt-2 text-base">{t.reportedBy} {who}</p>}
              {when && <p className="mt-1 text-sm text-muted-foreground">{when}</p>}
              {place && <p className="mt-3 text-sm">{place}</p>}
              {opened.fireLat != null && opened.fireLng != null && loc?.issue !== "denied" && loc?.issue !== "unsupported" && (
                <p className="mt-2 text-lg font-semibold" data-testid="text-fire-distance">
                  {locationReady
                    ? formatFireDistance(
                        haversineM(
                          { lat: loc.lat, lng: loc.lng },
                          { lat: opened.fireLat, lng: opened.fireLng },
                        ),
                        lang,
                        t,
                      )
                    : t.crimeDistanceWait}
                </p>
              )}
              {story && <p className="mt-3 whitespace-pre-wrap text-base">{story}</p>}
              {reportFiles.length > 0 && (
                <div className="mt-4 space-y-2" data-testid="fire-report-photos">
                  {reportFiles.map((file) => (
                    <AttachmentPreview key={file.id} large url={file.url} alt={file.filename} mimeType={file.mimeType} filename={file.filename} />
                  ))}
                </div>
              )}
              {!mine && opened.fireLat != null && opened.fireLng != null && (
                <button
                  type="button"
                  disabled={going}
                  onClick={() => {
                    setGoing(true);
                    try {
                      sessionStorage.removeItem("omt_pin_nav");
                      sessionStorage.setItem("omt_join_label", JSON.stringify({
                        id: opened.id,
                        name: who,
                        category: "Vuur",
                      }));
                    } catch { /* ignore */ }
                    setLocation(`/live-incident?join=${opened.id}`);
                  }}
                  className="mt-6 h-14 w-full rounded-2xl bg-orange-600 font-bold text-white disabled:opacity-50"
                  data-testid="button-fire-go"
                >
                  {t.fireGo}
                </button>
              )}
              {mine && (
                <button
                  type="button"
                  disabled={close.isPending}
                  onClick={() => close.mutate(opened.id, { onSuccess: () => setLocation("/") })}
                  className="mt-6 h-14 w-full rounded-2xl bg-orange-600 font-bold text-white disabled:opacity-50"
                  data-testid="button-fire-report-close"
                >
                  {t.closeFire}
                </button>
              )}
              <button
                type="button"
                onClick={() => setVerslag(true)}
                className="mt-3 h-14 w-full rounded-2xl border border-orange-600 font-bold text-orange-700"
                data-testid="button-brand-open"
              >
                {t.brandOpen}
              </button>
            </>
          ) : (
            <p className="mt-4 text-base">{firesLoading || detailLoading ? t.crimeLoading : t.crimeMissing}</p>
          )}
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="mt-8 h-14 w-full rounded-2xl bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900"
            data-testid="button-fire-back"
          >
            {t.crimeBack}
          </button>
        </div>
      </div>
    );
  }

  if (justSent || ownFire) {
    const sentAt = ownFire?.createdAt
      ? new Date(ownFire.createdAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })
      : new Date().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
    return (
      <div className="flex h-full items-center justify-center bg-[#f4f1ea] p-5" data-testid="page-farmer-vuur-reported">
        <div className="w-full max-w-[340px] rounded-[1.6rem] bg-white px-5 py-6 text-center text-zinc-900 shadow-2xl">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-orange-600/15 text-orange-700">
            <Flame className="h-6 w-6" />
          </span>
          <h1 className="mt-3 text-xl font-bold tracking-tight">{justSent?.joined && !ownFire ? t.fireJoined : t.fireReportedTitle}</h1>
          <p className="mx-auto mt-2 max-w-[300px] text-sm leading-relaxed text-zinc-600">{t.fireReportedBody}</p>
          <p className="mt-2 text-xs text-zinc-500">{t.panicSentAt} {sentAt}</p>
          <button
            type="button"
            disabled={!(ownFire?.id ?? justSent?.id) || close.isPending}
            onClick={() => {
              const id = ownFire?.id ?? justSent?.id;
              if (id) close.mutate(id);
            }}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-orange-600 text-sm font-semibold text-white disabled:opacity-60"
            data-testid="button-close-own-fire"
          >
            {t.closeFire}
          </button>
          <button
            type="button"
            onClick={() => setVerslag(true)}
            className="mt-3 flex h-12 w-full items-center justify-center rounded-xl border border-orange-600 text-sm font-semibold text-orange-700"
            data-testid="button-brand-open"
          >
            {t.brandOpen}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[#f8f3ee]" data-testid="page-farmer-vuur">
      <div className="mx-auto max-w-lg space-y-4 px-4 py-4">
        <div className="flex items-center gap-3 rounded-[1.6rem] bg-gradient-to-r from-[#ff9a2e] to-[#c2410c] px-4 py-4 text-white shadow-[0_16px_40px_-18px_rgba(234,88,12,0.9)]">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-black/15">
            <Flame className="h-6 w-6" />
          </span>
          <span className="min-w-0">
            <h1 className="text-xl font-bold leading-tight">{t.reportFire}</h1>
            <p className="mt-0.5 text-sm text-white/85">{t.vuurHint}</p>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("farm")}
            className={`h-12 rounded-2xl text-sm font-semibold ${mode === "farm" ? "bg-orange-600 text-white" : "border border-orange-200 bg-white text-orange-950"}`}
            data-testid="button-fire-on-farm"
          >
            {t.onMyFarm}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("smoke");
              if (pin) return;
              void acquirePanicLocation().then((loc) => {
                if (hasPanicCoordinates(loc)) setPin({ lat: loc.lat, lng: loc.lng });
              });
            }}
            className={`h-12 rounded-2xl text-sm font-semibold ${mode === "smoke" ? "bg-orange-600 text-white" : "border border-orange-200 bg-white text-orange-950"}`}
            data-testid="button-fire-smoke"
          >
            {t.seeSmoke}
          </button>
        </div>

        {loc != null && locationReady && (
          <div className="flex items-start gap-2 rounded-2xl border border-green-600/40 bg-green-600/10 px-4 py-3 text-sm text-green-800">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t.panicGps}</span>
          </div>
        )}
        {loc != null && !locationReady && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm">
              {t.panicLocationOff}
            </div>
            <p className="text-sm text-muted-foreground">{t.panicWhereHelp}</p>
            <button
              type="button"
              onClick={() => void showWhereIAm()}
              disabled={finding || send.isPending}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-60"
              data-testid="button-fire-where"
            >
              <MapPin className="h-4 w-4" />
              {finding ? t.panicWhereWait : t.panicWhereButton}
            </button>
          </div>
        )}

        {mode === "smoke" && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t.smokeHelp}</p>
            {pin ? (
              <MapPicker
                latitude={pin.lat}
                longitude={pin.lng}
                onLocationSelect={(lat, lng) => setPin({ lat, lng })}
                height="240px"
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t.gpsUsed}</p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-semibold text-orange-950">{t.windAsk}</p>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(t.wind) as Array<keyof typeof t.wind>).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setWind((current) => (current === key ? null : key))}
                className={`h-11 rounded-xl text-xs font-semibold ${wind === key ? "bg-orange-600 text-white" : "border border-orange-200 bg-white text-orange-950"}`}
                data-testid={`button-wind-${key}`}
              >
                {t.wind[key]}
              </button>
            ))}
          </div>
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t.note}
          rows={3}
          className="w-full rounded-2xl border border-orange-200 bg-white px-3 py-2 text-sm"
          data-testid="input-fire-note"
        />

        <FarmerPhotoPicker photos={photos} onChange={setPhotos} tone="fire" idPrefix="fire" />

        <button
          type="button"
          disabled={send.isPending || (mode === "smoke" && !pin && online)}
          onClick={() => send.mutate()}
          className="w-full h-14 rounded-2xl bg-orange-600 text-white font-bold disabled:opacity-50"
          data-testid="button-send-fire"
        >
          {send.isPending ? t.sending : t.sendFire}
        </button>

        <button
          type="button"
          onClick={() => setVerslag(true)}
          className="h-14 w-full rounded-2xl border border-orange-600 font-bold text-orange-700"
          data-testid="button-brand-open"
        >
          {t.brandOpen}
        </button>

        <section className="space-y-2 pt-2">
          <h2 className="text-sm font-semibold text-orange-950">{t.firesNow}</h2>
          {fires.length === 0 && <p className="text-sm text-muted-foreground">{t.noFires}</p>}
          {fires.map((fire) => {
            const name = [fire.reporterFirstName, fire.reporterLastName].filter(Boolean).join(" ") || t.vuur;
            const mine = fire.userId === user?.id;
            return (
              <div key={fire.id} className="flex items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-white p-3" data-testid={`card-fire-${fire.id}`}>
                <button
                  type="button"
                  onClick={() => setLocation(`/vuur?report=${fire.id}`)}
                  className="min-w-0 flex-1 text-left"
                  data-testid={`button-fire-report-${fire.id}`}
                >
                  <p className="font-semibold truncate">{mine ? t.you : name}</p>
                  <p className="text-xs text-muted-foreground">{t.fireView}</p>
                </button>
                <button
                  type="button"
                  onClick={() => close.mutate(fire.id)}
                  disabled={close.isPending}
                  className="shrink-0 h-10 px-3 rounded-xl bg-muted text-sm font-semibold"
                  data-testid={`button-close-fire-${fire.id}`}
                >
                  {t.closeFire}
                </button>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

/** Local look at the card a neighbour gets after tapping a vuur notification. */
export function FireAckPreview() {
  const { t, toggle } = useFarmerLang();
  const [, navigate] = useLocation();
  return (
    <div className="flex h-full items-center justify-center bg-zinc-950 p-5" data-testid="preview-fire-ack">
      <div className="w-full max-w-[340px] rounded-[1.6rem] bg-white px-5 py-6 text-center text-zinc-900 shadow-2xl">
        <div className="mb-1 flex justify-end">
          <button
            type="button"
            onClick={toggle}
            className="h-8 rounded-full border border-zinc-200 px-3 text-xs font-semibold"
          >
            {t.langLabel}
          </button>
        </div>
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-orange-600/15 text-orange-700">
          <Flame className="h-6 w-6" />
        </span>
        <h1 className="mt-3 text-xl font-bold tracking-tight">{t.fireAckAsk}</h1>
        <p className="mx-auto mt-2 max-w-[300px] text-sm leading-relaxed text-zinc-600">
          <span className="font-semibold text-zinc-900">Buurman</span> {t.fireAckNeeds}
        </p>
        <p className="mx-auto mt-2 max-w-[300px] text-sm font-medium text-zinc-800">{t.fireAckWind}</p>
        <p className="mx-auto mt-3 max-w-[300px] text-xs leading-relaxed text-zinc-500">{t.joinPanicHint}</p>
        <button
          type="button"
          onClick={() => navigate("/preview/farmer/vuur?going=1")}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-semibold text-white"
        >
          <Flame className="h-5 w-5" />
          {t.joinPanicYes}
        </button>
        <div className="mt-2 flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 text-sm font-medium">
          {t.joinPanicNo}
        </div>
      </div>
    </div>
  );
}

/** Local look at the map after Reageer nou on a vuur. */
export function FireGoingPreview() {
  const { t, toggle } = useFarmerLang();
  return (
    <div className="flex h-full flex-col bg-[#101410] text-white" data-testid="preview-fire-going">
      <header className="flex items-center gap-2 px-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">{t.joinGoing}</p>
          <p className="truncate text-[11px] text-white/60">{t.fireGoingTo}</p>
        </div>
        <button
          type="button"
          onClick={toggle}
          className="h-8 shrink-0 rounded-full border border-white/15 px-3 text-xs font-semibold"
        >
          {t.langLabel}
        </button>
        <span className="shrink-0 rounded-full bg-orange-600 px-2 py-0.5 text-[10px] font-bold">{t.joinGoingBadge}</span>
      </header>
      <div className="relative min-h-0 flex-1 bg-[#1a3326]">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 300 460" aria-hidden>
          <path d="M70 90 C 110 160, 90 220, 150 250 S 210 340, 230 390" fill="none" stroke="#fdba74" strokeWidth="4" strokeLinecap="round" />
        </svg>
        <span className="absolute left-[18%] top-[16%] h-3.5 w-3.5 rounded-full bg-blue-500 ring-4 ring-blue-500/30" />
        <span className="absolute bottom-[12%] right-[16%] flex flex-col items-center">
          <span className="rounded-full bg-orange-600 px-2 py-1 text-[10px] font-bold">Vuur</span>
          <span className="mt-1 h-3 w-3 rotate-45 bg-orange-600" />
        </span>
      </div>
      <div className="px-4 py-4">
        <p className="text-lg font-semibold">12 km · {t.panicAbout} 20 min</p>
        <p className="mt-1 text-sm text-white/80">{t.fireAckWind}</p>
        <p className="mt-1 text-sm text-white/70">{t.joinGoingShare}</p>
      </div>
    </div>
  );
}

/** Local look at the vuur push the rest of the group receives. */
export function FireNoticePreview() {
  const { t } = useFarmerLang();
  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[#24312b] to-[#0c100e] text-white" data-testid="preview-fire-notice">
      <p className="pt-16 text-center text-5xl font-light tracking-tight">13:19</p>
      <p className="mt-1 text-center text-sm text-white/70">Donderdag 15 Okt</p>
      <div className="mx-4 mt-10 rounded-2xl bg-white p-3.5 text-zinc-900 shadow-2xl">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-orange-600">
            <Flame className="h-3 w-3 text-white" />
          </span>
          <span className="font-medium text-zinc-700">{t.appName}</span>
          <span className="ml-auto">nou</span>
        </div>
        <p className="mt-2 text-[15px] font-semibold leading-tight">VUUR — Buurman</p>
        <p className="mt-1 text-sm leading-snug text-zinc-700">
          Daar is 'n vuur in die gebied. Die wind waai na die noorde.
        </p>
      </div>
    </div>
  );
}
