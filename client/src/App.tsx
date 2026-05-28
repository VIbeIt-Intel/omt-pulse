import { Switch, Route, useLocation, Link } from "wouter";
import { useEffect, useState, useRef } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SubscriptionWall } from "@/components/subscription-wall";
import NotFound from "@/pages/not-found";
import OccurrenceBook from "@/pages/occurrence-book";
import AdminPage from "@/pages/admin";
import AnalyticsPage from "@/pages/analytics";
import MapViewPage from "@/pages/map-view";
import UserAdminPage from "@/pages/user-admin";
import ImportPage from "@/pages/import";
import BillingPage from "@/pages/billing";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import LiveIncidentPage from "@/pages/live-incident";
import LiveSeverityPage from "@/pages/live-severity";
import LiveMonitorPage from "@/pages/live-monitor";
import CommandDashboard from "@/pages/command-dashboard";
import CommandsPage from "@/pages/commands";
import VisibilityPage from "@/pages/visibility";
import ArchonDashboard from "@/pages/archon-dashboard";
import ArchonLoginPage from "@/pages/archon-login";
import OnboardingPage from "@/pages/onboarding";
import InvitePage from "@/pages/invite";
import LandingPage from "@/pages/landing";
import EnableAlertsPage from "@/pages/enable-alerts";
import NotificationsPage from "@/pages/notifications";
import ChatPage from "@/pages/chat";
import { Bell, CreditCard, Loader2, LogOut, Download, X, Camera, CheckCheck, Radio, HelpCircle, MessageCircle } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { type NotificationLog, timeAgo, formatDate, markAllRead } from "@/pages/notifications";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import intelafriLogo from "@assets/IntelAfri_Logo_13_January_2025_2_1778851888379.png";
import { PermissionPrimerModal } from "@/components/permission-primer-modal";
import { PermissionDeniedBanner } from "@/components/permission-denied-banner";
import { PushPermissionBanner } from "@/components/push-permission-banner";
import { PwaInstallGate } from "@/components/pwa-install-gate";
import { PanicAlertSiren } from "@/components/panic-alert-siren";
import { SetupWizardController } from "@/components/setup-wizard";

function resolveAvatarSrc(avatarUrl: string): string {
  if (avatarUrl.startsWith("data:")) return avatarUrl;
  try {
    const url = new URL(avatarUrl);
    return url.pathname + url.search;
  } catch {
    return avatarUrl;
  }
}

type AuthUser = {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  subscriptionStatus: string;
  trialEndsAt?: string | null;
  subscriptionCurrentPeriodEnd?: string | null;
  mustChangePassword?: boolean;
  avatarUrl?: string | null;
  orgName?: string | null;
  isSuperadmin?: boolean;
};

function RoleGuard({ role, allowed, children }: { role: string; allowed: string[]; children: React.ReactNode }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    if (!allowed.includes(role)) navigate("/");
  }, [role]);
  if (!allowed.includes(role)) return null;
  return <>{children}</>;
}

function BillingStatusDot({ status }: { status: string }) {
  if (status === "active" || status === "complimentary") return <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-green-500" />;
  if (status === "trial") return <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-amber-400" />;
  return <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-destructive animate-pulse" />;
}


function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

type PushSubState = "unknown" | "subscribed" | "not-subscribed" | "denied" | "unavailable";

