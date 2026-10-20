import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft,
  Radio,
  CheckCheck,
  Check,
  Loader2,
  Gauge,
  Clock,
  WifiOff,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/page-hero";
import { useControlRoomLang } from "@/hooks/use-control-room-lang";
import { controlRoomChrome, translateNotice } from "@/lib/control-room-chrome";
import type { ControlRoomLang } from "@/lib/control-room-i18n";
import { OPS_PAGE_SHELL } from "@/lib/ops-layout";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AlertMetaBadges, AcknowledgedPill } from "@/components/alert-meta";
import { isFleetAlertType, type FleetAlertType } from "@shared/fleet-alerts";

const LAST_SEEN_KEY = "omt_notif_last_seen";

export type NotificationLog = {
  id: number;
  organizationId: string;
  userId: string;
  title: string;
  body: string;
  url: string | null;
  incidentId: number | null;
  createdAt: string;
  /** Present when this feed item is tied to a fleet alert (for Ack). */
  fleetAlertId?: number | null;
  fleetAcknowledgedAt?: string | null;
  fleetAlertType?: string | null;
};

const FLEET_ICONS: Record<FleetAlertType, typeof Gauge> = {
  speeding: Gauge,
  idle: Clock,
  offline: WifiOff,
  geofence_enter: MapPin,
  geofence_leave: MapPin,
};

const FLEET_ICON_COLORS: Record<FleetAlertType, string> = {
  speeding: "text-red-400 bg-red-950/40 border-red-800/50",
  idle: "text-amber-400 bg-amber-950/40 border-amber-800/50",
  offline: "text-slate-400 bg-slate-900/60 border-slate-700/50",
  geofence_enter: "text-blue-400 bg-blue-950/40 border-blue-800/50",
  geofence_leave: "text-orange-400 bg-orange-950/40 border-orange-800/50",
};

export function timeAgo(dateStr: string, lang: ControlRoomLang = "en"): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const af = lang === "af";
  if (mins < 1) return af ? "nou" : "just now";
  if (mins < 60) return af ? `${mins} m gelede` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return af ? `${hrs} u gelede` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return af ? `${days} d gelede` : `${days}d ago`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function markAllRead() {
  try { localStorage.setItem(LAST_SEEN_KEY, String(Date.now())); } catch { /* ignore */ }
  window.dispatchEvent(new Event("omt_notif_seen"));
}

function invalidateFleetAndNotifications(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["/api/notifications"] });
  void qc.invalidateQueries({
    predicate: (q) => {
      const key = q.queryKey[0];
      return typeof key === "string" && key.startsWith("/api/fleet-alerts");
    },
  });
}

function notificationCategory(n: NotificationLog, chrome: ReturnType<typeof controlRoomChrome>): string {
  if (n.fleetAlertId != null) return chrome.fleetBadge;
  if (n.incidentId != null) return chrome.incidentBadge;
  if (n.url?.includes("live") || n.url?.includes("panic")) return chrome.liveBadge;
  return chrome.alertBadge;
}

