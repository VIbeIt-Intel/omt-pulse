export type NativePushStatus = "unknown" | "needs-enable" | "denied" | "granted" | "error";

const PENDING_PUSH_URL_KEY = "omt_pending_push_url";
export const PUSH_DEEPLINK_EVENT = "omt:push-deeplink";

let nativePushListenersReady = false;

function pushDataUrl(data: Record<string, unknown> | undefined): string | null {
  const url = data?.url;
  return typeof url === "string" && url.startsWith("/") ? url : null;
}

/** Resolve in-app path from FCM data (fallback when url key is missing on Android). */
export function resolvePushDeepLink(data: Record<string, unknown> | undefined): string | null {
  const direct = pushDataUrl(data);
  if (direct) {
    // Reporters cannot open /live-monitor — RoleGuard sends them to dashboard.
    const monitorMatch = direct.match(/^\/live-monitor\?incidentId=(\d+)/);
    if (monitorMatch) return `/live-incident?join=${monitorMatch[1]}`;
    return direct;
  }
  const type = data?.type;
  const incidentId = data?.incidentId;
  if (type === "incident_started" && incidentId != null && String(incidentId)) {
    return `/live-incident?join=${incidentId}`;
  }
  if (type === "incident_closed" && incidentId != null && String(incidentId)) {
    return `/occurrence-book?incident=${incidentId}`;
  }
  return null;
}

function storePushDeepLink(url: string): void {
  try {
    sessionStorage.setItem(PENDING_PUSH_URL_KEY, url);
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(PUSH_DEEPLINK_EVENT, { detail: { url } }));
}

function handlePushAction(data: Record<string, unknown> | undefined): void {
  const url = resolvePushDeepLink(data);
  if (url) storePushDeepLink(url);
}

/** Register FCM tap listener as early as possible (main.tsx) so cold-start taps are not missed. */
export function initNativePushListeners(): void {
  if (nativePushListenersReady) return;
  nativePushListenersReady = true;

  void (async () => {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;

    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.addListener(
      "pushNotificationActionPerformed",
      (event) => handlePushAction(event.notification.data as Record<string, unknown>),
    );
  })();
}

/** @deprecated Prefer initNativePushListeners in main.tsx; kept for cleanup hook symmetry. */
export function setupNativePushDeepLinks(navigate: (path: string) => void): () => void {
  initNativePushListeners();
  return () => {};
}

/** Apply a deep link stored when the app opened from a notification before auth routed. */
export function consumePendingPushDeepLink(navigate: (path: string) => void): void {
  try {
    const pending = sessionStorage.getItem(PENDING_PUSH_URL_KEY);
    if (!pending) return;
    sessionStorage.removeItem(PENDING_PUSH_URL_KEY);
    navigate(pending);
  } catch { /* ignore */ }
}

/** True when the server already has an FCM token stored for this user. */
export async function fetchFcmRegisteredOnServer(): Promise<boolean> {
  try {
    const res = await fetch("/api/push/fcm-status", { credentials: "include" });
    if (!res.ok) return false;
    const body = await res.json();
    return !!body.registered;
  } catch {
    return false;
  }
}

async function waitForFcmToken(
  PushNotifications: typeof import("@capacitor/push-notifications").PushNotifications,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let regHandle: { remove: () => void } | null = null;
    let errHandle: { remove: () => void } | null = null;

    const cleanup = () => {
      window.clearTimeout(timer);
      regHandle?.remove();
      errHandle?.remove();
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const succeed = (token: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(token);
    };

    const timer = window.setTimeout(
      () => fail(new Error("FCM registration timed out")),
      30000,
    );

    // Listeners MUST be attached before register() — otherwise the token event
    // can fire synchronously and be missed (causes permanent "Alerts off").
    void (async () => {
      try {
        regHandle = await PushNotifications.addListener("registration", (tokenData) => {
          succeed(tokenData.value);
        });
        errHandle = await PushNotifications.addListener("registrationError", () => {
          fail(new Error("FCM registration failed"));
        });
        await PushNotifications.register();
      } catch (e) {
        fail(e instanceof Error ? e : new Error("FCM register failed"));
      }
    })();
  });
}

export async function checkNativePushStatus(): Promise<Exclude<NativePushStatus, "unknown">> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const perm = await PushNotifications.checkPermissions();
  if (perm.receive === "granted") return "granted";
  if (perm.receive === "denied") return "denied";
  return "needs-enable";
}

export async function registerNativePushToken(token: string): Promise<void> {
  const res = await fetch("/api/push/register-fcm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error("Server rejected FCM token");
}

/** Request permission (if needed), register with FCM, and sync token to the server. */
export async function enableNativePush(): Promise<void> {
  const { PushNotifications } = await import("@capacitor/push-notifications");

  let perm = await PushNotifications.checkPermissions();
  if (perm.receive !== "granted") {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== "granted") {
    throw new Error("denied");
  }

  const token = await waitForFcmToken(PushNotifications);
  await registerNativePushToken(token);
}

/**
 * Boot-time sync: if permission is granted and the server already has a token,
 * skip FCM register. Otherwise register and POST the token.
 */
export async function syncNativePushIfNeeded(): Promise<NativePushStatus> {
  const perm = await checkNativePushStatus();
  if (perm === "denied") return "denied";
  if (perm === "needs-enable") return "needs-enable";

  if (await fetchFcmRegisteredOnServer()) return "granted";

  try {
    await enableNativePush();
    return "granted";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "denied") return "denied";
    return "error";
  }
}
