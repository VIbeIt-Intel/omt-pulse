import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Siren, X, CheckCircle2, Phone, Radio, AlertOctagon, MapPin } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { GeoLocationSheet, type GeoMapView } from "@/components/incident-location-sheet";
import { CoordinateLink } from "@/components/coordinate-link";

export type PanicAlert = {
  id: number;
  userId: string;
  firstName: string;
  lastName: string;
  contactNumber: string | null;
  lat: number | null;
  lng: number | null;
  createdAt: string | Date;
  panicAcknowledgedAt: string | Date | null;
  panicClosedAt: string | Date | null;
  acknowledgedBy: Array<{ userId: string; firstName: string; lastName: string; acknowledgedAt: string | Date; arrivedAt?: string | Date | null }>;
};

function summariseAckStatus(acks: PanicAlert["acknowledgedBy"]): string | null {
  if (acks.length === 0) return null;
  const arrived = acks.filter((a) => a.arrivedAt);
  const enRoute = acks.filter((a) => !a.arrivedAt);
  if (arrived.length > 0 && enRoute.length > 0) {
    return `${arrived.length} on scene · ${enRoute.length} en route`;
  }
  if (arrived.length > 0) {
    // Use names when only one or two arrived so it stays personal.
    if (arrived.length === 1) return `${arrived[0].firstName} ${arrived[0].lastName} on scene`.trim();
    if (arrived.length === 2) return `${arrived[0].firstName} and ${arrived[1].firstName} on scene`;
    return `${arrived.length} on scene`;
  }
  // Only en-route — fall back to existing name list.
  return null;
}

type PanicBannerProps = {
  alerts: PanicAlert[];
  currentUserId: string | null | undefined;
  dismissedIds: Set<number>;
  onDismiss: (id: number) => void;
  testIdSuffix?: string;
};