function usePushSubscription(userId: string | undefined) {
  const [subState, setSubState] = useState<PushSubState>("unknown");

  async function doSubscribe() {
    if (!userId) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setSubState("unavailable"); return; }
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      const vapidRes = await fetch("/api/push/vapid-public-key", { credentials: "include" });
      if (!vapidRes.ok) return;
      const { vapidPublicKey } = await vapidRes.json();
      if (Notification.permission === "denied") { setSubState("denied"); return; }
      if (Notification.permission === "default") {
        const result = await Notification.requestPermission();
        if (result !== "granted") { setSubState("denied"); return; }
      }
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(sub.toJSON()),
      });
      setSubState("subscribed");
      triggerBatteryHint();
    } catch { setSubState("unavailable"); }
  }

  // Heartbeat — tells the server this user is online; fires every 60 s
  useEffect(() => {
    if (!userId) return;
    const ping = () => fetch("/api/auth/heartbeat", { method: "POST", credentials: "include" }).catch(() => {});
    ping();
    const t = setInterval(ping, 60000);
    return () => clearInterval(t);
  }, [userId]);

  // On load: silently check if a subscription already exists and re-sync it
  // to the server (endpoint can rotate after browser/OS updates). Does NOT
  // auto-prompt for permission — the banner does that explicitly.
  useEffect(() => {
    if (!userId) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setSubState("unavailable"); return; }
    if (Notification.permission === "denied") { setSubState("denied"); return; }
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
        await navigator.serviceWorker.ready;
        if (cancelled) return;
        const existing = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (!existing) {
          // Permission already granted but subscription gone — happens when the SW
          // is unregistered during a version update and a fresh SW installs.
          // Silently recreate it so the user never loses push alerts after an update.
          if (Notification.permission === "granted") {
            doSubscribe();
          } else {
            setSubState("not-subscribed");
          }
          return;
        }
        // Re-sync existing subscription so server always has the latest endpoint
        const vapidRes = await fetch("/api/push/vapid-public-key", { credentials: "include" });
        if (!vapidRes.ok || cancelled) return;
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(existing.toJSON()),
        });
        if (!cancelled) {
          setSubState("subscribed");
          // Existing users: nudge them once to fix battery settings
          triggerBatteryHint();
        }
      } catch { if (!cancelled) setSubState("unavailable"); }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return { subState, subscribe: doSubscribe };
}

// ── Capacitor FCM token registration (native Android/iOS only) ───────────────
function useCapacitorPush(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const permResult = await PushNotifications.requestPermissions();
        if (permResult.receive !== "granted") return;
        await PushNotifications.register();
        PushNotifications.addListener("registration", async (tokenData) => {
          if (cancelled) return;
          try {
            await fetch("/api/push/register-fcm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ token: tokenData.value }),
            });
          } catch { /* silent */ }
        });
        PushNotifications.addListener("registrationError", (err) => {
          console.warn("[FCM] registration error:", err);
        });
      } catch { /* not on native platform or capacitor not available */ }
    })();
    return () => { cancelled = true; };
  }, [userId]);
}

// ── Battery optimisation hint ────────────────────────────────────────────────

const BATTERY_HINT_KEY = "omt_battery_hint_shown";
const BATTERY_HINT_SESSION_KEY = "omt_battery_hint_snoozed";

function isAndroid() {
  return /android/i.test(navigator.userAgent);
}

/** Call after a successful push subscription to prompt Android users. */
function triggerBatteryHint() {
  if (!isAndroid()) return;
  try {
    if (localStorage.getItem(BATTERY_HINT_KEY) === "1") return;
    if (sessionStorage.getItem(BATTERY_HINT_SESSION_KEY) === "1") return;
  } catch { return; }
  window.dispatchEvent(new CustomEvent("omt:battery-hint-show"));
}

