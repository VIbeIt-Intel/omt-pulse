import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Location } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { IncidentDialog } from "@/components/incident-dialog";
import { OmtShield } from "@/components/omt-shield";
import { HeartbeatLine } from "@/components/heartbeat-line";
import { PanicBanner, type PanicAlert } from "@/components/panic-banner";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  PlusCircle,
  Radio,
  ChevronRight,
  Siren,
  MessageSquare,
  Navigation,
  type LucideIcon,
} from "lucide-react";

type Period = "day" | "week";

type DashboardData = {
  totalIncidents: number;
  liveCount: number;
  chartData: Array<{ label: string; count: number }>;
  users: unknown[];
};

type LiveIncidentRow = {
  id: number;
  userId: string | null;
  categoryName: string | null;
  locationId: number | null;
  locationName: string | null;
  destinationName: string | null;
  liveStartedAt: string | null;
  isEscalated?: boolean;
  responders?: Array<{
    userId: string;
    firstName: string;
    lastName: string;
    joinedAt: string;
    lastPositionAt: string | null;
    arrivedAt: string | null;
  }>;
};

function ActionTile({
  title,
  subtitle,
  icon: Icon,
  onClick,
  variant = "primary",
  testId,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: "primary" | "live";
  testId: string;
}) {
  const surface =
    variant === "live"
      ? "bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-500/25"
      : "bg-gradient-to-br from-primary to-primary/85 text-primary-foreground shadow-lg shadow-primary/20";
  const subtitleClass =
    variant === "live" ? "text-white/85" : "text-primary-foreground/80";

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`w-full flex items-center gap-4 px-4 py-4 min-h-[72px] rounded-2xl active:scale-[0.98] transition-transform touch-manipulation text-left ${surface}`}
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/20">
        <Icon className="h-6 w-6" strokeWidth={2.25} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-base leading-tight">{title}</p>
        <p className={`text-sm mt-0.5 ${subtitleClass}`}>{subtitle}</p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 opacity-75" />
    </button>
  );
}

