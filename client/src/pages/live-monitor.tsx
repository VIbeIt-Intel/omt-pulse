import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ToastAction } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Radio,
  MapPin,
  Clock,
  CheckCircle2,
  FileText,
  Loader2,
  ShieldAlert,
  Tag,
  Navigation,
  UserPlus,
  Users,
  MessageSquare,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PageHero } from "@/components/page-hero";
import { useControlRoomLang } from "@/hooks/use-control-room-lang";
import { liveMonitorCopy, type LiveMonitorCopy } from "@/lib/live-monitor-copy";
import { OPS_PAGE_SHELL } from "@/lib/ops-layout";
import { cn } from "@/lib/utils";
import { GeoLocationSheet, type GeoMapView } from "@/components/incident-location-sheet";
import { CoordinateLink } from "@/components/coordinate-link";
import { ControlRoomMap } from "@/components/control-room-map";
import { useTheme } from "@/components/theme-provider";
import { usePrivateRadioActions } from "@/components/radio/private-radio-host";
import type { Location } from "@shared/schema";

type LiveResponderSummary = {
  id: number;
  userId: string;
  firstName: string;
  lastName: string;
  lastLat: number | null;
  lastLng: number | null;
  lastPositionAt: string | null;
  joinedAt: string;
  arrivedAt: string | null;
  arrivalNote: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  destinationName: string | null;
};

type LiveIncident = {
  id: number;
  organizationId: string;
  userId: string | null;
  incidentDate: string;
  incidentTime: string;
  locationId: number | null;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  customMapId: number | null;
  customMapX: number | null;
  customMapY: number | null;
  categoryId: number | null;
  otherCategoryNote: string | null;
  description: string | null;
  customFields: Record<string, string | number | null> | null;
  importBatchId: number | null;
  isLive: boolean;
  isEscalated: boolean;
  liveStartedAt: string | null;
  responderLat: number | null;
  responderLng: number | null;
  responderPositionUpdatedAt: string | null;
  responderArrivedAt: string | null;
  destinationName: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  createdAt: string;
  responderFirstName: string | null;
  responderLastName: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  responders: LiveResponderSummary[];
  severity: string | null;
  ownerLastLat?: number | null;
  ownerLastLng?: number | null;
  ownerLastPositionAt?: string | null;
  panicAcknowledgedAt: string | null;
  panicAcknowledgedByUserId: string | null;
};

function formatDuration(startedAt: string | null, m: LiveMonitorCopy): string {
  if (!startedAt) return "—";
  const diffMs = Date.now() - new Date(startedAt).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return m.justNow;
  if (mins < 60) return m.minutes(mins);
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return m.hours(hrs, rem);
}

function formatTime(ts: string | null, lang: "en" | "af", unknown: string): string {
  if (!ts) return unknown;
  return new Date(ts).toLocaleTimeString(lang === "af" ? "af-ZA" : undefined, { hour: "2-digit", minute: "2-digit" });
}

function getResponderName(inc: LiveIncident): string {
  const full = `${inc.responderFirstName ?? ""} ${inc.responderLastName ?? ""}`.trim();
  return full || `Incident #${inc.id}`;
}

function isPanicIncident(inc: LiveIncident): boolean {
  return (inc.categoryName ?? "").toLowerCase().includes("panic");
}