function formatAckList(acks: PanicAlert["acknowledgedBy"]) {
  if (acks.length === 0) return null;
  const names = acks.map((a) => a.firstName);
  if (names.length === 1) return `${acks[0].firstName} ${acks[0].lastName}`.trim();
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2} more`;
}

export function PanicBanner({ alerts, currentUserId, dismissedIds, onDismiss, testIdSuffix = "" }: PanicBannerProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const acknowledge = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/incidents/${id}/acknowledge-panic`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/panic/recent"] });
      toast({ title: "Acknowledged", description: "The panicker has been notified that you are responding." });
    },
    onError: () => toast({ title: "Failed to acknowledge", variant: "destructive" }),
  });

  const closePanic = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/incidents/${id}/close-panic`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/panic/recent"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
      toast({ title: "Panic closed", description: "Your alert has been cleared from everyone's screens." });
    },
    onError: () => toast({ title: "Failed to close", variant: "destructive" }),
  });

  const joinPanic = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/incidents/${id}/join-live`, {}),
  });

  const [closingId, setClosingId] = useState<number | null>(null);
  const [joiningId, setJoiningId] = useState<number | null>(null);
  const [geoMapView, setGeoMapView] = useState<GeoMapView | null>(null);

  async function respondLive(alert: PanicAlert) {
    const hasGps = alert.lat != null && alert.lng != null;
    setJoiningId(alert.id);
    try {
      // Join the panicker's existing live incident (the panic itself is live).
      // Idempotent: server allows re-join attempts; on the rare race where
      // the panic was just closed, we surface a clear error rather than
      // silently dropping the responder into a new live session.
      await joinPanic.mutateAsync(alert.id);
      if (hasGps) {
        const target = {
          lat: alert.lat!,
          lng: alert.lng!,
          name: `🆘 ${alert.firstName} ${alert.lastName}`.trim(),
        };
        try { localStorage.setItem("omt_panic_target", JSON.stringify(target)); } catch { /* ignore */ }
      } else {
        try { localStorage.removeItem("omt_panic_target"); } catch { /* ignore */ }
      }
      try { localStorage.setItem("omt_joined_incident_id", String(alert.id)); } catch { /* ignore */ }
      await queryClient.refetchQueries({ queryKey: ["/api/incidents/live"] });
      if (!hasGps) {
        toast({
          title: "Joined panic response",
          description: "No GPS yet — the map will update when they turn location on.",
        });
      }
      navigate("/live-incident");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not join the panic incident";
      toast({ title: "Couldn't respond", description: msg, variant: "destructive" });
    } finally {
      setJoiningId(null);
    }
  }

  const visible = alerts.filter((a) => !dismissedIds.has(a.id));
  if (visible.length === 0) return null;
  const suffix = testIdSuffix ? `-${testIdSuffix}` : "";

  return (
    <div className="w-full rounded-lg border-2 border-amber-500 bg-amber-500/10 overflow-hidden shadow-lg" data-testid={`banner-panic${suffix}`}>
      <div className="bg-amber-500 px-4 py-2 flex items-center gap-2">
        <Siren className="h-4 w-4 text-white animate-pulse shrink-0" />
        <span className="text-white font-bold text-sm uppercase tracking-wide">🆘 Panic Alert</span>
      </div>
      <div className="px-4 py-3 space-y-3">
        {visible.map((alert) => {
          const isPanicker = !!currentUserId && alert.userId === currentUserId;
          const myAck = currentUserId ? alert.acknowledgedBy.find((a) => a.userId === currentUserId) : undefined;
          const hasAcked = !!myAck;
          const hasArrived = !!myAck?.arrivedAt;
          const ackText = formatAckList(alert.acknowledgedBy);
          const onSceneText = summariseAckStatus(alert.acknowledgedBy);
          const hasPanicGps = alert.lat != null && alert.lng != null;
          const fullAckList = alert.acknowledgedBy.map((a) => `${a.firstName} ${a.lastName}`.trim()).join(", ");

          return (
            <div key={alert.id} className="border-b border-amber-500/20 last:border-0 pb-3 last:pb-0 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {isPanicker ? (
                    onSceneText ? (
                      <p className="text-sm font-semibold text-green-700 dark:text-green-400">
                        📍 {onSceneText}
                      </p>
                    ) : ackText ? (
                      <p className="text-sm font-semibold text-green-700 dark:text-green-400">
                        ✅ {ackText} {alert.acknowledgedBy.length === 1 ? "is" : "are"} responding
                      </p>
                    ) : (
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                        🆘 Help requested — waiting for someone to acknowledge
                      </p>
                    )
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                        {`${alert.firstName} ${alert.lastName}`.trim() || "A colleague"} needs immediate assistance
                      </p>
                      {hasArrived ? (
                        <p
                          className="text-xs text-green-700 dark:text-green-400 font-medium"
                          data-testid={`text-panic-self-arrived-${alert.id}`}
                        >
                          📍 You have arrived — {alert.firstName} knows you're here
                        </p>
                      ) : onSceneText ? (
                        <p
                          className="text-xs text-green-700 dark:text-green-400 font-medium"
                          title={fullAckList}
                          data-testid={`text-panic-ack-list-${alert.id}`}
                        >
                          ✓ {onSceneText}
                          {alert.acknowledgedBy.some((a) => !a.arrivedAt) && !onSceneText.includes("en route") &&
                            ` · ${alert.acknowledgedBy.filter((a) => !a.arrivedAt).length} en route`}
                        </p>
                      ) : ackText && (
                        <p
                          className="text-xs text-green-700 dark:text-green-400 font-medium"
                          title={fullAckList}
                          data-testid={`text-panic-ack-list-${alert.id}`}
                        >
                          ✓ {ackText} {alert.acknowledgedBy.length === 1 ? "is" : "are"} responding
                        </p>
                      )}
                    </>
                  )}
                  {hasPanicGps ? (
                    <CoordinateLink
                      lat={alert.lat!}
                      lng={alert.lng!}
                      label="View panic location"
                      onOpenMap={setGeoMapView}
                      className="text-xs text-amber-700 dark:text-amber-300"
                      testId={`link-panic-location${suffix}-${alert.id}`}
                    />
                  ) : (
                    <p className="text-xs text-amber-600/70 dark:text-amber-400/70">Location unavailable</p>
                  )}
                </div>
                {/* Dismiss only available AFTER acknowledging — prevents responders
                    silently dropping a panic from their screen without committing. */}
                {!isPanicker && hasAcked && (
                  <button
                    onClick={() => onDismiss(alert.id)}
                    className="shrink-0 text-amber-700/60 hover:text-amber-800 dark:text-amber-400/60 dark:hover:text-amber-300 transition-colors"
                    aria-label="Dismiss"
                    data-testid={`button-dismiss-panic${suffix}-${alert.id}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {isPanicker ? (
                  <button
                    onClick={() => {
                      if (closingId === alert.id) {
                        closePanic.mutate(alert.id);
                        setClosingId(null);
                      } else {
                        setClosingId(alert.id);
                        setTimeout(() => setClosingId((c) => (c === alert.id ? null : c)), 4000);
                      }
                    }}
                    disabled={closePanic.isPending}
                    className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded bg-amber-700 hover:bg-amber-800 text-white disabled:opacity-60 transition-colors"
                    data-testid={`button-close-panic${suffix}-${alert.id}`}
                  >
                    <AlertOctagon className="h-3.5 w-3.5" />
                    {closingId === alert.id ? "Tap again to confirm" : "Close panic"}
                  </button>
                ) : (
                  <>
                    {!hasAcked && (
                      <button
                        onClick={() => acknowledge.mutate(alert.id)}
                        disabled={acknowledge.isPending}
                        className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-60 transition-colors"
                        data-testid={`button-acknowledge-panic${suffix}-${alert.id}`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Acknowledge
                      </button>
                    )}
                    {hasAcked && !hasArrived && (
                      <button
                        onClick={() => respondLive(alert)}
                        disabled={joiningId === alert.id}
                        className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded bg-red-700 hover:bg-red-800 text-white disabled:opacity-60 transition-colors"
                        data-testid={`button-respond-live-panic${suffix}-${alert.id}`}
                      >
                        <Radio className="h-3.5 w-3.5" />
                        Respond Live
                      </button>
                    )}
                    {hasArrived && (
                      <button
                        onClick={() => respondLive(alert)}
                        disabled={joiningId === alert.id}
                        className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded bg-green-700 hover:bg-green-800 text-white disabled:opacity-60 transition-colors"
                        data-testid={`button-reopen-live-panic${suffix}-${alert.id}`}
                      >
                        <MapPin className="h-3.5 w-3.5" />
                        Re-open live view
                      </button>
                    )}
                    {alert.contactNumber && (
                      <a
                        href={`tel:${alert.contactNumber}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white transition-colors"
                        data-testid={`link-call-panic${suffix}-${alert.id}`}
                      >
                        <Phone className="h-3.5 w-3.5" />
                        Call {alert.firstName}
                      </a>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <GeoLocationSheet view={geoMapView} onClose={() => setGeoMapView(null)} />
    </div>
  );
}
