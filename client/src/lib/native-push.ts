import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

export type NativePushStatus = "unknown" | "needs-enable" | "denied" | "granted" | "error";

const PENDING_PUSH_URL_KEY = "omt_pending_push_url";
export { PENDING_PUSH_URL_KEY };
export const PUSH_DEEPLINK_EVENT = "omt:push-deeplink";

let nativePushListenersReady = false;

function pushDataUrl(data: Record<string, unknown> | undefined): string | null {
  const url = data?.url;
  return typeof url === "string" && url.startsWith("/") ? url : null;
}

/** Normalize legacy panic URLs to the live-incident join flow. */
export function rewritePushDeepLinkPath(url: string): string {
  const monitorMatch = url.match(/^\/live-monitor\?incidentId=(\d+)/);
  if (monitorMatch) return `/live-incident?join=${monitorMatch[1]}`;
  return url;
}

/** Resolve in-app path from FCM data (fallback when url key is missing on Android). */
export function resolvePushDeepLink(data: Record<string, unknown> | undefined): string | null {
  const direct = pushDataUrl(data);
  if (direct) {
    return rewritePushDeepLinkPath(direct);
  }
  const type = data?.type;
  const incidentId = data?.incidentId;
  if (type === "panic" && incidentId != null && String(incidentId)) {
    return `/live-incident?join=${incidentId}`;
  }
  if (type === "incident_started" && incidentId != null && String(incidentId)) {
    return `/live-incident?join=${incidentId}`;
  }
  if (type === "incident_closed" && incidentId != null && String(incidentId)) {
    return `/occurrence-book?incident=${incidentId}`;
  }
  if (type === "incident_reported" && incidentId != null && String(incidentId)) {
    return `/occurrence-book?incident=${incidentId}`;
  }
  if (type === "chat_message") {
    return direct ?? "/chat";
  }
  if (type === "fleet_alert") {
    const deviceId = data?.deviceId;
    if (deviceId != null && String(deviceId)) {
      return `/fleet?device=${deviceId}`;
    }
    return "/fleet";
  }
  return null;
}

function storePushDeepLink(url: string): void {
  try {
    sessionStorage.setItem(PENDING_PUSH_URL_KEY, url);
    localStorage.setItem(PENDING_PUSH_URL_KEY, url);
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(PUSH_DEEPLINK_EVENT, { detail: { url } }));
}

function readPendingPushDeepLink(): string | null {
  try {
    return (
      sessionStorage.getItem(PENDING_PUSH_URL_KEY)
      ?? localStorage.getItem(PENDING_PUSH_URL_KEY)
    );
  } catch {
    return null;
  }
}

function clearPendingPushDeepLink(): void {
  try {
    sessionStorage.removeItem(PENDING_PUSH_URL_KEY);
    localStorage.removeItem(PENDING_PUSH_URL_KEY);
  } catch { /* ignore */ }
}

function handlePushAction(data: Record<string, unknown> | undefined): void {
  const url = resolvePushDeepLink(data);
  if (url) storePushDeepLink(url);
}

/** Register FCM tap listener as early as possible (main.tsx) so cold-start taps are not missed. */
export function initNativePushListeners(): void {
  if (nativePushListenersReady) return;
  if (!Capacitor.isNativePlatform()) return;
  nativePushListenersReady = true;

  void PushNotifications.addListener(
    "pushNotificationActionPerformed",
    (event) => handlePushAction(event.notification.data as Record<string, unknown>),
  );
}

/** @deprecated Prefer initNativePushListeners in main.tsx; kept for cleanup hook symmetry. */
export function setupNativePushDeepLinks(navigate: (path: string) => void): () => void {
  initNativePushListeners();
  return () => {};
}

/** Apply a deep link stored when the app opened from a notification before auth routed. */
export function consumePendingPushDeepLink(navigate: (path: string) => void): boolean {
  const pending = readPendingPushDeepLink();
  if (!pending) return false;
  clearPendingPushDeepLink();
  navigate(pending);
  return true;
}

/** Retry consumption — cold-start FCM tap can arrive after the first mount effect. */
export function schedulePendingPushDeepLinkConsumption(
  navigate: (path: string) => void,
): () => void {
  const tryConsume = () => {
    consumePendingPushDeepLink(navigate);
  };
  tryConsume();
  const t1 = window.setTimeout(tryConsume, 400);
  const t2 = window.setTimeout(tryConsume, 1_500);
  const t3 = window.setTimeout(tryConsume, 3_500);
  return () => {
    window.clearTimeout(t1);
    window.clearTimeout(t2);
    window.clearTimeout(t3);
  };
}

/** True when the server already has an FCM token stored for this user. */
export async function fetchFcmRegisteredOnServer(): Promise<boolean | "unknown"> {
  try {
    const res = await fetch("/api/push/fcm-status", { credentials: "include" });
    if (!res.ok) return false;
    const body = await res.json();
    return !!body.registered;
  } catch {
    // Network blip (e.g. data just restored) — don't treat as "no token on server".
    return "unknown";
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
  rememberSyncedToken(token);
}

const LAST_FCM_TOKEN_KEY = "omt_last_fcm_token";

function readLastSyncedToken(): string | null {
  try {
    return localStorage.getItem(LAST_FCM_TOKEN_KEY);
  } catch {
    return null;
  }
}

function rememberSyncedToken(token: string): void {
  try {
    localStorage.setItem(LAST_FCM_TOKEN_KEY, token);
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Boot/foreground sync: when permission is granted, always read the CURRENT
 * device FCM token and sync it to the server when it has changed.
 *
 * The previous implementation skipped registration whenever the server already
 * had *a* token for the user. But FCM rotates/invalidates tokens (app update,
 * data clear, OS refresh, reinstall). When that happened, the device opened,
 * saw "server already has a token" (the OLD, now-dead one), and never replaced
 * it — leaving that device permanently undeliverable. We now re-register
 * whenever the live device token differs from the last one we synced, or the
 * server has no token on record.
 */
export async function syncNativePushIfNeeded(): Promise<NativePushStatus> {
  const perm = await checkNativePushStatus();
  if (perm === "denied") return "denied";
  if (perm === "needs-enable") return "needs-enable";

  const lastSynced = readLastSyncedToken();

  // Data off: don't call FCM or show a false "not synced" if we synced before.
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    if (lastSynced) return "granted";
    return "error";
  }

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const serverRegistered = await fetchFcmRegisteredOnServer();
    if (serverRegistered === false) {
      try {
        localStorage.removeItem(LAST_FCM_TOKEN_KEY);
      } catch {
        /* ignore storage errors */
      }
    }
    const token = await waitForFcmToken(PushNotifications);
    const changed = token !== readLastSyncedToken();
    const needsServerSync = serverRegistered === false || serverRegistered === "unknown";
    if (changed || needsServerSync) {
      await registerNativePushToken(token);
      rememberSyncedToken(token);
    }
    return "granted";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "denied") return "denied";
    // Transient failure after airplane mode / slow mobile data — keep last good state.
    if (lastSynced) return "granted";
    return "error";
  }
}
