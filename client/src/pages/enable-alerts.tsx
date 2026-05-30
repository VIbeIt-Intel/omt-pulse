import { useState, useEffect } from "react";
import { Bell, BellOff, CheckCircle2, Smartphone, Monitor, Apple, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import omtLogo from "@/assets/omt-logo-v2.png";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

type Step = { heading: string; items: string[] };

const ANDROID_APP_STEPS: Step[] = [
  {
    heading: "Samsung (Galaxy)",
    items: [
      "Open Settings → Apps → OMT Pulse",
      "Tap Notifications → make sure all are turned On",
      "Tap Permissions → Location → Allow all the time (recommended for live incidents)",
      "Re-open OMT Pulse and tap Enable below",
    ],
  },
  {
    heading: "Google Pixel / Stock Android",
    items: [
      "Open Settings → Apps → OMT Pulse",
      "Tap Notifications → toggle Allow notifications On",
      "Tap Permissions → Location → Allow all the time",
      "Re-open OMT Pulse and tap Enable below",
    ],
  },
  {
    heading: "Battery (recommended)",
    items: [
      "Settings → Apps → OMT Pulse → Battery → Unrestricted",
      "On Samsung: Settings → Battery → Background usage limits → add OMT Pulse to Never sleeping apps",
    ],
  },
];

const ANDROID_BROWSER_STEPS: Step[] = [
  {
    heading: "Samsung (Galaxy)",
    items: [
      "Open Settings → Apps → find your browser (Chrome)",
      "Tap Notifications → make sure all are turned On",
      "Reload this page and tap Enable below",
    ],
  },
  {
    heading: "Google Pixel / Stock Android",
    items: [
      "Open Settings → Apps → Chrome",
      "Tap Notifications → toggle Allow notifications On",
      "Reload this page and tap Enable below",
    ],
  },
  {
    heading: "If blocked in Chrome (Android)",
    items: [
      "Tap the padlock / info icon in the address bar",
      "Tap Permissions → Notifications → Allow",
      "Reload this page and tap Enable below",
    ],
  },
];

const IOS_STEPS: Step[] = [
  {
    heading: "iPhone / iPad",
    items: [
      "OMT Pulse must be installed as a PWA: tap the Share button in Safari → Add to Home Screen",
      "Open OMT Pulse from your Home Screen (not from Safari directly)",
      "When prompted, tap Allow for notifications",
    ],
  },
  {
    heading: "If already installed but notifications are off",
    items: [
      "Go to Settings → Notifications → OMT Pulse",
      "Toggle Allow Notifications On",
      "Re-open OMT Pulse from your Home Screen",
    ],
  },
];

const DESKTOP_STEPS: Step[] = [
  {
    heading: "Chrome / Edge",
    items: [
      "Click the padlock icon in the address bar",
      "Click Site settings → Notifications → Allow",
      "Reload this page and tap Enable below",
    ],
  },
  {
    heading: "Firefox",
    items: [
      "Click the padlock icon → Connection secure → More information",
      "Permissions tab → Receive Notifications → Allow",
      "Reload this page and tap Enable below",
    ],
  },
  {
    heading: "Safari (macOS)",
    items: [
      "Safari → Settings → Websites → Notifications",
      "Find the OMT Pulse URL → set to Allow",
      "Reload this page and tap Enable below",
    ],
  },
];

function StepCard({ heading, items }: Step) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <p className="text-sm font-semibold text-foreground">{heading}</p>
      <ol className="list-decimal pl-4 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-muted-foreground leading-relaxed">
            {item}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PlatformSection({
  icon,
  title,
  steps,
}: {
  icon: JSX.Element;
  title: string;
  steps: Step[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
        data-testid={`button-expand-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <span className="flex items-center gap-2 font-medium text-sm text-foreground">
          {icon}
          {title}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="p-4 space-y-3 bg-background">
          {steps.map((s, i) => (
            <StepCard key={i} {...s} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function EnableAlertsPage() {
  const nativeApp = Capacitor.isNativePlatform();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | "unknown">("unknown");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (nativeApp) {
      setPermission("unknown");
      return;
    }
    if (!("Notification" in window)) {
      setPermission("unsupported");
    } else {
      setPermission(Notification.permission);
    }
  }, [nativeApp]);

  async function handleEnableNative() {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== "granted") {
      setError("Notifications were not allowed. Open Settings → Apps → OMT Pulse → Notifications and turn them on, then try again.");
      return;
    }

    const token = await new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("FCM registration timed out")), 15000);
      let regHandle: { remove: () => void } | null = null;
      let errHandle: { remove: () => void } | null = null;
      const cleanup = () => {
        window.clearTimeout(timeout);
        regHandle?.remove();
        errHandle?.remove();
      };
      void PushNotifications.addListener("registration", (tokenData) => {
        cleanup();
        resolve(tokenData.value);
      }).then((h) => { regHandle = h; });
      void PushNotifications.addListener("registrationError", () => {
        cleanup();
        reject(new Error("FCM registration failed"));
      }).then((h) => { errHandle = h; });
      PushNotifications.register().catch((e) => {
        cleanup();
        reject(e);
      });
    });

    const res = await fetch("/api/push/register-fcm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    });
    if (!res.ok) throw new Error("Server rejected FCM token");
    setDone(true);
  }

  async function handleEnable() {
    if (busy || done) return;
    setError(null);
    setBusy(true);
    try {
      if (nativeApp) {
        await handleEnableNative();
        return;
      }
      if (!("Notification" in window)) {
        setError("Your browser doesn't support notifications. Try Chrome or Firefox.");
        return;
      }
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        setError("Permission was not granted. Follow the steps below to allow notifications, then try again.");
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setDone(true);
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      const vapidRes = await fetch("/api/push/vapid-public-key", { credentials: "include" });
      if (!vapidRes.ok) {
        setDone(true);
        return;
      }
      const { vapidPublicKey } = await vapidRes.json();
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
      setDone(true);
    } catch {
      setError(nativeApp
        ? "Something went wrong registering this device. Make sure you're logged in, then try again."
        : "Something went wrong. Make sure you're logged in to OMT Pulse, then try again.");
    } finally {
      setBusy(false);
    }
  }

  const isGranted = !nativeApp && permission === "granted";
  const isDenied = !nativeApp && permission === "denied";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <img src={omtLogo} alt="OMT Pulse" className="h-12 w-auto" />
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-foreground">Enable Panic Alerts</h1>
            <p className="text-sm text-muted-foreground">
              Allow OMT Pulse to send you alerts so your phone rings for panic and live-incident notifications — even when the app is closed.
            </p>
          </div>
        </div>

        {done ? (
          <div
            className="rounded-xl border-2 border-green-500/60 bg-green-500/10 px-5 py-4 flex items-start gap-3"
            data-testid="banner-alerts-enabled"
          >
            <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5 text-green-600 dark:text-green-400" />
            <div>
              <p className="text-sm font-semibold text-green-900 dark:text-green-200">Alerts enabled!</p>
              <p className="text-xs text-green-800/90 dark:text-green-300/90 mt-0.5">
                You'll now receive panic and live-incident alerts on this device. You can close this page.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border-2 border-amber-500/60 bg-amber-500/10 px-5 py-4 space-y-3">
            <div className="flex items-start gap-3">
              {isGranted
                ? <Bell className="h-5 w-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                : <BellOff className="h-5 w-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              }
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  {nativeApp
                    ? "Turn on notifications for this app"
                    : isGranted
                    ? "Permission granted — tap below to finish"
                    : "Notifications are not enabled"}
                </p>
                <p className="text-xs text-amber-800/90 dark:text-amber-300/90 mt-0.5">
                  {nativeApp
                    ? "Tap below — Android will ask you to allow notifications for OMT Pulse. Tap Allow."
                    : isDenied
                    ? "Notifications are blocked. Follow the device instructions below to unblock them, then tap the button."
                    : isGranted
                    ? "Your browser has given permission. Tap the button to register your device for push alerts."
                    : "Tap the button below. Your browser will ask you to allow notifications — tap Allow."}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleEnable}
              disabled={busy || done}
              data-testid="button-enable-alerts"
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-60 px-4 py-2 text-sm font-semibold text-white transition-colors"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? "Enabling…" : isDenied ? "I've allowed it — re-check" : "Enable alerts"}
            </button>

            {error && (
              <p className="text-xs text-red-700 dark:text-red-400" data-testid="text-enable-error">{error}</p>
            )}
          </div>
        )}

        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Device-specific instructions
          </p>
          <PlatformSection
            icon={<Smartphone className="h-4 w-4" />}
            title={nativeApp ? "Android app (OMT Pulse)" : "Android"}
            steps={nativeApp ? ANDROID_APP_STEPS : ANDROID_BROWSER_STEPS}
          />
          {!nativeApp && (
            <>
              <PlatformSection
                icon={<Apple className="h-4 w-4" />}
                title="iPhone / iPad (iOS)"
                steps={IOS_STEPS}
              />
              <PlatformSection
                icon={<Monitor className="h-4 w-4" />}
                title="Desktop (Chrome, Firefox, Safari)"
                steps={DESKTOP_STEPS}
              />
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Already enabled? You can close this page.
          <br />
          Having trouble? Ask your administrator for help.
        </p>
      </div>
    </div>
  );
}