function pickLatLng(
  lat: number | string | null | undefined,
  lng: number | string | null | undefined,
): { lat: number; lng: number } | null {
  if (lat == null || lng == null) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return { lat: la, lng: ln };
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function fmtDistanceKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** Rough road ETA — straight-line × 1.25 at ~55 km/h. */
function estimateDriveMinutes(km: number): number {
  const roadKm = km * 1.25;
  return Math.max(1, Math.round((roadKm / 55) * 60));
}

const LAST_KNOWN_MS = 14 * 24 * 60 * 60 * 1000;

/** Live tracking if the phone is streaming, otherwise the position from their latest login. */
function fieldUnitFix(inc: LiveIncident): { lat: number; lng: number; at: string | null; live: boolean } | null {
  const live = pickLatLng(inc.responderLat, inc.responderLng);
  if (live) return { ...live, at: inc.responderPositionUpdatedAt, live: true };
  const known = pickLatLng(inc.ownerLastLat, inc.ownerLastLng);
  if (!known) return null;
  if (inc.ownerLastPositionAt) {
    const age = Date.now() - new Date(inc.ownerLastPositionAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age > LAST_KNOWN_MS) return null;
  }
  return { ...known, at: inc.ownerLastPositionAt ?? null, live: false };
}

function getIncidentTarget(inc: LiveIncident): { lat: number; lng: number } | null {
  if (isPanicIncident(inc)) {
    return (
      pickLatLng(inc.destinationLat, inc.destinationLng) ??
      pickLatLng(inc.latitude, inc.longitude) ??
      pickLatLng(inc.responderLat, inc.responderLng)
    );
  }
  return (
    pickLatLng(inc.destinationLat, inc.destinationLng) ??
    pickLatLng(inc.latitude, inc.longitude) ??
    pickLatLng(inc.responderLat, inc.responderLng)
  );
}

function formatEtaLine(
  from: { lat: number; lng: number } | null,
  target: { lat: number; lng: number } | null,
): string | null {
  if (!from || !target) return null;
  const km = haversineKm(from, target);
  if (!Number.isFinite(km)) return null;
  return `${fmtDistanceKm(km)} · ~${estimateDriveMinutes(km)} min`;
}

function getMarkerColor(inc: LiveIncident): string {
  if (inc.isEscalated) return "#ef4444";
  if (inc.responderArrivedAt) return "#2563eb";
  return inc.categoryColor ?? "#22c55e";
}

export default function LiveMonitorPage() {
  const { t, lang } = useControlRoomLang();
  const m = liveMonitorCopy(lang);
  const { theme } = useTheme();
  const light = theme === "light";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [geoMapView, setGeoMapView] = useState<GeoMapView | null>(null);
  const [endConfirmId, setEndConfirmId] = useState<number | null>(null);
  const [endReport, setEndReport] = useState("");
  const [noteIncidentId, setNoteIncidentId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [tick, setTick] = useState(0);
  const [focusId, setFocusId] = useState<number | null>(() => {
    const p = new URLSearchParams(window.location.search).get("incidentId");
    const id = p ? parseInt(p, 10) : NaN;
    return Number.isFinite(id) ? id : null;
  });
  const [focusResponderKey, setFocusResponderKey] = useState<string | null>(null);

  const preview = window.location.pathname.startsWith("/preview/");
  const { data: liveIncidents = [], isLoading } = useQuery<LiveIncident[]>({
    queryKey: ["/api/incidents/live"],
    refetchInterval: preview ? false : 5000,
    refetchIntervalInBackground: !preview,
  });

  const monitorPath = preview ? "/preview/live-monitor" : "/live-monitor";
  function focusIncident(id: number) {
    setFocusResponderKey(null);
    setFocusId(id);
    navigate(`${monitorPath}?incidentId=${id}`);
  }
  function clearFocus() {
    setFocusResponderKey(null);
    setFocusId(null);
    navigate(monitorPath);
  }
  function focusResponder(incidentId: number, key: string) {
    setFocusId(incidentId);
    setFocusResponderKey((current) => (current === key ? null : key));
    navigate(`${monitorPath}?incidentId=${incidentId}`);
  }

  useEffect(() => {
    if (isLoading || focusId == null) return;
    if (!liveIncidents.some((inc) => inc.id === focusId)) setFocusId(null);
  }, [isLoading, focusId, liveIncidents]);

  useEffect(() => {
    if (!focusResponderKey || isLoading) return;
    if (focusResponderKey.startsWith("team-")) {
      const id = Number(focusResponderKey.slice(5));
      if (!liveIncidents.some((inc) => inc.id === id)) setFocusResponderKey(null);
      return;
    }
    if (focusResponderKey.startsWith("primary-")) {
      const id = Number(focusResponderKey.slice(8));
      const inc = liveIncidents.find((item) => item.id === id);
      if (!inc || !fieldUnitFix(inc)) setFocusResponderKey(null);
      return;
    }
    const joiner = /^joiner-(\d+)-(.+)$/.exec(focusResponderKey);
    if (!joiner) {
      setFocusResponderKey(null);
      return;
    }
    const inc = liveIncidents.find((item) => item.id === Number(joiner[1]));
    const person = inc?.responders?.find((item) => item.userId === joiner[2]);
    if (person?.lastLat == null || person?.lastLng == null) setFocusResponderKey(null);
  }, [focusResponderKey, liveIncidents, isLoading]);

  const responderFocusLabel = useMemo(() => {
    if (!focusResponderKey) return null;
    if (focusResponderKey.startsWith("team-")) return m.wholeResponseOnMap;
    if (focusResponderKey.startsWith("primary-")) {
      const inc = liveIncidents.find((item) => item.id === Number(focusResponderKey.slice(8)));
      return inc ? m.showingOnMap(getResponderName(inc)) : null;
    }
    const joiner = /^joiner-(\d+)-(.+)$/.exec(focusResponderKey);
    if (!joiner) return null;
    const inc = liveIncidents.find((item) => item.id === Number(joiner[1]));
    const person = inc?.responders?.find((item) => item.userId === joiner[2]);
    if (!person) return null;
    const name = `${person.firstName} ${person.lastName}`.trim() || m.responder;
    return m.showingOnMap(name);
  }, [focusResponderKey, liveIncidents, m]);

  const focusedIncident = focusId == null ? null : liveIncidents.find((inc) => inc.id === focusId) ?? null;
  const shownIncidents = focusedIncident ? [focusedIncident] : liveIncidents;

  // Toast when a new live incident appears during polling
  const prevIncidentIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const prevIds = prevIncidentIdsRef.current;
    const newIncidents = liveIncidents.filter((inc) => !prevIds.has(inc.id));
    if (newIncidents.length > 0 && prevIds.size > 0) {
      // Only toast for incidents that appeared after the page was already loaded
      // (skip on first load where prevIds is empty)
      newIncidents.forEach((inc) => {
        const name = `${inc.responderFirstName ?? ""} ${inc.responderLastName ?? ""}`.trim() || m.incidentWord(inc.id);
        toast({
          title: m.newLiveTitle(name),
          description: m.newLiveBody(name),
          action: (
            <ToastAction altText={m.view} onClick={() => navigate(preview ? "/preview/live-monitor" : "/live-monitor")}>
              {m.view}
            </ToastAction>
          ),
        });
      });
    }
    prevIncidentIdsRef.current = new Set(liveIncidents.map((inc) => inc.id));
  }, [liveIncidents, toast, m, navigate, preview]);

  const { data: me } = useQuery<{ id: string }>({ queryKey: ["/api/auth/me"] });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: commandsData } = useQuery<{
    activeCommandId: number | "all" | null;
  }>({ queryKey: ["/api/me/commands"] });

  const groupLocations = useMemo(() => {
    const activeCommandId = commandsData?.activeCommandId ?? null;
    if (activeCommandId === "all" || activeCommandId == null) return locations;
    return locations.filter((l) => l.commandId === activeCommandId || l.commandId == null);
  }, [locations, commandsData?.activeCommandId]);

  const joinMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/incidents/${id}/join-live`, {}),
    onSuccess: async (_, id) => {
      localStorage.setItem("omt_joined_incident_id", String(id));
      await queryClient.refetchQueries({ queryKey: ["/api/incidents/live"] });
      navigate("/live-incident");
    },
    onError: () => toast({ title: m.error, description: m.couldNotJoin, variant: "destructive" }),
  });

  useEffect(() => {
    const t = setInterval(() => setTick((d) => d + 1), 30000);
    return () => clearInterval(t);
  }, []);


  const endLiveMutation = useMutation({
    mutationFn: async ({ id, report }: { id: number; report: string }) => {
      if (preview) return;
      await apiRequest("POST", `/api/incidents/${id}/add-note`, {
        note: `${m.closeReportNote}: ${report}`,
      });
      await apiRequest("POST", `/api/incidents/${id}/end-live`, {});
    },
    onSuccess: (_data, { id }) => {
      if (preview) {
        queryClient.setQueryData<LiveIncident[]>(["/api/incidents/live"], (rows) =>
          (rows ?? []).filter((row) => row.id !== id),
        );
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
        queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      }
      setEndConfirmId(null);
      setEndReport("");
      if (focusId === id) {
        setFocusId(null);
        setFocusResponderKey(null);
        navigate(monitorPath);
      }
      toast({ title: m.incidentEnded, description: m.incidentEndedBody });
    },
    onError: () => toast({ title: m.error, description: m.couldNotEnd, variant: "destructive" }),
  });

  const escalateMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/incidents/${id}/escalate`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
      toast({ title: m.escalatedTitle, description: m.escalatedBody });
    },
    onError: () => toast({ title: m.error, description: m.couldNotEscalate, variant: "destructive" }),
  });

  const addNoteMutation = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      apiRequest("POST", `/api/incidents/${id}/add-note`, { note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      setNoteIncidentId(null);
      setNoteText("");
      toast({ title: m.noteSaved, description: m.noteSavedBody });
    },
    onError: () => toast({ title: m.error, description: m.couldNotSaveNote, variant: "destructive" }),
  });

  const noteIncident = liveIncidents.find((i) => i.id === noteIncidentId) ?? null;

  return (
    <div className={cn("flex flex-col h-full bg-background", light && "ops-light")}>
      <div className={cn(OPS_PAGE_SHELL, "shrink-0 pt-3 pb-3")}>
        <PageHero
          eyebrow={t.liveMonitor}
          badge={liveIncidents.length > 0 ? t.screen.autoRefresh : t.screen.standby}
          total={liveIncidents.length}
          totalLabel={t.screen.active}
          totalTestId="badge-live-count"
          leading={
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(preview ? "/preview/control-room" : "/")} data-testid="button-back-live-monitor">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          }
          insights={[
            {
              label: t.screen.status,
              value: liveIncidents.length > 0 ? t.screen.liveResponse : t.allClear,
            },
          ]}
        />
      </div>

      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">
        <div className="order-2 md:order-1 flex-1 min-h-0 md:flex-none md:w-80 border-b md:border-b-0 md:border-r flex flex-col bg-muted/40 overflow-y-auto" data-testid="panel-live-incidents">
          {isLoading ? (
            <div className="flex items-center justify-center flex-1 text-muted-foreground py-12">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              {m.loading}
            </div>
          ) : liveIncidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 px-6 py-10 text-center" data-testid="empty-live-monitor">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="font-semibold text-sm">{t.allClear}</p>
              <p className="text-xs text-muted-foreground">{t.mapHint}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-3">
              {focusedIncident && (
                <button
                  type="button"
                  onClick={clearFocus}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted"
                  data-testid="button-clear-incident-focus"
                >
                  <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{m.inFocus}</span>
                    <span className="block truncate">{getResponderName(focusedIncident)} · {focusedIncident.categoryName ?? m.incidentWord(focusedIncident.id)}</span>
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] font-medium text-primary">{m.allIncidents}</span>
                </button>
              )}
              {shownIncidents.map((inc) => {
                const isMyIncident = me?.id != null && inc.userId === me.id;
                const alreadyJoined = me?.id != null && (inc.responders ?? []).some((r) => r.userId === me.id);
                const isFocused = focusId === inc.id;
                return (
                  <div
                    key={inc.id}
                    ref={(el) => {
                      if (el) cardRefs.current.set(inc.id, el);
                      else cardRefs.current.delete(inc.id);
                    }}
                    onClick={() => focusIncident(inc.id)}
                    className={cn(
                      "cursor-pointer rounded-xl border bg-background shadow-sm overflow-hidden",
                      inc.isEscalated ? "border-red-500" : "border-border",
                      isFocused && "ring-2 ring-primary",
                    )}
                  >
                    <LiveIncidentCard
                      incident={inc}
                      onEndClick={() => { setEndConfirmId(inc.id); setEndReport(""); }}
                      onNoteClick={() => { setNoteIncidentId(inc.id); setNoteText(""); }}
                      onEscalateClick={() => escalateMutation.mutate(inc.id)}
                      isEscalating={escalateMutation.isPending && (escalateMutation.variables as number) === inc.id}
                      canJoin={!isMyIncident && !alreadyJoined}
                      alreadyJoined={alreadyJoined}
                      onJoinClick={() => joinMutation.mutate(inc.id)}
                      isJoining={joinMutation.isPending && (joinMutation.variables as number) === inc.id}
                      onOpenMap={setGeoMapView}
                      focusResponderKey={focusResponderKey}
                      onFocusResponder={(key) => focusResponder(inc.id, key)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="order-1 md:order-2 h-[42vh] md:h-auto md:flex-1 min-w-0 relative shrink-0 md:shrink flex flex-col" data-testid="map-live-monitor">
          <ControlRoomMap
            incidents={shownIncidents}
            locations={groupLocations}
            highlightId={focusId}
            onHighlightId={focusIncident}
            showSidePanels={false}
            darkTheme={!light}
            className="flex-1 min-h-0"
            testId="map-live-monitor"
            onIncidentMarkerClick={focusIncident}
            onOpenLiveMonitor={(incidentId) => {
              if (incidentId != null) focusIncident(incidentId);
            }}
            highlightResponderKey={focusResponderKey}
            onClearResponderFocus={() => setFocusResponderKey(null)}
          />
          {responderFocusLabel && (
            <div
              className="absolute bottom-3 left-3 z-30 flex max-w-sm items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 text-xs shadow-lg"
              data-testid="banner-responder-on-map"
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 text-sky-600" />
              <span className="min-w-0 truncate font-semibold">{responderFocusLabel}</span>
              <button
                type="button"
                className="shrink-0 font-semibold text-primary"
                onClick={() => setFocusResponderKey(null)}
                data-testid="button-back-to-incident-map"
              >
                {m.backToIncident}
              </button>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={endConfirmId !== null}
        onOpenChange={(open) => {
          if (!open && !endLiveMutation.isPending) {
            setEndConfirmId(null);
            setEndReport("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.endTitle}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{m.endBody}</p>
          <label className="block space-y-1.5 text-sm font-semibold">
            {m.closeReportLabel}
            <Textarea
              value={endReport}
              onChange={(e) => setEndReport(e.target.value)}
              placeholder={m.closeReportPlaceholder}
              rows={5}
              autoFocus
              disabled={endLiveMutation.isPending}
              className="mt-1.5 font-normal"
              data-testid="textarea-end-report"
            />
          </label>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={endLiveMutation.isPending}
              onClick={() => { setEndConfirmId(null); setEndReport(""); }}
              data-testid="button-cancel-end-live"
            >
              {m.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={!endReport.trim() || endLiveMutation.isPending}
              data-testid="button-confirm-end-live"
              onClick={() => {
                const report = endReport.trim();
                if (endConfirmId == null || !report) return;
                endLiveMutation.mutate({ id: endConfirmId, report });
              }}
            >
              {endLiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {m.endIncident}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={noteIncidentId !== null} onOpenChange={(o) => { if (!o) { setNoteIncidentId(null); setNoteText(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.addNoteTitle(noteIncident ? getResponderName(noteIncident) : "")}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {m.noteHint}
          </p>
          <Textarea
            placeholder={m.notePlaceholder}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={4}
            data-testid="textarea-note"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNoteIncidentId(null); setNoteText(""); }}>{m.cancel}</Button>
            <Button
              onClick={() => noteIncidentId !== null && addNoteMutation.mutate({ id: noteIncidentId, note: noteText })}
              disabled={addNoteMutation.isPending || !noteText.trim()}
              data-testid="button-save-note"
            >
              {addNoteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {m.saveNote}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GeoLocationSheet view={geoMapView} onClose={() => setGeoMapView(null)} />
    </div>
  );
}

function LiveIncidentCard({
  incident,
  onEndClick,
  onNoteClick,
  onEscalateClick,
  isEscalating,
  canJoin,
  alreadyJoined,
  onJoinClick,
  isJoining,
  onOpenMap,
  focusResponderKey,
  onFocusResponder,
}: {
  incident: LiveIncident;
  onEndClick: () => void;
  onNoteClick: () => void;
  onEscalateClick: () => void;
  isEscalating: boolean;
  canJoin: boolean;
  alreadyJoined: boolean;
  onJoinClick: () => void;
  isJoining: boolean;
  onOpenMap: (view: GeoMapView) => void;
  focusResponderKey: string | null;
  onFocusResponder: (key: string) => void;
}) {
  const { lang } = useControlRoomLang();
  const m = liveMonitorCopy(lang);
  const name = getResponderName(incident);
  const duration = formatDuration(incident.liveStartedAt, m);
  const hasGps = incident.responderLat != null && incident.responderLng != null;
  const gpsTime = incident.responderPositionUpdatedAt
    ? m.updated(formatTime(incident.responderPositionUpdatedAt, lang, m.unknownTime))
    : m.noGps;
  const isStale = hasGps && incident.responderPositionUpdatedAt
    ? (Date.now() - new Date(incident.responderPositionUpdatedAt).getTime()) > 180000
    : false;
  const markerColor = getMarkerColor(incident);

  return (
    <div
      className="p-3.5 space-y-3"
      data-testid={`card-live-incident-${incident.id}`}
    >
      <div className="space-y-1.5">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate" data-testid={`text-responder-name-${incident.id}`}>{name}</p>
            {incident.categoryName && (
              <p className="text-xs flex items-center gap-1 mt-0.5">
                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: markerColor }} />
                <Tag className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground truncate">{incident.categoryName}</span>
              </p>
            )}
            {incident.locationName && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{incident.locationName}</span>
              </p>
            )}
            {incident.destinationName && (
              <p className="text-xs flex items-center gap-1 mt-0.5">
                <Navigation className="h-3 w-3 shrink-0 text-red-500" />
                <span className="text-red-600 dark:text-red-400 font-medium truncate">→ {incident.destinationName}</span>
              </p>
            )}
          </div>
          {incident.panicAcknowledgedAt && (
            <Badge className="bg-green-600 text-white text-xs shrink-0" data-testid={`badge-panic-acknowledged-${incident.id}`}>
              ✓ {m.acknowledged}
            </Badge>
          )}
          {incident.isEscalated && (
            <Badge className="bg-red-500 text-white text-xs shrink-0" data-testid={`badge-escalated-${incident.id}`}>
              {m.escalated}
            </Badge>
          )}
          {incident.responderArrivedAt && !incident.isEscalated && (
            <Badge className="bg-blue-600 text-white text-xs shrink-0" data-testid={`badge-at-scene-${incident.id}`}>
              {m.atScene}
            </Badge>
          )}
        </div>

        {incident.responderArrivedAt && (
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400" data-testid={`text-arrived-at-${incident.id}`}>
            {m.activeAtScene(name, formatTime(incident.responderArrivedAt, lang, m.unknownTime))}
          </p>
        )}

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {duration}
          </span>
          <span className="flex items-center gap-1" data-testid={`text-gps-status-${incident.id}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${hasGps ? (isStale ? "bg-red-500" : "bg-green-500") : "bg-amber-400"}`} />
            <span className={isStale ? "text-red-500 font-medium" : ""}>{hasGps ? gpsTime : m.noGps}</span>
          </span>
          {isStale && (
            <Badge className="bg-red-500 text-white text-[9px] px-1.5 py-0 leading-tight" data-testid={`badge-gps-stale-${incident.id}`}>
              {m.gpsStale}
            </Badge>
          )}
        </div>
        {hasGps && (
          <div className="flex items-center gap-1 text-xs">
            <CoordinateLink
              lat={Number(incident.responderLat)}
              lng={Number(incident.responderLng)}
              label={m.lastGps(name)}
              onOpenMap={onOpenMap}
              className="text-xs"
              decimals={4}
              testId={`link-responder-position-${incident.id}`}
            />
          </div>
        )}
      </div>

      {(canJoin || alreadyJoined) && (
        <div className="pb-1">
          {canJoin ? (
            <Button
              size="sm"
              className="w-full text-xs h-8 bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
              onClick={(e) => { e.stopPropagation(); onJoinClick(); }}
              disabled={isJoining}
              data-testid={`button-join-incident-${incident.id}`}
            >
              {isJoining ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
              {isJoining ? m.joining : m.respond}
            </Button>
          ) : (
            <div className="flex flex-col gap-2 pb-1">
              <Link href="/live-incident" className="block">
                <Button
                  size="sm"
                  className="w-full text-xs h-10 bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
                  data-testid={`button-open-gps-tracking-${incident.id}`}
                >
                  <Navigation className="h-3.5 w-3.5" />
                  {m.openGps}
                </Button>
              </Link>
              <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium px-1">
                <UserPlus className="h-3 w-3" />
                {m.stayOnLive}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        <Button
          size="sm"
          variant="destructive"
          className="w-full text-xs h-8 px-2"
          onClick={(e) => { e.stopPropagation(); onEndClick(); }}
          data-testid={`button-end-incident-${incident.id}`}
        >
          <CheckCircle2 className="h-3 w-3 mr-1" />
          {m.end}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs h-8 px-2"
          onClick={(e) => { e.stopPropagation(); onNoteClick(); }}
          data-testid={`button-note-incident-${incident.id}`}
        >
          <FileText className="h-3 w-3 mr-1" />
          {m.note}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={`w-full text-xs h-8 px-2 ${incident.isEscalated ? "opacity-50 cursor-not-allowed" : "border-red-500/50 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"}`}
          onClick={!incident.isEscalated ? (e) => { e.stopPropagation(); onEscalateClick(); } : undefined}
          disabled={incident.isEscalated || isEscalating}
          data-testid={`button-escalate-incident-${incident.id}`}
        >
          {isEscalating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ShieldAlert className="h-3 w-3 mr-1" />}
          {incident.isEscalated ? m.done : m.escalate}
        </Button>
      </div>

      <ResponseTeamPanel
        incident={incident}
        primaryName={name}
        focusResponderKey={focusResponderKey}
        onFocusResponder={onFocusResponder}
      />
    </div>
  );
}

function ResponderContactActions({
  userId,
  incidentId,
  disabled,
}: {
  userId: string | null | undefined;
  incidentId: number;
  disabled?: boolean;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { lang } = useControlRoomLang();
  const m = liveMonitorCopy(lang);
  const privateRadio = usePrivateRadioActions();
  const [starting, setStarting] = useState(false);

  if (!userId || disabled) return null;

  return (
    <div className="mt-1.5 flex gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 flex-1 text-[10px] px-1.5 gap-1"
        data-testid={`button-message-responder-${incidentId}-${userId}`}
        onClick={() => navigate(`/chat?dm=${encodeURIComponent(userId)}`)}
      >
        <MessageSquare className="h-3 w-3" />
        {m.message}
      </Button>
      <Button
        type="button"
        size="sm"
        className="h-7 flex-1 text-[10px] px-1.5 gap-1 bg-violet-700 hover:bg-violet-600 text-white"
        data-testid={`button-private-talk-${incidentId}-${userId}`}
        disabled={starting || privateRadio.callActive}
        onClick={() => {
          setStarting(true);
          void privateRadio
            .startCall(userId, incidentId)
            .catch((err) => {
              toast({
                title: m.privateRadioFailed,
                description: err instanceof Error ? err.message : m.couldNotStartTalk,
                variant: "destructive",
              });
            })
            .finally(() => setStarting(false));
        }}
      >
        {starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Radio className="h-3 w-3" />}
        {m.privateTalk}
      </Button>
    </div>
  );
}

function LocateRow({
  locatable,
  selected,
  onLocate,
  testId,
  children,
}: {
  locatable: boolean;
  selected: boolean;
  onLocate: () => void;
  testId: string;
  children: ReactNode;
}) {
  const className = cn(
    "w-full rounded px-0.5 py-0.5 text-left",
    locatable && "cursor-pointer hover:bg-sky-500/10",
    selected && "bg-sky-500/15",
  );
  if (!locatable) return <div className={className}>{children}</div>;
  return (
    <button
      type="button"
      className={className}
      data-testid={testId}
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation();
        onLocate();
      }}
    >
      {children}
    </button>
  );
}

function ResponseTeamPanel({
  incident,
  primaryName,
  focusResponderKey,
  onFocusResponder,
}: {
  incident: LiveIncident;
  primaryName: string;
  focusResponderKey: string | null;
  onFocusResponder: (key: string) => void;
}) {
  const { lang } = useControlRoomLang();
  const m = liveMonitorCopy(lang);
  const { data: me } = useQuery<{ id: string }>({ queryKey: ["/api/auth/me"] });
  const target = getIncidentTarget(incident);
  const joiners = (incident.responders ?? []).filter((r) => r.userId !== incident.userId);
  const enRoute = joiners.filter((r) => !r.arrivedAt).length;
  const onScene = joiners.filter((r) => !!r.arrivedAt).length;
  const primaryFix = fieldUnitFix(incident);
  const primaryPos = primaryFix ? { lat: primaryFix.lat, lng: primaryFix.lng } : null;
  const primaryKey = `primary-${incident.id}`;
  const teamKey = `team-${incident.id}`;
  const primaryEta = !incident.responderArrivedAt
    ? formatEtaLine(primaryPos, target)
    : null;
  const primaryStale =
    !!primaryFix?.at && Date.now() - new Date(primaryFix.at).getTime() > 180000;
  const locatedJoiners = joiners.filter((r) => pickLatLng(r.lastLat, r.lastLng) != null);
  const canFrameTeam = locatedJoiners.length > 0 && (primaryPos != null || target != null);

  return (
    <div
      className="rounded-md border border-border bg-muted/50 px-2.5 py-2 space-y-2"
      data-testid={`list-responders-${incident.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
          <Users className="h-3 w-3" />
          {m.responseTeam}
        </p>
        <div className="flex items-center gap-1.5">
          {canFrameTeam && (
            <button
              type="button"
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                focusResponderKey === teamKey
                  ? "bg-sky-600 text-white"
                  : "text-sky-700 hover:bg-sky-500/10 dark:text-sky-300",
              )}
              aria-pressed={focusResponderKey === teamKey}
              data-testid={`button-show-response-${incident.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onFocusResponder(teamKey);
              }}
            >
              {m.showAllOnMap}
            </button>
          )}
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {joiners.length === 0
              ? m.noneJoined
              : m.teamStatus(onScene, enRoute)}
          </p>
        </div>
      </div>
      {(locatedJoiners.length > 0 || primaryFix != null) && (
        <p className="text-[10px] text-muted-foreground leading-snug">{m.tapToLocate}</p>
      )}

      <ul className="space-y-1.5">
        <li
          className={cn(
            "rounded border border-border bg-background px-2 py-1.5",
            focusResponderKey === primaryKey && "ring-2 ring-sky-500 border-sky-500",
          )}
          data-testid={`responder-row-${incident.id}-primary`}
        >
          <LocateRow
            locatable={primaryPos != null}
            selected={focusResponderKey === primaryKey}
            onLocate={() => onFocusResponder(primaryKey)}
            testId={`button-locate-primary-${incident.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{primaryName}</p>
                <p className="text-[10px] text-muted-foreground">{m.fieldUnit}</p>
              </div>
              {incident.responderArrivedAt ? (
                <span className="text-[10px] font-semibold text-emerald-400 shrink-0">
                  {m.onSceneAt(formatTime(incident.responderArrivedAt, lang, m.unknownTime))}
                </span>
              ) : primaryFix?.live ? (
                <span className="text-[10px] font-medium text-sky-400 shrink-0 text-right">
                  {primaryStale ? m.enRouteStale : m.liveGps}
                  {primaryEta ? <span className="block text-muted-foreground font-normal">{primaryEta}</span> : null}
                  {primaryFix.at ? (
                    <span className="block text-muted-foreground font-normal">
                      {m.gpsAt(formatTime(primaryFix.at, lang, m.unknownTime))}
                    </span>
                  ) : null}
                </span>
              ) : primaryFix ? (
                <span className={cn("text-[10px] font-medium shrink-0 text-right", primaryStale ? "text-amber-500" : "text-sky-400")}>
                  {m.lastKnownPlace}
                  {primaryEta ? <span className="block text-foreground font-semibold">{primaryEta}</span> : null}
                  {primaryFix.at ? (
                    <span className="block text-muted-foreground font-normal">
                      {m.gpsAt(formatTime(primaryFix.at, lang, m.unknownTime))}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="text-[10px] font-medium text-amber-400 shrink-0">{m.noGps}</span>
              )}
            </div>
          </LocateRow>
          <ResponderContactActions
            userId={incident.userId}
            incidentId={incident.id}
            disabled={!!me?.id && incident.userId === me.id}
          />
        </li>

        {joiners.map((r) => {
          const respName = `${r.firstName} ${r.lastName}`.trim() || m.responder;
          const pos = pickLatLng(r.lastLat, r.lastLng);
          const eta = !r.arrivedAt ? formatEtaLine(pos, target) : null;
          const joinerKey = `joiner-${incident.id}-${r.userId}`;
          const selected = focusResponderKey === joinerKey;
          const stale =
            !!r.lastPositionAt &&
            Date.now() - new Date(r.lastPositionAt).getTime() > 180000;

          return (
            <li
              key={r.id}
              className={cn(
                "rounded border border-border bg-background px-2 py-1.5",
                selected && "ring-2 ring-sky-500 border-sky-500",
              )}
              data-testid={`responder-row-${incident.id}-${r.userId}`}
            >
              <LocateRow
                locatable={pos != null}
                selected={selected}
                onLocate={() => onFocusResponder(joinerKey)}
                testId={`button-locate-responder-${incident.id}-${r.userId}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{respName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {m.joinedAt(formatTime(r.joinedAt, lang, m.unknownTime))}
                      {r.destinationName ? ` · → ${r.destinationName}` : ""}
                    </p>
                  </div>
                  {r.arrivedAt ? (
                    <span
                      className="text-[10px] font-semibold text-emerald-400 shrink-0"
                      data-testid={`responder-status-${incident.id}-${r.userId}`}
                    >
                      {m.arrivedAt(formatTime(r.arrivedAt, lang, m.unknownTime))}
                    </span>
                  ) : pos && r.lastPositionAt ? (
                    <span
                      className={cn(
                        "text-[10px] font-medium shrink-0 text-right",
                        stale ? "text-red-400" : "text-sky-400",
                      )}
                      data-testid={`responder-status-${incident.id}-${r.userId}`}
                    >
                      {stale ? m.enRouteStale : m.enRoute}
                      {eta ? <span className="block text-foreground font-semibold">{eta}</span> : null}
                      <span className="block text-muted-foreground font-normal">
                        {m.gpsAt(formatTime(r.lastPositionAt, lang, m.unknownTime))}
                      </span>
                    </span>
                  ) : (
                    <span
                      className="text-[10px] font-medium text-amber-400 shrink-0"
                      data-testid={`responder-status-${incident.id}-${r.userId}`}
                    >
                      {m.joinedNoGps}
                    </span>
                  )}
                </div>
              </LocateRow>
              <ResponderContactActions
                userId={r.userId}
                incidentId={incident.id}
                disabled={!!me?.id && r.userId === me.id}
              />
            </li>
          );
        })}
      </ul>

      {joiners.length === 0 ? (
        <p className="text-[11px] text-muted-foreground leading-snug px-0.5" data-testid={`text-no-responders-${incident.id}`}>
          {m.noRespondersYet}
        </p>
      ) : null}
    </div>
  );
}
