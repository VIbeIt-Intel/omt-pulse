import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ToastAction } from "@/components/ui/toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { GeoLocationSheet, type GeoMapView } from "@/components/incident-location-sheet";
import { CoordinateLink } from "@/components/coordinate-link";
import { LiveIncidentsMap } from "@/components/live-incidents-map";

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
  panicAcknowledgedAt: string | null;
  panicAcknowledgedByUserId: string | null;
};

function formatDuration(startedAt: string | null): string {
  if (!startedAt) return "—";
  const diffMs = Date.now() - new Date(startedAt).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function formatTime(ts: string | null): string {
  if (!ts) return "Unknown";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getResponderName(inc: LiveIncident): string {
  const full = `${inc.responderFirstName ?? ""} ${inc.responderLastName ?? ""}`.trim();
  return full || `Incident #${inc.id}`;
}

function isPanicIncident(inc: LiveIncident): boolean {
  return (inc.categoryName ?? "").toLowerCase().includes("panic");
}

export default function LiveMonitorPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [geoMapView, setGeoMapView] = useState<GeoMapView | null>(null);
  const [endConfirmId, setEndConfirmId] = useState<number | null>(null);
  const [noteIncidentId, setNoteIncidentId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [tick, setTick] = useState(0);
  const [highlightId, setHighlightId] = useState<number | null>(() => {
    const p = new URLSearchParams(window.location.search).get("incidentId");
    return p ? parseInt(p, 10) : null;
  });

  const { data: liveIncidents = [], isLoading } = useQuery<LiveIncident[]>({
    queryKey: ["/api/incidents/live"],
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  // Scroll to the deep-linked incident once it loads
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (!highlightId || scrolledRef.current || liveIncidents.length === 0) return;
    const el = cardRefs.current.get(highlightId);
    if (!el) return;
    scrolledRef.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Auto-clear highlight after 3 s so it doesn't stay forever
    const t = setTimeout(() => setHighlightId(null), 3000);
    return () => clearTimeout(t);
  }, [highlightId, liveIncidents]);

  // Toast when a new live incident appears during polling
  const prevIncidentIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const prevIds = prevIncidentIdsRef.current;
    const newIncidents = liveIncidents.filter((inc) => !prevIds.has(inc.id));
    if (newIncidents.length > 0 && prevIds.size > 0) {
      // Only toast for incidents that appeared after the page was already loaded
      // (skip on first load where prevIds is empty)
      newIncidents.forEach((inc) => {
        const name = `${inc.responderFirstName ?? ""} ${inc.responderLastName ?? ""}`.trim() || `Incident #${inc.id}`;
        toast({
          title: `🚨 New Live Incident — ${name}`,
          description: `${name} has started a live incident.`,
          action: (
            <ToastAction altText="View" onClick={() => navigate("/live-monitor")}>
              View
            </ToastAction>
          ),
        });
      });
    }
    prevIncidentIdsRef.current = new Set(liveIncidents.map((inc) => inc.id));
  }, [liveIncidents, toast]);

  const { data: me } = useQuery<{ id: string }>({ queryKey: ["/api/auth/me"] });

  const joinMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/incidents/${id}/join-live`, {}),
    onSuccess: async (_, id) => {
      localStorage.setItem("omt_joined_incident_id", String(id));
      await queryClient.refetchQueries({ queryKey: ["/api/incidents/live"] });
      navigate("/live-incident");
    },
    onError: () => toast({ title: "Error", description: "Could not join the incident.", variant: "destructive" }),
  });

  useEffect(() => {
    const t = setInterval(() => setTick((d) => d + 1), 30000);
    return () => clearInterval(t);
  }, []);


  const endLiveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/incidents/${id}/end-live`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      setEndConfirmId(null);
      toast({ title: "Live incident ended", description: "The incident has been closed." });
    },
    onError: () => toast({ title: "Error", description: "Could not end the incident.", variant: "destructive" }),
  });

  const escalateMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/incidents/${id}/escalate`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
      toast({ title: "Incident escalated", description: "All admins and supervisors have been notified." });
    },
    onError: () => toast({ title: "Error", description: "Could not escalate the incident.", variant: "destructive" }),
  });

  const addNoteMutation = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      apiRequest("POST", `/api/incidents/${id}/add-note`, { note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      setNoteIncidentId(null);
      setNoteText("");
      toast({ title: "Note saved", description: "The note has been appended to the incident." });
    },
    onError: () => toast({ title: "Error", description: "Could not save the note.", variant: "destructive" }),
  });

  const noteIncident = liveIncidents.find((i) => i.id === noteIncidentId) ?? null;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0 bg-background">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} data-testid="button-back-live-monitor">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Radio className="h-5 w-5 text-red-500 animate-pulse shrink-0" />
          <span className="font-semibold text-lg">Live Monitor</span>
          {liveIncidents.length > 0 && (
            <Badge className="bg-red-500 text-white ml-1 shrink-0" data-testid="badge-live-count">
              {liveIncidents.length} Active
            </Badge>
          )}
        </div>
        {liveIncidents.length > 0 && (
          <span className="text-xs text-muted-foreground hidden sm:block">Auto-refreshes every 5s</span>
        )}
      </div>

      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">
        <div className="order-2 md:order-1 flex-1 min-h-0 md:flex-none md:w-72 border-b md:border-b-0 md:border-r flex flex-col bg-background overflow-y-auto" data-testid="panel-live-incidents">
          {isLoading ? (
            <div className="flex items-center justify-center flex-1 text-muted-foreground py-12">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading…
            </div>
          ) : liveIncidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 px-6 py-10 text-center" data-testid="empty-live-monitor">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="font-semibold text-sm">All clear</p>
              <p className="text-xs text-muted-foreground">No active live incidents at this time.</p>
            </div>
          ) : (
            <div className="divide-y">
              {liveIncidents.map((inc) => {
                const isMyIncident = me?.id != null && inc.userId === me.id;
                const alreadyJoined = me?.id != null && (inc.responders ?? []).some((r) => r.userId === me.id);
                const isHighlighted = highlightId === inc.id;
                return (
                  <div
                    key={inc.id}
                    ref={(el) => {
                      if (el) cardRefs.current.set(inc.id, el);
                      else cardRefs.current.delete(inc.id);
                    }}
                    className={isHighlighted ? "ring-2 ring-primary ring-inset transition-all duration-700" : ""}
                  >
                    <LiveIncidentCard
                      incident={inc}
                      onEndClick={() => setEndConfirmId(inc.id)}
                      onNoteClick={() => { setNoteIncidentId(inc.id); setNoteText(""); }}
                      onEscalateClick={() => escalateMutation.mutate(inc.id)}
                      isEscalating={escalateMutation.isPending && (escalateMutation.variables as number) === inc.id}
                      canJoin={!isMyIncident && !alreadyJoined}
                      alreadyJoined={alreadyJoined}
                      onJoinClick={() => joinMutation.mutate(inc.id)}
                      isJoining={joinMutation.isPending && (joinMutation.variables as number) === inc.id}
                      onOpenMap={setGeoMapView}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="order-1 md:order-2 h-[42vh] md:h-auto md:flex-1 min-w-0 relative shrink-0 md:shrink" data-testid="map-live-monitor">
          <LiveIncidentsMap
            incidents={liveIncidents}
            highlightId={highlightId}
            showMapControls
            className="absolute inset-0"
            onIncidentMarkerClick={(id) => {
              const inc = liveIncidents.find((i) => i.id === id);
              if (inc && isPanicIncident(inc)) {
                setHighlightId(id);
                const el = cardRefs.current.get(id);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }}
          />
        </div>
      </div>

      <AlertDialog open={endConfirmId !== null} onOpenChange={(o) => { if (!o) setEndConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End Live Incident</AlertDialogTitle>
            <AlertDialogDescription>
              This will close the live incident and stop GPS tracking for this person. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-end-live">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => endConfirmId !== null && endLiveMutation.mutate(endConfirmId)}
              disabled={endLiveMutation.isPending}
              data-testid="button-confirm-end-live"
            >
              {endLiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              End Incident
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={noteIncidentId !== null} onOpenChange={(o) => { if (!o) { setNoteIncidentId(null); setNoteText(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Note — {noteIncident ? getResponderName(noteIncident) : ""}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Notes are timestamped and appended to the incident description for the record.
          </p>
          <Textarea
            placeholder="Enter note about this incident…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={4}
            data-testid="textarea-note"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNoteIncidentId(null); setNoteText(""); }}>Cancel</Button>
            <Button
              onClick={() => noteIncidentId !== null && addNoteMutation.mutate({ id: noteIncidentId, note: noteText })}
              disabled={addNoteMutation.isPending || !noteText.trim()}
              data-testid="button-save-note"
            >
              {addNoteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Note
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
}) {
  const name = getResponderName(incident);
  const duration = formatDuration(incident.liveStartedAt);
  const hasGps = incident.responderLat != null && incident.responderLng != null;
  const gpsTime = incident.responderPositionUpdatedAt
    ? `Updated ${formatTime(incident.responderPositionUpdatedAt)}`
    : "No GPS";
  const isStale = hasGps && incident.responderPositionUpdatedAt
    ? (Date.now() - new Date(incident.responderPositionUpdatedAt).getTime()) > 180000
    : false;
  const markerColor = getMarkerColor(incident);

  return (
    <div
      className={`p-4 space-y-3 ${incident.isEscalated ? "bg-red-500/5 border-l-4 border-red-500" : ""}`}
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
              ✓ Acknowledged
            </Badge>
          )}
          {incident.isEscalated && (
            <Badge className="bg-red-500 text-white text-xs shrink-0" data-testid={`badge-escalated-${incident.id}`}>
              ESCALATED
            </Badge>
          )}
          {incident.responderArrivedAt && !incident.isEscalated && (
            <Badge className="bg-blue-600 text-white text-xs shrink-0" data-testid={`badge-at-scene-${incident.id}`}>
              AT SCENE
            </Badge>
          )}
        </div>

        {incident.responderArrivedAt && (
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400" data-testid={`text-arrived-at-${incident.id}`}>
            {name} is active at incident scene · arrived {formatTime(incident.responderArrivedAt)}
          </p>
        )}

        {(() => {
          const joiners = (incident.responders ?? []).filter((r) => r.userId !== incident.userId);
          if (joiners.length === 0) return null;
          return (
            <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 mt-1" data-testid={`list-responders-${incident.id}`}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">
                Responders ({joiners.length})
              </p>
              <ul className="space-y-1">
                {joiners.map((r) => {
                  const respName = `${r.firstName} ${r.lastName}`.trim() || "Responder";
                  let statusEl;
                  if (r.arrivedAt) {
                    statusEl = (
                      <span className="text-[10px] font-semibold text-green-600 dark:text-green-400 shrink-0" data-testid={`responder-status-${incident.id}-${r.userId}`}>
                        ✅ Arrived {formatTime(r.arrivedAt)}
                      </span>
                    );
                  } else if (r.lastPositionAt) {
                    const stale = (Date.now() - new Date(r.lastPositionAt).getTime()) > 180000;
                    statusEl = (
                      <span className={`text-[10px] font-medium shrink-0 ${stale ? "text-red-500" : "text-blue-600 dark:text-blue-400"}`} data-testid={`responder-status-${incident.id}-${r.userId}`}>
                        📍 En route · GPS {formatTime(r.lastPositionAt)}{stale ? " (stale)" : ""}
                      </span>
                    );
                  } else {
                    statusEl = (
                      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 shrink-0" data-testid={`responder-status-${incident.id}-${r.userId}`}>
                        ⏳ Joined {formatTime(r.joinedAt)} · no GPS
                      </span>
                    );
                  }
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-2 text-xs" data-testid={`responder-row-${incident.id}-${r.userId}`}>
                      <span className="truncate font-medium">{respName}</span>
                      {statusEl}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })()}

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {duration}
          </span>
          <span className="flex items-center gap-1" data-testid={`text-gps-status-${incident.id}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${hasGps ? (isStale ? "bg-red-500" : "bg-green-500") : "bg-amber-400"}`} />
            <span className={isStale ? "text-red-500 font-medium" : ""}>{hasGps ? gpsTime : "No GPS"}</span>
          </span>
          {isStale && (
            <Badge className="bg-red-500 text-white text-[9px] px-1.5 py-0 leading-tight" data-testid={`badge-gps-stale-${incident.id}`}>
              GPS STALE
            </Badge>
          )}
        </div>
        {hasGps && (
          <div className="flex items-center gap-1 text-xs">
            <CoordinateLink
              lat={Number(incident.responderLat)}
              lng={Number(incident.responderLng)}
              label={`${name} — last GPS`}
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
              onClick={onJoinClick}
              disabled={isJoining}
              data-testid={`button-join-incident-${incident.id}`}
            >
              {isJoining ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
              {isJoining ? "Joining…" : "Respond — Join & Track GPS"}
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
                  Open GPS Tracking
                </Button>
              </Link>
              <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium px-1">
                <UserPlus className="h-3 w-3" />
                You are responding — stay on Live Incident to share GPS
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
          onClick={onEndClick}
          data-testid={`button-end-incident-${incident.id}`}
        >
          <CheckCircle2 className="h-3 w-3 mr-1" />
          End
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs h-8 px-2"
          onClick={onNoteClick}
          data-testid={`button-note-incident-${incident.id}`}
        >
          <FileText className="h-3 w-3 mr-1" />
          Note
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={`w-full text-xs h-8 px-2 ${incident.isEscalated ? "opacity-50 cursor-not-allowed" : "border-red-500/50 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"}`}
          onClick={!incident.isEscalated ? onEscalateClick : undefined}
          disabled={incident.isEscalated || isEscalating}
          data-testid={`button-escalate-incident-${incident.id}`}
        >
          {isEscalating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ShieldAlert className="h-3 w-3 mr-1" />}
          {incident.isEscalated ? "Done" : "Escalate"}
        </Button>
      </div>
    </div>
  );
}