function StatTile({
  label,
  value,
  sublabel,
  onClick,
  highlight,
  testId,
}: {
  label: string;
  value: number | string;
  sublabel: string;
  onClick?: () => void;
  highlight?: boolean;
  testId: string;
}) {
  const inner = (
    <>
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">{label}</p>
      <p
        className={`text-3xl font-bold tabular-nums ${highlight ? "text-green-600 dark:text-green-400" : ""}`}
        data-testid={testId}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
        {sublabel}
        {onClick && <ChevronRight className="h-3.5 w-3.5" />}
      </p>
    </>
  );

  if (!onClick) {
    return (
      <Card>
        <CardContent className="p-4">{inner}</CardContent>
      </Card>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left w-full rounded-xl border bg-card shadow-sm hover:bg-muted/40 active:scale-[0.99] transition-all touch-manipulation"
      data-testid={`${testId}-button`}
    >
      <div className="p-4">{inner}</div>
    </button>
  );
}

export default function CommandDashboard() {
  const [, navigate] = useLocation();
  const [period, setPeriod] = useState<Period>("day");
  const [logIncidentOpen, setLogIncidentOpen] = useState(false);
  const [panicOpen, setPanicOpen] = useState(false);
  const [panicking, setPanicking] = useState(false);
  const { toast } = useToast();

  const DISMISSED_KEY = "dismissedPanicIds";
  const [dismissedPanicIds, setDismissedPanicIds] = useState<Set<number>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]")); } catch { return new Set(); }
  });

  function dismissPanic(id: number) {
    setDismissedPanicIds((prev) => {
      const next = new Set([...prev, id]);
      try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  const { data: currentUser } = useQuery<{ id: string; firstName: string; lastName: string; role: string }>({
    queryKey: ["/api/auth/me"],
  });
  const isReporter = currentUser?.role === "reporter";
  const isDispatch = currentUser?.role === "administrator" || currentUser?.role === "supervisor";

  const { data: panicAlerts = [] } = useQuery<PanicAlert[]>({
    queryKey: ["/api/panic/recent"],
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: true,
  });

  type ChatConversation = { recipientId: string | null; recipientFirstName: string | null; recipientLastName: string | null; unreadCount: number };
  const { data: chatConvos = [] } = useQuery<ChatConversation[]>({
    queryKey: ["/api/chat/conversations"],
    refetchInterval: 5000,
  });
  const totalUnread = chatConvos.reduce((sum, c) => sum + c.unreadCount, 0);
  const unreadSenders = chatConvos
    .filter((c) => c.unreadCount > 0)
    .map((c) => c.recipientId === null ? "General" : `${c.recipientFirstName ?? ""} ${c.recipientLastName ?? ""}`.trim())
    .filter(Boolean);

  async function sendPanic() {
    setPanicking(true);
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, maximumAge: 10000 })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch { /* GPS unavailable */ }
      const res = await apiRequest("POST", "/api/panic", { lat, lng });
      const { sent, found } = await res.json() as { sent: number; found: number };
      setPanicOpen(false);
      if (found === 0) {
        toast({
          title: "🆘 Panic alert stored",
          description: "No team members have push notifications enabled.",
          variant: "destructive",
        });
      } else if (sent === 0) {
        toast({ title: "🆘 Panic alert sent", description: "Alert dispatched — delivery may be delayed on some devices." });
      } else {
        toast({ title: "🆘 Panic alert sent", description: `Push notification delivered to ${sent} device${sent === 1 ? "" : "s"}.` });
      }
    } catch (e: unknown) {
      toast({
        title: "Failed to send panic alert",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPanicking(false);
    }
  }

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard", period],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard?period=${period}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: liveIncidents = [] } = useQuery<LiveIncidentRow[]>({
    queryKey: ["/api/incidents/live"],
    refetchInterval: 15_000,
  });
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });

  const visibleLiveIncidents = useMemo(() => {
    if (!isReporter || !currentUser) return liveIncidents;
    return liveIncidents.filter(
      (inc) =>
        inc.userId === currentUser.id ||
        (inc.responders ?? []).some((r) => r.userId === currentUser.id && !r.arrivedAt),
    );
  }, [liveIncidents, isReporter, currentUser?.id]);

  function openIncidentsList() {
    navigate(`/occurrence-book?period=${period}`);
  }

  function openLiveView() {
    const count = isReporter ? visibleLiveIncidents.length : (data?.liveCount ?? 0);
    if (count === 0) {
      toast({ title: "No live incidents", description: "There are no active live incidents right now." });
      return;
    }
    if (isDispatch) {
      navigate("/live-monitor");
      return;
    }
    const inc = visibleLiveIncidents[0];
    if (!inc) return;
    if (inc.userId === currentUser?.id) {
      navigate("/live-incident");
    } else {
      try { localStorage.setItem("omt_joined_incident_id", String(inc.id)); } catch { /* ignore */ }
      navigate("/live-incident");
    }
  }

  function openLiveIncidentRow(inc: LiveIncidentRow) {
    if (isDispatch) {
      navigate(`/live-monitor?incidentId=${inc.id}`);
      return;
    }
    if (inc.userId === currentUser?.id) {
      navigate("/live-incident");
    } else {
      try { localStorage.setItem("omt_joined_incident_id", String(inc.id)); } catch { /* ignore */ }
      navigate("/live-incident");
    }
  }

  const periodLabel = period === "day" ? "Today" : "This Week";
  const incidentSublabel = isReporter
    ? `my incident${(data?.totalIncidents ?? 0) === 1 ? "" : "s"} · tap to view`
    : `incident${(data?.totalIncidents ?? 0) === 1 ? "" : "s"} · tap to view`;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-4 md:p-6 pb-4 space-y-4 max-w-4xl mx-auto w-full">

        <div className="flex flex-col items-center gap-1 pt-2 pb-1">
          <OmtShield className="w-16 h-16" />
          <div className="flex items-center justify-center gap-2">
            <div style={{ transform: "scaleX(-1)" }}>
              <HeartbeatLine className="w-16 h-4" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">OMT Pulse</h1>
            <HeartbeatLine className="w-16 h-4" />
          </div>
          <p className="text-sm text-muted-foreground">
            {currentUser?.firstName ? `Welcome, ${currentUser.firstName}.` : "Welcome."}
          </p>
          <div className="flex items-center rounded-lg border border-border overflow-hidden text-sm mt-2">
            <button
              onClick={() => setPeriod("day")}
              className={`px-4 py-1.5 font-medium transition-colors ${period === "day" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
              data-testid="toggle-period-day"
            >
              Today
            </button>
            <button
              onClick={() => setPeriod("week")}
              className={`px-4 py-1.5 font-medium transition-colors border-l border-border ${period === "week" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
              data-testid="toggle-period-week"
            >
              This Week
            </button>
          </div>
        </div>

        <PanicBanner
          alerts={panicAlerts}
          currentUserId={currentUser?.id}
          dismissedIds={dismissedPanicIds}
          onDismiss={dismissPanic}
          testIdSuffix="dashboard"
        />

        {totalUnread > 0 && (
          <button
            type="button"
            onClick={() => navigate("/chat")}
            className="w-full text-left rounded-2xl border-2 border-primary/60 bg-primary/5 hover:bg-primary/10 transition-colors overflow-hidden shadow-sm"
            data-testid="banner-unread-chat"
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="relative shrink-0">
                <MessageSquare className="h-5 w-5 text-primary" />
                <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground leading-none">
                  {totalUnread > 99 ? "99+" : totalUnread}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {totalUnread} unread message{totalUnread !== 1 ? "s" : ""}
                </p>
                {unreadSenders.length > 0 && (
                  <p className="text-xs text-muted-foreground truncate">{unreadSenders.join(", ")}</p>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          </button>
        )}

        <div className="flex flex-col gap-3">
          <ActionTile
            title="Start Live Incident"
            subtitle="Share GPS and navigate in real time"
            icon={Radio}
            variant="live"
            onClick={() => navigate("/live-severity")}
            testId="button-start-live-incident"
          />
          <ActionTile
            title="Report Incident"
            subtitle="Log an occurrence to the book"
            icon={PlusCircle}
            variant="primary"
            onClick={() => setLogIncidentOpen(true)}
            testId="button-report-incident"
          />
        </div>

        <div className="flex flex-col items-center gap-1.5 py-2">
          <button
            onClick={() => setPanicOpen(true)}
            disabled={panicking}
            data-testid="button-panic"
            className="h-20 w-20 rounded-full bg-red-600 hover:bg-red-700 active:scale-95 shadow-[0_0_0_4px_rgba(220,38,38,0.3)] hover:shadow-[0_0_0_6px_rgba(220,38,38,0.4)] transition-all duration-150 flex items-center justify-center touch-manipulation"
            aria-label="Send panic alert"
          >
            <Siren className="h-9 w-9 text-white" />
          </button>
          <span className="text-[11px] font-bold tracking-widest text-red-600 dark:text-red-400 uppercase select-none">SOS</span>
        </div>
      </div>

      <div className="p-4 md:p-6 pt-1 pb-28 space-y-5 max-w-4xl mx-auto w-full">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {isLoading ? (
            <>
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </>
          ) : (
            <>
              <StatTile
                label={periodLabel}
                value={data?.totalIncidents ?? 0}
                sublabel={incidentSublabel}
                onClick={openIncidentsList}
                testId="stat-total-incidents"
              />
              <StatTile
                label="Currently Live"
                value={isReporter ? visibleLiveIncidents.length : (data?.liveCount ?? 0)}
                sublabel={
                  (isReporter ? visibleLiveIncidents.length : (data?.liveCount ?? 0)) > 0
                    ? `active · tap to open`
                    : "no active incidents"
                }
                onClick={openLiveView}
                highlight={(isReporter ? visibleLiveIncidents.length : (data?.liveCount ?? 0)) > 0}
                testId="stat-live-count"
              />
            </>
          )}
        </div>

        {visibleLiveIncidents.length > 0 && (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                <CardTitle className="text-sm font-semibold">Active Live Incidents</CardTitle>
                <span className="ml-auto text-[10px] text-muted-foreground uppercase tracking-wide">
                  {isDispatch ? "Tap → Live Monitor" : "Tap → open"}
                </span>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <ul className="divide-y divide-border">
                {visibleLiveIncidents.map((inc) => {
                  const locText =
                    inc.destinationName ||
                    inc.locationName ||
                    (inc.locationId ? locations.find((l) => l.id === inc.locationId)?.name : null) ||
                    "Unknown location";
                  const startedMs = inc.liveStartedAt ? new Date(inc.liveStartedAt).getTime() : null;
                  const minsAgo = startedMs != null ? Math.max(0, Math.round((Date.now() - startedMs) / 60000)) : null;
                  const isMine = inc.userId === currentUser?.id;
                  return (
                    <li key={inc.id}>
                      <button
                        type="button"
                        onClick={() => openLiveIncidentRow(inc)}
                        className="w-full text-left px-4 py-3 hover:bg-muted/50 active:bg-muted/70 transition-colors touch-manipulation"
                        data-testid={`row-live-incident-${inc.id}`}
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm truncate">
                                {isMine ? "Your live incident" : `Incident #${inc.id}`}
                              </span>
                              {inc.categoryName && (
                                <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                  {inc.categoryName}
                                </span>
                              )}
                              {inc.isEscalated && (
                                <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/25">
                                  ESCALATED
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1">
                              <Navigation className="h-3 w-3 shrink-0" />
                              {locText}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {minsAgo != null ? `Started ${minsAgo === 0 ? "just now" : `${minsAgo} min ago`}` : "In progress"}
                            </p>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      <IncidentDialog open={logIncidentOpen} onOpenChange={setLogIncidentOpen} />

      {panicOpen && (
        <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm px-6" data-testid="overlay-panic-confirm">
          <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
            <div className="relative flex items-center justify-center">
              <span className="absolute h-28 w-28 rounded-full bg-red-600/20 animate-ping" />
              <span className="absolute h-20 w-20 rounded-full bg-red-600/30" />
              <div className="relative h-24 w-24 rounded-full bg-red-600 flex items-center justify-center shadow-lg">
                <Siren className="h-12 w-12 text-white" />
              </div>
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white tracking-tight">Send PANIC Alert?</h2>
              <p className="text-sm text-white/70 leading-relaxed">
                This will immediately alert <strong className="text-white">everyone</strong> in your organisation. Your GPS location will be shared.
              </p>
            </div>
            {typeof Notification !== "undefined" && Notification.permission !== "granted" && (
              <div className="w-full flex items-start gap-2 rounded-xl bg-amber-500/15 border border-amber-500/40 px-4 py-3 text-xs text-amber-300 text-left">
                <Siren className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Push notifications are not enabled — alerts may be delayed.</span>
              </div>
            )}
            <div className="w-full space-y-3 pt-2">
              <button
                onClick={() => { setPanicOpen(false); sendPanic(); }}
                disabled={panicking}
                data-testid="button-confirm-panic-dashboard"
                className="w-full h-14 rounded-2xl bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white font-bold text-base tracking-wide shadow-lg transition-all touch-manipulation disabled:opacity-60"
              >
                {panicking ? "Sending alert…" : "CONFIRM — Send Alert"}
              </button>
              <button
                onClick={() => setPanicOpen(false)}
                disabled={panicking}
                className="w-full h-12 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-medium text-sm transition-all touch-manipulation"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