function BatteryOptimizationHint() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("omt:battery-hint-show", handler);
    return () => window.removeEventListener("omt:battery-hint-show", handler);
  }, []);

  function dismiss(permanent: boolean) {
    try {
      if (permanent) localStorage.setItem(BATTERY_HINT_KEY, "1");
      else sessionStorage.setItem(BATTERY_HINT_SESSION_KEY, "1");
    } catch { /* ignore */ }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) dismiss(false); }}>
      <SheetContent side="bottom" className="rounded-t-2xl px-6 pb-8 pt-4 max-w-lg mx-auto">
        <SheetHeader className="text-left mb-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            ⚡ One more step for instant alerts
          </SheetTitle>
        </SheetHeader>
        <p className="text-sm text-muted-foreground mb-4">
          Android may delay notifications while your screen is off. To ensure live incidents
          wake your device immediately, allow unrestricted background activity for Chrome:
        </p>
        <ol className="space-y-2 text-sm mb-6">
          <li className="flex items-start gap-2">
            <span className="shrink-0 font-semibold text-primary">1.</span>
            Open <strong>Settings → Apps → Chrome</strong>
          </li>
          <li className="flex items-start gap-2">
            <span className="shrink-0 font-semibold text-primary">2.</span>
            Tap <strong>Battery → Unrestricted</strong>
          </li>
          <li className="flex items-start gap-2">
            <span className="shrink-0 font-semibold text-primary">3.</span>
            Done — alerts will now ring even with the screen off ✓
          </li>
        </ol>
        <p className="text-xs text-muted-foreground mb-5">
          On Samsung devices also check: <strong>Settings → Battery → Background usage limits</strong> and make sure Chrome is not listed under sleeping apps.
        </p>
        <div className="flex flex-col gap-2">
          <Button className="w-full min-h-[44px] touch-manipulation" onClick={() => dismiss(true)} data-testid="button-battery-hint-done">
            Got it — I'll do this now
          </Button>
          <Button variant="ghost" className="w-full min-h-[44px] touch-manipulation" onClick={() => dismiss(false)} data-testid="button-battery-hint-snooze">
            Remind me next time
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Notification banner ───────────────────────────────────────────────────────

type NotifPlatform = "ios" | "android" | "desktop";

function detectNotifPlatform(): NotifPlatform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

const NOTIF_FIX_INSTRUCTIONS: Record<NotifPlatform, string> = {
  android:
    'Open Settings → Apps → Chrome (or your browser) → Permissions → Notifications → Allow. Then return here — the warning will clear automatically.',
  ios:
    'Open Settings → scroll to your browser (Chrome or Safari) → Notifications → Allow. Then return here — the warning will clear automatically.',
  desktop:
    'Click the lock icon in the address bar → Site settings → Notifications → Allow. Then return here — the warning will clear automatically.',
};