export function NotificationList({
  notifications,
  isLoading,
  onNavigate,
}: {
  notifications: NotificationLog[];
  isLoading: boolean;
  onNavigate?: () => void;
}) {
  const { lang } = useControlRoomLang();
  const chrome = controlRoomChrome(lang);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [ackingId, setAckingId] = useState<number | null>(null);

  const acknowledgeMutation = useMutation({
    mutationFn: async (alertId: number) => {
      setAckingId(alertId);
      const res = await apiRequest("POST", `/api/fleet-alerts/${alertId}/acknowledge`, {});
      return res.json();
    },
    onSuccess: () => {
      invalidateFleetAndNotifications(qc);
      toast({ title: "Alert acknowledged" });
    },
    onError: (e: Error) => {
      toast({ title: "Could not acknowledge", description: e.message, variant: "destructive" });
    },
    onSettled: () => setAckingId(null),
  });

  const grouped = notifications.reduce<Record<string, NotificationLog[]>>((acc, n) => {
    const day = formatDate(n.createdAt);
    if (!acc[day]) acc[day] = [];
    acc[day].push(n);
    return acc;
  }, {});

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground p-8">
        <CheckCheck className="h-12 w-12 opacity-30" />
        <p className="text-sm font-medium">{chrome.noNotices}</p>
        <p className="text-xs text-center">
          {chrome.noNoticesHint}
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/60">
      {Object.entries(grouped).map(([day, items]) => (
        <div key={day}>
          <div className="px-4 py-2 bg-muted/40 text-xs font-medium text-muted-foreground sticky top-0">
            {day}
          </div>
          {items.map((n) => {
            const fleetId = n.fleetAlertId ?? null;
            const fleetAcked = !!n.fleetAcknowledgedAt;
            const canAck = fleetId != null && !fleetAcked;
            const isAcking = ackingId === fleetId && acknowledgeMutation.isPending;
            const category = notificationCategory(n, chrome);
            const alertType = isFleetAlertType(n.fleetAlertType) ? n.fleetAlertType : null;
            const Icon = alertType ? FLEET_ICONS[alertType] : Radio;
            const iconClass = fleetAcked
              ? "text-muted-foreground bg-muted/40 border-border/60"
              : alertType
                ? FLEET_ICON_COLORS[alertType]
                : "text-primary bg-primary/10 border-primary/20";

            return (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors",
                  fleetAcked && "opacity-90",
                )}
                data-testid={`notification-item-${n.id}`}
              >
                <div
                  className={cn(
                    "mt-0.5 shrink-0 h-8 w-8 rounded-lg border flex items-center justify-center",
                    iconClass,
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <p
                      className={cn(
                        "text-sm font-medium leading-snug",
                        fleetAcked && "text-muted-foreground",
                      )}
                      data-testid={`notification-title-${n.id}`}
                    >
                      {translateNotice(lang, n.title)}
                    </p>
                    <span
                      className="text-[11px] text-muted-foreground shrink-0 mt-0.5 tabular-nums"
                      data-testid={`notification-time-${n.id}`}
                    >
                      {timeAgo(n.createdAt, lang)}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "text-xs leading-snug",
                      fleetAcked ? "text-muted-foreground/80" : "text-muted-foreground",
                    )}
                    data-testid={`notification-body-${n.id}`}
                  >
                    {translateNotice(lang, n.body)}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-0.5">
                    <AlertMetaBadges category={category} alertType={alertType} />
                    {fleetAcked && (
                      <AcknowledgedPill
                        acknowledgedAt={n.fleetAcknowledgedAt}
                        formatWhen={(iso) => timeAgo(iso, lang)}
                      />
                    )}
                    {canAck && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[11px] gap-1 border-border/80 bg-background/60 hover:bg-muted/60"
                        disabled={isAcking}
                        onClick={() => acknowledgeMutation.mutate(fleetId)}
                        data-testid={`notification-ack-${fleetId}`}
                      >
                        {isAcking ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <Check className="h-3 w-3" strokeWidth={2.5} />
                            {chrome.acknowledge}
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                  {n.url && (
                    n.url.startsWith("http") ? (
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block text-xs text-primary hover:underline cursor-pointer"
                        data-testid={`notification-link-${n.id}`}
                      >
                        {chrome.view} →
                      </a>
                    ) : (
                      <Link href={n.url} onClick={onNavigate}>
                        <span
                          className="inline-block text-xs text-primary hover:underline cursor-pointer"
                          data-testid={`notification-link-${n.id}`}
                        >
                          {chrome.view} →
                        </span>
                      </Link>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function NotificationsPage() {
  const { t, lang } = useControlRoomLang();
  const chrome = controlRoomChrome(lang);
  const queryClient = useQueryClient();
  const { data: notifications = [], isLoading } = useQuery<NotificationLog[]>({
    queryKey: ["/api/notifications"],
    refetchInterval: 30000,
  });

  const unreadCount = useMemo(() => {
    let lastSeen = 0;
    try {
      lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
    } catch {
      lastSeen = 0;
    }
    return notifications.filter((n) => new Date(n.createdAt).getTime() > lastSeen).length;
  }, [notifications]);

  function handleMarkAllRead() {
    markAllRead();
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  }

  return (
    <div className="flex flex-col h-full">
      <div className={cn(OPS_PAGE_SHELL, "shrink-0 pt-3 pb-3")}>
        <PageHero
          eyebrow={t.nav.notifications}
          badge={t.screen.last7Days}
          total={unreadCount}
          totalLabel={t.screen.unread}
          emptyMessage={
            notifications.length === 0
              ? t.screen.noNotifications
              : undefined
          }
          leading={
            <Link href="/occurrence-book">
              <Button
                variant="ghost"
                size="icon"
                aria-label={chrome.view}
                className="h-8 w-8"
                data-testid="button-notifications-back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
          }
          actions={
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 h-8"
              onClick={handleMarkAllRead}
              disabled={notifications.length === 0}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {chrome.markAllRead}
            </Button>
          }
          insights={[
            { label: chrome.inFeed, value: String(notifications.length) },
            { label: chrome.window, value: `7 ${chrome.days}` },
          ]}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <NotificationList notifications={notifications} isLoading={isLoading} />
      </div>
    </div>
  );
}
