import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Download, Home, MapPin, PawPrint, ShieldAlert, UserRound } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { downloadIncidentDocket, docketCopy, type DocketLang } from "@/lib/incident-docket";
import type { Incident } from "@shared/schema";
import type { IncidentWithMeta } from "@/lib/incident-display";
import { useToast } from "@/hooks/use-toast";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import type { AuthUser } from "@/lib/auth-user";
import { acquirePanicLocation, acquireReportLocation, hasPanicCoordinates, quickPanicLocationCheck, type PanicLocationResult } from "@/lib/panic-location";
import { openLocationSettings } from "@/lib/open-location-settings";
import { AttachmentPreview } from "@/components/attachment-preview";
import { FarmerPhotoPicker } from "@/components/farmer-photo-picker";
import { attachScenePhotos, queueScenePhotos, uploadScenePhotos } from "@/lib/scene-photos";
import { enqueueOutboxJob, isNetworkFailure } from "@/lib/offline-outbox";
import { haversineM } from "@shared/premises-geofence";

function formatCrimeDistance(
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

function DocketButton({
  busy,
  label,
  onClick,
  testId,
  tone,
}: {
  busy: boolean;
  label: string;
  onClick: () => void;
  testId: string;
  tone: "crime" | "livestock";
}) {
  const color = tone === "livestock"
    ? "border-[#b45309]/30 text-[#7c2d12]"
    : "border-[#1E3A5F]/25 text-[#1E3A5F]";
  return (
    <button
      type="button"
      disabled={busy}
      className={`mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border bg-white text-sm font-semibold disabled:opacity-60 ${color}`}
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Download className="h-4 w-4" />
      {label}
    </button>
  );
}

function reportNote(description: string | null, locationName: string | null): string {
  const place = locationName?.trim() ?? "";
  return (description ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== place && line !== `Plek: ${place}`)
    .join("\n");
}

const KINDS = ["stock_theft", "burglary", "suspicious_vehicle", "suspicious_person", "other"] as const;
type Kind = (typeof KINDS)[number] | "roaming_livestock";

function joinDots(parts: Array<string | false | undefined>): string {
  return parts.map((part) => (typeof part === "string" ? part.trim() : "")).filter(Boolean).join(" · ");
}

function labeledLine(label: string, value: string): string {
  const text = value.trim();
  return text ? `${label}: ${text}` : "";
}

function ChoiceRow({
  label,
  options,
  value,
  onChange,
  testId,
  tone,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
  testId: string;
  tone: "person" | "vehicle";
}) {
  const onClass = tone === "person" ? "bg-amber-800 text-white" : "bg-sky-900 text-white";
  const offClass = tone === "person"
    ? "bg-white text-amber-950 border border-amber-200"
    : "bg-white text-sky-950 border border-sky-200";
  return (
    <div className="space-y-2">
      <span className={`text-sm font-semibold ${tone === "person" ? "text-amber-950" : "text-sky-950"}`}>{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const on = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(on ? "" : opt.id)}
              className={`h-12 rounded-2xl px-4 text-sm font-semibold ${on ? onClass : offClass}`}
              data-testid={`${testId}-${opt.id}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LineField({
  label,
  value,
  onChange,
  placeholder,
  testId,
  caps,
  tone,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId: string;
  caps?: boolean;
  tone: "person" | "vehicle";
}) {
  return (
    <label className="block space-y-2">
      <span className={`text-sm font-semibold ${tone === "person" ? "text-amber-950" : "text-sky-950"}`}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(caps ? e.target.value.toUpperCase() : e.target.value)}
        placeholder={placeholder}
        autoCapitalize={caps ? "characters" : "sentences"}
        spellCheck={caps ? false : undefined}
        className={`h-12 w-full rounded-2xl border bg-white px-3 text-sm ${tone === "person" ? "border-amber-200 placeholder:text-amber-800/40" : "border-sky-200 placeholder:text-sky-800/40"}`}
        data-testid={testId}
      />
    </label>
  );
}

type CrimeRow = {
  id: number;
  userId: string | null;
  categoryName: string | null;
  description: string | null;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  reporterFirstName: string | null;
  reporterLastName: string | null;
  createdAt: string;
};

function incidentFromReport(row: CrimeRow, source?: Incident): IncidentWithMeta {
  const created = new Date(row.createdAt);
  const date = Number.isNaN(created.getTime()) ? "" : created.toISOString().slice(0, 10);
  const time = Number.isNaN(created.getTime())
    ? ""
    : created.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return {
    id: row.id,
    organizationId: source?.organizationId ?? "",
    userId: row.userId,
    incidentDate: source?.incidentDate || date,
    incidentTime: source?.incidentTime || time,
    locationId: source?.locationId ?? null,
    locationName: source?.locationName ?? row.locationName,
    latitude: source?.latitude ?? row.latitude,
    longitude: source?.longitude ?? row.longitude,
    customMapId: source?.customMapId ?? null,
    customMapX: source?.customMapX ?? null,
    customMapY: source?.customMapY ?? null,
    categoryId: source?.categoryId ?? null,
    otherCategoryNote: source?.otherCategoryNote ?? null,
    description: source?.description ?? row.description,
    customFields: source?.customFields ?? null,
    importBatchId: source?.importBatchId ?? null,
    isLive: source?.isLive ?? false,
    isEscalated: source?.isEscalated ?? false,
    liveStartedAt: source?.liveStartedAt ?? null,
    responderLat: source?.responderLat ?? null,
    responderLng: source?.responderLng ?? null,
    responderPositionUpdatedAt: source?.responderPositionUpdatedAt ?? null,
    responderArrivedAt: source?.responderArrivedAt ?? null,
    liveStartLat: source?.liveStartLat ?? null,
    liveStartLng: source?.liveStartLng ?? null,
    destinationName: source?.destinationName ?? null,
    destinationLat: source?.destinationLat ?? null,
    destinationLng: source?.destinationLng ?? null,
    liveEndedAt: source?.liveEndedAt ?? null,
    liveClosedManually: source?.liveClosedManually ?? null,
    liveConvertLat: source?.liveConvertLat ?? null,
    liveConvertLng: source?.liveConvertLng ?? null,
    liveEndLat: source?.liveEndLat ?? null,
    liveEndLng: source?.liveEndLng ?? null,
    severity: source?.severity ?? null,
    panicAcknowledgedAt: source?.panicAcknowledgedAt ?? null,
    panicAcknowledgedByUserId: source?.panicAcknowledgedByUserId ?? null,
    panicClosedAt: source?.panicClosedAt ?? null,
    closedByUserId: source?.closedByUserId ?? null,
    commandId: source?.commandId ?? null,
    createdAt: source?.createdAt ?? created,
    attachmentCount: 0,
    reporterFirstName: row.reporterFirstName,
    reporterLastName: row.reporterLastName,
  };
}

export default function FarmerMisdaad() {
  const { t, lang } = useFarmerLang();
  const { data: user } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const { toast } = useToast();
  const qc = useQueryClient();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const reportId = Number(params.get("report"));
  const openReportId = Number.isFinite(reportId) && reportId > 0 ? reportId : null;
  const lockedKind: Kind | null = params.get("kind") === "roaming_livestock" ? "roaming_livestock" : null;
  const [kind, setKind] = useState<Kind | null>(lockedKind);
  const [note, setNote] = useState("");
  const [sex, setSex] = useState("");
  const [race, setRace] = useState("");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [clothes, setClothes] = useState("");
  const [doing, setDoing] = useState("");
  const [colour, setColour] = useState("");
  const [colourOther, setColourOther] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [make, setMake] = useState("");
  const [reg, setReg] = useState("");
  const [direction, setDirection] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [loc, setLoc] = useState<PanicLocationResult | null>(null);
  const [finding, setFinding] = useState(false);
  const [going, setGoing] = useState(false);
  const [docketId, setDocketId] = useState<number | null>(null);
  const preview = import.meta.env.DEV && window.location.pathname.startsWith("/preview/farmer");
  const previewSample: CrimeRow[] = preview
    ? [{
        id: -1,
        userId: null,
        categoryName: lockedKind ? "Vee en Wilde Diere" : "Verdagte voertuig",
        description: lockedKind ? "Beeste op die werf." : "Wit bakkie, ABC 123 GP.",
        locationName: "Plaaspad",
        latitude: -30.99,
        longitude: 26.33,
        reporterFirstName: "Martin",
        reporterLastName: "Engels",
        createdAt: new Date().toISOString(),
      }]
    : [];
  const [distanceSettled, setDistanceSettled] = useState(false);
  const locationReady = loc != null && hasPanicCoordinates(loc);

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
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (openReportId == null || locationReady) return;
    if (loc?.issue === "denied" || loc?.issue === "unsupported") return;
    let cancelled = false;
    void acquireReportLocation().then((next) => {
      if (cancelled) return;
      if (hasPanicCoordinates(next)) setLoc(next);
      else setDistanceSettled(true);
    });
    return () => { cancelled = true; };
  }, [openReportId, locationReady, loc?.issue]);

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

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (new URLSearchParams(window.location.search).get("pic") !== "1") return;
    let cancelled = false;
    void (async () => {
      const res = await fetch("/marketing/cctv-gate-entrance.jpg");
      if (!res.ok || cancelled) return;
      const blob = await res.blob();
      if (cancelled) return;
      setPhotos([new File([blob], "foto.jpg", { type: blob.type || "image/jpeg" })]);
    })();
    return () => { cancelled = true; };
  }, []);

  const { data: reports = [], isLoading: reportsLoading } = useQuery<CrimeRow[]>({
    queryKey: ["/api/crime"],
    refetchInterval: 8000,
  });
  const [reportChecked, setReportChecked] = useState<number | null>(null);
  useEffect(() => {
    if (openReportId == null || reportChecked === openReportId) return;
    let cancel = false;
    // The crime list is cached and can be a few seconds behind a new report.
    // Refresh it before saying the verslag is missing.
    void qc.refetchQueries({ queryKey: ["/api/crime"] }).finally(() => {
      if (!cancel) setReportChecked(openReportId);
    });
    return () => { cancel = true; };
  }, [openReportId, reportChecked, qc]);
  const opened = openReportId == null ? null : reports.find((row) => row.id === openReportId) ?? null;
  const reportStillLoading = openReportId != null && !opened && (reportsLoading || reportChecked !== openReportId);
  const canGo = !!(
    opened
    && user?.id
    && opened.userId
    && opened.userId !== user.id
    && opened.latitude != null
    && opened.longitude != null
  );
  const goStarted = useRef(false);

  async function goToCrime(row: CrimeRow) {
    setGoing(true);
    try {
      await apiRequest("POST", `/api/crime/${row.id}/respond`, {});
      try {
        sessionStorage.removeItem("omt_pin_nav");
        const name = [row.reporterFirstName, row.reporterLastName].filter(Boolean).join(" ");
        sessionStorage.setItem("omt_join_label", JSON.stringify({
          id: row.id,
          name,
          category: row.categoryName,
        }));
      } catch { /* ignore */ }
      setLocation(`/live-incident?join=${row.id}`);
    } catch (err) {
      setGoing(false);
      toast({
        title: t.misdaad,
        description: err instanceof Error ? err.message : t.crimeMissing,
        variant: "destructive",
      });
    }
  }
  const { data: reportFiles = [] } = useQuery<Array<{ id: number; url: string; mimeType: string | null; filename: string }>>({
    queryKey: ["/api/incidents", openReportId ?? 0, "attachments"],
    enabled: openReportId != null,
    staleTime: 0,
    refetchInterval: openReportId != null ? 4000 : false,
    queryFn: async () => {
      const res = await fetch(`/api/incidents/${openReportId}/attachments`, { credentials: "include", cache: "no-store" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const personLabel = (id: string) => {
    const labels: Record<string, string> = {
      male: t.person.male,
      female: t.person.female,
      unknown: t.person.unknown,
      black: t.person.black,
      white: t.person.white,
      coloured: t.person.coloured,
      indian: t.person.indian,
      child: t.person.child,
      teen: t.person.teen,
      young: t.person.young,
      adult: t.person.adult,
      older: t.person.older,
      short: t.person.short,
      average: t.person.average,
      tall: t.person.tall,
    };
    return labels[id] ?? "";
  };
  const vehicleLabel = (id: string) => {
    const labels: Record<string, string> = {
      white: t.vehicle.white,
      black: t.vehicle.black,
      silver: t.vehicle.silver,
      grey: t.vehicle.grey,
      red: t.vehicle.red,
      blue: t.vehicle.blue,
      green: t.vehicle.green,
      yellow: t.vehicle.yellow,
      bakkie: t.vehicle.bakkie,
      car: t.vehicle.car,
      bike: t.vehicle.bike,
      truck: t.vehicle.truck,
      tractor: t.vehicle.tractor,
    };
    return labels[id] ?? "";
  };
  const builtSummary = kind === "suspicious_person"
    ? [
        joinDots([personLabel(sex), personLabel(race), personLabel(age)]),
        labeledLine(t.person.height, personLabel(height)),
        labeledLine(t.person.clothes, clothes),
        labeledLine(t.person.doingShort, doing),
      ].filter(Boolean).join("\n")
    : kind === "suspicious_vehicle"
      ? [
          joinDots([
            colour === "other" ? colourOther : vehicleLabel(colour),
            vehicleLabel(vehicleType),
            make,
          ]),
          labeledLine(t.vehicle.reg, reg),
          labeledLine(t.vehicle.direction, direction),
        ].filter(Boolean).join("\n")
      : "";
  const reportText = [builtSummary, note.trim()].filter(Boolean).join("\n").slice(0, 500);
  const needsSummary = kind === "suspicious_person" || kind === "suspicious_vehicle";

  function clearDetails() {
    setNote("");
    setSex("");
    setRace("");
    setAge("");
    setHeight("");
    setClothes("");
    setDoing("");
    setColour("");
    setColourOther("");
    setVehicleType("");
    setMake("");
    setReg("");
    setDirection("");
  }

  function chooseKind(next: Kind) {
    if (next !== kind) clearDetails();
    setKind(next);
  }

  const send = useMutation({
    mutationFn: async () => {
      if (!kind) throw new Error(t.crimeHelp);
      const locPromise = acquireReportLocation();
      let queuedPromise: ReturnType<typeof queueScenePhotos> | null = null;
      const queuePhotos = () => {
        queuedPromise ??= photos.length > 0 ? queueScenePhotos(photos) : Promise.resolve([]);
        return queuedPromise;
      };
      const queue = async () => {
        const [loc, queuedPhotos] = await Promise.all([locPromise, queuePhotos()]);
        const coords = hasPanicCoordinates(loc) ? { lat: loc.lat, lng: loc.lng } : {};
        await enqueueOutboxJob({
          type: "crime",
          kind,
          note: reportText || undefined,
          ...coords,
          photos: queuedPhotos,
          photoDataUrl: queuedPhotos[0]?.dataUrl,
          photoName: queuedPhotos[0]?.name,
        });
        return { queued: true as const };
      };
      if (!navigator.onLine) return queue();
      try {
        const [loc, uploaded] = await Promise.all([
          locPromise,
          photos.length > 0 ? uploadScenePhotos(photos) : Promise.resolve([]),
        ]);
        const coords = hasPanicCoordinates(loc) ? { lat: loc.lat, lng: loc.lng } : {};
        const first = uploaded[0];
        const body = { kind, note: reportText || undefined, ...coords };
        const res = await apiRequest("POST", "/api/crime", first ? { ...body, photo: first } : body);
        const saved = await res.json() as { incidentId: number; photoStored?: boolean };
        if (saved.incidentId && uploaded.length > 0) {
          await attachScenePhotos(saved.incidentId, uploaded, Boolean(saved.photoStored));
        }
        return { queued: false as const };
      } catch (err) {
        if (!isNetworkFailure(err)) throw err;
        return queue();
      }
    },
    onSuccess: (data) => {
      setKind(lockedKind);
      clearDetails();
      setPhotos([]);
      qc.invalidateQueries({ queryKey: ["/api/crime"] });
      toast(data.queued
        ? { title: t.savedOnPhone, description: t.sendsWhenSignal }
        : { title: t.crimeSent });
      setLocation("/dashboard");
    },
    onError: (err: Error) => {
      toast({ title: lockedKind ? t.vee : t.misdaad, description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (params.get("go") !== "1" || goStarted.current || !opened || !canGo) return;
    goStarted.current = true;
    void goToCrime(opened);
  }, [canGo, opened]);

  const listed = lockedKind
    ? reports.filter((row) => row.categoryName === "Vee en Wilde Diere" || row.categoryName === "Vee en Wildediere" || row.categoryName === "Wilde Diere")
    : reports;
  const shown = listed.length > 0 ? listed : previewSample;

  async function downloadDocket(row: CrimeRow) {
    if (docketId != null) return;
    const copy = docketCopy(lang as DocketLang);
    setDocketId(row.id);
    try {
      let source: Incident | undefined;
      if (row.id > 0) {
        const res = await fetch(`/api/incidents/${row.id}`, { credentials: "include", cache: "no-store" });
        if (!res.ok) throw new Error(t.docketFailed);
        source = await res.json() as Incident;
      }
      const incident = incidentFromReport(row, source);
      const place = incident.locationName?.trim()
        || (incident.latitude != null && incident.longitude != null
          ? `${incident.latitude.toFixed(5)}, ${incident.longitude.toFixed(5)}`
          : "—");
      const date = (incident.incidentDate || "").replaceAll("-", "/");
      await downloadIncidentDocket({
        incident,
        incidentNumber: date ? `${date}-${incident.id}` : String(incident.id),
        category: row.categoryName
          ? {
              id: source?.categoryId ?? 0,
              organizationId: source?.organizationId ?? "",
              name: row.categoryName,
              description: null,
              color: null,
              icon: null,
              isOther: false,
              isSystem: false,
              severity: incident.severity,
              commandId: incident.commandId,
            }
          : null,
        locationLabel: place,
        locations: [],
        lang: lang as DocketLang,
        skipRemote: row.id < 0,
        brand: "farmer",
      });
      toast({ title: t.docketSaved, description: copy.toastBody });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast({
        title: t.docketFailed,
        description: err instanceof Error ? err.message : copy.toastFailBody,
        variant: "destructive",
      });
    } finally {
      setDocketId(null);
    }
  }

  if (openReportId != null) {
    const who = opened ? [opened.reporterFirstName, opened.reporterLastName].filter(Boolean).join(" ") : "";
    const when = opened
      ? new Date(opened.createdAt).toLocaleString(lang === "af" ? "af-ZA" : "en-ZA", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    return (
      <div className="flex h-full min-h-0 flex-col bg-background" data-testid="page-farmer-misdaad-report">
        <div className="mx-auto min-h-0 w-full max-w-lg flex-1 overflow-y-auto overscroll-y-contain px-6 py-8">
          <ShieldAlert className="h-8 w-8" />
          {opened ? (
            <>
              <h1 className="mt-4 text-3xl font-bold">{opened.categoryName ?? t.misdaad}</h1>
              {who && <p className="mt-2 text-base">{t.reportedBy} {who}</p>}
              {when && <p className="mt-1 text-sm text-muted-foreground">{when}</p>}
              {(opened.locationName || (opened.latitude != null && opened.longitude != null)) && (
                <p className="mt-3 text-sm">
                  {opened.locationName
                    || `${opened.latitude!.toFixed(5)}, ${opened.longitude!.toFixed(5)}`}
                </p>
              )}
              {opened.latitude != null && opened.longitude != null && (locationReady || !distanceSettled) && loc?.issue !== "denied" && loc?.issue !== "unsupported" && (
                <p className="mt-2 text-lg font-semibold" data-testid="text-crime-distance">
                  {locationReady
                    ? formatCrimeDistance(
                        haversineM(
                          { lat: loc.lat, lng: loc.lng },
                          { lat: opened.latitude, lng: opened.longitude },
                        ),
                        lang,
                        t,
                      )
                    : t.crimeDistanceWait}
                </p>
              )}
              {reportNote(opened.description, opened.locationName) && (
                <p className="mt-3 whitespace-pre-wrap text-base">{reportNote(opened.description, opened.locationName)}</p>
              )}
              {reportFiles.map((file) => (
                <div key={file.id} className="mt-4 overflow-hidden rounded-2xl border border-border">
                  <AttachmentPreview large url={file.url} alt={file.filename} mimeType={file.mimeType} filename={file.filename} />
                </div>
              ))}
              {canGo && (
                <button
                  type="button"
                  disabled={going}
                  onClick={() => void goToCrime(opened)}
                  className="mt-6 h-14 w-full rounded-2xl bg-orange-600 font-bold text-white disabled:opacity-50"
                  data-testid="button-crime-go"
                >
                  {t.crimeGo}
                </button>
              )}
              <DocketButton
                busy={docketId === opened.id}
                label={docketId === opened.id ? t.downloadingDocket : t.downloadDocket}
                testId="button-crime-docket"
                tone={lockedKind ? "livestock" : "crime"}
                onClick={() => void downloadDocket(opened)}
              />
            </>
          ) : (
            <p className="mt-4 text-base">{reportStillLoading ? t.crimeLoading : t.crimeMissing}</p>
          )}
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="mt-8 h-14 w-full rounded-2xl bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900"
            data-testid="button-crime-back"
          >
            {canGo ? t.crimeLook : t.crimeBack}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full overflow-y-auto ${lockedKind ? "bg-[#f6f1ea]" : "bg-[#f4f6f8]"}`} data-testid="page-farmer-misdaad">
      <div className="px-4 py-4 space-y-4 max-w-lg mx-auto">
        {lockedKind ? (
          <div className="flex items-center gap-3 rounded-[1.6rem] bg-gradient-to-r from-[#b45309] to-[#92400e] px-4 py-4 text-white shadow-[0_16px_40px_-18px_rgba(180,83,9,0.85)]">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-black/15">
              <PawPrint className="h-6 w-6" />
            </span>
            <span className="min-w-0">
              <h1 className="text-xl font-bold leading-tight">{t.vee}</h1>
              <p className="mt-0.5 text-sm text-white/85">{t.veeHint}</p>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-[1.6rem] bg-[#1E3A5F] px-4 py-4 text-white shadow-[0_16px_40px_-18px_rgba(30,58,95,0.85)]">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15">
              <ShieldAlert className="h-6 w-6" />
            </span>
            <span className="min-w-0">
              <h1 className="text-xl font-bold leading-tight">{t.crimeTitle}</h1>
              <p className="mt-0.5 text-sm text-white/80">{t.crimeHelp}</p>
            </span>
          </div>
        )}
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
              data-testid="button-crime-where"
            >
              <MapPin className="h-4 w-4" />
              {finding ? t.panicWhereWait : t.panicWhereButton}
            </button>
          </div>
        )}

        {!lockedKind && (
          <div className="grid grid-cols-1 gap-2">
            {KINDS.map((key) => {
              const Icon = key === "stock_theft" ? PawPrint : key === "burglary" ? Home : key === "suspicious_vehicle" ? Car : key === "suspicious_person" ? UserRound : ShieldAlert;
              const on = kind === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => chooseKind(key)}
                  className={`flex h-12 items-center gap-3 rounded-2xl px-4 text-left text-sm font-semibold ${on ? "bg-[#1E3A5F] text-white" : "border border-[#d5deea] bg-white text-[#1E3A5F]"}`}
                  data-testid={`button-crime-${key}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {t.kinds[key]}
                </button>
              );
            })}
          </div>
        )}

        {kind === "suspicious_person" && (
          <div className="space-y-4 rounded-[1.4rem] border border-amber-300 bg-amber-50 p-4" data-testid="form-person">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-800 text-white">
                <UserRound className="h-6 w-6" />
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-bold text-amber-950">{t.describePerson}</span>
                <span className="mt-0.5 block text-sm leading-snug text-amber-900/80">{t.describePersonHint}</span>
              </span>
            </div>
            <ChoiceRow
              tone="person"
              label={t.person.sex}
              value={sex}
              onChange={setSex}
              testId="choice-sex"
              options={[
                { id: "male", label: t.person.male },
                { id: "female", label: t.person.female },
                { id: "unknown", label: t.person.unknown },
              ]}
            />
            <ChoiceRow
              tone="person"
              label={t.person.race}
              value={race}
              onChange={setRace}
              testId="choice-race"
              options={[
                { id: "black", label: t.person.black },
                { id: "white", label: t.person.white },
                { id: "coloured", label: t.person.coloured },
                { id: "indian", label: t.person.indian },
                { id: "unknown", label: t.person.unknown },
              ]}
            />
            <ChoiceRow
              tone="person"
              label={t.person.age}
              value={age}
              onChange={setAge}
              testId="choice-age"
              options={[
                { id: "child", label: t.person.child },
                { id: "teen", label: t.person.teen },
                { id: "young", label: t.person.young },
                { id: "adult", label: t.person.adult },
                { id: "older", label: t.person.older },
              ]}
            />
            <ChoiceRow
              tone="person"
              label={t.person.height}
              value={height}
              onChange={setHeight}
              testId="choice-height"
              options={[
                { id: "short", label: t.person.short },
                { id: "average", label: t.person.average },
                { id: "tall", label: t.person.tall },
              ]}
            />
            <LineField tone="person" label={t.person.clothes} value={clothes} onChange={setClothes} placeholder={t.person.clothesHint} testId="input-clothes" />
            <LineField tone="person" label={t.person.doing} value={doing} onChange={setDoing} placeholder={t.person.doingHint} testId="input-doing" />
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-amber-950">{t.extra}</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t.extraHint}
                rows={2}
                className="w-full rounded-2xl border border-amber-200 bg-white px-3 py-2 text-sm"
                data-testid="input-crime-extra"
              />
            </label>
          </div>
        )}

        {kind === "suspicious_vehicle" && (
          <div className="space-y-4 rounded-[1.4rem] border border-sky-300 bg-sky-50 p-4" data-testid="form-vehicle">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-900 text-white">
                <Car className="h-6 w-6" />
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-bold text-sky-950">{t.describeVehicle}</span>
                <span className="mt-0.5 block text-sm leading-snug text-sky-900/80">{t.describeVehicleHint}</span>
              </span>
            </div>
            <ChoiceRow
              tone="vehicle"
              label={t.vehicle.colour}
              value={colour}
              onChange={setColour}
              testId="choice-colour"
              options={[
                { id: "white", label: t.vehicle.white },
                { id: "black", label: t.vehicle.black },
                { id: "silver", label: t.vehicle.silver },
                { id: "grey", label: t.vehicle.grey },
                { id: "red", label: t.vehicle.red },
                { id: "blue", label: t.vehicle.blue },
                { id: "green", label: t.vehicle.green },
                { id: "yellow", label: t.vehicle.yellow },
                { id: "other", label: t.vehicle.other },
              ]}
            />
            {colour === "other" && (
              <LineField tone="vehicle" label={t.vehicle.other} value={colourOther} onChange={setColourOther} placeholder={t.vehicle.otherHint} testId="input-colour-other" />
            )}
            <ChoiceRow
              tone="vehicle"
              label={t.vehicle.type}
              value={vehicleType}
              onChange={setVehicleType}
              testId="choice-vehicle-type"
              options={[
                { id: "bakkie", label: t.vehicle.bakkie },
                { id: "car", label: t.vehicle.car },
                { id: "bike", label: t.vehicle.bike },
                { id: "truck", label: t.vehicle.truck },
                { id: "tractor", label: t.vehicle.tractor },
              ]}
            />
            <LineField tone="vehicle" label={t.vehicle.make} value={make} onChange={setMake} placeholder={t.vehicle.makeHint} testId="input-make" />
            <LineField tone="vehicle" label={t.vehicle.reg} value={reg} onChange={setReg} placeholder={t.vehicle.regHint} testId="input-reg" caps />
            <LineField tone="vehicle" label={t.vehicle.direction} value={direction} onChange={setDirection} placeholder={t.vehicle.directionHint} testId="input-direction" />
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-sky-950">{t.extra}</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t.extraHint}
                rows={2}
                className="w-full rounded-2xl border border-sky-200 bg-white px-3 py-2 text-sm"
                data-testid="input-crime-extra"
              />
            </label>
          </div>
        )}

        {(lockedKind || (kind && !needsSummary)) && (
          <label className="block space-y-2">
            <span className={`text-sm font-semibold ${lockedKind ? "text-[#7c2d12]" : "text-[#1E3A5F]"}`}>{t.whatHappened}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.whatHappened}
              rows={3}
              className={`w-full rounded-2xl border bg-white px-3 py-2 text-sm ${lockedKind ? "border-[#e7d3b0]" : "border-[#d5deea]"}`}
              data-testid="input-crime-note"
            />
          </label>
        )}

        {needsSummary && reportText && (
          <div className="rounded-2xl border border-border bg-muted/50 px-4 py-3" data-testid="text-crime-summary">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.summary}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{reportText}</p>
          </div>
        )}

        <FarmerPhotoPicker photos={photos} onChange={setPhotos} tone={lockedKind ? "livestock" : "crime"} idPrefix="crime" />

        <button
          type="button"
          disabled={!kind || send.isPending}
          onClick={() => send.mutate()}
          className={`w-full h-14 rounded-2xl font-bold text-white disabled:opacity-50 ${lockedKind ? "bg-[#b45309]" : "bg-[#1E3A5F]"}`}
          data-testid="button-send-crime"
        >
          {send.isPending ? t.sending : t.sendCrime}
        </button>

        <section className="space-y-2 pt-2">
          <h2 className={`text-sm font-semibold ${lockedKind ? "text-[#7c2d12]" : "text-[#1E3A5F]"}`}>{t.recent}</h2>
          {shown.length === 0 && <p className="text-sm text-muted-foreground">{t.noCrime}</p>}
          {shown.map((row) => {
            const who = [row.reporterFirstName, row.reporterLastName].filter(Boolean).join(" ");
            return (
              <article
                key={row.id}
                className="rounded-2xl border border-border bg-white p-3"
                data-testid={`card-crime-${row.id}`}
                onClick={() => {
                  if (row.id < 0) return;
                  setLocation(`/misdaad?report=${row.id}`);
                }}
              >
                <p className="font-semibold">{row.categoryName}</p>
                <p className="text-sm text-muted-foreground">{who}</p>
                {row.description && <p className="text-sm mt-1 whitespace-pre-wrap">{row.description}</p>}
                <DocketButton
                  busy={docketId != null}
                  label={docketId === row.id ? t.downloadingDocket : t.downloadDocket}
                  testId={`button-docket-${row.id}`}
                  tone={lockedKind ? "livestock" : "crime"}
                  onClick={() => void downloadDocket(row)}
                />
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
