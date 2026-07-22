import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Bell, ArrowLeft, Radio, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHero } from "@/components/page-hero";
import { OPS_PAGE_SHELL } from "@/lib/ops-layout";
import { cn } from "@/lib/utils";

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
};

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
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

export function NotificationList({ notifications, isLoading }: { notifications: NotificationLog[]; isLoading: boolean }) {
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
        <p className="text-sm font-medium">No notifications in the last 7 days</p>
        <p className="text-xs text-center">Push alerts from live incidents will appear here.</p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {Object.entries(grouped).map(([day, items]) => (
        <div key={day}>
          <div className="px-4 py-2 bg-muted/40 text-xs font-medium text-muted-foreground sticky top-0">
            {day}
          </div>
          {items.map((n) => (
            <div
              key={n.id}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
              data-testid={`notification-item-${n.id}`}
            >
              <div className="mt-0.5 shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Radio className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug" data-testid={`notification-title-${n.id}`}>
                  {n.title}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug" data-testid={`notification-body-${n.id}`}>
                  {n.body}
                </p>
                {n.url && (
                  n.url.startsWith("http") ? (
                    <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline cursor-pointer" data-testid={`notification-link-${n.id}`}>
                      View →
                    </a>
                  ) : (
                    <Link href={n.url}>
                      <span className="text-xs text-primary hover:underline cursor-pointer" data-testid={`notification-link-${n.id}`}>
                        View →
                      </span>
                    </Link>
                  )
                )}
              </div>
              <span className="text-xs text-muted-foreground shrink-0 mt-0.5" data-testid={`notification-time-${n.id}`}>
                {timeAgo(n.createdAt)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function NotificationsPage() {
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
          eyebrow="Notifications"
          badge="Last 7 days"
          total={unreadCount}
          totalLabel="Unread"
          emptyMessage={
            notifications.length === 0
              ? "No notifications in the last 7 days."
              : undefined
          }
          leading={
            <Link href="/occurrence-book">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Back"
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
              Mark all as read
            </Button>
          }
          insights={[
            { label: "In feed", value: String(notifications.length) },
            { label: "Window", value: "7 days" },
          ]}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <NotificationList notifications={notifications} isLoading={isLoading} />
      </div>
    </div>
  );
}