function NotificationBanner({ onEnable, denied }: { onEnable: () => void; denied: boolean }) {
  if (denied) {
    const platform = detectNotifPlatform();
    return (
      <div className="shrink-0 bg-amber-500/15 border-b border-amber-500/40 px-4 py-2 flex items-center justify-between gap-3 text-sm" data-testid="banner-push-notifications">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative shrink-0 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
          </span>
          <span className="font-semibold text-amber-700 dark:text-amber-400 shrink-0">Alerts blocked</span>
          <span className="text-amber-700/80 dark:text-amber-400/80 hidden sm:inline truncate">
            — notifications are blocked on this device.
          </span>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 transition-colors font-medium px-3 rounded hover:bg-amber-500/10 shrink-0 min-h-[44px]"
              style={{ touchAction: "manipulation" }}
              data-testid="button-fix-notifications"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              How to fix
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-4 space-y-3" data-testid="popover-notification-help">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <Bell className="h-4 w-4 text-primary" />
              Re-enable Notifications
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {NOTIF_FIX_INSTRUCTIONS[platform]}
            </p>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <div className="shrink-0 bg-white dark:bg-card border-b border-red-500/40 px-4 py-2.5 flex items-center justify-between gap-3 text-sm" data-testid="banner-push-notifications">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="relative shrink-0 flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600" />
        </span>
        <span className="font-bold text-red-600 shrink-0">🚨 Alerts OFF</span>
        <span className="text-red-600/75 hidden sm:inline truncate">
          — you won't receive Panic or Live Incident dispatches on this device
        </span>
      </div>
      <Button
        size="sm"
        className="min-h-[36px] px-4 text-xs font-bold bg-red-600 text-white hover:bg-red-700 border-0 shrink-0 touch-manipulation"
        onClick={onEnable}
        data-testid="button-enable-notifications"
      >
        Enable Now
      </Button>
    </div>
  );
}

function NotificationSheet({ open, onOpenChange, onMarkAllRead }: { open: boolean; onOpenChange: (v: boolean) => void; onMarkAllRead: () => void }) {
  const { data: notifications = [], isLoading } = useQuery<NotificationLog[]>({
    queryKey: ["/api/notifications"],
    refetchInterval: 60000,
    enabled: open,
  });

  const grouped = notifications.reduce<Record<string, NotificationLog[]>>((acc, n) => {
    const day = formatDate(n.createdAt);
    if (!acc[day]) acc[day] = [];
    acc[day].push(n);
    return acc;
  }, {});

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0" data-testid="sheet-notifications">
        <SheetHeader className="px-5 py-4 border-b border-primary/15 bg-gradient-to-r from-primary/8 via-primary/5 to-transparent flex-row items-center justify-between space-y-0 shrink-0">
          <SheetTitle className="flex items-center gap-3 text-base">
            <span className="relative flex items-center justify-center">
              <span className="absolute inset-0 rounded-full bg-primary/20 blur-sm" />
              <span className="relative flex items-center justify-center w-8 h-8 rounded-full bg-primary/15 border border-primary/25">
                <Bell className="h-4 w-4 text-primary" />
              </span>
            </span>
            <span className="font-semibold tracking-tight">Notifications</span>
          </SheetTitle>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1.5 h-7 text-primary/70 hover:text-primary hover:bg-primary/10 border border-transparent hover:border-primary/20 rounded-full px-3 transition-all"
            onClick={onMarkAllRead}
            disabled={notifications.length === 0}
            data-testid="button-sheet-mark-all-read"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all as read
          </Button>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col gap-2 p-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground p-8">
              <CheckCheck className="h-10 w-10 opacity-30" />
              <p className="text-sm font-medium">No notifications in the last 7 days</p>
              <p className="text-xs text-center">Push alerts from live incidents will appear here.</p>
            </div>
          ) : (
            <div className="divide-y">
              {Object.entries(grouped).map(([day, items]) => (
                <div key={day}>
                  <div className="px-4 py-2 bg-muted/40 text-xs font-medium text-muted-foreground sticky top-0">
                    {day}
                  </div>
                  {items.map((n) => (
                    <div key={n.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors" data-testid={`sheet-notif-item-${n.id}`}>
                      <div className="mt-0.5 shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Radio className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug">{n.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{n.body}</p>
                        {n.url && (
                          <Link href={n.url} onClick={() => onOpenChange(false)}>
                            <span className="text-xs text-primary hover:underline cursor-pointer">View →</span>
                          </Link>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 mt-0.5">{timeAgo(n.createdAt)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border-t px-4 py-3 shrink-0">
          <Link href="/notifications" onClick={() => onOpenChange(false)}>
            <Button variant="outline" size="sm" className="w-full text-xs" data-testid="button-sheet-view-all">
              View full notification history
            </Button>
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AuthenticatedApp({ user }: { user: AuthUser }) {
  const [, navigate] = useLocation();
  const pwa = usePwaInstall();
  const { subState: pushSubState, subscribe: subscribePush } = usePushSubscription(user.id);
  useCapacitorPush(user.id);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [notifSheetOpen, setNotifSheetOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: notifLogs = [] } = useQuery<{ createdAt: string }[]>({
    queryKey: ["/api/notifications"],
    refetchInterval: 60000,
  });

  // Auto-redirect: if the user has an active live incident (as creator or joiner)
  // and lands anywhere other than /live-incident on app load, send them back immediately.
  // Covers: logout → re-login, session expiry → re-login, PWA kill → reopen.
  const liveRedirectFiredRef = useRef(false);
  const { data: myLiveIncidents = [], isSuccess: liveLoaded } = useQuery<
    Array<{ id: number; userId: string | null; isLive: boolean; responders?: Array<{ userId: string }> }>
  >({
    queryKey: ["/api/incidents/live"],
    refetchInterval: 30000,
  });
  useEffect(() => {
    if (!liveLoaded || liveRedirectFiredRef.current) return;
    const myActive = myLiveIncidents.find(
      (i) =>
        i.isLive &&
        (i.userId === user.id || (i.responders ?? []).some((r) => r.userId === user.id))
    );
    if (myActive) {
      liveRedirectFiredRef.current = true;
      navigate("/live-incident");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveLoaded, myLiveIncidents]);
  const [notifLastSeen, setNotifLastSeen] = useState<number>(() => {
    try { return Number(localStorage.getItem("omt_notif_last_seen") ?? "0"); } catch { return 0; }
  });
  useEffect(() => {
    function onSeen() {
      try { setNotifLastSeen(Number(localStorage.getItem("omt_notif_last_seen") ?? "0")); } catch { /* ignore */ }
    }
    window.addEventListener("omt_notif_seen", onSeen);
    return () => window.removeEventListener("omt_notif_seen", onSeen);
  }, []);

  // When a live incident is closed the service worker sends an INVALIDATE_LIVE
  // message — immediately flush the affected queries so the dashboard and
  // occurrence book reflect the closure without waiting for the polling timer.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function onSwMessage(event: MessageEvent) {
      if (event.data?.type === "INVALIDATE_LIVE") {
        qc.invalidateQueries({ queryKey: ["/api/incidents/live"] });
        qc.invalidateQueries({ queryKey: ["/api/dashboard"] });
        qc.invalidateQueries({ queryKey: ["/api/incidents"] });
      }
      if (event.data?.type === "INVALIDATE_PANIC") {
        qc.invalidateQueries({ queryKey: ["/api/panic/recent"] });
      }
    }
    navigator.serviceWorker.addEventListener("message", onSwMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onSwMessage);
  }, [qc]);
  const hasUnreadNotif = notifLogs.some(
    (n) => new Date(n.createdAt).getTime() > notifLastSeen
  );
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/logout", {}),
    onSuccess: () => {
      queryClient.clear();
      navigate("/login");
    },
  });

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const objectUrl = URL.createObjectURL(file);
      const avatarDataUrl = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          const MAX = 256;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Image load failed")); };
        img.src = objectUrl;
      });

      setAvatarPreview(avatarDataUrl);

      const res = await fetch("/api/users/me/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ avatarDataUrl }),
      });
      if (!res.ok) {
        setAvatarPreview(null);
        const msg = await res.json().catch(() => ({ message: "Upload failed" }));
        toast({ title: "Photo upload failed", description: msg.message ?? "Please try again.", variant: "destructive" });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setAvatarPreview(null);
      toast({ title: "Photo updated", description: "Your profile photo has been saved." });
    } catch {
      setAvatarPreview(null);
      toast({ title: "Photo upload failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  const [location] = useLocation();

  if (user.mustChangePassword) {
    if (location !== "/onboarding") {
      navigate("/onboarding");
      return null;
    }
    return <OnboardingPage firstName={user.firstName} />;
  }

  if (location === "/onboarding") {
    navigate("/");
    return null;
  }

  if (location === "/" && (user.role === "administrator" || user.role === "supervisor")) {
    navigate("/dashboard");
    return null;
  }

  // SUBSCRIPTION WALL DISABLED — re-enable this block when billing goes live
  // if (user.subscriptionStatus === "expired" && location !== "/billing") {
  //   if (user.role === "administrator") {
  //     return (
  //       <div className="min-h-screen flex flex-col">
  //         <SubscriptionWall user={user} />
  //       </div>
  //     );
  //   }
  //   return <SubscriptionWall user={user} />;
  // }

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar user={user} onLogout={() => logoutMutation.mutate()} avatarPreview={avatarPreview} />
        <div className="flex flex-col flex-1 min-w-0">
          {location === "/live-incident" && (
            <>
              {/* v75: global header is hidden on /live-incident to give the
                  navigation map maximum vertical space. Two floating buttons
                  replace it: a disabled Chat placeholder (per-incident chat
                  ships in v76) and a Notifications bell that only renders
                  when there's an unread alert. */}
              <div
                className="fixed z-50 flex items-center gap-1.5"
                style={{
                  top: "max(0.5rem, env(safe-area-inset-top))",
                  right: "max(0.5rem, env(safe-area-inset-right))",
                }}
              >
                {/* Notifications bell removed from live-incident overlay — accessible via /notifications. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled
                      className="bg-background/85 backdrop-blur border shadow-md h-9 w-9 opacity-60"
                      data-testid="button-chat-live"
                      aria-label="Chat"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Per-incident chat — coming in v76</TooltipContent>
                </Tooltip>
              </div>
            </>
          )}
          {location !== "/live-incident" && (
          <header className="grid grid-cols-[1fr_auto_1fr] items-center p-2 border-b shrink-0 gap-2">
            {/* Left */}
            <div className="flex items-center">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
            </div>

            {/* Centre — logo */}
            <div className="flex items-center justify-center pointer-events-none select-none">
              <img
                src={intelafriLogo}
                alt="IntelAfri"
                className="h-9 object-contain invert dark:invert-0"
                data-testid="img-header-logo"
              />
            </div>

            {/* Right — billing, theme, avatar */}
            <div className="flex items-center gap-1 justify-end">
              {user.role === "administrator" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link href="/billing">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="relative"
                        data-testid="button-billing"
                      >
                        <CreditCard className="h-4 w-4" />
                        <BillingStatusDot status={user.subscriptionStatus} />
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {user.subscriptionStatus === "active" ? "Subscription active" : user.subscriptionStatus === "trial" ? "Trial period" : "Subscription expired"}
                  </TooltipContent>
                </Tooltip>
              )}
              {pwa.installPrompt && !pwa.dismissed && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={pwa.triggerInstall}
                      data-testid="button-pwa-install"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Install App</TooltipContent>
                </Tooltip>
              )}
              <ThemeToggle />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative"
                    data-testid="button-notifications"
                    aria-label="Notifications"
                    onClick={() => setNotifSheetOpen(true)}
                  >
                    <Bell className="h-4 w-4" />
                    {hasUnreadNotif && (
                      <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Notifications</TooltipContent>
              </Tooltip>
              <NotificationSheet
                open={notifSheetOpen}
                onOpenChange={setNotifSheetOpen}
                onMarkAllRead={() => { markAllRead(); qc.invalidateQueries({ queryKey: ["/api/notifications"] }); setNotifLastSeen(Date.now()); }}
              />

              {/* Avatar dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden border border-border hover:ring-2 hover:ring-primary/40 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    data-testid="button-avatar-menu"
                    aria-label="User menu"
                  >
                    {(avatarPreview || user.avatarUrl) ? (
                      <img
                        src={avatarPreview ?? resolveAvatarSrc(user.avatarUrl!)}
                        alt={user.firstName}
                        className="h-full w-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <span className="text-xs font-semibold text-primary select-none">
                        {`${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase()}
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel className="pb-1">
                    <p className="font-medium text-sm truncate">{user.firstName} {user.lastName}</p>
                    <p className="text-xs text-muted-foreground font-normal truncate">{user.email}</p>
                    <Badge variant="secondary" className="mt-1 text-xs capitalize">{user.role}</Badge>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2 cursor-pointer"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={avatarUploading}
                    data-testid="menu-item-change-photo"
                  >
                    {avatarUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    {avatarUploading ? "Uploading…" : "Change photo"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive gap-2 cursor-pointer"
                    onClick={() => logoutMutation.mutate()}
                    data-testid="menu-item-sign-out"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
                data-testid="input-avatar-upload"
              />
            </div>
          </header>
          )}
          {pwa.showIosHint && (
            <div className="shrink-0 bg-primary text-primary-foreground px-4 py-2.5 flex items-center justify-between gap-3 text-sm border-b border-primary/80">
              <span>
                <strong>Install OMT:</strong> Tap the Share button
                <span className="mx-1 inline-block border border-primary-foreground/60 rounded px-1 text-xs font-mono">⎙</span>
                then "Add to Home Screen"
              </span>
              <button
                onClick={pwa.dismissIosHint}
                className="shrink-0 opacity-80 hover:opacity-100 transition-opacity min-h-[44px] min-w-[44px] flex items-center justify-center touch-manipulation"
                aria-label="Dismiss"
                data-testid="button-dismiss-ios-hint"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {(pushSubState === "not-subscribed" || pushSubState === "denied") &&
            typeof Notification !== "undefined" && Notification.permission !== "granted" && (
            <NotificationBanner
              onEnable={subscribePush}
              denied={pushSubState === "denied"}
            />
          )}
          <PermissionDeniedBanner />
          <PushPermissionBanner />
          <BatteryOptimizationHint />
          <PanicAlertSiren currentUserId={user.id} />
          {(user.role === "administrator" || user.isSuperadmin) && <SetupWizardController />}
          <main className="flex-1 overflow-hidden">
            <Switch>
              <Route path="/occurrence-book" component={OccurrenceBook} />
              <Route path="/" component={OccurrenceBook} />
              <Route path="/analytics">
                <RoleGuard role={user.role} allowed={["administrator", "supervisor"]}>
                  <AnalyticsPage />
                </RoleGuard>
              </Route>
              <Route path="/map" component={MapViewPage} />
              <Route path="/admin">
                <RoleGuard role={user.role} allowed={["administrator"]}>
                  <AdminPage />
                </RoleGuard>
              </Route>
              <Route path="/user-admin">
                <RoleGuard role={user.role} allowed={["administrator"]}>
                  <UserAdminPage />
                </RoleGuard>
              </Route>
              <Route path="/import">
                <RoleGuard role={user.role} allowed={["administrator"]}>
                  <ImportPage />
                </RoleGuard>
              </Route>
              <Route path="/billing">
                <RoleGuard role={user.role} allowed={["administrator"]}>
                  <BillingPage />
                </RoleGuard>
              </Route>
              <Route path="/live-incident" component={LiveIncidentPage} />
              <Route path="/live-severity" component={LiveSeverityPage} />
              <Route path="/dashboard">
                <RoleGuard role={user.role} allowed={["administrator", "supervisor"]}>
                  <CommandDashboard />
                </RoleGuard>
              </Route>
              <Route path="/live-monitor">
                <RoleGuard role={user.role} allowed={["administrator", "supervisor"]}>
                  <LiveMonitorPage />
                </RoleGuard>
              </Route>
              <Route path="/commands">
                {(user.isSuperadmin || user.role === "administrator")
                  ? <CommandsPage />
                  : <RoleGuard role="none" allowed={[]}>{null}</RoleGuard>}
              </Route>
              <Route path="/visibility" component={VisibilityPage} />
              <Route path="/chat" component={ChatPage} />
              <Route path="/notifications" component={NotificationsPage} />
              <Route path="/login" component={RedirectToHome} />
              <Route path="/register" component={RedirectToHome} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </div>
      <PermissionPrimerModal />
    </SidebarProvider>
  );
}

function RedirectToLogin() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/login"); }, []);
  return null;
}

function RedirectToHome() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/"); }, []);
  return null;
}

function UnauthenticatedApp() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route component={RedirectToLogin} />
    </Switch>
  );
}

// Marketing landing page wrapper — public, no auth, no PWA install gate.
// First-time visitors to omtpulse.com/ see this; "Sign in / Install app"
// links into /login which is wrapped by PwaInstallGate as before.
function PublicLanding() {
  return <LandingPage />;
}

function RedirectToArchonLogin() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/archon"); }, []);
  return null;
}

function ArchonApp() {
  return (
    <Switch>
      <Route path="/archon" component={ArchonLoginPage} />
      <Route path="/archon/dashboard" component={ArchonDashboard} />
      <Route component={RedirectToArchonLogin} />
    </Switch>
  );
}

function AppContent() {
  const { data: user, isLoading, error } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    retry: false,
    // Re-check auth whenever the user brings the app back into focus (e.g. a
    // deleted user switching back to the PWA after being removed by an admin).
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || error) {
    return <UnauthenticatedApp />;
  }

  return <AuthenticatedApp user={user} />;
}

function AppRouter() {
  const [location] = useLocation();
  if (location === "/archon" || location.startsWith("/archon/")) {
    return <ArchonApp />;
  }
  // Invite links must work regardless of current auth state: a deleted user
  // may still have an active session on their device, and an authenticated
  // user accepting a re-invite should land here too.
  if (location.startsWith("/invite")) {
    return <InvitePage />;
  }
  // Enable-alerts is a public instruction page that can be shared by admins
  // with users who haven't yet turned on push notifications.
  if (location.startsWith("/enable-alerts")) {
    return <EnableAlertsPage />;
  }
  return <AppContent />;
}

// Public marketing landing page lives at "/" for unauthenticated visitors,
// OUTSIDE the PwaInstallGate so first-time visitors can read about the
// product before being asked to install. The install gate still wraps every
// other route (login, register, the app itself). Authenticated users hitting
// "/" continue to land in the app proper (AppContent decides that).
function RootRouter() {
  const [location] = useLocation();
  const { data: user, isLoading } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    retry: false,
    refetchOnWindowFocus: true,
  });

  // Archon and /invite are always public and bypass both the landing and the gate.
  if (location === "/archon" || location.startsWith("/archon/")) {
    return <ArchonApp />;
  }
  if (location.startsWith("/invite")) {
    return <InvitePage />;
  }
  if (location.startsWith("/enable-alerts")) {
    return <EnableAlertsPage />;
  }

  // Visitor at "/" with no session → marketing landing page, no install gate.
  // We render the landing while auth/me is still loading too, so the login
  // page never flashes for first-time visitors. If the user is in fact logged
  // in, the next render swaps in the authenticated app.
  if (location === "/" && !user) {
    if (isLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }
    return <PublicLanding />;
  }

  // Everything else goes through the install gate as before.
  return (
    <PwaInstallGate>
      <AppRouter />
    </PwaInstallGate>
  );
}

// Polls /api/version every 60s. When the server build id changes (i.e. a new
// version was deployed), prompts the user with a sonner toast to refresh.
// Clicking Refresh nukes all caches, unregisters the service worker, and
// reloads — so the PWA can never get stuck on a stale bundle after a deploy.
function VersionWatcher() {
  const { toast } = useToast();
  const initialBuild = useRef<string | null>(null);
  const promptedRef = useRef(false);

  useEffect(() => {
    let stopped = false;

    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { build } = await res.json() as { build: string };
        if (initialBuild.current == null) {
          initialBuild.current = build;
          return;
        }
        if (build !== initialBuild.current && !promptedRef.current) {
          promptedRef.current = true;
          toast({
            title: "New version available",
            description: "Refresh to get the latest update.",
            duration: Infinity,
            action: (
              <ToastAction
                altText="Refresh now"
                onClick={async () => {
                  try {
                    if ("serviceWorker" in navigator) {
                      const reg = await navigator.serviceWorker.getRegistration();
                      if (reg?.active) {
                        reg.active.postMessage({ type: "CLEAR_ALL_CACHES_AND_RELOAD" });
                      }
                      // Belt-and-braces: also clear caches from the page side
                      // and unregister, in case the SW message gets dropped.
                      if ("caches" in window) {
                        const keys = await caches.keys();
                        await Promise.all(keys.map((k) => caches.delete(k)));
                      }
                      if (reg) await reg.unregister().catch(() => {});
                    }
                  } finally {
                    window.location.reload();
                  }
                }}
              >
                Refresh now
              </ToastAction>
            ),
          });
        }
      } catch {
        // Network blip — silently retry next tick.
      }
    }

    // SW asks us to reload after it has cleared its caches.
    function onSwMessage(e: MessageEvent) {
      if (e.data?.type === "RELOAD_NOW") window.location.reload();
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", onSwMessage);
    }

    check();
    const id = setInterval(() => { if (!stopped) check(); }, 60_000);
    // Re-check whenever the user comes back to the tab — most likely moment
    // for them to discover an update.
    function onVis() { if (document.visibilityState === "visible") check(); }
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", onSwMessage);
      }
    };
  }, [toast]);

  return null;
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <VersionWatcher />
          <RootRouter />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
