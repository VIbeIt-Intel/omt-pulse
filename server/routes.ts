import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import webpush from "web-push";
import admin from "firebase-admin";
import { storage, db, type LiveIncident } from "./storage";
import { insertLocationSchema, insertCategorySchema, insertIncidentSchema, insertFormFieldSchema, insertCustomMapSchema, incidents as incidentsTable, incidentCategories, locations as locationsTable, importBatches, type User, type Organization, type Incident, type InsertAuditLog, type InsertIncident } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import bcrypt from "bcrypt";
import { z } from "zod";
import { DEFAULT_FORM_FIELDS } from "./seed";
import { APP_CACHE_VERSION } from "@shared/cache-version";
import { USER_ROLES, DISPATCH_STAFF_ROLES, isDispatchStaff, isControlRoom, isAccessController, isOwnIncidentScopedRole, usesLocationAssignmentScope, getPermissionsForRole } from "@shared/user-roles";
import { isWithinPremiseRadius, PREMISE_COVERAGE_RADIUS_M } from "@shared/premises-geofence";
import { ObjectStorageService, ObjectNotFoundError } from "./replit_integrations/object_storage/objectStorage";
import { parseFile, suggestMapping, resolveRows, collectUnknownReferences, buildTemplateXLSX, buildErrorsCSV, type ImportMapping, type ParsedFile } from "./import-parser";
import * as XLSX from "xlsx";
import { CENTRAL_COMMAND_NAME } from "./archon-constants";
import { sendArchonWelcomeEmail } from "./archon-welcome-email";
import { createInviteToken, hashPlaceholderPassword } from "./user-invite";
import { appInviteUrl } from "@shared/app-url";
import { formatOrgAddress } from "@shared/org-address";
import { resolveAttachmentByteSize } from "@shared/attachment-byte-size";
import { isPositionUserEmail } from "@shared/workstations";

const objectStorageService = new ObjectStorageService();

const SALT_ROUNDS = 10;

// Normalise a base64 string to URL-safe base64 without padding.
// Some secret managers or copy-paste flows produce standard base64 with +/=/
// characters that web-push rejects.
function toUrlSafeBase64(key: string): string {
  // Strip ALL whitespace (including embedded newlines from copy-paste), convert
  // standard base64 characters (+/) to URL-safe equivalents (-_), and remove
  // all padding (=) regardless of position.
  return key.replace(/\s/g, "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// Initialise VAPID once — safe to call even if keys are missing or malformed
// (pushes will just fail silently rather than crashing the server).
// NOTE: the secrets were stored with public/private swapped, so we auto-detect
// which is which by key length: a VAPID public key is 87 chars (base64url),
// a private key is 43 chars. We assign them correctly regardless of env var name.
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  try {
    const keyA = toUrlSafeBase64(process.env.VAPID_PUBLIC_KEY);
    const keyB = toUrlSafeBase64(process.env.VAPID_PRIVATE_KEY);
    const vapidPublicKey  = keyA.length > keyB.length ? keyA : keyB;
    const vapidPrivateKey = keyA.length > keyB.length ? keyB : keyA;
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:admin@omt.app",
      vapidPublicKey,
      vapidPrivateKey,
    );
    console.log("VAPID initialised — push notifications enabled");
  } catch (err) {
    console.warn("VAPID key setup failed — push notifications disabled:", err instanceof Error ? err.message : String(err));
  }
}

function loadFirebaseServiceAccount(): Record<string, unknown> | null {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) as Record<string, unknown>;
  }
  const filePath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(process.cwd(), "secrets", "firebase-service-account.json");
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

// Firebase Admin SDK — FCM V1 API for native Android/iOS push
let fcmReady = false;
try {
  const serviceAccount = loadFirebaseServiceAccount();
  if (serviceAccount) {
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount as admin.ServiceAccount) });
    }
    fcmReady = true;
    const source = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? "FIREBASE_SERVICE_ACCOUNT_JSON"
      : process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "secrets/firebase-service-account.json";
    console.log(`Firebase Admin initialised — FCM native push enabled (${source})`);
  }
} catch (err) {
  console.warn("Firebase Admin init failed — FCM push disabled:", err instanceof Error ? err.message : String(err));
}

function liveIncidentFcmTag(incidentId: number): string {
  return `incident-${incidentId}`;
}

function liveIncidentNotifyRoles(severity: string | null | undefined): string[] {
  return severity === "yellow"
    ? ["administrator"]
    : ["administrator", "supervisor", "control_room", "reporter"];
}

async function sendFcmBatch(
  tokens: string[],
  payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
    notificationTag?: string;
    /** Android notification channel id (must be created on-device). */
    channelId?: string;
    /** Custom sound name (Android raw resource / APNs sound file). */
    sound?: string;
  },
): Promise<void> {
  if (!fcmReady || tokens.length === 0) return;
  const messaging = admin.messaging();
  const android: admin.messaging.AndroidConfig = { priority: "high" };
  const androidNotification: NonNullable<admin.messaging.AndroidConfig["notification"]> = {};
  if (payload.notificationTag) androidNotification.tag = payload.notificationTag;
  // On Android O+ the channel owns the sound; the sound field only matters
  // pre-O. Set both so every OS version plays the custom tone.
  if (payload.channelId) androidNotification.channelId = payload.channelId;
  if (payload.sound) androidNotification.sound = payload.sound;
  if (Object.keys(androidNotification).length > 0) {
    android.notification = androidNotification;
  }
  const apnsSound = payload.sound ? `${payload.sound}.caf` : "default";
  const results = await Promise.allSettled(
    tokens.map((token) =>
      messaging.send({
        token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ?? {},
        android,
        apns: { payload: { aps: { sound: apnsSound, contentAvailable: true } } },
      })
    )
  );
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "rejected") {
      const reason = r.reason as { code?: string; errorInfo?: { code?: string } } | undefined;
      const code = reason?.code ?? reason?.errorInfo?.code ?? "";
      const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      // Firebase Admin reports dead tokens via the error CODE
      // (messaging/registration-token-not-registered), while the human-readable
      // MESSAGE is "Requested entity was not found." The old check only matched
      // the message text, so stale tokens were never pruned and piled up — and
      // every live-incident push wasted a send on a device that could never
      // receive it. Match the code (with message fallbacks) so they are removed.
      const isDeadToken =
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        errMsg.includes("registration-token-not-registered") ||
        errMsg.includes("invalid-registration-token") ||
        errMsg.includes("Requested entity was not found");
      if (isDeadToken) {
        storage.deleteFcmToken(tokens[i]).catch(() => {});
      } else {
        console.error("[FCM] send failed for token:", errMsg);
      }
    }
  }
}

// High-urgency push options — tells FCM/APNs to wake Android/iOS immediately
// even in Doze / battery-saving mode. Applied to all live-incident alerts.
// TTL of 1 hour (3600 s) ensures the push survives brief connectivity gaps —
// the previous 5-minute TTL caused silent drops on devices with poor signal.
const URGENT_PUSH = { urgency: "high" as const, TTL: 3600 };

// Track incidents that have already received a retry push so we only re-fire once.
const retriedIncidentIds = new Set<number>();

// Deduplicate a subscription list by endpoint — prevents sending the same push
// twice if an endpoint is somehow stored more than once. Does NOT deduplicate
// by userId, so users with multiple devices (phone + computer) all receive it.
function dedupeByEndpoint<T extends { endpoint: string }>(subs: T[]): T[] {
  return Array.from(
    subs.reduce((map, s) => { map.set(s.endpoint, s); return map; }, new Map<string, T>()).values()
  );
}

// In-memory dedup for "Responder Navigating" pushes — keyed by incidentId,
// holds a signature of the last pushed destination so we only push again when
// the destination actually changes. Entries auto-expire after 1 h to avoid leaks.
const lastNavigatingDest = new Map<number, { sig: string; at: number }>();
function destSignature(name: string | null, lat: number, lng: number) {
  return `${name ?? ""}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
}
function shouldSendNavigatingPush(incidentId: number, sig: string): boolean {
  const now = Date.now();
  // Drop entries older than 1 h
  for (const [k, v] of lastNavigatingDest) {
    if (now - v.at > 60 * 60 * 1000) lastNavigatingDest.delete(k);
  }
  const prev = lastNavigatingDest.get(incidentId);
  if (prev && prev.sig === sig) return false;
  lastNavigatingDest.set(incidentId, { sig, at: now });
  return true;
}

async function dispatchLiveIncidentPush(orgId: string, triggerUserId: string, incident: Incident) {
  console.log("[PUSH] dispatchLiveIncidentPush called for incident", incident.id, "by user", triggerUserId);
  // Yellow severity is a low-priority alert — only administrators are notified.
  // Orange and red notify all roles so reporters can join their colleagues.
  // Creator is excluded in all cases via triggerUserId.
  const TARGET_ROLES = incident.severity === "yellow"
    ? ["administrator"]
    : ["administrator", "supervisor", "control_room", "reporter"];
  const subs = await storage.getPushSubscriptionsByOrg(orgId, triggerUserId, TARGET_ROLES, undefined);
  console.log(`[PUSH] Found ${subs.length} subscriptions for org ${orgId} (triggered by ${triggerUserId})`);

  const reporter = await storage.getUserById(triggerUserId);
  const fullName = reporter ? `${reporter.firstName} ${reporter.lastName}`.trim() : "A user";

  // Look up category name so we can include it in the single notification
  let catName: string | null = null;
  if (incident.categoryId) {
    const cat = await storage.getCategory(incident.categoryId, orgId);
    catName = cat?.name ?? null;
  }

  const sevEmoji = incident.severity === "red" ? "🔴" : incident.severity === "orange" ? "🟠" : "🚨";
  const catPart = catName ? ` · ${catName}` : "";
  const title = `${sevEmoji} Live Incident — ${fullName}${catPart}`;
  const locPart = incident.liveStartLat != null && incident.liveStartLng != null
    ? `${Number(incident.liveStartLat).toFixed(4)}, ${Number(incident.liveStartLng).toFixed(4)}`
    : "Location being tracked";

  const body = `Started at ${incident.incidentTime} · ${locPart} · Tap to respond`;

  const joinUrl = `/live-incident?join=${incident.id}`;
  const payload = JSON.stringify({
    type: "incident_started",
    title,
    body,
    incidentId: incident.id,
    url: joinUrl,
  });

  const pushedUserIds = new Set<string>();

  if (subs.length > 0) {
    await Promise.allSettled(
      dedupeByEndpoint(subs).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            URGENT_PUSH
          );
          pushedUserIds.add(sub.userId);
          storage.createNotificationLog({
            organizationId: orgId,
            userId: sub.userId,
            title,
            body,
            url: joinUrl,
            incidentId: incident.id,
          }).catch(() => {});
        } catch (err: unknown) {
          const statusCode = typeof err === "object" && err !== null && "statusCode" in err
            ? (err as { statusCode: number }).statusCode
            : 0;

          if (statusCode === 410 || statusCode === 404) {
            await storage.deletePushSubscription(sub.endpoint);
          } else {
            console.error("[push] send failed (status=%d):", statusCode, err instanceof Error ? err.message : err);
          }
        }
      })
    );
  }

  // FCM fan-out — native Android/iOS devices
  const fcmTag = liveIncidentFcmTag(incident.id);
  storage.getFcmTokensByOrg(orgId, triggerUserId, TARGET_ROLES).then((fcmSubs) => {
    if (fcmSubs.length > 0) {
      sendFcmBatch(fcmSubs.map((s) => s.token), {
        title,
        body,
        data: { type: "incident_started", incidentId: String(incident.id), url: joinUrl },
        notificationTag: fcmTag,
      }).catch(() => {});
    }
  }).catch(() => {});

  // Write notification-log entries for admins/supervisors who have no push
  // subscription so they still see the alert in the notification bell.
  (async () => {
    try {
      const allActive = await storage.getActiveUsersByOrg(orgId);
      const noPushUsers = allActive.filter(
        (u) =>
          u.id !== triggerUserId &&
          TARGET_ROLES.includes(u.role ?? "") &&
          !pushedUserIds.has(u.id)
      );
      await Promise.allSettled(
        noPushUsers.map((u) =>
          storage.createNotificationLog({
            organizationId: orgId,
            userId: u.id,
            title,
            body,
            url: joinUrl,
            incidentId: incident.id,
          }).catch(() => {})
        )
      );
    } catch { /* best-effort */ }
  })();
}

async function dispatchFleetAlertPush(
  orgId: string,
  alert: FleetAlertSummary,
  commandId: number | null,
) {
  const title = alert.title;
  const body = alert.message;
  const detailUrl = `/fleet?device=${alert.deviceId}`;
  const payload = JSON.stringify({
    type: "fleet_alert",
    title,
    body,
    url: detailUrl,
    deviceId: String(alert.deviceId),
    alertType: alert.alertType,
  });

  const commandIds = commandId != null ? [commandId] : undefined;
  const subs = await storage.getPushSubscriptionsByOrg(
    orgId,
    undefined,
    [...FLEET_ALERT_NOTIFY_ROLES],
    commandIds,
  );
  const pushedUserIds = new Set<string>();

  if (subs.length > 0) {
    await Promise.allSettled(
      dedupeByEndpoint(subs).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            URGENT_PUSH,
          );
          pushedUserIds.add(sub.userId);
          storage.createNotificationLog({
            organizationId: orgId,
            userId: sub.userId,
            title,
            body,
            url: detailUrl,
          }).catch(() => {});
        } catch (err: unknown) {
          const statusCode = typeof err === "object" && err !== null && "statusCode" in err
            ? (err as { statusCode: number }).statusCode
            : 0;
          if (statusCode === 410 || statusCode === 404) {
            await storage.deletePushSubscription(sub.endpoint);
          }
        }
      }),
    );
  }

  const fcmSubs = await storage.getFcmTokensByOrg(
    orgId,
    undefined,
    [...FLEET_ALERT_NOTIFY_ROLES],
    commandIds,
  );
  if (fcmSubs.length > 0) {
    await sendFcmBatch(fcmSubs.map((s) => s.token), {
      title,
      body,
      data: {
        type: "fleet_alert",
        url: detailUrl,
        deviceId: String(alert.deviceId),
        alertType: alert.alertType,
      },
      notificationTag: `fleet-alert-${alert.deviceId}-${alert.alertType}`,
    });
    for (const s of fcmSubs) pushedUserIds.add(s.userId);
  }

  try {
    const allActive = await storage.getActiveUsersByOrg(orgId);
    const noPushUsers = allActive.filter(
      (u) =>
        FLEET_ALERT_NOTIFY_ROLES.includes(u.role as (typeof FLEET_ALERT_NOTIFY_ROLES)[number])
        && !pushedUserIds.has(u.id),
    );
    await Promise.allSettled(
      noPushUsers.map((u) =>
        storage.createNotificationLog({
          organizationId: orgId,
          userId: u.id,
          title,
          body,
          url: detailUrl,
        }).catch(() => {}),
      ),
    );
  } catch { /* best-effort */ }
}

const PATROL_OVERDUE_NOTIFY_ROLES = ["administrator", "supervisor", "control_room"] as const;
// Must match PATROL_NOTIFICATION_CHANNEL_ID / raw sound name on the device.
const PATROL_ALERT_CHANNEL = "patrol_alerts";
const PATROL_ALERT_SOUND = "patrol_alert";

async function dispatchPatrolPush(req: PatrolPushRequest): Promise<void> {
  const detailUrl = `/patrol?routeId=${req.routeId}`;
  const isOverdue = req.kind === "patrol_overdue";
  const title = isOverdue ? "Patrol overdue" : "Patrol due";
  const body = isOverdue
    ? `${req.patrollerName ?? "Patroller"} has not started ${req.routeName}`
    : `Time to run ${req.routeName}`;
  const data = {
    type: req.kind,
    url: detailUrl,
    routeId: String(req.routeId),
    ...(req.dispatchId != null ? { dispatchId: String(req.dispatchId) } : {}),
  };
  const payload = JSON.stringify({ type: req.kind, title, body, url: detailUrl, routeId: String(req.routeId) });
  const pushedUserIds = new Set<string>();

  if (!isOverdue && req.userId) {
    const fcmSubs = await storage.getFcmTokensByUser(req.userId);
    if (fcmSubs.length > 0) {
      await sendFcmBatch(fcmSubs.map((s) => s.token), {
        title,
        body,
        data,
        notificationTag: `patrol-${req.routeId}`,
        channelId: PATROL_ALERT_CHANNEL,
        sound: PATROL_ALERT_SOUND,
      });
      pushedUserIds.add(req.userId);
    }

    const webSubs = await storage.getPushSubscriptionsByOrg(req.organizationId);
    const userWeb = webSubs.filter((s) => s.userId === req.userId);
    if (userWeb.length > 0) {
      await Promise.allSettled(
        dedupeByEndpoint(userWeb).map(async (sub) => {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload,
              URGENT_PUSH,
            );
            pushedUserIds.add(sub.userId);
          } catch (err: unknown) {
            const statusCode =
              typeof err === "object" && err !== null && "statusCode" in err
                ? (err as { statusCode: number }).statusCode
                : 0;
            if (statusCode === 410 || statusCode === 404) {
              await storage.deletePushSubscription(sub.endpoint);
            }
          }
        }),
      );
    }

    if (!pushedUserIds.has(req.userId)) {
      await storage.createNotificationLog({
        organizationId: req.organizationId,
        userId: req.userId,
        title,
        body,
        url: detailUrl,
      }).catch(() => {});
    }
    return;
  }

  // Overdue: remind patroller + notify supervisors/admins/control room
  if (req.userId) {
    const fcmSubs = await storage.getFcmTokensByUser(req.userId);
    if (fcmSubs.length > 0) {
      await sendFcmBatch(fcmSubs.map((s) => s.token), {
        title,
        body: `Start ${req.routeName} now — overdue`,
        data,
        notificationTag: `patrol-overdue-${req.routeId}`,
        channelId: PATROL_ALERT_CHANNEL,
        sound: PATROL_ALERT_SOUND,
      });
    }
  }

  const roles = [...PATROL_OVERDUE_NOTIFY_ROLES];
  const fcmSubs = await storage.getFcmTokensByOrg(req.organizationId, req.userId, roles);
  if (fcmSubs.length > 0) {
    await sendFcmBatch(fcmSubs.map((s) => s.token), {
      title,
      body,
      data,
      notificationTag: `patrol-overdue-mgmt-${req.routeId}`,
      channelId: PATROL_ALERT_CHANNEL,
      sound: PATROL_ALERT_SOUND,
    });
    for (const s of fcmSubs) pushedUserIds.add(s.userId);
  }

  const webSubs = await storage.getPushSubscriptionsByOrg(
    req.organizationId,
    req.userId,
    roles,
  );
  if (webSubs.length > 0) {
    await Promise.allSettled(
      dedupeByEndpoint(webSubs).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            URGENT_PUSH,
          );
          pushedUserIds.add(sub.userId);
        } catch (err: unknown) {
          const statusCode =
            typeof err === "object" && err !== null && "statusCode" in err
              ? (err as { statusCode: number }).statusCode
              : 0;
          if (statusCode === 410 || statusCode === 404) {
            await storage.deletePushSubscription(sub.endpoint);
          }
        }
      }),
    );
  }
}

/** userId:locationId → was inside premises radius on last known position */
const premiseGeofenceInside = new Map<string, boolean>();

async function dispatchPremiseBreachPush(
  orgId: string,
  triggerUserId: string,
  user: User,
  premise: { locationId: number; name: string },
) {
  const fullName = `${user.firstName} ${user.lastName}`.trim() || "Team member";
  const title = "⚠️ Left premises zone";
  const body = `${fullName} is outside the ${premise.name} ${PREMISE_COVERAGE_RADIUS_M / 1000} km radius`;
  const detailUrl = "/live-monitor";
  const payload = JSON.stringify({
    type: "premise_breach",
    title,
    body,
    url: detailUrl,
    locationId: premise.locationId,
    userId: triggerUserId,
  });

  const subs = await storage.getPushSubscriptionsByOrg(
    orgId,
    triggerUserId,
    [...DISPATCH_STAFF_ROLES],
  );
  const pushedUserIds = new Set<string>();

  if (subs.length > 0) {
    await Promise.allSettled(
      dedupeByEndpoint(subs).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            URGENT_PUSH,
          );
          pushedUserIds.add(sub.userId);
          storage.createNotificationLog({
            organizationId: orgId,
            userId: sub.userId,
            title,
            body,
            url: detailUrl,
          }).catch(() => {});
        } catch (err: unknown) {
          const statusCode = typeof err === "object" && err !== null && "statusCode" in err
            ? (err as { statusCode: number }).statusCode
            : 0;
          if (statusCode === 410 || statusCode === 404) {
            await storage.deletePushSubscription(sub.endpoint);
          }
        }
      }),
    );
  }

  const fcmSubs = await storage.getFcmTokensByOrg(orgId, triggerUserId, [...DISPATCH_STAFF_ROLES]);
  if (fcmSubs.length > 0) {
    await sendFcmBatch(fcmSubs.map((s) => s.token), {
      title,
      body,
      url: detailUrl,
      notificationTag: `premise-breach-${premise.locationId}-${triggerUserId}`,
    });
    for (const s of fcmSubs) pushedUserIds.add(s.userId);
  }

  try {
    const allActive = await storage.getActiveUsersByOrg(orgId);
    const noPushUsers = allActive.filter(
      (u) =>
        DISPATCH_STAFF_ROLES.includes(u.role as typeof DISPATCH_STAFF_ROLES[number]) &&
        u.id !== triggerUserId &&
        !pushedUserIds.has(u.id),
    );
    await Promise.allSettled(
      noPushUsers.map((u) =>
        storage.createNotificationLog({
          organizationId: orgId,
          userId: u.id,
          title,
          body,
          url: detailUrl,
        }),
      ),
    );
  } catch { /* best-effort */ }
}

async function checkPremiseGeofenceOnPosition(
  userId: string,
  orgId: string,
  lat: number,
  lng: number,
): Promise<void> {
  const premises = await storage.getAllocatedPremisesForUser(userId, orgId);
  if (premises.length === 0) return;
  const user = await storage.getUserById(userId);
  if (!user) return;

  for (const premise of premises) {
    const key = `${userId}:${premise.locationId}`;
    const inside = isWithinPremiseRadius(lat, lng, premise.lat, premise.lng);
    const wasInside = premiseGeofenceInside.get(key);
    if (wasInside === true && !inside) {
      await dispatchPremiseBreachPush(orgId, userId, user, premise);
    }
    premiseGeofenceInside.set(key, inside);
  }
}

function reportIncidentSeverityEmoji(severity: string | null | undefined, isOther: boolean): string {
  if (isOther) return "📋";
  if (severity === "red") return "🔴";
  if (severity === "orange") return "🟠";
  if (severity === "yellow") return "🟡";
  return "📋";
}

/** Notify administrators and supervisors when a standard (non-live) incident is filed. */
async function dispatchReportIncidentPush(orgId: string, triggerUserId: string, incident: Incident) {
  if (incident.isLive) return;

  const commandIds = incident.commandId != null ? [incident.commandId] : undefined;
  const subs = await storage.getPushSubscriptionsByOrg(
    orgId,
    triggerUserId,
    [...DISPATCH_STAFF_ROLES],
    commandIds,
  );

  const reporter = await storage.getUserById(triggerUserId);
  const fullName = reporter ? `${reporter.firstName} ${reporter.lastName}`.trim() : "A user";

  let catName: string | null = null;
  let catSeverity: string | null = null;
  let catIsOther = false;
  if (incident.categoryId) {
    const cat = await storage.getCategory(incident.categoryId, orgId);
    catName = cat?.name ?? null;
    catSeverity = cat?.severity ?? null;
    catIsOther = !!cat?.isOther;
  }

  const effectiveSeverity = incident.severity && incident.severity !== "none"
    ? incident.severity
    : catSeverity;
  const emoji = reportIncidentSeverityEmoji(effectiveSeverity, catIsOther);
  const typeLabel = catName ?? (catIsOther && incident.otherCategoryNote?.trim()
    ? incident.otherCategoryNote.trim()
    : "Incident reported");
  const title = `${emoji} New Report — ${fullName}`;
  const locPart = incident.locationName?.trim()
    || (incident.latitude != null && incident.longitude != null
      ? `${Number(incident.latitude).toFixed(4)}, ${Number(incident.longitude).toFixed(4)}`
      : null);
  const bodyParts = [typeLabel, `${incident.incidentDate} ${incident.incidentTime}`];
  if (locPart) bodyParts.push(locPart);
  const body = `${bodyParts.join(" · ")} · Tap to review`;

  const detailUrl = `/occurrence-book?incident=${incident.id}`;
  const payload = JSON.stringify({
    type: "incident_reported",
    title,
    body,
    incidentId: incident.id,
    url: detailUrl,
  });

  const pushedUserIds = new Set<string>();

  if (subs.length > 0) {
    await Promise.allSettled(
      dedupeByEndpoint(subs).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            URGENT_PUSH,
          );
          pushedUserIds.add(sub.userId);
          storage.createNotificationLog({
            organizationId: orgId,
            userId: sub.userId,
            title,
            body,
            url: detailUrl,
            incidentId: incident.id,
          }).catch(() => {});
        } catch (err: unknown) {
          const statusCode = typeof err === "object" && err !== null && "statusCode" in err
            ? (err as { statusCode: number }).statusCode
            : 0;

          if (statusCode === 410 || statusCode === 404) {
            await storage.deletePushSubscription(sub.endpoint);
          } else {
            console.error("[push] report incident notify failed (status=%d):", statusCode, err instanceof Error ? err.message : err);
          }
        }
      }),
    );
  }

  try {
    const fcmSubs = await storage.getFcmTokensByOrg(orgId, triggerUserId, [...DISPATCH_STAFF_ROLES], commandIds);
    if (fcmSubs.length > 0) {
      await sendFcmBatch(fcmSubs.map((s) => s.token), {
        title,
        body,
        data: {
          type: "incident_reported",
          incidentId: String(incident.id),
          url: detailUrl,
        },
        notificationTag: `report-${incident.id}`,
      }).catch(() => {});
      for (const s of fcmSubs) pushedUserIds.add(s.userId);
    }
  } catch { /* best-effort */ }

  try {
    const allActive = await storage.getActiveUsersByOrg(orgId);
    const commandMemberIds = commandIds
      ? await storage.getUserIdsInCommands(orgId, commandIds)
      : null;
    const noPushUsers = allActive.filter(
      (u) =>
        u.id !== triggerUserId &&
        isDispatchStaff(u.role) &&
        !pushedUserIds.has(u.id) &&
        (!commandMemberIds || commandMemberIds.has(u.id)),
    );
    await Promise.allSettled(
      noPushUsers.map((u) =>
        storage.createNotificationLog({
          organizationId: orgId,
          userId: u.id,
          title,
          body,
          url: detailUrl,
          incidentId: incident.id,
        }).catch(() => {}),
      ),
    );
  } catch { /* best-effort */ }
}

/** Replace stale live-incident FCM alerts on native devices when an incident closes. */
async function dispatchLiveIncidentCloseFcm(
  orgId: string,
  incident: Incident,
  opts: { fullName: string; endTime: string; durationMin: number | null },
  joinerUserIds: string[] = [],
): Promise<void> {
  const roles = liveIncidentNotifyRoles(incident.severity);
  const tag = liveIncidentFcmTag(incident.id);
  const title = `✅ Live Incident Closed — ${opts.fullName}`;
  const body = opts.durationMin != null
    ? `Closed at ${opts.endTime} · Duration: ${opts.durationMin < 1 ? "< 1" : opts.durationMin} min`
    : `Closed at ${opts.endTime}`;
  const incidentUrl = `/occurrence-book?incident=${incident.id}`;

  const [orgTokens, ...joinerTokenLists] = await Promise.all([
    storage.getFcmTokensByOrg(orgId, undefined, roles),
    ...joinerUserIds.map((uid) => storage.getFcmTokensByUser(uid)),
  ]);
  const tokenSet = new Set<string>();
  for (const t of orgTokens) tokenSet.add(t.token);
  for (const list of joinerTokenLists) {
    for (const t of list) tokenSet.add(t.token);
  }
  const tokens = Array.from(tokenSet);
  if (tokens.length === 0) return;

  await sendFcmBatch(tokens, {
    title,
    body,
    data: {
      type: "incident_closed",
      incidentId: String(incident.id),
      url: incidentUrl,
    },
    notificationTag: tag,
  });
}

async function sendClearBadgePush(orgId: string) {
  const subs = await storage.getPushSubscriptionsByOrg(orgId);
  if (subs.length === 0) return;
  const payload = JSON.stringify({ type: "clearBadge" });
  await Promise.allSettled(
    dedupeByEndpoint(subs).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (err: unknown) {
        const statusCode = typeof err === "object" && err !== null && "statusCode" in err
          ? (err as { statusCode: number }).statusCode : 0;
        if (statusCode === 410 || statusCode === 404) {
          await storage.deletePushSubscription(sub.endpoint);
        }
      }
    })
  );
}

/** Refresh in-app panic banners without a new notification (same silent push as ack). */
async function broadcastPanicBannerRefresh(orgId: string, excludeUserId?: string) {
  try {
    const orgSubs = await storage.getPushSubscriptionsByOrg(orgId, excludeUserId);
    if (orgSubs.length === 0) return;
    const silent = JSON.stringify({ type: "panic_ack_update", silent: true });
    await Promise.allSettled(
      dedupeByEndpoint(orgSubs).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            silent,
          );
        } catch (err: unknown) {
          const code = typeof err === "object" && err !== null && "statusCode" in err
            ? (err as { statusCode: number }).statusCode : 0;
          if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
        }
      }),
    );
  } catch { /* best-effort */ }
}

async function syncPanicIncidentCoordinates(
  orgId: string,
  incidentId: number,
  lat: number,
  lng: number,
  fullName: string,
) {
  const destName = `🆘 ${fullName}`;
  const desc = `🆘 Panic alert — ${fullName} · GPS: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  return storage.updateIncident(
    incidentId,
    {
      latitude: lat,
      longitude: lng,
      liveStartLat: lat,
      liveStartLng: lng,
      destinationLat: lat,
      destinationLng: lng,
      destinationName: destName,
      description: desc,
      responderLat: lat,
      responderLng: lng,
      responderPositionUpdatedAt: new Date(),
    },
    orgId,
  );
}

// Haversine distance in metres between two lat/lng points
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sl = Math.sin(dLat / 2), sln = Math.sin(dLng / 2);
  const x = sl * sl + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sln * sln;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Track which live incidents have already had an arrival push sent (in-memory, resets on restart)
const arrivalNotificationSent = new Set<number>();
// incidentId → Set of locationIds already notified for this live incident
const proximityNotificationSent = new Map<number, Set<number>>();
// incidentId → timestamp (ms) of the last GPS-stale notification sent (cleared on fresh GPS)
const gpsStaleLastSent = new Map<number, number>();

declare global {
  namespace Express {
    interface Request {
      currentUser?: User;
    }
  }
}

// ── Command Scope Helper ──────────────────────────────────────────────────
// Computes the effective command scope for the current request.
// - activeCommandId: number (a specific command) | "all" (superadmin only) | null (user has no commands)
// - commandFilter: number[] passed to storage read methods, or undefined for "all"
// - defaultStampCommandId: command_id to stamp onto newly created rows
// Cached on the request to avoid duplicate DB hits within a single handler.
type CommandScope = {
  activeCommandId: number | "all" | null;
  // Read filter — includes commands granted to the user via visibility grants.
  commandFilter: number[] | undefined;
  // Write-eligible commands — strictly the user's own assignments (or every
  // org command for wide-access roles). Excludes grants — granted visibility
  // is READ-ONLY by design.
  writeAccessCommandIds: number[];
  defaultStampCommandId: number | null;
  accessibleCommandIds: number[];
};
function canSwitchAllCommands(user: User): boolean {
  // Both administrators and superadmins may operate org-wide and switch into
  // any Command (including "All Commands"). Other roles are confined to their
  // assigned Commands.
  return !!user.isSuperadmin || user.role === "administrator";
}
async function getCommandScope(req: Request): Promise<CommandScope> {
  const cached = (req as any)._commandScope as CommandScope | undefined;
  if (cached) return cached;
  const user = req.currentUser!;
  const sessionActive = req.session.activeCommandId;

  const allCmds = await storage.getCommands(user.organizationId);
  const userCmds = await storage.getUserCommands(user.id);
  // Admins + superadmins can switch into any command in their org; everyone else only their assignments.
  const wideAccess = canSwitchAllCommands(user);
  const accessibleIds = wideAccess ? allCmds.map(c => c.id) : userCmds.map(c => c.id);

  // Granted commands the user may switch *into* as a read-only viewer.
  // Cross-Command visibility grants are an admin-level decision: only the
  // grantee Command's administrators (and superadmins) inherit the read
  // access — supervisors/reporters in the grantee Command do NOT.
  const isAdminPrincipal = user.role === "administrator" || user.isSuperadmin;
  const grantedSwitchableIds = (isAdminPrincipal && userCmds.length > 0)
    ? (await storage.getGrantedCommandIds(userCmds.map(c => c.id), user.organizationId))
        .filter(id => !accessibleIds.includes(id))
    : [];

  let active: number | "all" | null = sessionActive ?? null;
  if (active === "all" && !wideAccess) active = null;
  if (typeof active === "number"
      && !accessibleIds.includes(active)
      && !grantedSwitchableIds.includes(active)) {
    active = null;
  }
  if (active === null) {
    // Default for EVERY role is the Central Command (or the user's first assigned
    // Command if Central isn't accessible). "All Commands" is only ever the
    // active scope when the user explicitly switches to it.
    const central = (wideAccess ? allCmds : userCmds).find(c => c.isCentral);
    active = central?.id ?? accessibleIds[0] ?? null;
  }

  let commandFilter: number[] | undefined;
  let defaultStampCommandId: number | null = null;
  if (active === "all") {
    // Wide access mode — limit reads to org commands the user can switch into,
    // but skip the NULL fallback (legacy rows must be backfilled by migrate-commands.ts).
    commandFilter = accessibleIds.length > 0 ? accessibleIds : [-1];
    const central = allCmds.find(c => c.isCentral);
    defaultStampCommandId = central?.id ?? null;
  } else if (typeof active === "number") {
    if (grantedSwitchableIds.includes(active)) {
      // User is viewing another Command's data through a visibility grant —
      // strictly read-only. No write access, no default stamp.
      commandFilter = [active];
      defaultStampCommandId = null;
    } else {
      // Strict per-Command isolation: when a user picks one of their owned
      // Commands, they see ONLY that Command's rows. Visibility grants are
      // explicit switchable read-only targets — to view a grantor Command's
      // data, the user must switch INTO that grantor Command from the
      // CommandSwitcher (the grant makes it appear in the switcher list).
      commandFilter = [active];
      defaultStampCommandId = active;
    }
  } else {
    // User has no commands at all — match nothing (defensive; shouldn't happen post-migration)
    commandFilter = [-1];
    defaultStampCommandId = null;
  }

  // Writes (mutations) must target a Command the user actually belongs to.
  // In a single-command session that's just `[active]`; in "all" mode it's
  // the user's whole accessible set. Grants are deliberately excluded — they
  // are read-only.
  const writeAccessCommandIds = active === "all"
    ? accessibleIds
    : (typeof active === "number" && accessibleIds.includes(active)) ? [active] : [];

  const scope: CommandScope = { activeCommandId: active, commandFilter, writeAccessCommandIds, defaultStampCommandId, accessibleCommandIds: accessibleIds };
  (req as any)._commandScope = scope;
  return scope;
}

// READ check — includes cross-Command visibility grants. Use for GET routes
// and anywhere the action only inspects the row.
async function assertReadCommandAccess(req: Request, rowCommandId: number | null | undefined): Promise<boolean> {
  const scope = await getCommandScope(req);
  // Legacy NULL rows: only wide-access roles see them (defensive — migration
  // backfills should have eliminated these).
  if (rowCommandId == null) return canSwitchAllCommands(req.currentUser!);
  if (!scope.commandFilter) return true;
  return scope.commandFilter.includes(rowCommandId);
}

// WRITE check — strict to the user's owned commands. Grants do NOT confer
// mutate rights. Use for PATCH/DELETE and any state-changing action.
async function assertWriteCommandAccess(req: Request, rowCommandId: number | null | undefined): Promise<boolean> {
  const scope = await getCommandScope(req);
  if (rowCommandId == null) return canSwitchAllCommands(req.currentUser!);
  return scope.writeAccessCommandIds.includes(rowCommandId);
}

// Back-compat alias — defaults to WRITE-strict (the safer choice for any
// remaining caller). New code should prefer the explicit helpers above.
const assertCommandAccess = assertWriteCommandAccess;

const AUTH_WHITELIST = [
  "/auth/login",
  "/auth/register",
  "/auth/logout",
  "/auth/me",
  "/auth/has-users",
  "/invite/",
  "/contact",
  "/version",
  "/workstations/enrol",
  "/workstations/me",
  "/workstations/open-session",
  "/workstations/shift-login",
  "/workstations/shift-logout",
  "/workstations/unenrol",
  "/workstations/heartbeat",
];

const SUBSCRIPTION_WHITELIST = [
  "/billing/status",
  "/auth/change-password",
  "/uploads/request-url",
  "/users/me/avatar",
  "/push/vapid-public-key",
  "/push/subscribe",
];

function getOrgEffectiveStatus(org: Organization): "trial" | "active" | "expired" | "complimentary" {
  if (org.isComplimentary) return "complimentary";
  const now = new Date();
  if (org.subscriptionStatus === "active" && org.subscriptionCurrentPeriodEnd && new Date(org.subscriptionCurrentPeriodEnd) > now) {
    return "active";
  }
  if (org.subscriptionStatus === "trial" && org.trialEndsAt && new Date(org.trialEndsAt) > now) {
    return "trial";
  }
  return "expired";
}

async function resolveUser(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith("/archon")) return next();
  if (AUTH_WHITELIST.some(p => p.endsWith("/") ? req.path.startsWith(p) : req.path === p)) return next();
  if (SUBSCRIPTION_WHITELIST.includes(req.path)) {
    if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUserById(req.session.userId);
    if (!user) { req.session.destroy(() => {}); return res.status(401).json({ message: "User not found" }); }
    req.currentUser = user;
    return next();
  }
  if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
  const user = await storage.getUserById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: "User not found" });
  }
  req.currentUser = user;

  // SUBSCRIPTION GATE DISABLED — re-enable when billing goes live
  // const org = await storage.getOrganization(user.organizationId);
  // if (org) {
  //   const effectiveStatus = getOrgEffectiveStatus(org);
  //   if (effectiveStatus === "expired") {
  //     return res.status(402).json({ code: "subscription_required", subscriptionStatus: "expired" });
  //   }
  // }

  next();
}

const registerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  organization: z.string().min(1, "Organization is required"),
  organizationAddress: z.string().min(1, "Organization address is required"),
  organizationPhone: z.string().min(1, "Organization contact number is required"),
  password: z.string().min(10, "Password must be at least 10 characters"),
  repeatPassword: z.string(),
}).refine((d) => d.password === d.repeatPassword, {
  message: "Passwords do not match",
  path: ["repeatPassword"],
});

async function seedFormFieldsForOrg(orgId: string) {
  for (const field of DEFAULT_FORM_FIELDS) {
    await storage.createFormField(field, orgId);
  }
}


function audit(userId: string, orgId: string, action: string, description: string, opts?: { entityType?: string; entityId?: string; changes?: Record<string, { from: unknown; to: unknown }> }) {
  storage.createAuditLog({
    userId,
    organizationId: orgId,
    action,
    description,
    entityType: opts?.entityType ?? null,
    entityId: opts?.entityId ?? null,
    changes: opts?.changes ?? null,
  }).catch((err) => console.error("Audit log error:", err));
}

const PASSWORD_IN_USE_MSG = "This password is already in use by another account. Please choose a different password.";

async function isPasswordInUse(plaintext: string, excludeUserId?: string): Promise<boolean> {
  const allUsers = await storage.getAllUsers();
  for (const user of allUsers) {
    if (excludeUserId && user.id === excludeUserId) continue;
    const match = await bcrypt.compare(plaintext, user.password);
    if (match) return true;
  }
  return false;
}

function computeChanges(oldObj: Record<string, unknown>, newObj: Record<string, unknown>, skipKeys: string[] = ["password"]): Record<string, { from: unknown; to: unknown }> | null {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(newObj)) {
    if (skipKeys.includes(key)) continue;
    if (newObj[key] === undefined) continue;
    const oldVal = oldObj[key] ?? null;
    const newVal = newObj[key] ?? null;
    const oldStr = typeof oldVal === "object" ? JSON.stringify(oldVal) : String(oldVal ?? "");
    const newStr = typeof newVal === "object" ? JSON.stringify(newVal) : String(newVal ?? "");
    if (oldStr !== newStr) {
      changes[key] = { from: oldVal, to: newVal };
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

const CHAT_MAX_TEXT_LENGTH = 4000;
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
]);

function normalizeMimeType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

function isAllowedChatMediaUrl(url: string, kind: "image" | "audio"): boolean {
  if (url.startsWith(`data:${kind}/`)) return true;
  try {
    const pathname = url.startsWith("/") ? url : new URL(url).pathname;
    return pathname.startsWith("/objects/");
  } catch {
    return url.startsWith("/objects/");
  }
}

function validateChatContent(content: string): { ok: true; trimmed: string } | { ok: false; message: string } {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, message: "content is required" };

  if (trimmed.startsWith("[img]")) {
    const url = trimmed.slice(5).trim();
    if (!url || !isAllowedChatMediaUrl(url, "image")) {
      return { ok: false, message: "Invalid image attachment" };
    }
    return { ok: true, trimmed: `[img]${url}` };
  }

  if (trimmed.startsWith("[audio]")) {
    const url = trimmed.slice(7).trim();
    if (!url || !isAllowedChatMediaUrl(url, "audio")) {
      return { ok: false, message: "Invalid voice note attachment" };
    }
    return { ok: true, trimmed: `[audio]${url}` };
  }

  if (trimmed.length > CHAT_MAX_TEXT_LENGTH) {
    return { ok: false, message: `Message too long (max ${CHAT_MAX_TEXT_LENGTH} characters)` };
  }

  return { ok: true, trimmed };
}

function chatContentPreview(content: string): string {
  if (content.startsWith("[img]")) return "Photo";
  if (content.startsWith("[audio]")) return "Voice note";
  return content.length > 120 ? content.slice(0, 117) + "…" : content;
}

function canManageChatMessage(user: User, msg: { senderId: string }): boolean {
  return msg.senderId === user.id || user.role === "administrator" || !!user.isSuperadmin;
}

// Unique per server process — changes on every deploy/restart. The client
// polls /api/version and prompts the user to refresh when this value changes.
const BUILD_ID = String(Date.now());

import { registerAccessControlRoutes } from "./access-control/routes";
import { registerPatrolRoutes } from "./patrol/routes";
import { registerFleetAlertRoutes } from "./fleet-alerts/routes";
import { registerWorkstationRoutes, attachWorkstation } from "./workstations/routes";
import { hashShiftPin } from "./workstations/storage";
import { registerFleetAlertPushHandler } from "./fleet-alerts/push";
import { registerPatrolPushHandler, type PatrolPushRequest } from "./patrol/push";
import { FLEET_ALERT_NOTIFY_ROLES } from "@shared/fleet-alerts";
import type { FleetAlertSummary } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.use("/api", attachWorkstation);
  app.use("/api", resolveUser);

  // Upload a file through the server and store it in object storage.
  // If GCS/object-storage is unavailable the file is returned as a base64
  // data URL so the upload never hard-fails for the user.
  app.post("/api/uploads", async (req, res) => {
    const contentType =
      (req.headers["content-type"] as string) || "application/octet-stream";

    // ── Step 1: read raw body ──────────────────────────────────────────────
    let buffer: Buffer;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      buffer = Buffer.concat(chunks);
    } catch (readErr) {
      console.error("Failed to read upload body:", readErr);
      return res.status(400).json({ message: "Failed to read upload data" });
    }
    if (!buffer.length) return res.status(400).json({ message: "Missing file data" });

    const mime = normalizeMimeType(contentType);
    if (buffer.length > UPLOAD_MAX_BYTES) {
      return res.status(413).json({ message: `File too large (max ${UPLOAD_MAX_BYTES / (1024 * 1024)} MB)` });
    }
    if (mime.startsWith("audio/")) {
      if (!ALLOWED_AUDIO_TYPES.has(mime)) {
        return res.status(400).json({ message: "Unsupported audio format" });
      }
      if (buffer.length > UPLOAD_MAX_AUDIO_BYTES) {
        return res.status(413).json({ message: `Voice note too large (max ${UPLOAD_MAX_AUDIO_BYTES / (1024 * 1024)} MB)` });
      }
    }

    // ── Step 2: try GCS object storage ───────────────────────────────────
    const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
    const host =
      (req.headers["x-forwarded-host"] as string) || req.get("host") || "localhost";
    let gcsSucceeded = false;
    try {
      const objectUrl = await objectStorageService.uploadEntityBuffer(
        buffer,
        contentType,
        (objectPath) => `${proto}://${host}${objectPath}`,
      );
      gcsSucceeded = true;
      return res.json({ objectUrl, byteSize: buffer.length });
    } catch (gcsErr) {
      console.warn(
        "Object storage unavailable, falling back to base64:",
        gcsErr instanceof Error ? gcsErr.message : String(gcsErr),
      );
    }

    // ── Step 3: base64 fallback (always works, no external dependency) ───
    if (!gcsSucceeded) {
      const objectUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
      return res.json({ objectUrl, byteSize: buffer.length });
    }
  });

  // Serve uploaded objects — streams from GCS through this server (requires session)
  app.get(/^\/objects\/(.+)$/, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      await objectStorageService.downloadObject(objectFile, res);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return res.status(404).json({ message: "Object not found" });
      console.error("Error serving object:", err);
      res.status(500).json({ message: "Failed to serve object" });
    }
  });

  // Return 404 for legacy disk-storage paths so browsers reliably fire onError
  app.use("/uploads", (_req, res) => res.status(404).json({ message: "Not found" }));

  // Auth routes
  // --- Build version (used by client to detect new deploys) ---
  // Each server start gets a fresh build id. The client polls this and prompts
  // the user to refresh when it changes — fixes the PWA-cache-eats-new-bundle
  // problem where a deploy ships but users keep seeing the old UI.
  app.get("/api/version", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ build: BUILD_ID, cacheVersion: APP_CACHE_VERSION });
  });

  // --- Push Notification Routes ---
  app.get("/api/push/vapid-public-key", (_req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return res.status(503).json({ message: "Push notifications not configured" });
    res.json({ vapidPublicKey: key });
  });

  app.post("/api/push/subscribe", async (req, res) => {
    const { organizationId: orgId, id: userId } = req.currentUser!;
    const { endpoint, keys } = req.body ?? {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: "Invalid subscription object" });
    }
    const { wasAlreadyRegistered } = await storage.upsertPushSubscription(orgId, userId, { endpoint, p256dh: keys.p256dh, auth: keys.auth });
    res.json({ ok: true, wasAlreadyRegistered });
  });

  app.delete("/api/push/unsubscribe", async (req, res) => {
    const { id: userId } = req.currentUser!;
    const { endpoint } = req.body ?? {};
    if (!endpoint) return res.status(400).json({ message: "endpoint required" });
    await storage.deletePushSubscriptionByUser(endpoint, userId);
    res.json({ ok: true });
  });

  app.post("/api/push/register-fcm", async (req, res) => {
    const { organizationId: orgId, id: userId } = req.currentUser!;
    const { token } = req.body ?? {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "token required" });
    }
    await storage.upsertFcmToken(orgId, userId, token);
    // Drop stale Chrome/PWA subscriptions so the user only gets native notifications.
    await storage.deleteAllPushSubscriptionsByUser(userId);
    res.json({ ok: true });
  });

  app.get("/api/push/fcm-status", async (req, res) => {
    const { id: userId } = req.currentUser!;
    const tokens = await storage.getFcmTokensByUser(userId);
    if (tokens.length > 0) {
      await storage.deleteAllPushSubscriptionsByUser(userId);
    }
    res.json({ registered: tokens.length > 0 });
  });

  // Notification history — last 7 days by default for the current user
  app.get("/api/notifications", async (req, res) => {
    const { id: userId, organizationId: orgId } = req.currentUser!;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const logs = await storage.getNotificationLogsByUser(userId, orgId, since);
    res.json(logs);
  });

  app.get("/api/auth/has-users", async (_req, res) => {
    const count = await storage.getUserCount();
    res.json({ hasUsers: count > 0 });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const user = await storage.getUserById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "User not found" });
    }
    const org = await storage.getOrganization(user.organizationId);
    const effectiveStatus = org ? getOrgEffectiveStatus(org) : "expired";
    const { password: _pw, shiftPinHash: _sp, ...safeUser } = user;
    res.json({
      ...safeUser,
      subscriptionStatus: effectiveStatus,
      trialEndsAt: org?.trialEndsAt ?? null,
      subscriptionCurrentPeriodEnd: org?.subscriptionCurrentPeriodEnd ?? null,
      orgName: org?.name ?? null,
      isSuperadmin: !!user.isSuperadmin,
      permissions: getPermissionsForRole(user.role),
      workstationId: req.session.workstationId ?? null,
      workstation: req.currentWorkstation
        ? {
            id: req.currentWorkstation.id,
            name: req.currentWorkstation.name,
            type: req.currentWorkstation.type,
            locationId: req.currentWorkstation.locationId,
            locationName: req.currentWorkstation.locationName,
            kioskMode: req.currentWorkstation.kioskMode,
          }
        : null,
    });
  });

  app.post("/api/auth/change-password", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUserById(req.session.userId);
    if (!user) return res.status(401).json({ message: "User not found" });

    const { newPassword } = req.body;
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 10) {
      return res.status(400).json({ message: "Password must be at least 10 characters" });
    }

    const isSame = !user.mustChangePassword && (await bcrypt.compare(newPassword, user.password));
    if (isSame) return res.status(400).json({ message: "New password must be different from your current password" });

    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    // Also consume the invite token if one is still set (onboarding completion)
    await storage.updateUser(user.id, { password: hashedPassword, mustChangePassword: false, inviteToken: null, inviteTokenExpiresAt: null });
    res.json({ success: true });
  });

  app.post("/api/users/me/avatar", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
    const { avatarDataUrl } = req.body;
    if (!avatarDataUrl || typeof avatarDataUrl !== "string" || !avatarDataUrl.startsWith("data:image/")) {
      return res.status(400).json({ message: "Invalid image data" });
    }
    const updated = await storage.updateUser(req.session.userId, { avatarUrl: avatarDataUrl });
    if (!updated) return res.status(404).json({ message: "User not found" });
    const { password: _pw, ...safeUser } = updated;
    res.json(safeUser);
  });

  app.post("/api/auth/register", async (req, res) => {
    const userCount = await storage.getUserCount();
    if (userCount > 0) {
      return res.status(403).json({
        message: "Registration is by invitation only. Ask your administrator for an invite link.",
      });
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message || "Validation failed";
      return res.status(400).json({ message: msg });
    }

    const { firstName, lastName, email, organization, organizationAddress, organizationPhone, password } = parsed.data;

    const existing = await storage.getUserByEmail(email);
    if (existing) return res.status(400).json({ message: "An account with this email already exists" });

    if (await isPasswordInUse(password)) {
      return res.status(400).json({ message: PASSWORD_IN_USE_MSG });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const org = await storage.createOrganization({
      name: organization,
      address: organizationAddress,
      phone: organizationPhone,
    });

    const user = await storage.createUser({
      organizationId: org.id,
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role: "administrator",
    });

    await seedFormFieldsForOrg(org.id);

    req.session.userId = user.id;
    const { password: _pw, ...safeUser } = user;
    res.json(safeUser);
  });

  // Public marketing landing page contact form (Task #266).
  // No auth, no org scope — these are leads from prospective customers.
  const contactSchema = z.object({
    name: z.string().min(1).max(200),
    organisation: z.string().max(200).optional().nullable(),
    email: z.string().email().max(200),
    phone: z.string().max(60).optional().nullable(),
    message: z.string().min(1).max(4000),
    // Honeypot — bots tend to fill every visible field. Real users leave this blank.
    website: z.string().optional(),
  });
  app.post("/api/contact", async (req, res) => {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Please check the form and try again." });
    }
    const { website, ...data } = parsed.data;
    // Honeypot tripped — silently succeed so the bot moves on.
    if (website && website.trim() !== "") {
      return res.json({ success: true });
    }
    try {
      const { contactSubmissions } = await import("@shared/schema");
      const [row] = await db.insert(contactSubmissions).values({
        name: data.name,
        organisation: data.organisation || null,
        email: data.email,
        phone: data.phone || null,
        message: data.message,
      }).returning();
      console.log(`[contact] new submission #${row.id} from ${data.email} (${data.name})`);

      // Best-effort: email the sales inbox. NEVER fail the request if this errors —
      // the DB row is the source of truth and Archon can read it back.
      const { sendAppEmail } = await import("./mail");
      const safe = (s: string) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c));
      const text = [
        `New OMT Pulse contact-form submission #${row.id}`,
        ``,
        `Name:         ${data.name}`,
        `Organisation: ${data.organisation || "—"}`,
        `Email:        ${data.email}`,
        `Phone:        ${data.phone || "—"}`,
        ``,
        `Message:`,
        data.message,
      ].join("\n");
      const html = `
        <h2>New OMT Pulse contact-form submission #${row.id}</h2>
        <p><strong>Name:</strong> ${safe(data.name)}<br/>
        <strong>Organisation:</strong> ${safe(data.organisation || "—")}<br/>
        <strong>Email:</strong> <a href="mailto:${safe(data.email)}">${safe(data.email)}</a><br/>
        <strong>Phone:</strong> ${safe(data.phone || "—")}</p>
        <h3>Message</h3>
        <p style="white-space:pre-wrap">${safe(data.message)}</p>
      `;
      const mailResult = await sendAppEmail({
        to: "sales@intelafri.org",
        replyTo: data.email,
        subject: `[OMT Pulse] New lead — ${data.name}${data.organisation ? ` (${data.organisation})` : ""}`,
        text,
        html,
      });
      if (mailResult.sent) {
        await db.update(contactSubmissions)
          .set({ emailSentAt: new Date() })
          .where(eq(contactSubmissions.id, row.id));
        console.log(`[contact] email delivered for submission #${row.id}`);
      } else {
        console.log(`[contact] email not sent for #${row.id}: ${mailResult.reason ?? "unknown"}`);
      }

      return res.json({ success: true });
    } catch (err) {
      console.error("[contact] failed to persist submission:", err);
      return res.status(500).json({ message: "Could not send your message. Please email sales@intelafri.org directly." });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!password || typeof password !== "string") {
      return res.status(400).json({ message: "Password is required" });
    }

    const allUsers = await storage.getAllUsers();
    if (allUsers.length === 0) {
      return res.status(401).json({ message: "No accounts exist. Please register first." });
    }

    let matchedUser = null;

    if (email && typeof email === "string" && email.trim()) {
      // Email provided — look up by email first, then verify password
      const candidate = await storage.getUserByEmail(email.trim().toLowerCase());
      if (candidate) {
        const match = await bcrypt.compare(password, candidate.password);
        if (match) matchedUser = candidate;
      }
    } else {
      // Legacy fallback: password-only scan (single-org or dev use)
      for (const user of allUsers) {
        const match = await bcrypt.compare(password, user.password);
        if (match) { matchedUser = user; break; }
      }
    }

    if (!matchedUser) return res.status(401).json({ message: "Invalid email or password" });

    if (!matchedUser.isActive) {
      return res.status(401).json({ message: "Your account has been deactivated. Contact your administrator." });
    }

    req.session.userId = matchedUser.id;
    audit(matchedUser.id, matchedUser.organizationId, "auth.login", "Logged in", { entityType: "session" });
    const { password: _pw, ...safeUser } = matchedUser;
    res.json(safeUser);
  });

  app.post("/api/auth/heartbeat", async (req, res) => {
    const { id: userId, organizationId: orgId } = req.currentUser!;
    const body = req.body as { lat?: unknown; lng?: unknown } | undefined;
    const lat = typeof body?.lat === "number" ? body.lat : Number(body?.lat);
    const lng = typeof body?.lng === "number" ? body.lng : Number(body?.lng);
    const position =
      Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
    await storage.updateUserLastSeen(userId, position);
    if (position) {
      void checkPremiseGeofenceOnPosition(userId, orgId, position.lat, position.lng).catch((err) => {
        console.error("[premise-geofence] check failed:", err instanceof Error ? err.message : err);
      });
    }
    res.json({ ok: true });
  });

  app.post("/api/auth/logout", async (req, res) => {
    if (req.session.userId) {
      const u = await storage.getUserById(req.session.userId);
      if (u) audit(u.id, u.organizationId, "auth.logout", "Logged out", { entityType: "session" });
    }
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  // ─── Billing routes ───────────────────────────────────────────────────────

  app.get("/api/billing/status", async (req, res) => {
    if (req.currentUser!.role !== "administrator") {
      return res.status(403).json({ message: "Administrator access required" });
    }
    const orgId = req.currentUser!.organizationId;
    const org = await storage.getOrganization(orgId);
    if (!org) return res.status(404).json({ message: "Organization not found" });

    const orgUsers = await storage.getActiveUsersByOrg(orgId);
    const counts: Record<string, number> = {};
    for (const u of orgUsers) {
      counts[u.role] = (counts[u.role] ?? 0) + 1;
    }

    const breakdown = Object.entries(counts).map(([role, count]) => ({
      role,
      count,
    }));

    const effectiveStatus = getOrgEffectiveStatus(org);

    res.json({
      subscriptionStatus: effectiveStatus,
      trialEndsAt: org.trialEndsAt ?? null,
      subscriptionCurrentPeriodEnd: org.subscriptionCurrentPeriodEnd ?? null,
      breakdown,
    });
  });

  // ─── End billing routes ───────────────────────────────────────────────────

  // Admin guard middleware
  function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (req.currentUser?.role !== "administrator") {
      return res.status(403).json({ message: "Administrator access required" });
    }
    next();
  }

  // Superadmin guard — sits above administrator, controls visibility grants within an org
  function requireSuperadmin(req: Request, res: Response, next: NextFunction) {
    if (!req.currentUser?.isSuperadmin) {
      return res.status(403).json({ message: "Superadmin access required" });
    }
    next();
  }

  // Admin-or-superadmin guard — for group CRUD and member management
  function requireAdminOrSuperadmin(req: Request, res: Response, next: NextFunction) {
    const u = req.currentUser;
    if (!u || (u.role !== "administrator" && !u.isSuperadmin)) {
      return res.status(403).json({ message: "Administrator access required" });
    }
    next();
  }

  // ── Commands routes ─────────────────────────────────────────────────────────
  const commandSiteSchema = z.object({
    siteName: z.string().max(120).optional(),
    address: z.string().max(500).nullable().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
  });

  const createCommandSchema = z.object({
    name: z.string().min(1).max(120),
    site: commandSiteSchema.optional(),
  });

  const patchCommandSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    site: commandSiteSchema.optional(),
  });

  app.get("/api/commands", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    // Any authenticated user can list commands they belong to (for command switcher).
    // Admins + superadmins see all org commands (they can switch into any Command
    // and need the full list when assigning users in User Admin). Other roles see
    // only their own assignments.
    if (canSwitchAllCommands(req.currentUser!)) {
      res.json(await storage.getCommands(orgId));
    } else {
      const mine = await storage.getUserCommands(req.currentUser!.id);
      res.json(mine.map(c => ({ ...c, memberCount: 0 })));
    }
  });

  app.post("/api/commands", requireAdminOrSuperadmin, async (req, res) => {
    const parsed = createCommandSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });
    const orgId = req.currentUser!.organizationId;
    const created = await storage.createCommand({ name: parsed.data.name, isCentral: false }, orgId);
    if (parsed.data.site) {
      await storage.upsertCommandPrimaryLocation(created.id, orgId, created.name, parsed.data.site);
    }
    audit(req.currentUser!.id, orgId, "command.create", `Created Command "${created.name}"`, { entityType: "command", entityId: String(created.id) });
    res.json(created);
  });

  app.patch("/api/commands/:id", requireAdminOrSuperadmin, async (req, res) => {
    const id = Number(req.params.id);
    const parsed = patchCommandSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });
    const orgId = req.currentUser!.organizationId;
    const existing = await storage.getCommand(id, orgId);
    if (!existing) return res.status(404).json({ message: "Command not found" });
    if (existing.isCentral && parsed.data.name != null) {
      return res.status(400).json({ message: "Central Command cannot be renamed" });
    }
    let updated = existing;
    if (parsed.data.name != null && !existing.isCentral) {
      const row = await storage.updateCommand(id, { name: parsed.data.name }, orgId);
      if (row) updated = row;
    }
    if (parsed.data.site) {
      await storage.upsertCommandPrimaryLocation(id, orgId, updated.name, parsed.data.site);
    }
    audit(req.currentUser!.id, orgId, "command.update", `Updated Command "${existing.name}"`, { entityType: "command", entityId: String(id) });
    res.json(updated);
  });

  app.delete("/api/commands/:id", requireAdminOrSuperadmin, async (req, res) => {
    const id = Number(req.params.id);
    const orgId = req.currentUser!.organizationId;
    const existing = await storage.getCommand(id, orgId);
    if (!existing) return res.status(404).json({ message: "Command not found" });
    if (existing.isCentral) return res.status(400).json({ message: "Central Command cannot be deleted" });
    await storage.deleteCommand(id, orgId);
    audit(req.currentUser!.id, orgId, "command.delete", `Deleted Command "${existing.name}"`, { entityType: "command", entityId: String(id) });
    res.json({ ok: true });
  });

  app.get("/api/commands/:id/members", requireAdminOrSuperadmin, async (req, res) => {
    const id = Number(req.params.id);
    const orgId = req.currentUser!.organizationId;
    const existing = await storage.getCommand(id, orgId);
    if (!existing) return res.status(404).json({ message: "Command not found" });
    res.json(await storage.getCommandMembers(id, orgId));
  });

  app.post("/api/commands/:id/members/:userId", requireAdminOrSuperadmin, async (req, res) => {
    const id = Number(req.params.id);
    const userId = String(req.params.userId);
    const orgId = req.currentUser!.organizationId;
    const cmd = await storage.getCommand(id, orgId);
    if (!cmd) return res.status(404).json({ message: "Command not found" });
    const u = await storage.getUserById(userId);
    if (!u || u.organizationId !== orgId) return res.status(404).json({ message: "User not found" });
    await storage.assignUserToCommand(id, userId, orgId);
    audit(req.currentUser!.id, orgId, "command.assign_user", `Assigned ${u.firstName} ${u.lastName} to "${cmd.name}"`, { entityType: "command", entityId: String(id) });
    res.json({ ok: true });
  });

  // ── Active Command (session) ─────────────────────────────────────────────
  app.get("/api/me/commands", async (req, res) => {
    const user = req.currentUser!;
    const allCmds = await storage.getCommands(user.organizationId);
    const userCmds = await storage.getUserCommands(user.id);
    const userCmdIds = new Set(userCmds.map(c => c.id));
    const wide = canSwitchAllCommands(user);
    // Admin/superadmin: every command in the org. Others: only their assignments.
    const accessible = wide
      ? allCmds.map(c => ({ id: c.id, name: c.name, isCentral: c.isCentral, readOnly: false }))
      : allCmds.filter(c => userCmdIds.has(c.id)).map(c => ({ id: c.id, name: c.name, isCentral: c.isCentral, readOnly: false }));
    // Approved cross-Command visibility grants appear as selectable but
    // read-only entries — limited to Command administrators (the role that
    // requested the grant) and superadmins.
    const isAdminPrincipal = user.role === "administrator" || user.isSuperadmin;
    const grantedIds = (isAdminPrincipal && userCmds.length > 0)
      ? (await storage.getGrantedCommandIds(userCmds.map(c => c.id), user.organizationId))
          .filter(id => !accessible.some(a => a.id === id))
      : [];
    const granted = allCmds
      .filter(c => grantedIds.includes(c.id))
      .map(c => ({ id: c.id, name: c.name, isCentral: c.isCentral, readOnly: true }));
    const commands = [...accessible, ...granted];
    const scope = await getCommandScope(req);
    // "Other" Commands for the visibility-request flow are computed from
    // ACTUAL Command memberships, not wide-access. An administrator with
    // wide-access still only belongs to specific Commands, and may need to
    // request a grant from one of their owned Commands to another. Compute
    // it independently of the switcher's accessible list.
    const ownedIds = new Set(userCmds.map(c => c.id));
    const otherCommands = allCmds
      .filter(c => !ownedIds.has(c.id))
      .filter(c => !grantedIds.includes(c.id))
      .map(c => ({ id: c.id, name: c.name, isCentral: c.isCentral }));
    res.json({
      commands,
      activeCommandId: scope.activeCommandId,
      canSeeAll: wide,
      otherCommands,
      // Memberships the user can submit a request FROM. Always derived from
      // actual command_users membership (not wide-access).
      ownedCommands: userCmds.map(c => ({ id: c.id, name: c.name, isCentral: c.isCentral })),
    });
  });

  const activeCommandSchema = z.object({
    commandId: z.union([z.number().int().positive(), z.literal("all"), z.null()]),
  });
  app.patch("/api/me/active-command", async (req, res) => {
    const user = req.currentUser!;
    const parsed = activeCommandSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid commandId" });
    const value = parsed.data.commandId;
    const wide = canSwitchAllCommands(user);
    if (value === "all" && !wide) {
      return res.status(403).json({ message: "Only administrators and superadmins can view all commands" });
    }
    if (typeof value === "number") {
      const allCmds = await storage.getCommands(user.organizationId);
      const userCmds = await storage.getUserCommands(user.id);
      const ownedAllowed = wide ? allCmds.map(c => c.id) : userCmds.map(c => c.id);
      // Also allow switching INTO a Command that has granted visibility — view-only.
      // Granted access is admin-level only (matches getCommandScope).
      const isAdminPrincipal = user.role === "administrator" || user.isSuperadmin;
      const grantedAllowed = (isAdminPrincipal && userCmds.length > 0)
        ? await storage.getGrantedCommandIds(userCmds.map(c => c.id), user.organizationId)
        : [];
      const allowed = Array.from(new Set([...ownedAllowed, ...grantedAllowed]));
      if (!allowed.includes(value)) {
        return res.status(403).json({ message: "You do not have access to that Command" });
      }
    }
    const previous = req.session.activeCommandId ?? null;
    req.session.activeCommandId = value === null ? undefined : value;
    delete (req as any)._commandScope; // bust cache
    const scope = await getCommandScope(req);
    // Audit the switch so admins can see what scope was active when actions ran
    audit(user.id, user.organizationId, "command.switch_active",
      `Switched active Command from ${previous ?? "default"} to ${value ?? "default"}`,
      { entityType: "command", entityId: String(scope.activeCommandId ?? "") });
    res.json({ activeCommandId: scope.activeCommandId });
  });

  // ── Cross-Command Visibility Requests ──────────────────────────────────────
  // Anyone can request access from one of their Commands to another Command's
  // data; a superadmin approves or denies. Approval auto-creates the grant.
  const visibilityRequestSchema = z.object({
    granteeCommandId: z.number().int().positive(),
    granterCommandId: z.number().int().positive(),
    reason: z.string().max(500).optional(),
  }).refine(d => d.granteeCommandId !== d.granterCommandId, {
    message: "Cannot request visibility to the same Command",
  });

  app.get("/api/commands/visibility-requests", async (req, res) => {
    const user = req.currentUser!;
    res.json(await storage.listVisibilityRequests(user.organizationId, user.isSuperadmin ? undefined : user.id));
  });

  app.post("/api/commands/visibility-requests", async (req, res) => {
    const user = req.currentUser!;
    const parsed = visibilityRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });
    // Any user may request cross-Command read access on behalf of a Command
    // they actually belong to. A superadmin reviews and approves/denies.
    // Wide-access (admin/superadmin) does NOT substitute for membership here —
    // the requester must be a real member of the grantee Command.
    const userCmdIds = (await storage.getUserCommands(user.id)).map(c => c.id);
    if (!userCmdIds.includes(parsed.data.granteeCommandId)) {
      return res.status(403).json({ message: "You can only request visibility from a Command you belong to" });
    }
    if (userCmdIds.includes(parsed.data.granterCommandId)) {
      return res.status(400).json({ message: "You already belong to that Command" });
    }
    const grantee = await storage.getCommand(parsed.data.granteeCommandId, user.organizationId);
    const granter = await storage.getCommand(parsed.data.granterCommandId, user.organizationId);
    if (!grantee || !granter) return res.status(404).json({ message: "Command not found" });
    const created = await storage.createVisibilityRequest({
      ...parsed.data,
      reason: parsed.data.reason ?? null,
    }, user.organizationId, user.id);
    audit(user.id, user.organizationId, "command.visibility_request",
      `Requested visibility from "${grantee.name}" to "${granter.name}"`,
      { entityType: "command_visibility_request", entityId: String(created.id) });
    res.json(created);
  });

  app.patch("/api/commands/visibility-requests/:id", requireSuperadmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const action = req.body?.action;
    if (action !== "approve" && action !== "deny") {
      return res.status(400).json({ message: "action must be 'approve' or 'deny'" });
    }
    const updated = await storage.decideVisibilityRequest(id, orgId, action, req.currentUser!.id);
    if (!updated) return res.status(404).json({ message: "Request not found" });
    audit(req.currentUser!.id, orgId, `command.visibility_${action}`,
      `${action === "approve" ? "Approved" : "Denied"} visibility request #${id}`,
      { entityType: "command_visibility_request", entityId: String(id) });
    res.json(updated);
  });

  // ── Command Visibility Grants (superadmin) ───────────────────────────────
  // A grant lets the `granteeCommand` read data belonging to `granterCommand`.
  app.get("/api/commands/visibility-grants", requireSuperadmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    res.json(await storage.getVisibilityGrants(orgId));
  });

  const visibilityGrantSchema = z.object({
    granteeCommandId: z.number().int().positive(),
    granterCommandId: z.number().int().positive(),
    scope: z.string().min(1).max(40).default("read"),
  }).refine(d => d.granteeCommandId !== d.granterCommandId, {
    message: "A Command cannot grant visibility to itself",
  });
  app.post("/api/commands/visibility-grants", requireSuperadmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const parsed = visibilityGrantSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });
    const grantee = await storage.getCommand(parsed.data.granteeCommandId, orgId);
    const granter = await storage.getCommand(parsed.data.granterCommandId, orgId);
    if (!grantee || !granter) return res.status(404).json({ message: "Command not found" });
    try {
      const grant = await storage.createVisibilityGrant(parsed.data, orgId, req.currentUser!.id);
      audit(req.currentUser!.id, orgId, "command.visibility_grant", `Granted "${grantee.name}" read access to "${granter.name}"`, { entityType: "command_visibility", entityId: String(grant.id) });
      res.json(grant);
    } catch (e: any) {
      if (e?.code === "23505") return res.status(409).json({ message: "Grant already exists" });
      throw e;
    }
  });

  app.delete("/api/commands/visibility-grants/:id", requireSuperadmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid grant id" });
    const ok = await storage.deleteVisibilityGrant(id, orgId);
    if (!ok) return res.status(404).json({ message: "Grant not found" });
    audit(req.currentUser!.id, orgId, "command.visibility_revoke", `Revoked visibility grant #${id}`, { entityType: "command_visibility", entityId: String(id) });
    res.json({ ok: true });
  });

  app.delete("/api/commands/:id/members/:userId", requireAdminOrSuperadmin, async (req, res) => {
    const id = Number(req.params.id);
    const userId = String(req.params.userId);
    const orgId = req.currentUser!.organizationId;
    const cmd = await storage.getCommand(id, orgId);
    if (!cmd) return res.status(404).json({ message: "Command not found" });
    if (cmd.isCentral) return res.status(400).json({ message: "Cannot remove members from Central Command" });
    const u = await storage.getUserById(userId);
    if (!u || u.organizationId !== orgId) return res.status(404).json({ message: "User not found" });
    await storage.removeUserFromCommand(id, userId, orgId);
    audit(req.currentUser!.id, orgId, "command.unassign_user", `Removed ${u.firstName} ${u.lastName} from "${cmd.name}"`, { entityType: "command", entityId: String(id) });
    res.json({ ok: true });
  });

  const createUserSchema = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    contactNumber: z.string().optional().nullable(),
    homeAddress: z.string().optional().nullable(),
    posting: z.string().optional().nullable(),
    role: z.enum(USER_ROLES),
    password: z.string().min(10, "Password must be at least 10 characters"),
    shiftPin: z.union([
      z.string().regex(/^\d{4,6}$/, "Shift PIN must be 4–6 digits"),
      z.literal(""),
      z.null(),
    ]).optional(),
    canEditIncidents: z.boolean().optional().default(true),
    canManageAttachments: z.boolean().optional().default(true),
    canDeleteIncidents: z.boolean().optional().default(true),
    commandIds: z.array(z.number().int().positive()).min(1, "At least one Command is required"),
  });

  const updateUserSchema = z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    email: z.string().email().optional(),
    contactNumber: z.string().optional().nullable(),
    homeAddress: z.string().optional().nullable(),
    posting: z.string().optional().nullable(),
    role: z.enum(USER_ROLES).optional(),
    password: z.string().optional(),
    shiftPin: z.union([
      z.string().regex(/^\d{4,6}$/, "Shift PIN must be 4–6 digits"),
      z.literal(""),
      z.null(),
    ]).optional(),
    canEditIncidents: z.boolean().optional(),
    canManageAttachments: z.boolean().optional(),
    canDeleteIncidents: z.boolean().optional(),
    commandIds: z.array(z.number().int().positive()).min(1, "At least one Command is required").optional(),
  });

  // User management routes (admin only)
  app.get("/api/users", requireAdmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const [orgUsers, pushRegistrationByUser] = await Promise.all([
      storage.getUsersByOrg(orgId),
      storage.getOrgPushRegistrationByUser(orgId),
    ]);
    // Hide synthetic position accounts (dedicated devices) from the people list.
    const people = orgUsers.filter((u) => !isPositionUserEmail(u.email));
    // Attach Command memberships per user so the User Admin table can show
    // which Command each user belongs to and flag users with no assignment.
    const withCommands = await Promise.all(people.map(async (u) => {
      const { password: _pw, ...safe } = u;
      const cmds = await storage.getUserCommands(u.id);
      const pushRegistration = pushRegistrationByUser.get(u.id) ?? { fcm: false, web: false };
      return {
        ...safe,
        commands: cmds.map(c => ({ id: c.id, name: c.name, isCentral: c.isCentral })),
        hasPushSubscription: pushRegistration.fcm || pushRegistration.web,
        pushRegistration,
      };
    }));
    res.json(withCommands);
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.errors[0]?.message || "Validation failed",
        details: parsed.error.errors,
      });
    }
    const { password: rawPassword, commandIds, shiftPin, ...rest } = parsed.data;
    // Validate every commandId belongs to the admin's org before we create anything.
    const orgCmds = await storage.getCommands(req.currentUser!.organizationId);
    const orgCmdIds = new Set(orgCmds.map(c => c.id));
    for (const cid of commandIds) {
      if (!orgCmdIds.has(cid)) {
        return res.status(400).json({ message: `Invalid Command id ${cid}` });
      }
    }
    const email = rest.email.trim().toLowerCase();
    const existing = await storage.getUserByEmail(email);
    if (existing) {
      const orgId = req.currentUser!.organizationId;
      if (existing.organizationId === orgId) {
        // Same org — give a contextual message so the admin knows exactly what to do.
        // Include existingUserId so the frontend can locate and highlight the row.
        if (!existing.isActive) {
          return res.status(409).json({
            message: `A deactivated account with this email already exists for ${existing.firstName} ${existing.lastName}. Reactivate or delete that account first.`,
            conflictType: "same_org_inactive",
            existingUserId: existing.id,
          });
        }
        if (existing.inviteToken) {
          return res.status(409).json({
            message: `An invite is already pending for ${existing.firstName} ${existing.lastName}. You can resend or copy the invite link from the user list.`,
            conflictType: "same_org_pending",
            existingUserId: existing.id,
          });
        }
        return res.status(409).json({
          message: `${existing.firstName} ${existing.lastName} already has an active account with this email address.`,
          conflictType: "same_org_active",
          existingUserId: existing.id,
        });
      }
      // Different org — keep generic message (don't reveal cross-org info).
      return res.status(400).json({ message: "A user with this email already exists" });
    }

    // Password required for new users — admins share email + password (field testers, Play closed test).
    if (!rawPassword || rawPassword.length < 10) {
      return res.status(400).json({ message: "Password must be at least 10 characters" });
    }
    if (await isPasswordInUse(rawPassword)) {
      return res.status(400).json({ message: PASSWORD_IN_USE_MSG });
    }

    const hashedPassword = await bcrypt.hash(rawPassword, SALT_ROUNDS);
    const shiftPinHash = shiftPin && shiftPin.length > 0 ? await hashShiftPin(shiftPin) : null;
    const orgId = req.currentUser!.organizationId;

    if (rest.role === "administrator") {
      rest.canEditIncidents = true;
      rest.canManageAttachments = true;
      rest.canDeleteIncidents = true;
    }
    if (rest.role === "control_room") {
      rest.canDeleteIncidents = false;
    }
    if (rest.role === "access_controller") {
      rest.canDeleteIncidents = false;
    }
    if (rest.role === "patrol_user") {
      rest.canDeleteIncidents = false;
    }

    const user = await storage.createUser({
      ...rest,
      email,
      organizationId: orgId,
      password: hashedPassword,
      shiftPinHash,
      isActive: true,
      mustChangePassword: false,
      inviteToken: null,
      inviteTokenExpiresAt: null,
    });
    // Assign the new user to every selected Command. Required: schema enforces
    // commandIds.length >= 1, so the user can always raise a panic and have
    // their incidents stamped to a real Command (no Central fallback).
    for (const cid of commandIds) {
      await storage.assignUserToCommand(cid, user.id, orgId);
    }
    const assignedNames = orgCmds.filter(c => commandIds.includes(c.id)).map(c => c.name).join(", ");
    audit(req.currentUser!.id, orgId, "admin.user_create", `Created user ${rest.firstName} ${rest.lastName} (${rest.role}) in ${assignedNames}`, { entityType: "user", entityId: user.id });
    const { password: _pw, ...safeUser } = user;
    res.status(201).json({ ...safeUser, commandIds });
  });

  app.patch("/api/users/:id", requireAdmin, async (req, res) => {
    const { id } = req.params as { id: string };
    const orgId = req.currentUser!.organizationId;
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Validation failed" });
    }

    const { password, commandIds, shiftPin, ...rest } = parsed.data;

    if (rest.role === "administrator") {
      rest.canEditIncidents = true;
      rest.canManageAttachments = true;
      rest.canDeleteIncidents = true;
    }
    if (rest.role === "control_room") {
      rest.canDeleteIncidents = false;
    }
    if (rest.role === "access_controller") {
      rest.canDeleteIncidents = false;
    }
    if (rest.role === "patrol_user") {
      rest.canDeleteIncidents = false;
    }

    const updateData: Record<string, unknown> = { ...rest };

    if (password && password.length > 0) {
      if (password.length < 10) return res.status(400).json({ message: "Password must be at least 10 characters" });
      if (await isPasswordInUse(password, id)) {
        return res.status(400).json({ message: PASSWORD_IN_USE_MSG });
      }
      updateData.password = await bcrypt.hash(password, SALT_ROUNDS);
      updateData.mustChangePassword = false;
    }

    if (shiftPin !== undefined) {
      updateData.shiftPinHash = shiftPin && shiftPin.length > 0 ? await hashShiftPin(shiftPin) : null;
    }

    // Verify user belongs to same org
    const existingUser = await storage.getUserById(id);
    if (!existingUser || existingUser.organizationId !== orgId) {
      return res.status(404).json({ message: "User not found" });
    }

    if (rest.email) {
      rest.email = rest.email.trim().toLowerCase();
      if (rest.email !== existingUser.email) {
        const emailTaken = await storage.getUserByEmail(rest.email);
        if (emailTaken) return res.status(400).json({ message: "A user with this email already exists" });
      }
    }

    const changes = computeChanges(existingUser as Record<string, unknown>, rest as Record<string, unknown>);
    const updated = await storage.updateUser(id, updateData as Partial<typeof existingUser>);
    if (!updated) return res.status(404).json({ message: "User not found" });

    // If commandIds provided, replace the user's Command memberships wholesale.
    // Validate every id belongs to the admin's org, then diff against current
    // memberships so we only insert/delete what changed (cheap on small sets).
    if (commandIds && commandIds.length > 0) {
      const orgCmds = await storage.getCommands(orgId);
      const orgCmdIds = new Set(orgCmds.map(c => c.id));
      for (const cid of commandIds) {
        if (!orgCmdIds.has(cid)) {
          return res.status(400).json({ message: `Invalid Command id ${cid}` });
        }
      }
      const current = await storage.getUserCommands(id);
      const currentIds = new Set(current.map(c => c.id));
      const targetIds = new Set(commandIds);
      for (const cid of commandIds) {
        if (!currentIds.has(cid)) await storage.assignUserToCommand(cid, id, orgId);
      }
      for (const cid of currentIds) {
        if (!targetIds.has(cid)) await storage.removeUserFromCommand(cid, id, orgId);
      }
    }

    const isSelf = id === req.currentUser!.id;
    audit(req.currentUser!.id, orgId, isSelf ? "profile.update" : "admin.user_update", isSelf ? "Updated own profile" : `Updated user ${existingUser.firstName} ${existingUser.lastName}`, { entityType: "user", entityId: id, changes: changes ?? undefined });
    const { password: _pw, ...safeUser } = updated;
    res.json(safeUser);
  });

  app.patch("/api/users/:id/status", requireAdmin, async (req, res) => {
    const { id } = req.params as { id: string };
    const orgId = req.currentUser!.organizationId;
    const { isActive } = req.body;
    if (typeof isActive !== "boolean") return res.status(400).json({ message: "isActive must be a boolean" });

    const existingUser = await storage.getUserById(id);
    if (!existingUser || existingUser.organizationId !== orgId) {
      return res.status(404).json({ message: "User not found" });
    }

    const updated = await storage.updateUser(id, { isActive });
    if (!updated) return res.status(404).json({ message: "User not found" });
    audit(req.currentUser!.id, orgId, "admin.user_status", `${isActive ? "Activated" : "Deactivated"} user ${existingUser.firstName} ${existingUser.lastName}`, { entityType: "user", entityId: id, changes: { isActive: { from: existingUser.isActive, to: isActive } } });
    const { password: _pw, ...safeUser } = updated;
    res.json(safeUser);
  });

  app.delete("/api/users/:id", requireAdmin, async (req, res) => {
    const { id } = req.params as { id: string };
    const orgId = req.currentUser!.organizationId;
    if (id === req.currentUser!.id) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }
    const existingUser = await storage.getUserById(id);
    if (!existingUser || existingUser.organizationId !== orgId) {
      return res.status(404).json({ message: "User not found" });
    }
    audit(req.currentUser!.id, orgId, "admin.user_delete", `Deleted user ${existingUser.firstName} ${existingUser.lastName}`, { entityType: "user", entityId: id });
    await storage.deleteUser(id, orgId);
    res.json({ success: true });
  });

  // Regenerate invite token for a user (admin only, authenticated)
  app.post("/api/users/:id/regenerate-invite", requireAdmin, async (req, res) => {
    const { id } = req.params as { id: string };
    const orgId = req.currentUser!.organizationId;
    const existingUser = await storage.getUserById(id);
    if (!existingUser || existingUser.organizationId !== orgId) {
      return res.status(404).json({ message: "User not found" });
    }
    const inviteToken = crypto.randomUUID();
    const inviteTokenExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const updated = await storage.updateUser(id, { inviteToken, inviteTokenExpiresAt });
    if (!updated) return res.status(500).json({ message: "Failed to update user" });
    const { password: _pw, ...safeUser } = updated;
    res.json(safeUser);
  });

  // Invite token lookup — unauthenticated
  app.get("/api/invite/:token", async (req, res) => {
    const { token } = req.params as { token: string };
    const user = await storage.getUserByInviteToken(token);
    if (!user) return res.status(404).json({ message: "This invite link is invalid." });
    if (!user.inviteTokenExpiresAt || new Date(user.inviteTokenExpiresAt) < new Date()) {
      return res.status(410).json({ message: "This invite link has expired. Please ask your administrator for a new one." });
    }
    const org = await storage.getOrganization(user.organizationId);
    res.json({ firstName: user.firstName, orgName: org?.name ?? null });
  });

  // Accept invite — unauthenticated; atomically validates + consumes token in one DB update.
  // Only one concurrent request will match; the second gets a 404. Session + mustChangePassword
  // gate handles onboarding continuity if the browser is refreshed mid-flow.
  app.post("/api/invite/:token/accept", async (req, res) => {
    const { token } = req.params as { token: string };
    // atomicConsumeInviteToken does a single conditional UPDATE WHERE invite_token = $token
    // AND invite_token_expires_at > now() AND is_active = true, returning the updated row.
    // This eliminates the read-then-update race window.
    const user = await storage.atomicConsumeInviteToken(token);
    if (!user) {
      // Token not found, already consumed, expired, or user inactive.
      // Distinguish expired from consumed/invalid for better UX.
      const existing = await storage.getUserByInviteToken(token);
      if (existing && existing.inviteTokenExpiresAt && new Date(existing.inviteTokenExpiresAt) < new Date()) {
        return res.status(410).json({ message: "This invite link has expired. Please ask your administrator for a new one." });
      }
      if (existing && !existing.isActive) {
        return res.status(403).json({ message: "Your account has been deactivated. Please contact your administrator." });
      }
      return res.status(404).json({ message: "This invite link has already been used or is invalid." });
    }

    // Token consumed — establish session; onboarding continues via mustChangePassword gate
    req.session.userId = user.id;
    req.session.save((err) => {
      if (err) return res.status(500).json({ message: "Session error" });
      const { password: _pw, ...safeUser } = user;
      res.json(safeUser);
    });
  });

  app.get("/api/command-assignments", async (req, res) => {
    const { organizationId: orgId, role } = req.currentUser!;
    if (role !== "administrator" && !isDispatchStaff(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const assignments = await storage.getOrgCommandUserAssignments(orgId);
    res.json({ assignments });
  });

  app.get("/api/location-assignments", async (req, res) => {
    const { organizationId: orgId, role } = req.currentUser!;
    if (role !== "administrator" && !isDispatchStaff(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const assignments = await storage.getOrgLocationAssignments(orgId);
    res.json({ assignments });
  });

  // User Location Assignments
  app.get("/api/users/:userId/location-assignments", async (req, res) => {
    const { userId } = req.params as { userId: string };
    const orgId = req.currentUser!.organizationId;
    const targetUser = await storage.getUserById(userId);
    if (!targetUser || targetUser.organizationId !== orgId) {
      return res.status(404).json({ message: "User not found" });
    }
    const locationIds = await storage.getUserLocationAssignments(userId, orgId);
    res.json({ locationIds });
  });

  app.put("/api/users/:userId/location-assignments", requireAdmin, async (req, res) => {
    const { userId } = req.params as { userId: string };
    const orgId = req.currentUser!.organizationId;
    const { locationIds } = req.body;
    if (!Array.isArray(locationIds) || locationIds.some(id => typeof id !== "number")) {
      return res.status(400).json({ message: "locationIds must be an array of numbers" });
    }
    const targetUser = await storage.getUserById(userId);
    if (!targetUser || targetUser.organizationId !== orgId) {
      return res.status(404).json({ message: "User not found" });
    }
    await storage.setUserLocationAssignments(userId, locationIds, orgId);
    res.json({ success: true });
  });

  // User Audit Trail
  app.get("/api/users/:userId/audit", async (req, res) => {
    const callerRole = req.currentUser!.role;
    if (callerRole !== "administrator" && !isDispatchStaff(callerRole)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { userId } = req.params as { userId: string };
    const orgId = req.currentUser!.organizationId;
    const targetUser = await storage.getUserById(userId);
    if (!targetUser || targetUser.organizationId !== orgId) {
      return res.status(404).json({ message: "User not found" });
    }
    const showAll = req.query.all === "true";
    let since: Date | undefined;
    if (!showAll) {
      const sinceParam = req.query.since as string | undefined;
      if (sinceParam) {
        since = new Date(sinceParam);
        if (isNaN(since.getTime())) since = undefined;
      }
      if (!since) {
        since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      }
    }
    const logs = await storage.getAuditLogsByUser(userId, orgId, since);
    res.json(logs);
  });

  // User incidents (admin/supervisor only)
  app.get("/api/users/:userId/incidents", async (req, res) => {
    const callerRole = req.currentUser!.role;
    if (callerRole !== "administrator" && !isDispatchStaff(callerRole)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { userId } = req.params as { userId: string };
    const orgId = req.currentUser!.organizationId;
    const targetUser = await storage.getUserById(userId);
    if (!targetUser || targetUser.organizationId !== orgId) {
      return res.status(404).json({ message: "User not found" });
    }
    const allIncidents = await storage.getIncidents(orgId);
    const userIncidents = allIncidents.filter(i => i.userId === userId);
    const attachmentCounts = await storage.getAttachmentCountsByOrg(orgId);
    const result = userIncidents.map(inc => ({
      ...inc,
      attachmentCount: attachmentCounts[inc.id] || 0,
    }));
    res.json(result);
  });

  // All responders (including departed) who participated in a live incident
  app.get("/api/incidents/:id/responders", async (req, res) => {
    const { role: callerRole, id: callerId, organizationId: orgId } = req.currentUser!;
    const id = parseInt(req.params.id as string);
    if (callerRole !== "administrator" && !isDispatchStaff(callerRole)) {
      // Reporters may only view responders for incidents they created (e.g. their own panic)
      const incident = await storage.getIncident(id, orgId);
      if (!incident || incident.userId !== callerId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }
    const responders = await storage.getIncidentResponders(id, orgId);
    res.json(responders);
  });

  // All live incidents a user participated in as a joiner (not creator)
  app.get("/api/users/:userId/joined-incidents", async (req, res) => {
    const callerRole = req.currentUser!.role;
    if (callerRole !== "administrator" && !isDispatchStaff(callerRole)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { userId } = req.params as { userId: string };
    const orgId = req.currentUser!.organizationId;
    const targetUser = await storage.getUserById(userId);
    if (!targetUser || targetUser.organizationId !== orgId) {
      return res.status(404).json({ message: "User not found" });
    }
    const joined = await storage.getIncidentsByResponder(userId, orgId);
    res.json(joined);
  });

  // Locations
  app.get("/api/locations", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const { commandFilter } = await getCommandScope(req);
    const locationList = await storage.getLocations(orgId, commandFilter);
    res.json(locationList);
  });

  app.post("/api/locations", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const parsed = insertLocationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const { defaultStampCommandId, writeAccessCommandIds } = await getCommandScope(req);
    if (defaultStampCommandId == null || writeAccessCommandIds.length === 0) {
      return res.status(403).json({ message: "No writeable Command in current scope" });
    }
    // Ignore any client-supplied commandId — always stamp from server scope.
    const { commandId: _ignored, ...safe } = parsed.data as any;
    const location = await storage.createLocation(
      { ...safe, commandId: defaultStampCommandId },
      orgId,
    );
    res.json(location);
  });

  app.patch("/api/locations/:id", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const id = parseInt(req.params.id as string);
    const existing = await storage.getLocation(id, orgId);
    if (!existing) return res.status(404).json({ message: "Location not found" });
    if (!(await assertWriteCommandAccess(req, (existing as any).commandId))) {
      return res.status(403).json({ message: "Out-of-scope Command" });
    }
    const parsed = insertLocationSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    // Never allow clients to re-stamp commandId via PATCH.
    const { commandId: _ignored, ...safe } = parsed.data as any;
    const location = await storage.updateLocation(id, safe, orgId);
    if (!location) return res.status(404).json({ message: "Location not found" });
    res.json(location);
  });

  app.delete("/api/locations/:id", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const id = parseInt(req.params.id as string);
    const existing = await storage.getLocation(id, orgId);
    if (!existing) return res.status(404).json({ message: "Location not found" });
    if (!(await assertWriteCommandAccess(req, (existing as any).commandId))) {
      return res.status(403).json({ message: "Out-of-scope Command" });
    }
    await storage.deleteLocation(id, orgId);
    res.json({ success: true });
  });

  // Categories
  app.get("/api/categories", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const { commandFilter } = await getCommandScope(req);
    const categories = await storage.getCategories(orgId, commandFilter);
    res.json(categories);
  });

  app.post("/api/categories", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const parsed = insertCategorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const { defaultStampCommandId, writeAccessCommandIds } = await getCommandScope(req);
    if (defaultStampCommandId == null || writeAccessCommandIds.length === 0) {
      return res.status(403).json({ message: "No writeable Command in current scope" });
    }
    const { commandId: _ignored, isSystem: _ignoredSys, ...safe } = parsed.data as any;
    const category = await storage.createCategory(
      { ...safe, commandId: defaultStampCommandId, isSystem: false },
      orgId,
    );
    res.json(category);
  });

  app.post("/api/categories/ensure-other", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const { defaultStampCommandId, writeAccessCommandIds } = await getCommandScope(req);
    if (defaultStampCommandId == null || writeAccessCommandIds.length === 0) {
      return res.status(403).json({ message: "No writeable Command in current scope" });
    }
    const category = await storage.ensureOtherCategory(orgId, defaultStampCommandId);
    res.json(category);
  });

  app.patch("/api/categories/:id", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const id = parseInt(req.params.id as string);
    const existing = await storage.getCategory(id, orgId);
    if (!existing) return res.status(404).json({ message: "Category not found" });
    if ((existing as any).isSystem) {
      return res.status(403).json({ message: "System categories cannot be modified" });
    }
    if (!(await assertWriteCommandAccess(req, (existing as any).commandId))) {
      return res.status(403).json({ message: "Out-of-scope Command" });
    }
    const parsed = insertCategorySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const { commandId: _ignored, isSystem: _ignoredSys, ...safe } = parsed.data as any;
    const category = await storage.updateCategory(id, safe, orgId);
    if (!category) return res.status(404).json({ message: "Category not found" });
    res.json(category);
  });

  app.delete("/api/categories/:id", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const id = parseInt(req.params.id as string);
    const existing = await storage.getCategory(id, orgId);
    if (!existing) return res.status(404).json({ message: "Category not found" });
    if ((existing as any).isSystem) {
      return res.status(403).json({ message: "System categories cannot be modified" });
    }
    if (!(await assertWriteCommandAccess(req, (existing as any).commandId))) {
      return res.status(403).json({ message: "Out-of-scope Command" });
    }
    await storage.deleteCategory(id, orgId);
    res.json({ success: true });
  });

  // Custom Maps (admin only for create/delete, all roles for read)
  app.get("/api/custom-maps", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const { commandFilter } = await getCommandScope(req);
    const maps = await storage.getCustomMaps(orgId, commandFilter);
    res.json(maps);
  });

  app.post("/api/custom-maps", requireAdmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const parsed = insertCustomMapSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Validation failed" });
    const { defaultStampCommandId, writeAccessCommandIds } = await getCommandScope(req);
    if (defaultStampCommandId == null || writeAccessCommandIds.length === 0) {
      return res.status(403).json({ message: "Cannot create custom map in a read-only scope. Switch to one of your own Commands first." });
    }
    const map = await storage.createCustomMap(parsed.data, orgId, defaultStampCommandId);
    audit(req.currentUser!.id, orgId, "admin.custom_map_create", `Created custom map "${map.name}"`, { entityType: "custom_map", entityId: String(map.id) });
    res.status(201).json(map);
  });

  app.delete("/api/custom-maps/:id", requireAdmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid map ID" });
    const existing = await storage.getCustomMap(id, orgId);
    if (!existing) return res.status(404).json({ message: "Custom map not found" });
    await storage.deleteCustomMap(id, orgId);
    audit(req.currentUser!.id, orgId, "admin.custom_map_delete", `Deleted custom map "${existing.name}"`, { entityType: "custom_map", entityId: String(id) });
    res.json({ success: true });
  });

  // Live incidents — must be registered BEFORE /api/incidents/:id to avoid "live" being treated as an id
  app.get("/api/incidents/live", async (req, res) => {
    const { organizationId: orgId } = req.currentUser!;
    const { commandFilter, accessibleCommandIds } = await getCommandScope(req);
    // Safety-critical read: wide-access users (admin/superadmin) must see ALL
    // live incidents across every accessible command, not just the active group
    // tab. A panic or live incident stamped with a different command than the
    // admin's current desktop session must never be hidden from the Live Monitor.
    const liveFilter = canSwitchAllCommands(req.currentUser!)
      ? (accessibleCommandIds.length > 0 ? accessibleCommandIds : undefined)
      : commandFilter;
    const live = await storage.getLiveIncidents(orgId, liveFilter);
    const scopedLive = req.currentUser!.role === "access_controller"
      ? live.filter((inc) => inc.userId === req.currentUser!.id)
      : live;
    res.json(scopedLive);
  });

  // Incidents
  app.get("/api/incidents", async (req, res) => {
    const { organizationId: orgId, role, id: userId } = req.currentUser!;
    const { commandFilter } = await getCommandScope(req);
    let restrictToLocationIds: number[] | undefined;
    if (usesLocationAssignmentScope(role)) {
      const assigned = await storage.getUserLocationAssignments(userId, orgId);
      if (assigned.length > 0) restrictToLocationIds = assigned;
    }
    let incidentList = await storage.getIncidents(orgId, restrictToLocationIds, commandFilter);
    if (role === "access_controller") {
      incidentList = incidentList.filter((inc) => inc.userId === userId);
    }
    const categories = await storage.getCategories(orgId, commandFilter);
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
    const attachmentCounts = await storage.getAttachmentCountsByOrg(orgId);
    // Batch-resolve closer names from closedByUserId FKs
    const closerIds = [...new Set(incidentList.map(inc => (inc as any).closedByUserId).filter(Boolean))] as string[];
    const closerMap: Record<string, string> = {};
    if (closerIds.length > 0) {
      const closers = await Promise.all(closerIds.map(id => storage.getUserById(id)));
      closerIds.forEach((id, i) => {
        if (closers[i]) closerMap[id] = `${closers[i]!.firstName} ${closers[i]!.lastName}`.trim();
      });
    }
    // Batch-resolve reporter names from userId FKs
    const reporterIds = [...new Set(incidentList.map(inc => inc.userId).filter(Boolean))] as string[];
    const reporterMap: Record<string, { firstName: string; lastName: string }> = {};
    if (reporterIds.length > 0) {
      const reporters = await Promise.all(reporterIds.map(id => storage.getUserById(id)));
      reporterIds.forEach((id, i) => {
        if (reporters[i]) reporterMap[id] = { firstName: reporters[i]!.firstName, lastName: reporters[i]!.lastName };
      });
    }
    const incidentsWithCounts = incidentList.map(inc => ({
      ...inc,
      attachmentCount: attachmentCounts[inc.id] || 0,
      categoryName: inc.categoryId != null ? (categoryNameById.get(inc.categoryId) ?? null) : null,
      closedByName: closerMap[(inc as any).closedByUserId] ?? null,
      reporterFirstName: inc.userId ? (reporterMap[inc.userId]?.firstName ?? null) : null,
      reporterLastName: inc.userId ? (reporterMap[inc.userId]?.lastName ?? null) : null,
    }));
    res.json(incidentsWithCounts);
  });

  app.get("/api/incidents/:id", async (req, res) => {
    const { organizationId: orgId, role, id: userId } = req.currentUser!;
    const id = parseInt(req.params.id as string);
    const incident = await storage.getIncident(id, orgId);
    if (!incident) return res.status(404).json({ message: "Incident not found" });
    // Active-Command authorisation (read): includes cross-Command visibility grants.
    if (!(await assertReadCommandAccess(req, (incident as any).commandId))) {
      return res.status(404).json({ message: "Incident not found" });
    }
    if (usesLocationAssignmentScope(role)) {
      const assigned = await storage.getUserLocationAssignments(userId, orgId);
      if (assigned.length > 0 && incident.locationId !== null && !assigned.includes(incident.locationId)) {
        return res.status(404).json({ message: "Incident not found" });
      }
    }
    if (role === "access_controller" && incident.userId !== userId) {
      return res.status(404).json({ message: "Incident not found" });
    }
    res.json(incident);
  });

  app.post("/api/live-incidents/notify-severity", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    // Severity info is now baked into dispatchLiveIncidentPush (fired when the
    // live incident record is created). Returning 0 here prevents a duplicate push.
    return res.json({ sent: 0 });
    const { organizationId: orgId, id: userId } = req.currentUser;
    const { categoryId, severity } = req.body;
    if (!severity || !["red", "orange", "yellow"].includes(severity)) {
      return res.status(400).json({ message: "Invalid severity" });
    }
    if (severity === "yellow") return res.json({ sent: 0 });

    let catName = "Incident";
    if (categoryId) {
      const cat = await storage.getCategory(Number(categoryId), orgId);
      catName = cat?.name ?? "Incident";
    }
    const reporter = await storage.getUserById(userId);
    const fullName = reporter ? `${reporter.firstName} ${reporter.lastName}`.trim() : "A user";

    // Severity alerts use the same org-wide scope as dispatchLiveIncidentPush so
    // every team member who can receive the main live-incident push also receives
    // the severity pre-alert. Command-scoped filtering caused false "push unavailable"
    // toasts when the responder's command_users rows didn't match other subscribers.
    let subs: Awaited<ReturnType<typeof storage.getPushSubscriptionsByOrg>>;
    let title: string;
    if (severity === "red") {
      title = `🔴 RED Alert — ${catName} · ${fullName}`;
      subs = await storage.getPushSubscriptionsByOrg(orgId, userId, undefined, undefined);
    } else {
      title = `🟠 Orange Alert — ${catName} · ${fullName}`;
      subs = await storage.getPushSubscriptionsByOrg(orgId, userId, ["administrator", "supervisor", "control_room"], undefined);
    }

    const body = `Responding now · ${catName} · Tap to monitor`;
    const payload = JSON.stringify({ type: "incident_started", title, body, url: "/live-monitor" });
    const dedupedSubs = dedupeByEndpoint(subs);
    const pushedUserIds = new Set<string>();
    let sent = 0;
    await Promise.allSettled(
      dedupedSubs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            URGENT_PUSH,
          );
          sent++;
          pushedUserIds.add(sub.userId);
          storage.createNotificationLog({
            organizationId: orgId,
            userId: sub.userId,
            title,
            body,
            url: "/live-monitor",
          }).catch(() => {});
        } catch (err: unknown) {
          const statusCode = typeof err === "object" && err !== null && "statusCode" in err
            ? (err as { statusCode: number }).statusCode
            : 0;
          if (statusCode === 410 || statusCode === 404) {
            await storage.deletePushSubscription(sub.endpoint);
          } else {
            console.error("[push] severity notify failed (status=%d):", statusCode, err instanceof Error ? err.message : err);
          }
        }
      })
    );
    // FCM fan-out — native Android/iOS devices (severity alert)
    {
      const severityRoles = severity === "red" ? undefined : ["administrator", "supervisor", "control_room"];
      storage.getFcmTokensByOrg(orgId, userId, severityRoles).then((fcmSubs) => {
        if (fcmSubs.length > 0) {
          sendFcmBatch(fcmSubs.map((s) => s.token), {
            title,
            body,
            data: { type: "incident_started", url: "/live-monitor" },
          }).catch(() => {});
        }
      }).catch(() => {});
    }
    // Create notification logs for eligible users who don't have push subscriptions,
    // so they still see the alert in the notification bell.
    (async () => {
      try {
        const allActive = await storage.getActiveUsersByOrg(orgId);
        const targetRoles = severity === "red" ? ["administrator", "supervisor", "reporter"] : ["administrator", "supervisor", "control_room"];
        // Build the set of user IDs who are members of the reporting Command so we
        // don't write notification-log entries for users in other Commands.
        let commandMemberIds: Set<string> | null = null;
        if (defaultStampCommandId != null) {
          const members = await storage.getCommandMembers(defaultStampCommandId, orgId);
          commandMemberIds = new Set(members.map((m) => m.userId));
        }
        const noPushUsers = allActive.filter(
          (u) =>
            u.id !== userId &&
            targetRoles.includes(u.role ?? "") &&
            !pushedUserIds.has(u.id) &&
            (commandMemberIds == null || commandMemberIds.has(u.id))
        );
        await Promise.allSettled(
          noPushUsers.map((u) =>
            storage.createNotificationLog({
              organizationId: orgId,
              userId: u.id,
              title,
              body,
              url: "/live-monitor",
            }).catch(() => {})
          )
        );
      } catch { /* best-effort */ }
    })();
    res.json({ sent });
  });

  app.get("/api/panic/recent", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const { role, organizationId: orgId } = req.currentUser;
    const since = new Date(Date.now() - 30 * 60 * 1000);
    const alerts = await storage.getRecentPanicAlerts(orgId, since);
    res.json(alerts);
  });

  app.post("/api/incidents/:id/acknowledge-panic", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const { organizationId: orgId, id: acknowledgerId } = req.currentUser;
    const incidentId = parseInt(req.params.id as string, 10);
    if (isNaN(incidentId)) return res.status(400).json({ message: "Invalid incident ID" });
    const incident = await storage.getIncident(incidentId, orgId);
    if (!incident) return res.status(404).json({ message: "Incident not found" });
    if (!(await assertCommandAccess(req, (incident as any).commandId))) {
      return res.status(404).json({ message: "Incident not found" });
    }
    // Only allow ack on actual panic incidents that are still open.
    const cats = await storage.getCategories(orgId);
    const cat = cats.find((c) => c.id === incident.categoryId);
    if (!cat || cat.name.toLowerCase() !== "panic") {
      return res.status(400).json({ message: "Not a panic incident" });
    }
    if (incident.panicClosedAt) {
      return res.status(400).json({ message: "Panic alert already closed" });
    }
    // Panicker cannot acknowledge their own alert.
    if (incident.userId === acknowledgerId) {
      return res.status(400).json({ message: "You cannot acknowledge your own panic alert" });
    }

    await storage.acknowledgePanic(incidentId, orgId, acknowledgerId);
    res.json({ ok: true });

    // Best-effort: push the panicker + broadcast a silent INVALIDATE_PANIC
    // signal to every device in the org so all banners update instantly.
    (async () => {
      try {
        const acknowledger = await storage.getUserById(acknowledgerId);
        const ackName = acknowledger ? `${acknowledger.firstName} ${acknowledger.lastName}`.trim() : "A responder";
        // Notify the panicker
        if (incident.userId) {
          const title = "🤝 Help is on the way";
          const body = `${ackName} acknowledged your panic alert. Assistance is coming.`;
          const url = "/";
          storage.createNotificationLog({
            organizationId: orgId,
            userId: incident.userId,
            title,
            body,
            url,
            incidentId,
          }).catch(() => {});
          const panickerSubs = await storage.getPushSubscriptionsByUser(incident.userId);
          if (panickerSubs.length > 0) {
            const payload = JSON.stringify({ type: "panic_acknowledged", title, body, url });
            await Promise.allSettled(
              panickerSubs.map(async (sub) => {
                try {
                  await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    payload,
                    URGENT_PUSH,
                  );
                } catch (err: unknown) {
                  const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
                  if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
                }
              })
            );
          }
          // FCM fan-out to panicker's native device
          storage.getFcmTokensByUser(incident.userId).then((fcmSubs) => {
            if (fcmSubs.length > 0) {
              sendFcmBatch(fcmSubs.map((s) => s.token), {
                title,
                body,
                data: { type: "panic_acknowledged", url },
              }).catch(() => {});
            }
          }).catch(() => {});
        }
        // Silent broadcast to everyone else in the org so their banners refresh
        // without waiting for the 10 s poll. SW intercepts type=panic_ack_update
        // and only posts INVALIDATE_PANIC; no native notification is shown.
        const orgSubs = await storage.getPushSubscriptionsByOrg(orgId, incident.userId ?? undefined);
        if (orgSubs.length > 0) {
          const silent = JSON.stringify({ type: "panic_ack_update", silent: true });
          await Promise.allSettled(
            dedupeByEndpoint(orgSubs).map(async (sub) => {
              try {
                await webpush.sendNotification(
                  { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                  silent,
                );
              } catch (err: unknown) {
                const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
                if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
              }
            })
          );
        }
      } catch { /* best-effort */ }
    })();
  });

  // Close a panic alert — only the original panicker can close. Sets
  // panicClosedAt so it disappears from the panic banner. The incident itself
  // stays in the Occurrence Book (with category "Panic") so the panicker can
  // edit / convert it as needed.
  app.post("/api/incidents/:id/close-panic", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const { organizationId: orgId, id: callerId } = req.currentUser;
    const incidentId = parseInt(req.params.id as string, 10);
    if (isNaN(incidentId)) return res.status(400).json({ message: "Invalid incident ID" });
    const incident = await storage.getIncident(incidentId, orgId);
    if (!incident) return res.status(404).json({ message: "Incident not found" });
    if (!(await assertCommandAccess(req, (incident as any).commandId))) {
      return res.status(404).json({ message: "Incident not found" });
    }
    // Only allow close on actual panic incidents (not arbitrary org incidents).
    const cats = await storage.getCategories(orgId);
    const cat = cats.find((c) => c.id === incident.categoryId);
    if (!cat || cat.name.toLowerCase() !== "panic") {
      return res.status(400).json({ message: "Not a panic incident" });
    }
    if (incident.userId !== callerId) {
      return res.status(403).json({ message: "Only the panicker can close their alert" });
    }
    await storage.updateIncident(incidentId, { closedByUserId: callerId } as any, orgId);
    await storage.closePanic(incidentId, orgId);
    audit(callerId, orgId, "panic.close", `Closed panic alert for incident #${incidentId}`, { entityType: "incident", entityId: String(incidentId) });
    res.json({ ok: true });

    // Broadcast silent INVALIDATE_PANIC to everyone in the org so banners hide.
    (async () => {
      try {
        const orgSubs = await storage.getPushSubscriptionsByOrg(orgId);
        if (orgSubs.length === 0) return;
        const silent = JSON.stringify({ type: "panic_ack_update", silent: true });
        await Promise.allSettled(
          dedupeByEndpoint(orgSubs).map(async (sub) => {
            try {
              await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                silent,
              );
            } catch (err: unknown) {
              const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
              if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
            }
          })
        );
      } catch { /* best-effort */ }
    })();
  });

  // Panicker updates GPS while panic is active (e.g. location turned on after SOS).
  app.patch("/api/incidents/:id/panic-location", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const { organizationId: orgId, id: userId } = req.currentUser;
    const incidentId = parseInt(req.params.id as string, 10);
    if (isNaN(incidentId)) return res.status(400).json({ message: "Invalid incident ID" });
    const { lat, lng } = req.body ?? {};
    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({ message: "lat and lng must be numbers" });
    }
    const incident = await storage.getIncident(incidentId, orgId);
    if (!incident || !incident.isLive) return res.status(404).json({ message: "Live incident not found" });
    if (!(await assertCommandAccess(req, (incident as { commandId?: number | null }).commandId))) {
      return res.status(404).json({ message: "Incident not found" });
    }
    if (incident.userId !== userId) {
      return res.status(403).json({ message: "Only the panicker can update panic location" });
    }
    const cats = await storage.getCategories(orgId);
    const cat = cats.find((c) => c.id === incident.categoryId);
    if (!cat || cat.name.toLowerCase() !== "panic") {
      return res.status(400).json({ message: "Not a panic incident" });
    }
    if (incident.panicClosedAt) {
      return res.status(400).json({ message: "Panic alert already closed" });
    }
    const user = await storage.getUserById(userId);
    const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : "A user";
    const hadNoCoords =
      incident.latitude == null &&
      incident.liveStartLat == null &&
      incident.destinationLat == null;
    const updated = await syncPanicIncidentCoordinates(orgId, incidentId, lat, lng, fullName);
    res.json(updated);
    if (hadNoCoords) {
      void broadcastPanicBannerRefresh(orgId);
    }
  });

  app.post("/api/panic", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const { organizationId: orgId, id: userId } = req.currentUser;
    const { lat, lng } = req.body ?? {};
    const user = await storage.getUserById(userId);
    const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : "A user";
    const hasCoords = typeof lat === "number" && typeof lng === "number";
    const title = `🆘 PANIC — ${fullName} needs immediate assistance`;
    // NEVER include raw lat/lng here — Android auto-linkifies coordinate text
    // in the notification body and hijacks the tap into Google Maps before the
    // service worker can route into the app. Keep coordinates in the in-app banner only.
    const body = hasCoords
      ? "Tap to open OMT Pulse and respond — location is shown in the app."
      : "Location unavailable — tap to open OMT Pulse and respond.";
    // Active-Command scope for the panicker — used to stamp both the auto-created
    // "Panic" category and the panic incident itself so they're isolated correctly.
    // If the panicker is viewing a granted (read-only) Command, fall back to
    // their FIRST owned Command (or Central) so panics never produce orphaned
    // records — a panic must always be filed in a Command the panicker owns.
    let { defaultStampCommandId: panicCommandId } = await getCommandScope(req);
    if (panicCommandId == null) {
      const ownCmds = await storage.getUserCommands(userId);
      const central = ownCmds.find(c => c.isCentral);
      panicCommandId = central?.id ?? ownCmds[0]?.id ?? null;
    }
    if (panicCommandId == null) {
      return res.status(403).json({ message: "Cannot raise a panic — user has no assigned Command" });
    }
    // Upsert "Panic" category for this Command (create on first use).
    // Scoped by panicCommandId so each Command owns its own Panic category —
    // a Panic in Command A must never bind to Command B's category row.
    const scopedCategories = await storage.getCategories(orgId, [panicCommandId]);
    let panicCategory = scopedCategories.find((c) => c.name.toLowerCase() === "panic");
    if (!panicCategory) {
      panicCategory = await storage.createCategory(
        { name: "Panic", color: "#ef4444", description: "Auto-generated by panic alert system", isOther: false, isSystem: true, severity: "red", commandId: panicCommandId },
        orgId,
      );
    }

    // Create an incident record so the panic appears in Occurrence Book & Analytics.
    // Await it so we can embed the incident ID in the notification URL, letting
    // "View →" deep-link directly to the dialog with the map pin visible.
    const now = new Date();
    const incidentDate = now.toISOString().slice(0, 10);
    const incidentTime = now.toTimeString().slice(0, 5);
    const incidentDesc = hasCoords
      ? `🆘 Panic alert — ${fullName} · GPS: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
      : `🆘 Panic alert — ${fullName} · Location unavailable`;
    let panicIncidentId: number | null = null;
    try {
      // Panic is created as a live incident so responders can join it via the
      // standard /api/incidents/:id/join-live flow. The panicker's coordinates
      // are also stored as the destination so joiners' Live Monitor map shows
      // them as the route target. closePanic() ends the live state cleanly.
      const panicIncident = await storage.createIncident(
        {
          incidentDate,
          incidentTime,
          categoryId: panicCategory.id,
          description: incidentDesc,
          severity: "red",
          latitude: hasCoords ? lat : null,
          longitude: hasCoords ? lng : null,
          isLive: true,
          liveStartedAt: now,
          liveStartLat: hasCoords ? lat : null,
          liveStartLng: hasCoords ? lng : null,
          destinationLat: hasCoords ? lat : null,
          destinationLng: hasCoords ? lng : null,
          destinationName: hasCoords ? `🆘 ${fullName}` : null,
          // Live Monitor "No GPS" keys off responderLat — seed it at SOS so the
          // pin is live from the first poll, then panicker sync keeps it moving.
          responderLat: hasCoords ? lat : null,
          responderLng: hasCoords ? lng : null,
          responderPositionUpdatedAt: hasCoords ? now : null,
          // Stamp with active Command so panic appears in the same scope as the
          // panicker's other incidents (Task #212 isolation).
          commandId: panicCommandId,
        },
        orgId,
        userId,
      );
      panicIncidentId = panicIncident.id;
    } catch (err) {
      console.error("[panic] incident create failed:", err);
    }

    // Deep-link to live-incident join flow (same path native FCM and PWA use after rewrite).
    const notifUrl = panicIncidentId
      ? `/live-incident?join=${panicIncidentId}`
      : "/live-incident";
    const payload = JSON.stringify({ type: "panic", title, body, incidentId: panicIncidentId, url: notifUrl });

    const allSubs = await storage.getPushSubscriptionsByOrg(orgId, userId, undefined, undefined);
    let sent = 0;
    await Promise.allSettled(
      dedupeByEndpoint(allSubs).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            URGENT_PUSH,
          );
          sent++;
          storage.createNotificationLog({
            organizationId: orgId,
            userId: sub.userId,
            title,
            body,
            url: notifUrl,
          }).catch(() => {});
        } catch (err: unknown) {
          const statusCode = typeof err === "object" && err !== null && "statusCode" in err
            ? (err as { statusCode: number }).statusCode : 0;
          if (statusCode === 410 || statusCode === 404) {
            await storage.deletePushSubscription(sub.endpoint);
          } else {
            console.error("[push] panic notify failed (status=%d):", statusCode, err instanceof Error ? err.message : err);
          }
        }
      })
    );
    // FCM fan-out — native Android/iOS devices (all roles, exclude panicker)
    storage.getFcmTokensByOrg(orgId, userId).then((fcmSubs) => {
      if (fcmSubs.length > 0) {
        sendFcmBatch(fcmSubs.map((s) => s.token), {
          title,
          body,
          data: { type: "panic", incidentId: String(panicIncidentId ?? ""), url: notifUrl },
        }).catch(() => {});
      }
    }).catch(() => {});
    storage.createAuditLog({
      organizationId: orgId,
      userId,
      action: "panic.alert",
      entityType: "user",
      entityId: userId,
      description: `${fullName} triggered a panic alert${hasCoords ? ` from ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}` : " (location unavailable)"}`,
      changes: hasCoords ? { location: { from: null, to: { lat, lng } } } : undefined,
    }).catch(() => {});
    res.json({ sent, found: allSubs.length });
  });

  app.post("/api/incidents", async (req, res) => {
    const { organizationId: orgId, role, id: userId } = req.currentUser!;
    const parsed = insertIncidentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    if (usesLocationAssignmentScope(role)) {
      const assigned = await storage.getUserLocationAssignments(userId, orgId);
      if (assigned.length > 0 && parsed.data.locationId != null && !assigned.includes(parsed.data.locationId)) {
        return res.status(403).json({ message: "You are not assigned to this location" });
      }
    }
    if (parsed.data.customMapId != null) {
      const cmap = await storage.getCustomMap(parsed.data.customMapId, orgId);
      if (!cmap) return res.status(400).json({ message: "Invalid custom map" });
    } else if (parsed.data.customMapX != null || parsed.data.customMapY != null) {
      return res.status(400).json({ message: "customMapX/customMapY require a customMapId" });
    }
    if (parsed.data.categoryId != null) {
      const cat = await storage.getCategory(parsed.data.categoryId, orgId);
      if (!cat) {
        return res.status(400).json({ message: "STALE_CATEGORY" });
      }
      if (cat.isOther && !parsed.data.otherCategoryNote?.trim()) {
        return res.status(400).json({ message: "Please specify the occurrence type for this category" });
      }
    }
    if (parsed.data.otherCategoryNote !== undefined) {
      parsed.data.otherCategoryNote = parsed.data.otherCategoryNote?.trim() || null;
    }
    const { defaultStampCommandId, writeAccessCommandIds } = await getCommandScope(req);
    if (defaultStampCommandId == null || writeAccessCommandIds.length === 0) {
      return res.status(403).json({ message: "Cannot file an incident from a read-only scope" });
    }
    // Auto-create "Live Incident" category and set liveStartedAt when isLive is true
    if (parsed.data.isLive) {
      const liveCat = await storage.ensureLiveIncidentCategory(orgId, defaultStampCommandId);
      if (!parsed.data.categoryId) parsed.data.categoryId = liveCat.id;
      parsed.data.liveStartedAt = new Date();
    }
    // Always stamp the incident with the server-resolved active Command —
    // ignore any client-supplied commandId to prevent cross-Command writes.
    parsed.data.commandId = defaultStampCommandId;
    const incident = await storage.createIncident(parsed.data, orgId, userId);
    audit(userId, orgId, "incident.create", `Created incident on ${parsed.data.incidentDate}`, { entityType: "incident", entityId: String(incident.id) });
    if (incident.isLive) {
      dispatchLiveIncidentPush(orgId, userId, incident).catch((e) => console.error("[push] dispatch error:", e));
    } else {
      dispatchReportIncidentPush(orgId, userId, incident).catch((e) => console.error("[push] report incident dispatch error:", e));
    }
    if (incident.isLive) {
      // Retry push after 2 minutes — catches devices that had the first push
      // dropped due to brief offline windows, battery optimisation, or TTL expiry.
      // Only fires once per incident and only if the incident is still live.
      setTimeout(async () => {
        if (retriedIncidentIds.has(incident.id)) return;
        retriedIncidentIds.add(incident.id);
        try {
          const live = await storage.getIncident(incident.id, orgId);
          if (live && (live as any).isLive) {
            console.log(`[PUSH] Retry push for incident ${incident.id} (still live after 2 min)`);
            await dispatchLiveIncidentPush(orgId, userId, live as any);
          }
        } catch (e) {
          console.error("[push] retry dispatch error:", e);
        }
      }, 2 * 60 * 1000);
    }
    res.json(incident);
  });

  // End a live incident — any authenticated org member can call this (reporters included)
  app.post("/api/incidents/:id/end-live", async (req, res) => {
    const { organizationId: orgId, id: userId, role } = req.currentUser!;
    const id = parseInt(req.params.id as string);
    const incident = await storage.getIncident(id, orgId);
    if (!incident) return res.status(404).json({ message: "Incident not found" });
    if (!(await assertCommandAccess(req, (incident as any).commandId))) {
      return res.status(404).json({ message: "Incident not found" });
    }
    // Only the original creator or dispatch staff may end a live incident.
    // Field joiners (reporter / access controller / patrol) must use leave-live instead.
    if (incident.userId !== userId && !isDispatchStaff(role)) {
      return res.status(403).json({ message: "Only the incident creator or an admin/supervisor can end this incident" });
    }
    // Panic incidents: the panicker can always close their own alert.
    // Admins/supervisors may also close on behalf of the panicker (e.g. the
    // panicker is incapacitated or has lost their phone). Reporters who are
    // NOT the panicker still can't end someone else's panic — they were
    // already blocked above by the role==="reporter" check.
    // When ending a panic this way, we ALSO stamp panicClosedAt (below) and
    // broadcast INVALIDATE_PANIC so every device drops the red banner —
    // matching the close-panic endpoint exactly so banners never get stuck.
    const cats = await storage.getCategories(orgId);
    const cat = cats.find((c) => c.id === incident.categoryId);
    const isPanic = !!cat && cat.name.toLowerCase() === "panic";
    const { liveConvertLat, liveConvertLng, endLat, endLng } = req.body;
    const closureFields = (liveConvertLat != null && liveConvertLng != null)
      ? { liveConvertLat: Number(liveConvertLat), liveConvertLng: Number(liveConvertLng) }
      : {};
    // Snapshot the closer's last known position to liveEndLat/Lng before we
    // null out responderLat/Lng. Prefer fresh coords explicitly sent by the
    // client (one-shot getCurrentPosition at close time); fall back to the
    // continuously-PATCHed responderLat/Lng cached on the incident row. This
    // gives admins auditable proof of where the responder was standing when
    // they closed the incident — the gap that previously made "Manually
    // closed" entries show only Origin with no end-location.
    const endLatVal = (endLat != null && Number.isFinite(Number(endLat)))
      ? Number(endLat)
      : (incident.responderLat != null ? Number(incident.responderLat) : null);
    const endLngVal = (endLng != null && Number.isFinite(Number(endLng)))
      ? Number(endLng)
      : (incident.responderLng != null ? Number(incident.responderLng) : null);
    const endPositionFields = (endLatVal != null && endLngVal != null)
      ? { liveEndLat: endLatVal, liveEndLng: endLngVal }
      : {};
    const panicClosure = isPanic ? { panicClosedAt: new Date() } : {};
    const updated = await storage.updateIncident(id, { isLive: false, responderLat: null, responderLng: null, responderArrivedAt: null, liveEndedAt: new Date(), liveClosedManually: true, closedByUserId: userId, ...panicClosure, ...closureFields, ...endPositionFields } as any, orgId);
    // Close all active responders for this incident
    const activeResponders = await storage.getActiveLiveResponders(id, orgId);
    await storage.closeAllLiveResponders(id, orgId);
    audit(userId, orgId, "incident.end_live", `Ended live incident #${id}`, { entityType: "incident", entityId: String(id) });
    arrivalNotificationSent.delete(id);
    proximityNotificationSent.delete(id);
    res.json(updated);
    // FCM — replace stale "Live Incident" notification on native Android/iOS
    const reporterIdForFcm = incident.userId ?? userId;
    const reporterForFcm = await storage.getUserById(reporterIdForFcm);
    const fcmFullName = reporterForFcm ? `${reporterForFcm.firstName} ${reporterForFcm.lastName}`.trim() : "Responder";
    const fcmEndedAt = updated?.liveEndedAt ?? new Date();
    const fcmEndTime = fcmEndedAt.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
    const fcmDurationMin = incident.liveStartedAt
      ? Math.round((fcmEndedAt.getTime() - new Date(incident.liveStartedAt).getTime()) / 60000)
      : null;
    dispatchLiveIncidentCloseFcm(
      orgId,
      incident,
      { fullName: fcmFullName, endTime: fcmEndTime, durationMin: fcmDurationMin },
      activeResponders.map((r) => r.userId),
    ).catch(() => {});
    // Push to active joiners: incident closed — same payload format as admin/supervisor notification
    if (activeResponders.length > 0) {
      const reporterId = incident.userId ?? userId;
      const reporter = await storage.getUserById(reporterId);
      const fullName = reporter ? `${reporter.firstName} ${reporter.lastName}`.trim() : "Responder";
      const endedAt = updated?.liveEndedAt ?? new Date();
      const endTime = endedAt.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
      const durationMin = incident.liveStartedAt
        ? Math.round((endedAt.getTime() - new Date(incident.liveStartedAt).getTime()) / 60000)
        : null;
      const joinerTitle = `✅ Live Incident Closed — ${fullName}`;
      const joinerBody = durationMin != null
        ? `Closed at ${endTime} · Duration: ${durationMin < 1 ? "< 1" : durationMin} min`
        : `Closed at ${endTime}`;
      const joinerPayload = JSON.stringify({ type: "incident_closed", title: joinerTitle, body: joinerBody, url: "/live-incident" });
      for (const responder of activeResponders) {
        const joinerSubs = await storage.getPushSubscriptionsByUser(responder.userId);
        await Promise.allSettled(joinerSubs.map(async (sub) => {
          try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, joinerPayload, URGENT_PUSH);
            storage.createNotificationLog({ organizationId: orgId, userId: responder.userId, title: joinerTitle, body: joinerBody, url: "/live-incident", incidentId: id }).catch(() => {});
          } catch (err: unknown) {
            const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
            if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
          }
        }));
      }
    }
    // Push to admin/supervisor: rich executive summary on incident closed
    (async () => {
      const reporterId = incident.userId ?? userId;
      const [reporter, category, allResponders, attachments] = await Promise.all([
        storage.getUserById(reporterId),
        incident.categoryId ? storage.getCategory(incident.categoryId, orgId) : Promise.resolve(undefined),
        storage.getIncidentResponders(id, orgId),
        storage.getAttachmentsByIncident(id, orgId),
      ]);
      const fullName = reporter ? `${reporter.firstName} ${reporter.lastName}`.trim() : "Responder";
      const endedAt = updated?.liveEndedAt ?? new Date();
      const fmt = (d: Date | string | null | undefined) =>
        d ? new Date(d).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false }) : null;
      const durationMin = incident.liveStartedAt
        ? Math.round((endedAt.getTime() - new Date(incident.liveStartedAt).getTime()) / 60000)
        : null;
      const categoryLabel = category?.name ?? "Live Incident";
      // Build title
      const closeTitle = `📋 Mission Closed — ${categoryLabel} · ${fullName}`;
      // Line 1: destination + duration
      const destPart = incident.destinationName ? `→ ${incident.destinationName}` : null;
      const durPart = durationMin != null ? `${durationMin < 1 ? "< 1" : durationMin} min total` : null;
      const line1 = [destPart, durPart].filter(Boolean).join(" · ");
      // Line 2: timeline
      const dispatchTime = fmt(incident.liveStartedAt);
      const arrivedTime = fmt(incident.responderArrivedAt);
      const closedTime = fmt(endedAt);
      const timelineParts: string[] = [];
      if (dispatchTime) timelineParts.push(`Dispatch ${dispatchTime}`);
      if (arrivedTime) timelineParts.push(`On scene ${arrivedTime}`);
      if (closedTime) timelineParts.push(`Closed ${closedTime}`);
      const line2 = timelineParts.join(" · ");
      // Line 3: joiners
      const joinerNames = allResponders
        .map((r) => {
          const name = `${r.firstName} ${r.lastName}`.trim();
          const arr = fmt(r.arrivedAt);
          return arr ? `${name} (arr. ${arr})` : name;
        });
      const line3 = joinerNames.length > 0 ? `Responders: ${joinerNames.join(", ")}` : null;
      // Line 4: attachments + description snippet
      const attPart = attachments.length > 0 ? `📎 ${attachments.length} attachment${attachments.length > 1 ? "s" : ""}` : null;
      const descSnippet = incident.description?.trim()
        ? `"${incident.description.trim().slice(0, 80)}${incident.description.trim().length > 80 ? "…" : ""}"`
        : null;
      const line4 = [attPart, descSnippet].filter(Boolean).join(" · ");
      const closeBody = [line1, line2, line3, line4].filter(Boolean).join("\n");
      const incidentUrl = `/occurrence-book?incident=${id}`;
      const subs = await storage.getPushSubscriptionsByOrg(orgId, userId, ["administrator", "supervisor", "control_room"]);
      if (subs.length > 0) {
        const payload = JSON.stringify({ type: "incident_closed", title: closeTitle, body: closeBody, url: incidentUrl });
        await Promise.allSettled(dedupeByEndpoint(subs).map(async (sub) => {
          try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, URGENT_PUSH);
            storage.createNotificationLog({ organizationId: orgId, userId: sub.userId, title: closeTitle, body: closeBody, url: incidentUrl, incidentId: id }).catch(() => {});
          } catch (err: unknown) {
            const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
            if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
          }
        }));
      }
    })().catch(() => {});
    // After closing, check if any live incidents remain — if none, clear badge on all devices
    storage.countLiveIncidents(orgId).then((remaining) => {
      if (remaining === 0) sendClearBadgePush(orgId).catch(() => {});
    }).catch(() => {});
    // Panic-close parity: broadcast silent INVALIDATE_PANIC to everyone in
    // the org so the red panic banner drops on every device immediately,
    // matching what /close-panic does. Without this, admins ending a panic
    // via Live Monitor would leave the banner stuck for other users until
    // their next 10-second poll.
    if (isPanic) {
      (async () => {
        try {
          const orgSubs = await storage.getPushSubscriptionsByOrg(orgId);
          if (orgSubs.length === 0) return;
          const silent = JSON.stringify({ type: "panic_ack_update", silent: true });
          await Promise.allSettled(
            dedupeByEndpoint(orgSubs).map(async (sub) => {
              try {
                await webpush.sendNotification(
                  { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                  silent,
                );
              } catch (err: unknown) {
                const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
                if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
              }
            }),
          );
        } catch { /* best-effort */ }
      })();
    }
  });

  // Escalate a live incident — admin/supervisor only
  app.post("/api/incidents/:id/escalate", async (req, res) => {
    const { organizationId: orgId, id: userId, role } = req.currentUser!;
    if (role === "reporter" || isAccessController(role)) return res.status(403).json({ message: "Forbidden" });
    const id = parseInt(req.params.id as string);
    const incident = await storage.getIncident(id, orgId);
    if (!incident) return res.status(404).json({ message: "Incident not found" });
    if (!(await assertCommandAccess(req, (incident as any).commandId))) {
      return res.status(404).json({ message: "Incident not found" });
    }
    if (!incident.isLive) return res.status(400).json({ message: "Incident is not live" });
    const updated = await storage.escalateIncident(id, orgId);
    audit(userId, orgId, "incident.escalate", `Escalated live incident #${id}`, { entityType: "incident", entityId: String(id) });
    // Push to all admin/supervisor subscriptions
    const subs = await storage.getPushSubscriptionsByOrg(orgId, userId, ["administrator", "supervisor", "control_room"]);
    if (subs.length > 0) {
      const escTitle = "🚨 ESCALATED: Live Incident";
      const escBody = `Incident #${id}${incident.locationName ? ` at ${incident.locationName}` : ""} has been escalated — immediate attention required.`;
      const payload = JSON.stringify({ title: escTitle, body: escBody, url: "/live-monitor" });
      await Promise.allSettled(dedupeByEndpoint(subs).map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, URGENT_PUSH);
          storage.createNotificationLog({ organizationId: orgId, userId: sub.userId, title: escTitle, body: escBody, url: "/live-monitor", incidentId: id }).catch(() => {});
        } catch (err: unknown) {
          const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
          if (code === 410 || code === 404) await storage.deletePushSubscription(sub.endpoint);
        }
      }));
    }
    res.json(updated);
  });

  // Join a live incident as an additional responder
  app.post("/api/incidents/:id/join-live", async (req, res) => {
    const { organizationId: orgId, id: userId, role } = req.currentUser!;
    const id = parseInt(req.params.id as string);
    const incident = await storage.getIncident(id, orgId);
    if (!incident) return res.status(404).json({ message: "Incident not found" });
    if (!(await assertCommandAccess(req, (incident as any).commandId))) {
      return res.status(404).json({ message: "Incident not found" });
    }
    if (!incident.isLive) return res.status(400).json({ message: "Incident is not live" });
    if (incident.userId === userId) return res.status(400).json({ message: "You are the creator of this incident — use GPS tracking instead" });
    const responder = await storage.joinLiveIncident(id, orgId, userId);
    audit(userId, orgId, "incident.join_live", `Joined live incident #${id}`, { entityType: "incident", entityId: String(id) });

    // Auto-acknowledge panic incidents when a responder joins via any path
    // (live monitor "Join", push notification tap, etc.) — not just when they
    // click the explicit Acknowledge button on the panic banner. Idempotent.
    const cats = await storage.getCategories(orgId);
    const cat = cats.find((c: any) => c.id === (incident as any).categoryId);
    const isPanic = cat?.name?.toLowerCase() === "panic" && !(incident as any).panicClosedAt;
    if (isPanic && incident.userId !== userId) {
      await storage.acknowledgePanic(id, orgId, userId).catch(() => {});
      // Broadcast silent update so all devices' panic banners refresh immediately
      storage.getPushSubscriptionsByOrg(orgId, incident.userId ?? undefined).then(async (orgSubs) => {
        if (!orgSubs.length) return;
        const silent = JSON.stringify({ type: "panic_ack_update", silent: true });
        await Promise.allSettled(dedupeByEndpoint(orgSubs).map(async (sub) => {
          try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, silent);
          } catch (err: unknown) {
            const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
            if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
          }
        }));
      }).catch(() => {});
    }

    // Notify the incident creator + admins/supervisors that a joiner has responded
    (async () => {
      const joiner = await storage.getUserById(userId);
      const name = joiner ? `${joiner.firstName} ${joiner.lastName}`.trim() : "A user";

      // 1. Push directly to the creator so they know they have backup
      if (incident.userId && incident.userId !== userId) {
        const creatorSubs = await storage.getPushSubscriptionsByUser(incident.userId);
        const creatorTitle = `👥 Backup on the way — ${name} joined`;
        const creatorBody = `${name} has joined your live incident and is en route`;
        const creatorPayload = JSON.stringify({ type: "incident_joined", title: creatorTitle, body: creatorBody, url: "/live-incident" });
        // creatorSubs is already filtered to a single user — do not dedupe (would collapse multi-device).
        await Promise.allSettled(creatorSubs.map(async (sub) => {
          try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, creatorPayload, URGENT_PUSH);
            storage.createNotificationLog({ organizationId: orgId, userId: incident.userId!, title: creatorTitle, body: creatorBody, url: "/live-incident", incidentId: id }).catch(() => {});
          } catch (err: unknown) {
            const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
            if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
          }
        }));
      }

      // 2. Push to all admins/supervisors in the org (excluding the joiner)
      const adminTitle = `👥 Joined Live Incident #${id} — ${name}`;
      const adminBody = `${name} has joined the response for incident #${id}`;
      const adminPayload = JSON.stringify({ type: "incident_joined", title: adminTitle, body: adminBody, url: "/live-incident" });
      const subs = await storage.getPushSubscriptionsByOrg(orgId, userId, ["administrator", "supervisor", "control_room"]);
      await Promise.allSettled(dedupeByEndpoint(subs).map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, adminPayload, URGENT_PUSH);
          storage.createNotificationLog({ organizationId: orgId, userId: sub.userId, title: adminTitle, body: adminBody, url: "/live-incident", incidentId: id }).catch(() => {});
        } catch (err: unknown) {
          const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
          if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
        }
      }));
    })().catch(() => {});
    res.json(responder);
  });

  // Save joiner's chosen destination — persists to live_responders so Live Monitor can draw route
  app.patch("/api/incidents/:id/joiner-destination", async (req, res) => {
    const { organizationId: orgId, id: userId } = req.currentUser!;
    const id = parseInt(req.params.id as string);
    const { destinationLat, destinationLng, destinationName } = req.body;
    if (typeof destinationLat !== "number" || typeof destinationLng !== "number") {
      return res.status(400).json({ message: "destinationLat and destinationLng must be numbers" });
    }
    const incident = await storage.getIncident(id, orgId);
    if (!incident || !incident.isLive) return res.status(404).json({ message: "Live incident not found" });
    if (!(await assertCommandAccess(req, (incident as any).commandId))) {
      return res.status(404).json({ message: "Live incident not found" });
    }
    const responder = await storage.getActiveLiveResponderByUser(id, orgId, userId);
    if (!responder) return res.status(403).json({ message: "You have not joined this incident" });
    await storage.updateLiveResponderDestination(id, orgId, userId, destinationLat, destinationLng, destinationName ?? "");
    res.json({ success: true });
  });

  // Leave a joined live incident
  app.post("/api/incidents/:id/leave-live", async (req, res) => {
    const { organizationId: orgId, id: userId, role } = req.currentUser!;
    const id = parseInt(req.params.id as string);
    const incident = await storage.getIncident(id, orgId);
    if (!incident) return res.status(404).json({ message: "Incident not found" });
    if (!(await assertCommandAccess(req, (incident as any).commandId))) {
      return res.status(404).json({ message: "Incident not found" });
    }
    await storage.leaveLiveIncident(id, orgId, userId);
    audit(userId, orgId, "incident.leave_live", `Left live incident #${id}`, { entityType: "incident", entityId: String(id) });
    res.json({ success: true });
  });

  // Record joiner arrival — saves arrival time + note on the live_responders row
  app.post("/api/incidents/:id/joiner-arrival", async (req, res) => {
    const { organizationId: orgId, id: userId, role } = req.currentUser!;
    const id = parseInt(req.params.id as string);
    const incident = await storage.getIncident(id, orgId);
    if (!incident || !incident.isLive) return res.status(404).json({ message: "Live incident not found" });
    if (!(await assertCommandAccess(req, (incident as any).commandId))) {
      return res.status(404).json({ message: "Live incident not found" });
    }
    const responder = await storage.getActiveLiveResponderByUser(id, orgId, userId);
    if (!responder) return res.status(403).json({ message: "You have not joined this incident" });
    const arrivedAt = new Date();
    const arrivalNote: string | null = typeof req.body.arrivalNote === "string" && req.body.arrivalNote.trim() ? req.body.arrivalNote.trim() : null;
    await storage.recordJoinerArrival(id, orgId, userId, arrivedAt, arrivalNote);
    audit(userId, orgId, "incident.joiner_arrived", `Joiner arrived for live incident #${id}`, { entityType: "incident", entityId: String(id) });
    res.json({ success: true, arrivedAt: arrivedAt.toISOString() });
  });

  // Update joiner GPS position
  app.patch("/api/incidents/:id/joiner-position", async (req, res) => {
    const { organizationId: orgId, id: userId } = req.currentUser!;
    const id = parseInt(req.params.id as string);
    const { lat, lng } = req.body;
    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({ message: "lat and lng must be numbers" });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: "lat must be -90..90 and lng must be -180..180" });
    }
    const incident = await storage.getIncident(id, orgId);
    if (!incident || !incident.isLive) return res.status(404).json({ message: "Live incident not found" });
    if (!(await assertCommandAccess(req, (incident as any).commandId))) {
      return res.status(404).json({ message: "Live incident not found" });
    }
    const responder = await storage.getActiveLiveResponderByUser(id, orgId, userId);
    if (!responder) return res.status(403).json({ message: "You have not joined this incident" });
    await storage.updateLiveResponderPosition(id, orgId, userId, lat, lng);
    res.json({ success: true });
  });

  // Update responder GPS position for a live incident — any authenticated org member
  app.patch("/api/incidents/:id/responder-position", async (req, res) => {
    const { organizationId: orgId, id: userId } = req.currentUser!;
    const id = parseInt(req.params.id as string);
    const { lat, lng } = req.body;
    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({ message: "lat and lng must be numbers" });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: "lat must be -90..90 and lng must be -180..180" });
    }
    const incident = await storage.getIncident(id, orgId);
    if (!incident || !incident.isLive) return res.status(404).json({ message: "Live incident not found" });
    if (!(await assertCommandAccess(req, (incident as any).commandId))) {
      return res.status(404).json({ message: "Live incident not found" });
    }
    const cats = await storage.getCategories(orgId);
    const panicCategory = cats.find((c) => c.id === incident.categoryId);
    const isPanic = panicCategory?.name.toLowerCase() === "panic";
    const isPanicker = incident.userId === userId;
    const hadNoPanicCoords =
      isPanic &&
      isPanicker &&
      incident.latitude == null &&
      incident.liveStartLat == null &&
      incident.destinationLat == null;

    let updated: Incident | undefined;
    if (isPanic && isPanicker) {
      const user = await storage.getUserById(userId);
      const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : "A user";
      updated = await syncPanicIncidentCoordinates(orgId, id, lat, lng, fullName);
    } else {
      const posUpdate: Record<string, unknown> = {
        responderLat: lat,
        responderLng: lng,
        responderPositionUpdatedAt: new Date(),
      };
      if (incident.liveStartLat == null) {
        posUpdate.liveStartLat = lat;
        posUpdate.liveStartLng = lng;
      }
      updated = await storage.updateIncident(id, posUpdate, orgId);
    }
    res.json(updated);

    if (hadNoPanicCoords) {
      void broadcastPanicBannerRefresh(orgId);
    }

    // Fresh GPS received — reset stale alert timer so a future stale event will alert again
    gpsStaleLastSent.delete(id);

    // Named-location proximity notifications (500m radius) — fire after response
    (async () => {
      try {
        const PROXIMITY_M = 500;
        const geoLocations = await storage.getLocations(orgId);
        const alreadyNotified = proximityNotificationSent.get(id) ?? new Set<number>();
        // Pre-filter to locations in range that haven't been notified yet
        const nearbyNew = geoLocations.filter(
          (loc) => loc.latitude != null && loc.longitude != null &&
            !alreadyNotified.has(loc.id) &&
            haversineM({ lat, lng }, { lat: loc.latitude!, lng: loc.longitude! }) <= PROXIMITY_M
        );
        if (nearbyNew.length === 0) return;
        // Fetch subscriptions once, outside the per-location loop
        const proximityAdminRoles = incident.severity === "yellow" ? ["administrator"] : ["administrator", "supervisor", "control_room"];
        const [reporterSubs, adminSubs, reporterName] = await Promise.all([
          storage.getPushSubscriptionsByUser(userId).catch(() => [] as Awaited<ReturnType<typeof storage.getPushSubscriptionsByUser>>),
          storage.getPushSubscriptionsByOrg(orgId, userId, proximityAdminRoles).catch(() => [] as Awaited<ReturnType<typeof storage.getPushSubscriptionsByOrg>>),
          storage.getUserById(userId).then(u => u ? `${u.firstName} ${u.lastName}`.trim() : "Reporter").catch(() => "Reporter"),
        ]);
        for (const loc of nearbyNew) {
          alreadyNotified.add(loc.id);
          proximityNotificationSent.set(id, alreadyNotified);
          // Push to reporter
          if (reporterSubs.length > 0) {
            const title = `📍 You're near ${loc.name}`;
            const body = `You're within 500m of ${loc.name}. Tap to open OMT.`;
            // type:"incident_update" lets the SW post INVALIDATE_LIVE to open tabs immediately.
            const payload = JSON.stringify({ type: "incident_update", title, body, url: "/live-incident" });
            // Push to every registered device so all screens ring.
            let reporterPushSucceeded = false;
            await Promise.allSettled(reporterSubs.map((sub) =>
              webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, URGENT_PUSH)
                .then(() => { reporterPushSucceeded = true; })
                .catch((err: unknown) => {
                  const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
                  if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
                })
            ));
            // One notification-log entry per user regardless of how many devices fired.
            if (reporterPushSucceeded) {
              storage.createNotificationLog({ organizationId: orgId, userId, title, body, url: "/live-incident", incidentId: id }).catch(() => {});
            }
          }
          // Push to admins/supervisors
          if (adminSubs.length > 0) {
            const title = `📍 Reporter Near ${loc.name}`;
            const body = `${reporterName} is within 500m of ${loc.name}.`;
            const payload = JSON.stringify({ type: "incident_update", title, body, url: "/live-monitor" });
            dedupeByEndpoint(adminSubs).forEach((sub) => {
              webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, URGENT_PUSH)
                .then(() => storage.createNotificationLog({ organizationId: orgId, userId: sub.userId, title, body, url: "/live-monitor", incidentId: id }).catch(() => {}))
                .catch((err: unknown) => {
                  const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
                  if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
                });
            });
          }
        }
      } catch (err) {
        console.error("[proximity] location check error:", err instanceof Error ? err.message : err);
      }
    })();

    // Proximity arrival notification — fire after response so we don't delay the client.
    // Panic incidents set destination = panicker's own coords; arrival detection must be
    // completely suppressed to avoid false "arrived at destination" pushes.
    // NOTE: getIncident() returns a bare incidents row with no category join, so we must
    // look up the category separately to get a name to check.
    const cat = incident.categoryId ? await storage.getCategory(incident.categoryId, orgId) : null;
    const isPanicCat = (cat?.name ?? "").toLowerCase().includes("panic");
    if (isPanicCat) {
      console.log(`[ARRIVAL] Panic detected — skipping arrival push for incident ${incident.id}`);
    } else if (
      incident.latitude != null && incident.longitude != null &&
      !arrivalNotificationSent.has(id)
    ) {
      const dist = haversineM({ lat, lng }, { lat: Number(incident.latitude), lng: Number(incident.longitude) });
      if (dist <= 200) {
        arrivalNotificationSent.add(id);
        const destName = incident.locationName ?? null;
        // Mark arrival on the incident
        storage.updateIncident(id, { responderArrivedAt: new Date() }, orgId).catch((err) => {
          console.error(`[arrival] failed to set responderArrivedAt for incident ${id}:`, err instanceof Error ? err.message : err);
        });
        // Push to the reporter: "You've arrived"
        storage.getPushSubscriptionsByUser(userId).then(async (subs) => {
          if (subs.length === 0) return;
          const arrTitle = "📍 You've arrived!";
          const arrBody = `You're at the destination${destName ? ` — ${destName}` : ""}. Open OMT to record the incident.`;
          // type:"incident_update" tells the SW to post INVALIDATE_LIVE to open tabs.
          const reporterPayload = JSON.stringify({ type: "incident_update", title: arrTitle, body: arrBody, url: "/live-incident" });
          // Push to every registered device so all screens ring.
          let arrivalPushSucceeded = false;
          await Promise.allSettled(subs.map((sub) =>
            webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              reporterPayload,
              URGENT_PUSH,
            ).then(() => { arrivalPushSucceeded = true; })
            .catch((err: unknown) => {
              const code = typeof err === "object" && err !== null && "statusCode" in err
                ? (err as { statusCode: number }).statusCode : 0;
              if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
            })
          ));
          // One notification-log entry per user regardless of device count.
          if (arrivalPushSucceeded) {
            storage.createNotificationLog({ organizationId: orgId, userId, title: arrTitle, body: arrBody, url: "/live-incident", incidentId: id }).catch(() => {});
          }
        }).catch(() => {});
        // Push to admin/supervisor: "Responder arrived at scene"
        const responderName = await storage.getUserById(userId).then(u => u ? `${u.firstName} ${u.lastName}`.trim() : "Responder").catch(() => "Responder");
        storage.getPushSubscriptionsByOrg(orgId, userId, ["administrator", "supervisor", "control_room"]).then((adminSubs) => {
          if (adminSubs.length === 0) return;
          const adminTitle = "📍 Responder At Scene";
          const adminBody = `${responderName} has arrived at${destName ? ` ${destName}` : " the destination"}.`;
          // type:"incident_update" triggers INVALIDATE_LIVE in the SW so open live-monitor tabs refresh immediately.
          const adminPayload = JSON.stringify({ type: "incident_update", title: adminTitle, body: adminBody, url: "/live-monitor" });
          dedupeByEndpoint(adminSubs).forEach((sub) => {
            webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              adminPayload,
              URGENT_PUSH,
            ).then(() => {
              storage.createNotificationLog({ organizationId: orgId, userId: sub.userId, title: adminTitle, body: adminBody, url: "/live-monitor", incidentId: id }).catch(() => {});
            }).catch((err: unknown) => {
              const code = typeof err === "object" && err !== null && "statusCode" in err
                ? (err as { statusCode: number }).statusCode : 0;
              if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
            });
          });
        }).catch(() => {});
      }
    }
  });

  // Save destination for a live incident — reporter sends when opening navigation
  app.patch("/api/incidents/:id/destination", async (req, res) => {
    const { organizationId: orgId, id: triggerUserId } = req.currentUser!;
    const id = parseInt(req.params.id as string);
    const { destinationName, destinationLat, destinationLng } = req.body;
    if (typeof destinationLat !== "number" || typeof destinationLng !== "number") {
      return res.status(400).json({ message: "destinationLat and destinationLng must be numbers" });
    }
    if (destinationLat < -90 || destinationLat > 90 || destinationLng < -180 || destinationLng > 180) {
      return res.status(400).json({ message: "Invalid coordinates" });
    }
    const incident = await storage.getIncident(id, orgId);
    if (!incident || !incident.isLive) return res.status(404).json({ message: "Live incident not found" });
    if (!(await assertCommandAccess(req, (incident as any).commandId))) {
      return res.status(404).json({ message: "Live incident not found" });
    }
    const resolvedName = typeof destinationName === "string" ? destinationName.trim() || null : null;
    const updated = await storage.updateIncident(id, {
      destinationName: resolvedName,
      destinationLat,
      destinationLng,
    }, orgId);
    res.json(updated);
    // Dedup: only push when destination actually changed for this incident.
    // Prevents the duplicate "Responder Navigating" buzz that fired when the
    // client PATCHed the same destination twice in quick succession.
    const sig = destSignature(resolvedName, destinationLat, destinationLng);
    if (!shouldSendNavigatingPush(id, sig)) return;
    // Push to admin/supervisor: responder is navigating
    (async () => {
      const reporterId = incident.userId ?? triggerUserId;
      const reporter = await storage.getUserById(reporterId);
      const firstName = reporter?.firstName ?? "Responder";
      const destDisplay = resolvedName ?? "an unspecified location";
      const destTitle = "🗺️ Responder Navigating";
      const destBody = `${firstName} is navigating to ${destDisplay}.`;
      const navRoles = incident.severity === "yellow" ? ["administrator"] : ["administrator", "supervisor", "reporter"];
      const subs = await storage.getPushSubscriptionsByOrg(orgId, triggerUserId, navRoles);
      const navUrl = `/live-incident?join=${id}`;
      const payload = JSON.stringify({ title: destTitle, body: destBody, url: navUrl });
      await Promise.allSettled(dedupeByEndpoint(subs).map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, URGENT_PUSH);
          storage.createNotificationLog({ organizationId: orgId, userId: sub.userId, title: destTitle, body: destBody, url: navUrl, incidentId: id }).catch(() => {});
        } catch (err: unknown) {
          const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
          if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
        }
      }));
      storage.getFcmTokensByOrg(orgId, triggerUserId, navRoles).then((fcmSubs) => {
        if (fcmSubs.length === 0) return;
        sendFcmBatch(fcmSubs.map((s) => s.token), {
          title: destTitle,
          body: destBody,
          data: { type: "incident_update", incidentId: String(id), url: navUrl },
          notificationTag: liveIncidentFcmTag(id),
        }).catch(() => {});
      }).catch(() => {});
    })().catch(() => {});
  });

  // Reporter taps "I've Arrived" — immediately set responderArrivedAt and push-notify admin/supervisor
  app.patch("/api/incidents/:id/mark-arrived", async (req, res) => {
    const { organizationId: orgId, id: userId, role } = req.currentUser!;
    const id = parseInt(req.params.id as string);
    const incident = await storage.getIncident(id, orgId);
    if (!incident || !incident.isLive) return res.status(404).json({ message: "Live incident not found" });
    if (!(await assertCommandAccess(req, (incident as any).commandId))) {
      return res.status(404).json({ message: "Live incident not found" });
    }
    if (incident.userId !== userId) return res.status(403).json({ message: "Forbidden" });
    const alreadyArrived = !!incident.responderArrivedAt;
    const updated = await storage.updateIncident(id, { responderArrivedAt: new Date() }, orgId);
    if (!alreadyArrived) {
      audit(userId, orgId, "incident.arrived", `Marked arrived at scene for incident #${id}`, { entityType: "incident", entityId: String(id) });
    }
    res.json(updated);
    if (!alreadyArrived) {
      const destName = incident.destinationName ?? incident.locationName ?? null;
      const responderName = await storage.getUserById(userId)
        .then(u => u ? `${u.firstName} ${u.lastName}`.trim() : "Responder")
        .catch(() => "Responder");
      storage.getPushSubscriptionsByOrg(orgId, userId, ["administrator", "supervisor", "control_room"]).then((adminSubs) => {
        if (adminSubs.length === 0) return;
        const marTitle = "📍 Responder At Scene";
        const marBody = `${responderName} has arrived at${destName ? ` ${destName}` : " the scene"}.`;
        const payload = JSON.stringify({ title: marTitle, body: marBody, url: "/live-monitor" });
        dedupeByEndpoint(adminSubs).forEach((sub) => {
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            URGENT_PUSH,
          ).then(() => {
            storage.createNotificationLog({ organizationId: orgId, userId: sub.userId, title: marTitle, body: marBody, url: "/live-monitor", incidentId: id }).catch(() => {});
          }).catch((err: unknown) => {
            const code = typeof err === "object" && err !== null && "statusCode" in err
              ? (err as { statusCode: number }).statusCode : 0;
            if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
          });
        });
      }).catch(() => {});
    }
  });

  // Add timestamped note to a live incident — admin/supervisor only
  app.post("/api/incidents/:id/add-note", async (req, res) => {
    const { organizationId: orgId, role, id: userId } = req.currentUser!;
    if (role === "reporter" || isAccessController(role)) return res.status(403).json({ message: "Forbidden" });
    const id = parseInt(req.params.id as string);
    const { note } = req.body;
    if (!note || typeof note !== "string" || !note.trim()) {
      return res.status(400).json({ message: "note is required" });
    }
    const incident = await storage.getIncident(id, orgId);
    if (!incident) return res.status(404).json({ message: "Incident not found" });
    if (!(await assertCommandAccess(req, (incident as any).commandId))) {
      return res.status(404).json({ message: "Incident not found" });
    }
    const timestamp = new Date().toLocaleString("en-ZA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
    const noteEntry = `[${timestamp}] ${note.trim()}`;
    const newDescription = incident.description
      ? `${incident.description}\n\n${noteEntry}`
      : noteEntry;
    const updated = await storage.updateIncident(id, { description: newDescription }, orgId);
    audit(userId, orgId, "incident.note", `Added note to incident #${id}`, { entityType: "incident", entityId: String(id) });
    res.json(updated);
  });

  app.patch("/api/incidents/:id", async (req, res) => {
    const { organizationId: orgId, role, id: userId } = req.currentUser!;
    if (role !== "administrator" && !req.currentUser!.canEditIncidents) {
      return res.status(403).json({ message: "You do not have permission to edit incidents" });
    }
    const id = parseInt(req.params.id as string);
    const parsed = insertIncidentSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    if (usesLocationAssignmentScope(role)) {
      const assigned = await storage.getUserLocationAssignments(userId, orgId);
      if (assigned.length > 0 && parsed.data.locationId != null && !assigned.includes(parsed.data.locationId)) {
        return res.status(403).json({ message: "You are not assigned to this location" });
      }
    }
    // Fetch existing incident first so we can validate against effective resulting state
    const oldIncident = await storage.getIncident(id, orgId);
    if (!oldIncident) return res.status(404).json({ message: "Incident not found" });
    // Block edits to incidents that fall outside the caller's active Command scope.
    if (!(await assertCommandAccess(req, (oldIncident as any).commandId))) {
      return res.status(404).json({ message: "Incident not found" });
    }
    if (isAccessController(role) && oldIncident.userId !== userId) {
      return res.status(403).json({ message: "You can only edit your own incidents" });
    }
    if (parsed.data.customMapId != null) {
      const cmap = await storage.getCustomMap(parsed.data.customMapId, orgId);
      if (!cmap) return res.status(400).json({ message: "Invalid custom map" });
    } else {
      // Effective customMapId after patch — either the patched value (null) or the existing value
      const effectiveMapId = "customMapId" in parsed.data ? parsed.data.customMapId : oldIncident.customMapId;
      if (effectiveMapId == null && (parsed.data.customMapX != null || parsed.data.customMapY != null)) {
        return res.status(400).json({ message: "customMapX/customMapY require a customMapId" });
      }
    }
    if (parsed.data.categoryId != null) {
      const cat = await storage.getCategory(parsed.data.categoryId, orgId);
      if (cat?.isOther) {
        const noteTrimmed = parsed.data.otherCategoryNote?.trim() ?? "";
        if (!noteTrimmed) {
          return res.status(400).json({ message: "Please specify the occurrence type for this category" });
        }
        // Auto-create a real named category so it is available for future incidents
        const newCat = await storage.createCategory({ name: noteTrimmed, color: "#6B7280", icon: "alert", isOther: false }, orgId);
        parsed.data.categoryId = newCat.id;
        parsed.data.otherCategoryNote = null;
      }
    }
    if (parsed.data.otherCategoryNote !== undefined) {
      parsed.data.otherCategoryNote = parsed.data.otherCategoryNote?.trim() || null;
    }
    // If the incident was live and this edit doesn't explicitly keep it live, record conversion
    if (oldIncident.isLive && parsed.data.isLive !== true && !oldIncident.liveEndedAt) {
      (parsed.data as Record<string, unknown>).isLive = false;
      (parsed.data as Record<string, unknown>).liveEndedAt = new Date();
      (parsed.data as Record<string, unknown>).liveClosedManually = false;
    }
    const incident = await storage.updateIncident(id, parsed.data, orgId);
    if (!incident) return res.status(404).json({ message: "Incident not found" });
    const incChanges = oldIncident ? computeChanges(oldIncident as Record<string, unknown>, parsed.data as Record<string, unknown>, []) : null;
    audit(userId, orgId, "incident.edit", `Edited incident #${id}`, { entityType: "incident", entityId: String(id), changes: incChanges ?? undefined });
    res.json(incident);
  });

  app.delete("/api/incidents/:id", async (req, res) => {
    const { organizationId: orgId, role, id: userId } = req.currentUser!;
    if (role === "reporter" || isAccessController(role)) return res.status(403).json({ message: "You cannot delete incidents" });
    if (role === "control_room") return res.status(403).json({ message: "Control room users cannot delete incidents" });
    if (role !== "administrator" && !req.currentUser!.canDeleteIncidents) {
      return res.status(403).json({ message: "You do not have permission to delete incidents" });
    }
    const id = parseInt(req.params.id as string);
    const existing = await storage.getIncident(id, orgId);
    if (existing && !(await assertCommandAccess(req, (existing as any).commandId))) {
      return res.status(404).json({ message: "Incident not found" });
    }
    audit(userId, orgId, "incident.delete", `Deleted incident${existing ? ` on ${existing.incidentDate}` : ` #${id}`}`, { entityType: "incident", entityId: String(id) });
    await storage.deleteIncident(id, orgId);
    res.json({ success: true });
  });

  // Incident Attachments
  const evidencePhaseBodySchema = z.enum(["scene", "supplementary"]).optional();

  const attachmentBodySchema = z.object({
    url: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    evidencePhase: evidencePhaseBodySchema,
    byteSize: z.number().int().nonnegative().optional(),
  });

  /** Client may request scene only while the incident is still live; otherwise supplementary. */
  function resolveAttachmentEvidencePhase(
    requested: "scene" | "supplementary" | undefined,
    inc: { isLive: boolean | null },
  ): "scene" | "supplementary" {
    if (requested === "scene") return "scene";
    if (requested === "supplementary") return "supplementary";
    if (inc.isLive) return "scene";
    return "supplementary";
  }

  async function resolveStoredAttachmentByteSize(
    url: string,
    explicit?: number,
  ): Promise<number | null> {
    const fromClientOrData = resolveAttachmentByteSize(url, explicit);
    if (fromClientOrData != null) return fromClientOrData;
    try {
      let objectPath: string | null = null;
      if (url.startsWith("/objects/")) objectPath = url.split("?")[0] ?? null;
      else {
        try {
          const u = new URL(url);
          if (u.pathname.startsWith("/objects/")) objectPath = u.pathname;
        } catch {
          /* ignore */
        }
      }
      if (!objectPath) return null;
      const file = await objectStorageService.getObjectEntityFile(objectPath);
      const [meta] = await file.getMetadata();
      const raw = meta.size;
      const n = typeof raw === "string" ? Number(raw) : Number(raw ?? NaN);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    } catch {
      return null;
    }
  }

  function resolveNoteEvidencePhase(
    requested: "scene" | "supplementary" | undefined,
    inc: { isLive: boolean | null },
  ): "scene" | "supplementary" {
    // Text notes added via the OB composer are follow-up commentary — default supplementary.
    if (requested === "scene" && inc.isLive) return "scene";
    return "supplementary";
  }

  async function verifyIncidentAccess(req: Request, res: Response, incidentId: number): Promise<Incident | null> {
    const { organizationId: orgId, role, id: userId } = req.currentUser!;
    const inc = await storage.getIncident(incidentId, orgId);
    if (!inc) { res.status(404).json({ message: "Incident not found" }); return null; }
    // Command-scope authorisation (read — includes grants). Mutating
    // attachment routes additionally assert WRITE access below.
    if (!(await assertReadCommandAccess(req, (inc as any).commandId))) {
      res.status(404).json({ message: "Incident not found" });
      return null;
    }
    if (usesLocationAssignmentScope(role)) {
      const assigned = await storage.getUserLocationAssignments(userId, orgId);
      if (assigned.length > 0 && inc.locationId !== null && !assigned.includes(inc.locationId)) {
        res.status(404).json({ message: "Incident not found" });
        return null;
      }
    }
    if (isAccessController(role) && inc.userId !== userId) {
      res.status(404).json({ message: "Incident not found" });
      return null;
    }
    return inc;
  }

  app.get("/api/incidents/:id/attachments", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const incidentId = parseInt(req.params.id as string);
    const inc = await verifyIncidentAccess(req, res, incidentId);
    if (!inc) return;
    const attachments = await storage.getAttachmentsByIncident(incidentId, orgId);
    res.json(attachments);
  });

  app.post("/api/incidents/:id/attachments", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const { role, id: userId } = req.currentUser!;
    if (!["administrator", "supervisor", "control_room", "reporter", "access_controller", "patrol_user"].includes(role)) {
      return res.status(403).json({ message: "You do not have permission to add evidence" });
    }
    const incidentId = parseInt(req.params.id as string);
    const inc = await verifyIncidentAccess(req, res, incidentId);
    if (!inc) return;
    // Mutation: granted (read-only) visibility must not allow attaching files.
    if (!(await assertWriteCommandAccess(req, (inc as any).commandId))) {
      return res.status(403).json({ message: "Cross-Command visibility is read-only" });
    }
    const parsed = attachmentBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "url, filename, and mimeType are required" });
    const evidencePhase = resolveAttachmentEvidencePhase(parsed.data.evidencePhase, inc);
    const byteSize = await resolveStoredAttachmentByteSize(parsed.data.url, parsed.data.byteSize);
    const attachment = await storage.createAttachment({
      incidentId,
      organizationId: orgId,
      uploadedByUserId: userId,
      url: parsed.data.url,
      filename: parsed.data.filename,
      mimeType: parsed.data.mimeType,
      evidencePhase,
      byteSize,
    });
    res.json(attachment);
  });

  app.delete("/api/attachments/:id", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    if (req.currentUser!.role !== "administrator") {
      return res.status(403).json({ message: "Only administrators can delete attachments" });
    }
    const id = parseInt(req.params.id as string);
    const att = await storage.getAttachment(id, orgId);
    if (!att) return res.status(404).json({ message: "Attachment not found" });
    const inc = await verifyIncidentAccess(req, res, att.incidentId);
    if (!inc) return;
    await storage.deleteAttachment(id, orgId);
    res.json({ success: true });
  });

  const evidenceNoteBodySchema = z.object({
    body: z.string().trim().min(1).max(2000),
    evidencePhase: evidencePhaseBodySchema,
  });

  app.get("/api/incidents/:id/evidence-notes", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const incidentId = parseInt(req.params.id as string);
    const inc = await verifyIncidentAccess(req, res, incidentId);
    if (!inc) return;
    const notes = await storage.getEvidenceNotesByIncident(incidentId, orgId);
    res.json(notes);
  });

  app.post("/api/incidents/:id/evidence-notes", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const { role, id: userId } = req.currentUser!;
    if (!["administrator", "supervisor", "control_room", "reporter", "access_controller", "patrol_user"].includes(role)) {
      return res.status(403).json({ message: "You do not have permission to add evidence" });
    }
    const incidentId = parseInt(req.params.id as string);
    const inc = await verifyIncidentAccess(req, res, incidentId);
    if (!inc) return;
    if (!(await assertWriteCommandAccess(req, (inc as any).commandId))) {
      return res.status(403).json({ message: "Cross-Command visibility is read-only" });
    }
    const parsed = evidenceNoteBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "A note between 1 and 2000 characters is required" });
    const evidencePhase = resolveNoteEvidencePhase(parsed.data.evidencePhase, inc);
    const note = await storage.createEvidenceNote({
      incidentId,
      organizationId: orgId,
      authorUserId: userId,
      body: parsed.data.body,
      evidencePhase,
    });
    res.json(note);
  });

  app.delete("/api/evidence-notes/:id", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    if (req.currentUser!.role !== "administrator") {
      return res.status(403).json({ message: "Only administrators can delete evidence notes" });
    }
    const id = parseInt(req.params.id as string);
    const note = await storage.getEvidenceNote(id, orgId);
    if (!note) return res.status(404).json({ message: "Note not found" });
    const inc = await verifyIncidentAccess(req, res, note.incidentId);
    if (!inc) return;
    await storage.deleteEvidenceNote(id, orgId);
    res.json({ success: true });
  });

  // Dashboard summary
  app.get("/api/dashboard", async (req, res) => {
    const { organizationId: orgId, role, id: userId } = req.currentUser!;
    if (!USER_ROLES.includes(role as (typeof USER_ROLES)[number])) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const period = req.query.period === "week" ? "week" : "day";
    let restrictToLocationIds: number[] | undefined;
    let restrictToUserId: string | undefined;
    if (isOwnIncidentScopedRole(role)) {
      restrictToUserId = userId;
      const assigned = await storage.getUserLocationAssignments(userId, orgId);
      if (assigned.length > 0) restrictToLocationIds = assigned;
    } else if (role === "supervisor" || role === "control_room") {
      const assigned = await storage.getUserLocationAssignments(userId, orgId);
      if (assigned.length > 0) restrictToLocationIds = assigned;
    }
    const { commandFilter } = await getCommandScope(req);
    const summary = await storage.getDashboardSummary(orgId, period, restrictToLocationIds, commandFilter, restrictToUserId);
    res.json(summary);
  });

  app.get("/api/trackers", async (req, res) => {
    const { organizationId: orgId, role } = req.currentUser!;
    if (role !== "administrator" && !isDispatchStaff(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const { commandFilter } = await getCommandScope(req);
    const devices = await storage.getTrackerDevices(orgId, commandFilter);
    res.json(devices);
  });

  app.get("/api/trackers/assignees", async (req, res) => {
    const { organizationId: orgId, role } = req.currentUser!;
    if (role !== "administrator" && !isDispatchStaff(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const users = await storage.getUsersByOrg(orgId);
    res.json(
      users
        .filter((u) => u.isActive)
        .map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, role: u.role })),
    );
  });

  app.get("/api/trackers/:id", async (req, res) => {
    const { organizationId: orgId, role } = req.currentUser!;
    if (role !== "administrator" && !isDispatchStaff(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const device = await storage.getTrackerDeviceById(id, orgId);
    if (!device) return res.status(404).json({ message: "Not found" });
    const { commandFilter } = await getCommandScope(req);
    if (commandFilter && device.commandId != null && !commandFilter.includes(device.commandId)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    res.json(device);
  });

  app.patch("/api/trackers/:id", async (req, res) => {
    const { organizationId: orgId, role } = req.currentUser!;
    if (role !== "administrator" && !isDispatchStaff(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const existing = await storage.getTrackerDeviceById(id, orgId);
    if (!existing) return res.status(404).json({ message: "Not found" });
    const { commandFilter, writeAccessCommandIds } = await getCommandScope(req);
    if (commandFilter && existing.commandId != null && !commandFilter.includes(existing.commandId)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const body = req.body as Record<string, unknown>;
    const patch: Parameters<typeof storage.updateTrackerDevice>[2] = {};
    if ("label" in body) patch.label = typeof body.label === "string" ? body.label.trim() || null : null;
    if ("vehicleMake" in body) patch.vehicleMake = typeof body.vehicleMake === "string" ? body.vehicleMake.trim() || null : null;
    if ("vehicleModel" in body) patch.vehicleModel = typeof body.vehicleModel === "string" ? body.vehicleModel.trim() || null : null;
    if ("vehicleRegistration" in body) {
      patch.vehicleRegistration = typeof body.vehicleRegistration === "string" ? body.vehicleRegistration.trim() || null : null;
    }
    if ("vehiclePhotoUrl" in body) {
      if (body.vehiclePhotoUrl === null) {
        patch.vehiclePhotoUrl = null;
      } else if (typeof body.vehiclePhotoUrl === "string") {
        const url = body.vehiclePhotoUrl.trim();
        if (url.length > 2000) {
          return res.status(400).json({ message: "Photo URL too long" });
        }
        patch.vehiclePhotoUrl = url || null;
      } else {
        patch.vehiclePhotoUrl = null;
      }
    }
    if ("assignedUserId" in body) {
      patch.assignedUserId = typeof body.assignedUserId === "string" ? body.assignedUserId || null : null;
    }
    if ("notes" in body) patch.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
    if ("lastMileageKm" in body) {
      if (body.lastMileageKm === null || body.lastMileageKm === "") {
        patch.lastMileageKm = null;
      } else {
        const km = typeof body.lastMileageKm === "number" ? body.lastMileageKm : Number(body.lastMileageKm);
        if (!Number.isFinite(km) || km < 0 || km > 10_000_000) {
          return res.status(400).json({ message: "Odometer must be a number from 0 to 10 000 000 km" });
        }
        patch.lastMileageKm = Math.round(km * 10) / 10;
      }
    }
    if ("commandId" in body) {
      const cmdId = body.commandId === null ? null : Number(body.commandId);
      if (cmdId !== null && !Number.isFinite(cmdId)) {
        return res.status(400).json({ message: "Invalid commandId" });
      }
      if (cmdId !== null && writeAccessCommandIds && !writeAccessCommandIds.includes(cmdId)) {
        return res.status(403).json({ message: "Cannot assign to that group" });
      }
      patch.commandId = cmdId;
    }

    const updated = await storage.updateTrackerDevice(id, orgId, patch);
    res.json(updated);
  });

  app.get("/api/trackers/:id/positions", async (req, res) => {
    const { organizationId: orgId, role } = req.currentUser!;
    if (role !== "administrator" && !isDispatchStaff(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const device = await storage.getTrackerDeviceById(id, orgId);
    if (!device) return res.status(404).json({ message: "Not found" });
    const { commandFilter } = await getCommandScope(req);
    if (commandFilter && device.commandId != null && !commandFilter.includes(device.commandId)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const hours = parseInt(String(req.query.hours ?? "24"), 10);
    const limit = parseInt(String(req.query.limit ?? "200"), 10);
    const since =
      Number.isFinite(hours) && hours > 0
        ? new Date(Date.now() - hours * 60 * 60 * 1000)
        : undefined;

    const positions = await storage.getTrackerPositionHistory(id, orgId, {
      limit: Number.isFinite(limit) ? limit : 200,
      since,
    });

    const maxSpeedKph = positions.reduce((max, p) => Math.max(max, p.speedKph ?? 0), 0);
    res.json({
      deviceId: id,
      hours: Number.isFinite(hours) ? hours : null,
      count: positions.length,
      maxSpeedKph: maxSpeedKph > 0 ? maxSpeedKph : null,
      positions,
    });
  });

  // Stats
  app.get("/api/stats", async (req, res) => {
    const { organizationId: orgId, role, id: userId } = req.currentUser!;
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const { commandFilter } = await getCommandScope(req);
    let restrictToLocationIds: number[] | undefined;
    if (role === "supervisor" || role === "control_room" || role === "reporter" || role === "access_controller") {
      const assigned = await storage.getUserLocationAssignments(userId, orgId);
      if (assigned.length > 0) restrictToLocationIds = assigned;
    }
    const stats = await storage.getIncidentStats(orgId, startDate, endDate, restrictToLocationIds, commandFilter);
    res.json(stats);
  });

  // Form Fields
  app.get("/api/form-fields", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const { commandFilter } = await getCommandScope(req);
    const fields = await storage.getFormFields(orgId, commandFilter);
    res.json(fields);
  });

  app.post("/api/form-fields", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const parsed = insertFormFieldSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const { defaultStampCommandId, writeAccessCommandIds } = await getCommandScope(req);
    if (defaultStampCommandId == null || writeAccessCommandIds.length === 0) {
      return res.status(403).json({ message: "No writeable Command in current scope" });
    }
    const { commandId: _ignored, ...safe } = parsed.data as any;
    const field = await storage.createFormField(
      { ...safe, commandId: defaultStampCommandId },
      orgId,
    );
    res.json(field);
  });

  app.patch("/api/form-fields/:id", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const id = parseInt(req.params.id as string);
    const existing = await storage.getFormField(id, orgId);
    if (!existing) return res.status(404).json({ message: "Form field not found" });
    if (!(await assertWriteCommandAccess(req, (existing as any).commandId))) {
      return res.status(403).json({ message: "Out-of-scope Command" });
    }
    const parsed = insertFormFieldSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const { commandId: _ignored, ...safe } = parsed.data as any;
    const field = await storage.updateFormField(id, safe, orgId);
    if (!field) return res.status(404).json({ message: "Form field not found" });
    res.json(field);
  });

  app.delete("/api/form-fields/:id", async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const id = parseInt(req.params.id as string);
    const field = await storage.getFormField(id, orgId);
    if (!field) return res.status(404).json({ message: "Form field not found" });
    if (!(await assertWriteCommandAccess(req, (field as any).commandId))) {
      return res.status(403).json({ message: "Out-of-scope Command" });
    }
    if (["incidentDate", "incidentTime", "location", "categoryId"].includes(field.fieldKey)) {
      return res.status(400).json({ message: "This field is fixed and cannot be deleted" });
    }
    await storage.deleteFormField(id, orgId);
    res.json({ success: true });
  });

  // --- Archon routes ---

  function requireArchon(req: Request, res: Response, next: NextFunction) {
    if (!req.session.archonAuthed) return res.status(401).json({ message: "Archon authentication required" });
    next();
  }

  app.post("/api/archon/login", async (req, res) => {
    const { password } = req.body;
    if (!password || typeof password !== "string") return res.status(400).json({ message: "Password required" });
    const archonPassword = process.env.ARCHON_PASSWORD;
    if (!archonPassword) return res.status(503).json({ message: "Archon not configured" });
    const match = password === archonPassword;
    if (!match) return res.status(401).json({ message: "Invalid Archon password" });
    req.session.archonAuthed = true;
    res.json({ success: true });
  });

  app.get("/api/archon/me", (req, res) => {
    res.json({ authed: !!req.session.archonAuthed });
  });

  app.post("/api/archon/logout", (req, res) => {
    req.session.archonAuthed = false;
    res.json({ success: true });
  });

  app.get("/api/archon/contact-submissions", requireArchon, async (_req, res) => {
    const { contactSubmissions } = await import("@shared/schema");
    const rows = await db.select().from(contactSubmissions).orderBy(sql`created_at DESC`).limit(500);
    res.json(rows);
  });

  app.get("/api/archon/users", requireArchon, async (_req, res) => {
    const rows = await storage.getAllUsersWithOrgs();
    const safe = rows.map(({ password: _pw, ...rest }) => rest);
    res.json(safe);
  });

  app.patch("/api/archon/users/:id/status", requireArchon, async (req, res) => {
    const { id } = req.params as { id: string };
    const { isActive } = req.body;
    if (typeof isActive !== "boolean") return res.status(400).json({ message: "isActive must be a boolean" });
    const updated = await storage.updateUser(id, { isActive });
    if (!updated) return res.status(404).json({ message: "User not found" });
    const { password: _pw, ...safe } = updated;
    res.json(safe);
  });

  app.patch("/api/archon/users/:id/password", requireArchon, async (req, res) => {
    const { id } = req.params as { id: string };
    const { password } = req.body;
    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }
    if (await isPasswordInUse(password, id)) {
      return res.status(400).json({ message: PASSWORD_IN_USE_MSG });
    }
    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    const updated = await storage.updateUser(id, { password: hashed });
    if (!updated) return res.status(404).json({ message: "User not found" });
    res.json({ success: true });
  });

  app.delete("/api/archon/users/:id", requireArchon, async (req, res) => {
    const { id } = req.params as { id: string };
    const user = await storage.getUserById(id);
    if (!user) return res.status(404).json({ message: "User not found" });
    await storage.deleteUser(id, user.organizationId);
    res.json({ success: true });
  });

  app.post("/api/archon/users/:id/resend-invite", requireArchon, async (req, res) => {
    const { id } = req.params as { id: string };
    const user = await storage.getUserById(id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.isActive) return res.status(400).json({ message: "Cannot send invite to an inactive user" });
    if (!user.mustChangePassword) {
      return res.status(400).json({ message: "This user has already activated their account" });
    }

    const org = await storage.getOrganization(user.organizationId);
    if (!org) return res.status(404).json({ message: "Organisation not found" });

    const { token, expiresAt } = createInviteToken();
    const updated = await storage.updateUser(id, { inviteToken: token, inviteTokenExpiresAt: expiresAt });
    if (!updated) return res.status(500).json({ message: "Failed to update invite" });

    const welcomeEmailSent = await sendArchonWelcomeEmail({
      org,
      adminFirstName: user.firstName,
      adminEmail: user.email,
      inviteToken: token,
    });

    const inviteUrl = appInviteUrl(token);
    res.json({
      inviteUrl,
      inviteToken: token,
      inviteTokenExpiresAt: expiresAt,
      welcomeEmailSent: welcomeEmailSent.sent,
      welcomeEmailReason: welcomeEmailSent.reason ?? null,
    });
  });

  app.patch("/api/archon/orgs/:orgId/complimentary", requireArchon, async (req, res) => {
    const { orgId } = req.params as { orgId: string };
    const { isComplimentary } = req.body;
    if (typeof isComplimentary !== "boolean") return res.status(400).json({ message: "isComplimentary must be a boolean" });
    const org = await storage.updateOrganizationComplimentary(orgId, isComplimentary);
    res.json(org);
  });

  // GET /api/archon/orgs — list all orgs with usage summary
  app.get("/api/archon/orgs", requireArchon, async (_req, res) => {
    try {
      const orgs = await storage.getOrgsWithUsage();
      res.json(orgs);
    } catch (err) {
      console.error("getOrgsWithUsage error:", err);
      res.status(500).json({ message: "Failed to load organisations" });
    }
  });

  // POST /api/archon/orgs — create a new org + first administrator
  app.post("/api/archon/orgs", requireArchon, async (req, res) => {
    const {
      orgName, orgAddress, orgPhone,
      addressStreet, addressSuburb, addressCity, addressProvince, addressPostalCode,
      companyRegistrationNumber, vatNumber,
      adminFirstName, adminLastName, adminEmail, adminPhone,
      contractRef, contractStartDate, contractRenewalDate,
      rateAdmin, rateSupervisor, rateReporter, rateAccessController, rateControlRoom, ratePatrolUser,
      storageLimitGb, billingNotes,
      sendWelcomeEmail,
    } = req.body;

    if (!orgName || typeof orgName !== "string") return res.status(400).json({ message: "Organisation name is required" });
    if (!adminFirstName || !adminLastName) return res.status(400).json({ message: "Administrator first and last name are required" });
    if (!adminEmail || typeof adminEmail !== "string") return res.status(400).json({ message: "Administrator email is required" });

    const existing = await storage.getUserByEmail(adminEmail.toLowerCase().trim());
    if (existing) return res.status(400).json({ message: "An account with this email already exists" });

    const { token: inviteToken, expiresAt: inviteTokenExpiresAt } = createInviteToken();
    const hashedPassword = await hashPlaceholderPassword();

    const street = typeof addressStreet === "string" ? addressStreet.trim() : "";
    const suburb = typeof addressSuburb === "string" ? addressSuburb.trim() : "";
    const city = typeof addressCity === "string" ? addressCity.trim() : "";
    const province = typeof addressProvince === "string" ? addressProvince.trim() : "";
    const postalCode = typeof addressPostalCode === "string" ? addressPostalCode.trim() : "";
    const combinedAddress =
      formatOrgAddress({ street, suburb, city, province, postalCode }) ||
      (typeof orgAddress === "string" ? orgAddress.trim() : "") ||
      "";

    const contactFirst = adminFirstName.trim();
    const contactLast = adminLastName.trim();
    const contactEmail = adminEmail.toLowerCase().trim();
    const contactPhone = typeof adminPhone === "string" ? adminPhone.trim() : "";

    const org = await storage.createOrganization({
      name: orgName.trim(),
      address: combinedAddress,
      addressStreet: street || null,
      addressSuburb: suburb || null,
      addressCity: city || null,
      addressProvince: province || null,
      addressPostalCode: postalCode || null,
      phone: orgPhone?.trim() || contactPhone || "",
      subscriptionStatus: "active",
      isComplimentary: false,
      companyRegistrationNumber: companyRegistrationNumber?.trim() || null,
      vatNumber: vatNumber?.trim() || null,
      // Same person is billing contact and technical admin
      primaryContactFirstName: contactFirst,
      primaryContactLastName: contactLast,
      primaryContactEmail: contactEmail,
      primaryContactPhone: contactPhone || null,
      contractRef: contractRef?.trim() || null,
      contractStartDate: contractStartDate || null,
      contractRenewalDate: contractRenewalDate || null,
      rateAdmin: rateAdmin != null ? Math.round(Number(rateAdmin) * 100) : null,
      rateSupervisor: rateSupervisor != null ? Math.round(Number(rateSupervisor) * 100) : null,
      rateReporter: rateReporter != null ? Math.round(Number(rateReporter) * 100) : null,
      rateAccessController: rateAccessController != null ? Math.round(Number(rateAccessController) * 100) : null,
      rateControlRoom: rateControlRoom != null ? Math.round(Number(rateControlRoom) * 100) : null,
      ratePatrolUser: ratePatrolUser != null ? Math.round(Number(ratePatrolUser) * 100) : null,
      storageLimitGb: storageLimitGb != null ? Number(storageLimitGb) : null,
      billingNotes: billingNotes?.trim() || null,
    } as any);

    const user = await storage.createUser({
      organizationId: org.id,
      firstName: contactFirst,
      lastName: contactLast,
      email: contactEmail,
      contactNumber: contactPhone || null,
      password: hashedPassword,
      role: "administrator",
      mustChangePassword: true,
      inviteToken,
      inviteTokenExpiresAt,
    });

    await seedFormFieldsForOrg(org.id);

    const central = await storage.createCommand({ name: CENTRAL_COMMAND_NAME, isCentral: true } as any, org.id);
    await storage.assignUserToCommand(central.id, user.id, org.id);

    const groups = Array.isArray(req.body.groups) ? req.body.groups : [];
    for (const rawName of groups) {
      const name = typeof rawName === "string" ? rawName.trim() : "";
      if (name && name !== CENTRAL_COMMAND_NAME) {
        await storage.createCommand({ name, isCentral: false } as any, org.id);
      }
    }

    let welcomeEmailSent = false;
    let welcomeEmailReason: string | null = null;
    if (sendWelcomeEmail === true) {
      const emailResult = await sendArchonWelcomeEmail({
        org,
        adminFirstName: contactFirst,
        adminEmail: contactEmail,
        inviteToken,
      });
      welcomeEmailSent = emailResult.sent;
      welcomeEmailReason = emailResult.reason ?? null;
    }

    const inviteUrl = appInviteUrl(inviteToken);
    const { password: _pw, ...safeUser } = user;
    res.json({ org, user: safeUser, welcomeEmailSent, welcomeEmailReason, inviteUrl, inviteToken });
  });

  // POST /api/archon/orgs/:orgId/users — add a user (any role) to an existing org
  app.post("/api/archon/orgs/:orgId/users", requireArchon, async (req, res) => {
    const { orgId } = req.params as { orgId: string };
    const { firstName, lastName, email, password, role } = req.body;

    if (!firstName || !lastName) return res.status(400).json({ message: "First and last name required" });
    if (!email || typeof email !== "string") return res.status(400).json({ message: "Email required" });
    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }
    const validRoles = [...USER_ROLES];
    const userRole = role ?? "administrator";
    if (!validRoles.includes(userRole)) return res.status(400).json({ message: "Invalid role" });

    const org = await storage.getOrganization(orgId);
    if (!org) return res.status(404).json({ message: "Organisation not found" });

    if (userRole === "administrator") {
      const orgUsers = await storage.getUsersByOrg(orgId);
      if (orgUsers.some((u) => u.role === "administrator" && u.isActive)) {
        return res.status(400).json({ message: "This organisation already has an administrator. Only one admin is allowed." });
      }
    }

    const existing = await storage.getUserByEmail(email.toLowerCase().trim());
    if (existing) return res.status(400).json({ message: "An account with this email already exists" });

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await storage.createUser({
      organizationId: orgId,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: userRole,
    });

    const { password: _pw, ...safeUser } = user;
    res.json(safeUser);
  });

  // PATCH /api/archon/orgs/:orgId — update org details and/or contract config
  app.patch("/api/archon/orgs/:orgId", requireArchon, async (req, res) => {
    const { orgId } = req.params as { orgId: string };
    const {
      name, address, phone, subscriptionStatus,
      addressStreet, addressSuburb, addressCity, addressProvince, addressPostalCode,
      companyRegistrationNumber, vatNumber,
      primaryContactFirstName, primaryContactLastName, primaryContactEmail, primaryContactPhone,
      contractRef, contractStartDate, contractRenewalDate,
      rateAdmin, rateSupervisor, rateReporter, rateAccessController, rateControlRoom, ratePatrolUser,
      storageLimitGb, billingNotes,
    } = req.body;

    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name.trim();
    if (phone !== undefined) patch.phone = phone.trim();
    if (addressStreet !== undefined || addressSuburb !== undefined || addressCity !== undefined || addressProvince !== undefined || addressPostalCode !== undefined) {
      const street = addressStreet !== undefined ? (addressStreet?.trim() || "") : undefined;
      const suburb = addressSuburb !== undefined ? (addressSuburb?.trim() || "") : undefined;
      const city = addressCity !== undefined ? (addressCity?.trim() || "") : undefined;
      const province = addressProvince !== undefined ? (addressProvince?.trim() || "") : undefined;
      const postalCode = addressPostalCode !== undefined ? (addressPostalCode?.trim() || "") : undefined;
      if (street !== undefined) patch.addressStreet = street || null;
      if (suburb !== undefined) patch.addressSuburb = suburb || null;
      if (city !== undefined) patch.addressCity = city || null;
      if (province !== undefined) patch.addressProvince = province || null;
      if (postalCode !== undefined) patch.addressPostalCode = postalCode || null;
      // Rebuild combined address when any part is provided (fetch existing for missing parts)
      const existing = await storage.getOrganization(orgId);
      const combined = formatOrgAddress({
        street: street ?? existing?.addressStreet,
        suburb: suburb ?? existing?.addressSuburb,
        city: city ?? existing?.addressCity,
        province: province ?? existing?.addressProvince,
        postalCode: postalCode ?? existing?.addressPostalCode,
      });
      if (combined) patch.address = combined;
    } else if (address !== undefined) {
      patch.address = address.trim();
    }
    if (companyRegistrationNumber !== undefined) patch.companyRegistrationNumber = companyRegistrationNumber?.trim() || null;
    if (vatNumber !== undefined) patch.vatNumber = vatNumber?.trim() || null;
    if (primaryContactFirstName !== undefined) patch.primaryContactFirstName = primaryContactFirstName?.trim() || null;
    if (primaryContactLastName !== undefined) patch.primaryContactLastName = primaryContactLastName?.trim() || null;
    if (primaryContactEmail !== undefined) patch.primaryContactEmail = primaryContactEmail?.trim().toLowerCase() || null;
    if (primaryContactPhone !== undefined) patch.primaryContactPhone = primaryContactPhone?.trim() || null;
    if (subscriptionStatus !== undefined) {
      if (!["active", "expired"].includes(subscriptionStatus)) {
        return res.status(400).json({ message: "subscriptionStatus must be 'active' or 'expired'" });
      }
      patch.subscriptionStatus = subscriptionStatus;
    }
    if (contractRef !== undefined) patch.contractRef = contractRef?.trim() || null;
    if (contractStartDate !== undefined) patch.contractStartDate = contractStartDate || null;
    if (contractRenewalDate !== undefined) patch.contractRenewalDate = contractRenewalDate || null;
    if (rateAdmin !== undefined) patch.rateAdmin = rateAdmin != null ? Math.round(Number(rateAdmin) * 100) : null;
    if (rateSupervisor !== undefined) patch.rateSupervisor = rateSupervisor != null ? Math.round(Number(rateSupervisor) * 100) : null;
    if (rateReporter !== undefined) patch.rateReporter = rateReporter != null ? Math.round(Number(rateReporter) * 100) : null;
    if (rateAccessController !== undefined) patch.rateAccessController = rateAccessController != null ? Math.round(Number(rateAccessController) * 100) : null;
    if (rateControlRoom !== undefined) patch.rateControlRoom = rateControlRoom != null ? Math.round(Number(rateControlRoom) * 100) : null;
    if (ratePatrolUser !== undefined) patch.ratePatrolUser = ratePatrolUser != null ? Math.round(Number(ratePatrolUser) * 100) : null;
    if (storageLimitGb !== undefined) patch.storageLimitGb = storageLimitGb != null ? Number(storageLimitGb) : null;
    if (billingNotes !== undefined) patch.billingNotes = billingNotes?.trim() || null;

    if (Object.keys(patch).length === 0) return res.status(400).json({ message: "No fields to update" });

    const updated = await storage.updateOrganization(orgId, patch as any);
    res.json(updated);
  });

  // DELETE /api/archon/orgs/:orgId — permanently delete org and all its data
  app.delete("/api/archon/orgs/:orgId", requireArchon, async (req, res) => {
    const { orgId } = req.params as { orgId: string };
    const org = await storage.getOrganization(orgId);
    if (!org) return res.status(404).json({ message: "Organisation not found" });
    await storage.deleteOrganization(orgId);
    res.json({ ok: true });
  });

  // GET /api/archon/summary — aggregated metrics across all orgs
  app.get("/api/archon/summary", requireArchon, async (_req, res) => {
    try {
      const summary = await storage.getArchonSummary();
      res.json(summary);
    } catch (err) {
      console.error("getArchonSummary error:", err);
      res.status(500).json({ message: "Failed to load summary" });
    }
  });

  // GET /api/archon/orgs/:orgId/usage — detailed usage for one org
  app.get("/api/archon/orgs/:orgId/usage", requireArchon, async (req, res) => {
    const { orgId } = req.params as { orgId: string };
    try {
      const org = await storage.getOrganization(orgId);
      if (!org) return res.status(404).json({ message: "Organisation not found" });
      const usage = await storage.getOrgUsage(orgId);
      res.json(usage);
    } catch (err) {
      console.error("getOrgUsage error:", err);
      res.status(500).json({ message: "Failed to load usage" });
    }
  });

  // GET /api/archon/orgs/:orgId/invoice?month=YYYY-MM — Excel invoice download
  app.get("/api/archon/orgs/:orgId/invoice", requireArchon, async (req, res) => {
    const { orgId } = req.params as { orgId: string };
    const { month } = req.query as { month?: string };

    const org = await storage.getOrganization(orgId);
    if (!org) return res.status(404).json({ message: "Organisation not found" });

    const now = new Date();
    let year = now.getFullYear();
    let mon = now.getMonth() + 1;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      [year, mon] = month.split("-").map(Number);
    }
    const monthLabel = new Date(year, mon - 1, 1).toLocaleDateString("en-ZA", { month: "long", year: "numeric" });

    const usage = await storage.getOrgUsage(orgId);
    const rateAdmin = (org.rateAdmin ?? 0) / 100;
    const rateSupervisor = (org.rateSupervisor ?? 0) / 100;
    const rateReporter = (org.rateReporter ?? 0) / 100;
    const rateControlRoom = ((org.rateControlRoom ?? org.rateSupervisor) ?? 0) / 100;
    const ratePatrolUser = ((org.ratePatrolUser ?? org.rateReporter) ?? 0) / 100;
    const rateAccessController = (org.rateAccessController ?? 0) / 100;

    const adminAmt = usage.userCounts.administrator * rateAdmin;
    const supervisorAmt = usage.userCounts.supervisor * rateSupervisor;
    const controlRoomAmt = usage.userCounts.control_room * rateControlRoom;
    const reporterAmt = usage.userCounts.reporter * rateReporter;
    const patrolUserAmt = usage.userCounts.patrol_user * ratePatrolUser;
    const accessControllerAmt = usage.userCounts.access_controller * rateAccessController;
    const total = adminAmt + supervisorAmt + controlRoomAmt + reporterAmt + patrolUserAmt + accessControllerAmt;

    const rows: (string | number)[][] = [
      [org.name + (org.contractRef ? `  —  ${org.contractRef}` : ""), "", "", ""],
      [`Invoice for ${monthLabel}`, "", "", ""],
      [`Generated: ${now.toLocaleDateString("en-ZA")}`, "", "", ""],
      ["", "", "", ""],
      ["Line item", "Qty", "Unit rate (R)", "Amount (R)"],
      [`Administrator licences — ${monthLabel}`, usage.userCounts.administrator, Number(rateAdmin.toFixed(2)), Number(adminAmt.toFixed(2))],
      [`Supervisor licences — ${monthLabel}`, usage.userCounts.supervisor, Number(rateSupervisor.toFixed(2)), Number(supervisorAmt.toFixed(2))],
      [`Control room licences — ${monthLabel}`, usage.userCounts.control_room, Number(rateControlRoom.toFixed(2)), Number(controlRoomAmt.toFixed(2))],
      [`Reporter licences — ${monthLabel}`, usage.userCounts.reporter, Number(rateReporter.toFixed(2)), Number(reporterAmt.toFixed(2))],
      [`Patrol user licences — ${monthLabel}`, usage.userCounts.patrol_user, Number(ratePatrolUser.toFixed(2)), Number(patrolUserAmt.toFixed(2))],
      [`Access controller licences — ${monthLabel}`, usage.userCounts.access_controller, Number(rateAccessController.toFixed(2)), Number(accessControllerAmt.toFixed(2))],
      ["", "", "", ""],
      ["Total", "", "", Number(total.toFixed(2))],
      ["", "", "", ""],
      ["Invoice generated by OMT Pulse Archon", "", "", ""],
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 52 }, { wch: 8 }, { wch: 16 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Invoice");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const safeName = org.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const filename = `invoice-${safeName}-${year}-${String(mon).padStart(2, "0")}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(buffer);
  });

  // ─── TEMPORARY one-shot prod restore — DISABLED after use ───────────────
  app.post("/api/archon/restore-prod", requireArchon, async (_req, res) => {
    return res.status(410).json({ message: "Restore already completed — endpoint disabled" });
    try {
      const fs = await import("fs");
      const path = await import("path");
      const dataPath = path.join(process.cwd(), "server", "restore-data.json");
      if (!fs.existsSync(dataPath)) {
        return res.status(404).json({ message: "restore-data.json not found — already cleaned up" });
      }
      const { users: uRows, incidents: iRows, auditLogs: aRows, importBatches: bRows } =
        JSON.parse(fs.readFileSync(dataPath, "utf8"));

      // Users
      for (const u of uRows) {
        await db.execute(sql`
          INSERT INTO users (id,password,first_name,last_name,email,role,organization_id,
            contact_number,home_address,posting,is_active,can_edit_incidents,
            can_manage_attachments,can_delete_incidents,must_change_password,
            avatar_url,invite_token,invite_token_expires_at,last_seen_at)
          VALUES (${u.id},${u.password},${u.first_name},${u.last_name},${u.email},
            ${u.role},${u.organization_id},${u.contact_number},${u.home_address},
            ${u.posting},${u.is_active},${u.can_edit_incidents ?? false},
            ${u.can_manage_attachments ?? false},${u.can_delete_incidents ?? false},
            ${u.must_change_password ?? false},${u.avatar_url ?? null},
            ${u.invite_token ?? null},${u.invite_token_expires_at ?? null},
            ${u.last_seen_at ?? null})
          ON CONFLICT (id) DO NOTHING
        `);
      }

      // Import batches (must come before incidents due to FK)
      for (const b of bRows) {
        await db.execute(sql`
          INSERT INTO import_batches (id,organization_id,user_id,filename,status,
            total_rows,imported_rows,failed_rows,field_mapping,error_summary,
            created_category_ids,created_location_ids,created_at,completed_at)
          VALUES (${b.id},${b.organization_id},${b.user_id ?? null},${b.filename},
            ${b.status},${b.total_rows ?? null},${b.imported_rows ?? null},
            ${b.failed_rows ?? null},
            ${b.field_mapping ? JSON.stringify(b.field_mapping) : null}::jsonb,
            ${b.error_summary ? JSON.stringify(b.error_summary) : null}::jsonb,
            ${b.created_category_ids?.length ? sql.raw(`'{${b.created_category_ids.join(",")}}'::int[]`) : null},${b.created_location_ids?.length ? sql.raw(`'{${b.created_location_ids.join(",")}}'::int[]`) : null},
            ${b.created_at},${b.completed_at ?? null})
          ON CONFLICT (id) DO NOTHING
        `);
      }
      await db.execute(sql`SELECT setval('import_batches_id_seq', (SELECT MAX(id) FROM import_batches))`);

      // Incidents (serial PK — insert explicit ids then reset sequence)
      for (const inc of iRows) {
        await db.execute(sql`
          INSERT INTO incidents (id,incident_date,incident_time,location_id,location_name,
            latitude,longitude,category_id,description,created_at,custom_fields,
            organization_id,other_category_note,custom_map_id,custom_map_x,custom_map_y,
            import_batch_id,is_live,live_started_at,responder_lat,responder_lng,user_id,
            is_escalated,responder_position_updated_at,responder_arrived_at,
            destination_name,destination_lat,destination_lng,live_start_lat,live_start_lng,
            live_ended_at,live_closed_manually,live_convert_lat,live_convert_lng,
            severity,panic_acknowledged_at,panic_acknowledged_by_user_id,panic_closed_at)
          VALUES (${inc.id},${inc.incident_date},${inc.incident_time},${inc.location_id ?? null},
            ${inc.location_name ?? null},${inc.latitude ?? null},${inc.longitude ?? null},
            ${inc.category_id ?? null},${inc.description ?? null},${inc.created_at},
            ${inc.custom_fields ? JSON.stringify(inc.custom_fields) : null}::jsonb,
            ${inc.organization_id},${inc.other_category_note ?? null},
            ${inc.custom_map_id ?? null},${inc.custom_map_x ?? null},${inc.custom_map_y ?? null},
            ${inc.import_batch_id ?? null},${inc.is_live ?? false},${inc.live_started_at ?? null},
            ${inc.responder_lat ?? null},${inc.responder_lng ?? null},${inc.user_id ?? null},
            ${inc.is_escalated ?? false},${inc.responder_position_updated_at ?? null},
            ${inc.responder_arrived_at ?? null},${inc.destination_name ?? null},
            ${inc.destination_lat ?? null},${inc.destination_lng ?? null},
            ${inc.live_start_lat ?? null},${inc.live_start_lng ?? null},
            ${inc.live_ended_at ?? null},${inc.live_closed_manually ?? false},
            ${inc.live_convert_lat ?? null},${inc.live_convert_lng ?? null},
            ${inc.severity ?? null},${inc.panic_acknowledged_at ?? null},
            ${inc.panic_acknowledged_by_user_id ?? null},${inc.panic_closed_at ?? null})
          ON CONFLICT (id) DO NOTHING
        `);
      }
      await db.execute(sql`SELECT setval('incidents_id_seq', (SELECT MAX(id) FROM incidents))`);

      // Audit logs
      for (const a of aRows) {
        await db.execute(sql`
          INSERT INTO audit_logs (id,organization_id,user_id,action,entity_type,entity_id,
            description,changes,created_at)
          VALUES (${a.id},${a.organization_id},${a.user_id ?? null},${a.action},
            ${a.entity_type ?? null},${a.entity_id ?? null},${a.description ?? null},
            ${a.changes ? JSON.stringify(a.changes) : null}::jsonb,${a.created_at})
          ON CONFLICT (id) DO NOTHING
        `);
      }
      await db.execute(sql`SELECT setval('audit_logs_id_seq', (SELECT MAX(id) FROM audit_logs))`);

      res.json({ ok: true, users: uRows.length, incidents: iRows.length, auditLogs: aRows.length, importBatches: bRows.length });
    } catch (err: any) {
      console.error("restore-prod error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Bulk import routes ───────────────────────────────────────────────────

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  });

  // In-memory cache of parsed files keyed by batch id (single-server deploy)
  const parsedFileCache = new Map<number, ParsedFile>();
  const MAX_ROWS = 25000;

  app.get("/api/imports/template", requireAdmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const fields = await storage.getFormFields(orgId);
    const buffer = buildTemplateXLSX(fields);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="omt-import-template.xlsx"`);
    res.end(buffer);
  });

  app.get("/api/imports", requireAdmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const list = await storage.listImportBatches(orgId);
    res.json(list);
  });

  app.post("/api/imports", requireAdmin, upload.single("file"), async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const userId = req.currentUser!.id;
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const filename = req.file.originalname;
    if (!filename.match(/\.(xlsx|xls|csv)$/i)) {
      return res.status(400).json({ message: "Only .xlsx, .xls and .csv files are supported" });
    }

    let parsed: ParsedFile;
    try {
      parsed = parseFile(req.file.buffer, filename);
    } catch (err: any) {
      return res.status(400).json({ message: err.message || "Failed to parse file" });
    }

    if (parsed.totalRows === 0) {
      return res.status(400).json({ message: "File contains no data rows" });
    }
    if (parsed.totalRows > MAX_ROWS) {
      return res.status(400).json({ message: `File has ${parsed.totalRows} rows. Maximum allowed is ${MAX_ROWS}.` });
    }

    const formFields = await storage.getFormFields(orgId);
    let suggested = suggestMapping(parsed.headers, formFields);

    // Mapping reuse: if any prior completed batch in this org saved a column mapping,
    // prefer its choices for any header that matches (case-insensitive). Falls back to
    // the fuzzy-match suggestion otherwise.
    try {
      const priorBatches = await storage.listImportBatches(orgId);
      const lastCompleted = priorBatches.find((b) => b.status === "completed" && b.fieldMapping);
      if (lastCompleted?.fieldMapping) {
        const priorMapping = lastCompleted.fieldMapping as { columnMap?: Record<string, { fieldKey: string | null; type: "system" | "custom" | "skip" }> };
        const priorMap = priorMapping.columnMap ?? {};
        const priorByLower = new Map(Object.entries(priorMap).map(([k, v]) => [k.toLowerCase().trim(), v]));
        const merged = { ...suggested };
        for (const h of parsed.headers) {
          const prior = priorByLower.get(h.toLowerCase().trim());
          if (prior) merged[h] = prior;
        }
        suggested = merged;
      }
    } catch {}

    const batch = await storage.createImportBatch({
      organizationId: orgId,
      userId,
      filename,
      status: "pending",
      totalRows: parsed.totalRows,
      importedRows: 0,
      failedRows: 0,
      fieldMapping: null,
      errorSummary: null,
      createdCategoryIds: null,
      createdLocationIds: null,
    });

    parsedFileCache.set(batch.id, parsed);

    audit(userId, orgId, "import.upload", `Uploaded import file "${filename}" with ${parsed.totalRows} rows`, { entityType: "import_batch", entityId: String(batch.id) });

    res.json({
      batchId: batch.id,
      filename,
      headers: parsed.headers,
      previewRows: parsed.rows.slice(0, 10),
      totalRows: parsed.totalRows,
      suggestedMapping: suggested,
    });
  });

  app.get("/api/imports/:id", requireAdmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid batch ID" });
    const batch = await storage.getImportBatch(id, orgId);
    if (!batch) return res.status(404).json({ message: "Import batch not found" });
    res.json(batch);
  });

  app.get("/api/imports/:id/errors", requireAdmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid batch ID" });
    const batch = await storage.getImportBatch(id, orgId);
    if (!batch) return res.status(404).json({ message: "Import batch not found" });

    const errors = batch.errorSummary ?? [];
    if (errors.length === 0) {
      return res.status(404).json({ message: "No errors recorded for this import" });
    }

    // Derive the original column order from the saved field mapping (preserves insertion order
    // of the parsed file's headers). Fall back to the keys of the first error row if mapping is missing.
    const mapping = (batch.fieldMapping ?? null) as { columnMap?: Record<string, unknown> } | null;
    const headers = mapping?.columnMap
      ? Object.keys(mapping.columnMap)
      : Object.keys(errors[0]?.originalRow ?? {});

    const csv = buildErrorsCSV(headers, errors);
    const safeName = (batch.filename || `import-${id}`).replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "_");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-errors.csv"`);
    res.end(csv);
  });

  const mappingSchema = z.object({
    columnMap: z.record(z.string(), z.object({
      fieldKey: z.string().nullable(),
      type: z.enum(["system", "custom", "skip"]),
    })),
    categoryResolutions: z.record(z.string(), z.object({
      action: z.enum(["link", "create", "other"]),
      categoryId: z.number().optional(),
    })),
    locationResolutions: z.record(z.string(), z.object({
      action: z.enum(["link", "create", "freetext"]),
      locationId: z.number().optional(),
    })),
    dateFormat: z.enum(["dmy", "mdy", "ymd"]).optional(),
  });

  app.post("/api/imports/:id/mapping", requireAdmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid batch ID" });
    const batch = await storage.getImportBatch(id, orgId);
    if (!batch) return res.status(404).json({ message: "Import batch not found" });
    const parsed = mappingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid mapping" });

    // Tenant-isolation: any 'link' resolution must reference an ID that belongs to this org
    const orgCategories = await storage.getCategories(orgId);
    const orgLocations = await storage.getLocations(orgId);
    const orgCategoryIds = new Set(orgCategories.map((c) => c.id));
    const orgLocationIds = new Set(orgLocations.map((l) => l.id));

    for (const [name, res2] of Object.entries(parsed.data.categoryResolutions)) {
      if (res2.action === "link") {
        if (typeof res2.categoryId !== "number" || !orgCategoryIds.has(res2.categoryId)) {
          return res.status(400).json({ message: `Invalid category link for "${name}"` });
        }
      }
    }
    for (const [name, res2] of Object.entries(parsed.data.locationResolutions)) {
      if (res2.action === "link") {
        if (typeof res2.locationId !== "number" || !orgLocationIds.has(res2.locationId)) {
          return res.status(400).json({ message: `Invalid location link for "${name}"` });
        }
      }
    }

    await storage.updateImportBatch(id, orgId, {
      fieldMapping: parsed.data as unknown as Record<string, unknown>,
      status: "mapping",
    });
    res.json({ success: true });
  });

  app.post("/api/imports/:id/preview-references", requireAdmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid batch ID" });
    const batch = await storage.getImportBatch(id, orgId);
    if (!batch) return res.status(404).json({ message: "Import batch not found" });
    const parsed = parsedFileCache.get(id);
    if (!parsed) return res.status(410).json({ message: "Import session expired. Please re-upload the file." });
    const colMapInput = req.body.columnMap as ImportMapping["columnMap"] | undefined;
    if (!colMapInput) return res.status(400).json({ message: "columnMap required" });

    const categories = await storage.getCategories(orgId);
    const locations = await storage.getLocations(orgId);
    const { categoryNames, locationNames } = collectUnknownReferences(parsed.rows, { columnMap: colMapInput }, categories, locations);
    res.json({ categoryNames, locationNames, existingCategories: categories, existingLocations: locations });
  });

  app.post("/api/imports/:id/validate", requireAdmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid batch ID" });
    const batch = await storage.getImportBatch(id, orgId);
    if (!batch) return res.status(404).json({ message: "Import batch not found" });
    const parsed = parsedFileCache.get(id);
    if (!parsed) return res.status(410).json({ message: "Import session expired. Please re-upload the file." });
    if (!batch.fieldMapping) return res.status(400).json({ message: "Mapping not saved" });

    const mapping = batch.fieldMapping as unknown as ImportMapping;
    const formFields = await storage.getFormFields(orgId);
    const categories = await storage.getCategories(orgId);
    const locations = await storage.getLocations(orgId);
    const otherCat = categories.find((c) => c.isOther);

    const resolved = resolveRows(parsed, mapping, formFields, categories, locations, otherCat?.id ?? null);
    const errorRows = resolved.filter((r) => r.errors.length > 0);
    const validRows = resolved.length - errorRows.length;
    // Persist the full error list (with original row values) so admins can download a per-row CSV
    // even after the parsed-file cache is gone (e.g. server restart, completed batches in Past Imports).
    const fullErrorSummary = errorRows.map((r) => ({
      rowNumber: r.rowNumber,
      errors: r.errors,
      originalRow: r.originalRow,
    }));
    // Keep the inline response capped at 100 rows for the wizard UI.
    const inlineErrorSummary = fullErrorSummary.slice(0, 100).map((r) => ({ rowNumber: r.rowNumber, errors: r.errors }));

    await storage.updateImportBatch(id, orgId, {
      status: "validating",
      errorSummary: fullErrorSummary,
      failedRows: errorRows.length,
    });

    res.json({
      validRows,
      errorRows: errorRows.length,
      totalRows: resolved.length,
      errors: inlineErrorSummary,
    });
  });

  app.post("/api/imports/:id/commit", requireAdmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const userId = req.currentUser!.id;
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid batch ID" });
    const batch = await storage.getImportBatch(id, orgId);
    if (!batch) return res.status(404).json({ message: "Import batch not found" });
    if (!batch.fieldMapping) return res.status(400).json({ message: "Mapping not saved" });

    const skipErrors = !!req.body?.skipErrorRows;
    const mapping = batch.fieldMapping as unknown as ImportMapping;

    // Concurrency guard: only one commit may run per batch (compare-and-swap on status).
    // Done BEFORE the parsed-cache check so concurrent commits return 409 even after the cache is evicted.
    const claimed = await storage.claimImportBatchForCommit(id, orgId);
    if (!claimed) {
      return res.status(409).json({ message: "This import is already being processed or has already completed." });
    }

    const parsed = parsedFileCache.get(id);
    if (!parsed) {
      // We claimed the batch but lost the parsed file (server restart, etc.). Roll the status back.
      await storage.updateImportBatch(id, orgId, { status: "failed", completedAt: new Date() });
      return res.status(410).json({ message: "Import session expired. Please re-upload the file." });
    }

    try {
      // Import is strictly Command-scoped: refs come from the admin's active
      // Command, and refuses to run in a read-only (granted) scope where we
      // have nowhere to stamp newly created categories/locations/incidents.
      const { defaultStampCommandId, writeAccessCommandIds, commandFilter } = await getCommandScope(req);
      if (defaultStampCommandId == null || writeAccessCommandIds.length === 0) {
        await storage.updateImportBatch(id, orgId, { status: "failed", completedAt: new Date() });
        return res.status(403).json({ message: "Cannot import in a read-only scope. Switch to one of your own Commands first." });
      }
      const scopeFilter = [defaultStampCommandId];
      const formFields = await storage.getFormFields(orgId, scopeFilter);
      let categories = await storage.getCategories(orgId, scopeFilter);
      let locations = await storage.getLocations(orgId, scopeFilter);
      const otherCat = categories.find((c) => c.isOther);

      // First pass: validate WITHOUT creating any new refs, so we can fail fast and avoid orphaned data
      const dryResolved = resolveRows(parsed, mapping, formFields, categories, locations, otherCat?.id ?? null);
      // Treat unknown categories/locations the user marked "create" as resolvable (they don't count as errors)
      const willCreateCats = new Set(
        Object.entries(mapping.categoryResolutions)
          .filter(([, r]) => r.action === "create")
          .map(([n]) => n.toLowerCase().trim()),
      );
      const willCreateLocs = new Set(
        Object.entries(mapping.locationResolutions)
          .filter(([, r]) => r.action === "create")
          .map(([n]) => n.toLowerCase().trim()),
      );
      for (const r of dryResolved) {
        r.errors = r.errors.filter((e) => {
          if (e === '"Type" is required' && r.unknownCategoryName && willCreateCats.has(r.unknownCategoryName.toLowerCase().trim())) return false;
          if (e === '"Location" is required' && r.unknownLocationName && willCreateLocs.has(r.unknownLocationName.toLowerCase().trim())) return false;
          return true;
        });
      }
      const dryErrorRows = dryResolved.filter((r) => r.errors.length > 0);
      if (dryErrorRows.length > 0 && !skipErrors) {
        await storage.updateImportBatch(id, orgId, {
          status: "failed",
          errorSummary: dryErrorRows.map((r) => ({ rowNumber: r.rowNumber, errors: r.errors, originalRow: r.originalRow })),
          failedRows: dryErrorRows.length,
          completedAt: new Date(),
        });
        return res.status(400).json({
          message: `${dryErrorRows.length} rows have errors. Tick "Skip rows with errors" to import only the valid rows.`,
          errorRows: dryErrorRows.length,
        });
      }

      // Validation passed — perform ref creation + incident inserts + batch finalisation in ONE transaction.
      // If anything fails inside the transaction, every write is rolled back atomically — no orphaned refs.
      let insertedCount = 0;
      let errorRowCount = 0;
      let committedErrorSummary: Array<{ rowNumber: number; errors: string[]; originalRow: Record<string, string> }> = [];
      const createdCategoryIds: number[] = [];
      const createdLocationIds: number[] = [];

      // Reset progress counters on the batch so polling starts at 0 for this commit attempt.
      // (claimImportBatchForCommit already moved status -> "processing".)
      await db.update(importBatches)
        .set({ importedRows: 0, failedRows: 0 })
        .where(and(eq(importBatches.id, id), eq(importBatches.organizationId, orgId)));

      await db.transaction(async (tx) => {
        // 1. Create new categories
        const newCats: typeof categories = [];
        for (const [origName, res] of Object.entries(mapping.categoryResolutions)) {
          if (res.action !== "create") continue;
          const niceName = origName.length > 0 ? origName.charAt(0).toUpperCase() + origName.slice(1) : origName;
          const existing = categories.find((c) => c.name.toLowerCase().trim() === origName.toLowerCase().trim());
          if (existing) continue;
          const [created] = await tx.insert(incidentCategories)
            .values({ name: niceName, color: "#6B7280", icon: "alert", isOther: false, organizationId: orgId, commandId: defaultStampCommandId })
            .returning();
          createdCategoryIds.push(created.id);
          newCats.push(created);
        }
        const allCategories = [...categories, ...newCats];

        // 2. Create new locations
        const newLocs: typeof locations = [];
        for (const [origName, res] of Object.entries(mapping.locationResolutions)) {
          if (res.action !== "create") continue;
          const niceName = origName.length > 0 ? origName.charAt(0).toUpperCase() + origName.slice(1) : origName;
          const existing = locations.find((l) => l.name.toLowerCase().trim() === origName.toLowerCase().trim());
          if (existing) continue;
          const [created] = await tx.insert(locationsTable)
            .values({ name: niceName, color: "#6B7280", icon: "default", organizationId: orgId, commandId: defaultStampCommandId })
            .returning();
          createdLocationIds.push(created.id);
          newLocs.push(created);
        }
        const allLocations = [...locations, ...newLocs];

        // 3. Resolve rows against the now-complete reference set
        const resolved = resolveRows(parsed, mapping, formFields, allCategories, allLocations, otherCat?.id ?? null);
        const catByLower = new Map(allCategories.map((c) => [c.name.toLowerCase().trim(), c]));
        const locByLower = new Map(allLocations.map((l) => [l.name.toLowerCase().trim(), l]));
        for (const r of resolved) {
          if (r.unknownCategoryName && r.data.categoryId == null) {
            const c = catByLower.get(r.unknownCategoryName.toLowerCase().trim());
            if (c) r.data.categoryId = c.id;
          }
          if (r.unknownLocationName && r.data.locationId == null && !r.data.locationName) {
            const l = locByLower.get(r.unknownLocationName.toLowerCase().trim());
            if (l) {
              r.data.locationId = l.id;
              r.data.locationName = l.name;
              r.data.latitude = l.latitude;
              r.data.longitude = l.longitude;
            }
          }
          r.errors = r.errors.filter((e) => {
            if (e === '"Type" is required' && r.data.categoryId != null) return false;
            if (e === '"Location" is required' && (r.data.locationId != null || r.data.locationName)) return false;
            return true;
          });
        }
        const validRows = resolved.filter((r) => r.errors.length === 0);
        const errorRows = resolved.filter((r) => r.errors.length > 0);
        errorRowCount = errorRows.length;
        // Persist the full skipped-row error list (with original cell values) so admins can
        // download a per-row CSV from completed batches in Past Imports.
        committedErrorSummary = errorRows.map((r) => ({
          rowNumber: r.rowNumber,
          errors: r.errors,
          originalRow: r.originalRow,
        }));

        // 4. Bulk-insert incidents in chunks of 500 — all inside this transaction.
        // Between chunks emit a progress update via a separate (out-of-tx) connection so
        // the polling client sees importedRows climb during the import. The progress row
        // is only "advisory" — if the transaction rolls back, the final catch handler resets
        // status=failed and the counter is moot (the wizard reads success/failure from the
        // commit response, not from importedRows).
        const CHUNK = 500;
        // Stamp imported incidents with the admin's currently-active Command so they
        // land in the same scope as the rest of that Command's data.
        // (defaultStampCommandId is resolved + write-scope-checked at the top of the route.)
        const rowsToInsert = validRows.map((r) => ({
          ...(r.data as InsertIncident),
          organizationId: orgId,
          importBatchId: id,
          commandId: (r.data as InsertIncident).commandId ?? defaultStampCommandId,
        }));
        for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
          const chunk = rowsToInsert.slice(i, i + CHUNK);
          const inserted = await tx.insert(incidentsTable).values(chunk).returning({ id: incidentsTable.id });
          insertedCount += inserted.length;
          // Out-of-tx progress write (uses the pool, not tx's connection) — commits immediately.
          await db.update(importBatches)
            .set({ importedRows: insertedCount, failedRows: errorRowCount })
            .where(and(eq(importBatches.id, id), eq(importBatches.organizationId, orgId)));
        }

        // 5. Finalise the batch row
        await tx.update(importBatches)
          .set({
            status: "completed",
            importedRows: insertedCount,
            failedRows: errorRowCount,
            errorSummary: committedErrorSummary.length > 0 ? committedErrorSummary : null,
            createdCategoryIds: createdCategoryIds.length > 0 ? createdCategoryIds : null,
            createdLocationIds: createdLocationIds.length > 0 ? createdLocationIds : null,
            completedAt: new Date(),
          })
          .where(and(eq(importBatches.id, id), eq(importBatches.organizationId, orgId)));
      });

      audit(userId, orgId, "import.commit", `Imported ${insertedCount} occurrences from "${batch.filename}" (${errorRowCount} skipped)`, { entityType: "import_batch", entityId: String(id) });

      parsedFileCache.delete(id);
      res.json({ success: true, importedRows: insertedCount, failedRows: errorRowCount });
    } catch (err: any) {
      console.error("Import commit error:", err);
      // Transaction rolled back — no refs or incidents persisted from this attempt.
      // Reset progress counters so the batch metadata accurately reflects "0 imported".
      await storage.updateImportBatch(id, orgId, {
        status: "failed",
        importedRows: 0,
        failedRows: 0,
        completedAt: new Date(),
      });
      res.status(500).json({ message: err.message || "Import failed" });
    }
  });

  // ── Chat Routes ──────────────────────────────────────────────────────────────
  // Returns minimal user info for all active org members — used by the DM picker (all roles)
  app.get("/api/chat/users", async (req, res) => {
    const { organizationId: orgId } = req.currentUser!;
    const orgUsers = await storage.getActiveUsersByOrg(orgId);
    const safe = orgUsers.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      avatarUrl: u.avatarUrl ?? null,
    }));
    res.json(safe);
  });

  app.get("/api/chat/messages", async (req, res) => {
    const { id: userId, organizationId: orgId } = req.currentUser!;
    const { type, with: withUserId, before, limit } = req.query as Record<string, string>;
    const msgLimit = Math.min(parseInt(limit ?? "50") || 50, 100);
    const beforeId = before ? parseInt(before) : undefined;

    if (type === "group") {
      const msgs = await storage.getChatMessages(orgId, userId, { type: "group", limit: msgLimit, before: beforeId });
      return res.json(msgs);
    } else if (type === "dm" && withUserId) {
      const partner = await storage.getUserById(withUserId);
      if (!partner || partner.organizationId !== orgId) {
        return res.status(404).json({ message: "User not found" });
      }
      const msgs = await storage.getChatMessages(orgId, userId, { type: "dm", withUserId, limit: msgLimit, before: beforeId });
      return res.json(msgs);
    } else {
      return res.status(400).json({ message: "type=group or type=dm&with=<userId> required" });
    }
  });

  app.post("/api/chat/messages", async (req, res) => {
    const { id: userId, organizationId: orgId } = req.currentUser!;
    const { recipientId, content } = req.body ?? {};
    if (typeof content !== "string") {
      return res.status(400).json({ message: "content is required" });
    }
    const validated = validateChatContent(content);
    if (!validated.ok) {
      return res.status(400).json({ message: validated.message });
    }
    if (recipientId !== null && recipientId !== undefined) {
      const partner = await storage.getUserById(recipientId);
      if (!partner || partner.organizationId !== orgId) {
        return res.status(404).json({ message: "Recipient not found" });
      }
    }
    const msg = await storage.sendChatMessage(orgId, userId, recipientId ?? null, validated.trimmed);
    res.status(201).json(msg);

    // Fire push notifications non-blocking — failures must never affect the 201 response
    const senderId = userId;
    const finalRecipientId = recipientId ?? null;
    const trimmedContent = validated.trimmed;
    Promise.resolve().then(async () => {
      try {
        const sender = await storage.getUserById(senderId);
        const senderName = sender ? `${sender.firstName} ${sender.lastName}`.trim() : "Someone";
        const preview = chatContentPreview(trimmedContent);
        const title = finalRecipientId ? `💬 ${senderName}` : `💬 ${senderName} · General`;
        const payload = JSON.stringify({ type: "chat_message", title, body: preview, url: "/chat" });
        const pushOpts = { TTL: 60 };

        if (finalRecipientId) {
          const dmNotifUrl = `/chat?dm=${senderId}`;
          const fcmData = { type: "chat_message", url: dmNotifUrl };

          // DM — Web Push (PWA browsers without native FCM)
          const subs = await storage.getPushSubscriptionsByUser(finalRecipientId);
          await Promise.allSettled(subs.map(async (sub) => {
            try {
              await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, pushOpts);
            } catch (err: unknown) {
              const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
              if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint).catch(() => {});
            }
          }));

          // FCM — native Android/iOS (APK); same path as panic / live incident
          const fcmSubs = await storage.getFcmTokensByUser(finalRecipientId);
          if (fcmSubs.length > 0) {
            await sendFcmBatch(fcmSubs.map((s) => s.token), {
              title,
              body: preview,
              data: fcmData,
              notificationTag: `chat-dm-${senderId}`,
            });
          }

          // Log to notification_logs only on the 0→1 unread transition (dedup per thread)
          // url encodes the sender so clearing on read is thread-scoped
          storage.hasNotificationLogWithUrl(orgId, finalRecipientId, dmNotifUrl).then((exists) => {
            if (!exists) {
              storage.createNotificationLog({ organizationId: orgId, userId: finalRecipientId, title, body: preview, url: dmNotifUrl }).catch(() => {});
            }
          }).catch(() => {});
        } else {
          const groupNotifUrl = "/chat?type=group";
          const fcmData = { type: "chat_message", url: groupNotifUrl };

          // Group — Web Push (PWA browsers without native FCM)
          const subs = dedupeByEndpoint(await storage.getPushSubscriptionsByOrg(orgId, senderId));
          await Promise.allSettled(subs.map(async (sub) => {
            try {
              await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, pushOpts);
            } catch (err: unknown) {
              const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
              if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint).catch(() => {});
            }
          }));

          // FCM — native Android/iOS (APK)
          const fcmSubs = await storage.getFcmTokensByOrg(orgId, senderId);
          if (fcmSubs.length > 0) {
            await sendFcmBatch(fcmSubs.map((s) => s.token), {
              title,
              body: preview,
              data: fcmData,
              notificationTag: "chat-group",
            });
          }

          // Log to notification_logs for every org member except the sender — only on 0→1 transition
          // url is thread-scoped so clearing on read is precise
          const orgMembers = await storage.getActiveUsersByOrg(orgId);
          await Promise.allSettled(
            orgMembers
              .filter((u) => u.id !== senderId)
              .map(async (u) => {
                try {
                  const exists = await storage.hasNotificationLogWithUrl(orgId, u.id, groupNotifUrl);
                  if (!exists) {
                    await storage.createNotificationLog({ organizationId: orgId, userId: u.id, title, body: preview, url: groupNotifUrl });
                  }
                } catch { /* swallow */ }
              })
          );
        }
      } catch { /* swallow — push is best-effort */ }
    }).catch(() => {});
  });

  app.get("/api/chat/conversations", async (req, res) => {
    const { id: userId, organizationId: orgId } = req.currentUser!;
    const convos = await storage.getChatConversations(orgId, userId);
    res.json(convos);
  });

  app.post("/api/chat/read", async (req, res) => {
    const { id: userId, organizationId: orgId } = req.currentUser!;
    const { recipientId } = req.body ?? {};
    if (recipientId !== null && recipientId !== undefined) {
      if (typeof recipientId !== "string") {
        return res.status(400).json({ message: "recipientId must be a string or null" });
      }
      const recipient = await storage.getUserById(recipientId);
      if (!recipient || recipient.organizationId !== orgId || !recipient.isActive) {
        return res.status(404).json({ message: "Recipient not found" });
      }
    }
    await storage.markThreadRead(orgId, userId, recipientId ?? null);
    // Clear only the notification log for the specific thread that was just read
    const readNotifUrl = recipientId ? `/chat?dm=${recipientId}` : "/chat?type=group";
    storage.deleteNotificationLogsByUserAndUrl(orgId, userId, readNotifUrl).catch(() => {});
    res.json({ ok: true });
  });

  app.delete("/api/chat/messages/:id", async (req, res) => {
    const user = req.currentUser!;
    const orgId = user.organizationId;
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid message ID" });

    const msg = await storage.getChatMessageById(id, orgId);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    if (!canManageChatMessage(user, msg)) {
      return res.status(403).json({ message: "You can only delete your own messages" });
    }

    await storage.deleteChatMessage(id, orgId);
    audit(user.id, orgId, "chat.delete_message", `Deleted chat message #${id}`, {
      entityType: "chat_message",
      entityId: String(id),
    });
    res.json({ ok: true });
  });

  app.delete("/api/chat/group", requireAdmin, async (req, res) => {
    const user = req.currentUser!;
    const orgId = user.organizationId;
    const count = await storage.clearGroupChatMessages(orgId);
    audit(user.id, orgId, "chat.clear_group", `Cleared General chat (${count} messages)`, {
      entityType: "chat_thread",
      entityId: "group",
    });
    res.json({ ok: true, deletedCount: count });
  });

  app.delete("/api/imports/:id", requireAdmin, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const userId = req.currentUser!.id;
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid batch ID" });
    const batch = await storage.getImportBatch(id, orgId);
    if (!batch) return res.status(404).json({ message: "Import batch not found" });
    // Allow undo of completed batches AND failed batches (failed ones may have leftover
    // createdCategoryIds/createdLocationIds from older non-atomic commits — let admins clean them up).
    if (batch.status !== "completed" && batch.status !== "failed") {
      return res.status(400).json({ message: "Only completed or failed imports can be undone" });
    }
    const result = await storage.deleteImportBatchAndIncidents(id, orgId);
    audit(userId, orgId, "import.undo", `Undid import "${batch.filename}" — removed ${result.deletedIncidents} occurrences`, { entityType: "import_batch", entityId: String(id) });
    res.json({ success: true, ...result });
  });

  // ── GPS Stale Detection ───────────────────────────────────────────────────
  // Every 60 seconds, check all live incidents across all orgs. If a responder's
  // GPS has not updated for ≥ 15 minutes, push an ⚠️ alert to all
  // admin/supervisor subscribers in that org. Repeats every 5 minutes while
  // still stale. Deduplicates by userId so users with multiple push endpoints
  // (e.g. subscribed from two different origins) receive only one notification.
  // The timer resets automatically when fresh GPS arrives.
  const GPS_STALE_INITIAL_MS = 15 * 60 * 1000; // 15 min before first alert
  const GPS_STALE_REPEAT_MS  =  5 * 60 * 1000; //  5 min between repeats
  setInterval(async () => {
    try {
      const liveList = await storage.getAllLiveIncidentsForStaleCheck();
      const now = Date.now();
      for (const inc of liveList) {
        const lastUpdate = inc.responderPositionUpdatedAt
          ? inc.responderPositionUpdatedAt.getTime()
          : inc.liveStartedAt
            ? inc.liveStartedAt.getTime()
            : null;

        if (lastUpdate == null) continue;

        const staleDuration = now - lastUpdate;
        const lastSent = gpsStaleLastSent.get(inc.id);

        // First alert: must be stale for at least 15 minutes
        if (!lastSent && staleDuration < GPS_STALE_INITIAL_MS) continue;
        // Repeat alerts: must be at least 5 minutes since last notification
        if (lastSent && now - lastSent < GPS_STALE_REPEAT_MS) continue;

        // Stamp before async work to prevent duplicate sends on slow iteration
        gpsStaleLastSent.set(inc.id, now);

        const fullName = [inc.responderFirstName, inc.responderLastName].filter(Boolean).join(" ") || "Responder";
        const lastSeenDate = inc.responderPositionUpdatedAt ?? inc.liveStartedAt!;
        const lastSeenTime = lastSeenDate.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
        const minsAgo = Math.round((now - lastSeenDate.getTime()) / 60000);
        const title = `⚠️ GPS Signal Lost — ${fullName}`;
        const body = `Incident #${inc.id} · Last seen ${lastSeenTime} · ${minsAgo < 1 ? "< 1" : minsAgo} min ago`;
        // type:"incident_update" triggers INVALIDATE_LIVE in the service worker
        // so any open live-monitor or live-incident tab refreshes immediately.
        const payload = JSON.stringify({ type: "incident_update", title, body, url: "/live-monitor" });

        (async () => {
          try {
            const subs = await storage.getPushSubscriptionsByOrg(inc.organizationId, inc.userId ?? undefined, ["administrator", "supervisor", "control_room"]);
            if (subs.length === 0) return;

            // Deduplicate by userId — one notification per person regardless of
            // how many origins/devices they have subscribed from. Keep the last
            // subscription encountered for each user (insertion order).
            const uniqueSubs = Array.from(
              subs.reduce((map, s) => { map.set(s.userId, s); return map; }, new Map<string, typeof subs[0]>()).values()
            );

            let successCount = 0;
            await Promise.allSettled(uniqueSubs.map(async (sub) => {
              try {
                await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, URGENT_PUSH);
                successCount++;
                storage.createNotificationLog({
                  organizationId: inc.organizationId,
                  userId: sub.userId,
                  title,
                  body,
                  url: "/live-monitor",
                  incidentId: inc.id,
                }).catch((logErr) => console.warn(`[gps-stale] Notification log write failed for incident #${inc.id}:`, logErr instanceof Error ? logErr.message : logErr));
              } catch (err: unknown) {
                const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
                if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
              }
            }));
            if (successCount === 0) {
              // All sends failed (transient) — roll back timestamp so next tick retries
              gpsStaleLastSent.delete(inc.id);
              console.warn(`[gps-stale] All sends failed for incident #${inc.id} — will retry next tick`);
            } else {
              console.log(`[gps-stale] Sent stale alert for incident #${inc.id} (${fullName}, last seen ${lastSeenTime}, ${successCount}/${uniqueSubs.length} delivered)`);
            }
          } catch (err) {
            console.error(`[gps-stale] Failed to send alert for incident #${inc.id}:`, err instanceof Error ? err.message : err);
            gpsStaleLastSent.delete(inc.id);
          }
        })();
      }
    } catch (err) {
      console.error("[gps-stale] Interval check failed:", err instanceof Error ? err.message : err);
    }
  }, 60_000);

  // Panic reminder — every 2 minutes, re-notify admins/supervisors for unacknowledged panics
  setInterval(async () => {
    try {
      const unacknowledged = await storage.getAllUnacknowledgedPanicsForReminder();
      if (unacknowledged.length === 0) return;
      const byOrg = new Map<string, typeof unacknowledged[0][]>();
      for (const p of unacknowledged) {
        if (!byOrg.has(p.organizationId)) byOrg.set(p.organizationId, []);
        byOrg.get(p.organizationId)!.push(p);
      }
      for (const [orgId, panics] of byOrg) {
        const subs = await storage.getPushSubscriptionsByOrg(orgId, undefined, ["administrator", "supervisor", "control_room"]);
        const dedupedSubs = dedupeByEndpoint(subs);
        if (dedupedSubs.length === 0) continue;
        for (const panic of panics) {
          const fullName = `${panic.firstName ?? ""} ${panic.lastName ?? ""}`.trim() || "A user";
          const title = `🆘 PANIC REMINDER — ${fullName} still needs help!`;
          const body = "This panic alert has not been acknowledged. Tap to open OMT Pulse and respond.";
          const url = "/";
          const payload = JSON.stringify({ type: "panic", title, body, url });
          await Promise.allSettled(
            dedupedSubs.map(async (sub) => {
              try {
                await webpush.sendNotification(
                  { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                  payload,
                  URGENT_PUSH,
                );
              } catch (err: unknown) {
                const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
                if (code === 410 || code === 404) storage.deletePushSubscription(sub.endpoint);
              }
            })
          );
        }
      }
    } catch (err) {
      console.error("[panic-reminder] Interval check failed:", err instanceof Error ? err.message : err);
    }
  }, 2 * 60_000);

  registerAccessControlRoutes(app);
  registerPatrolRoutes(app);
  registerFleetAlertRoutes(app);
  registerWorkstationRoutes(app);

  registerFleetAlertPushHandler(async ({ alert, commandId }) => {
    await dispatchFleetAlertPush(alert.organizationId, alert, commandId);
  });

  registerPatrolPushHandler(async (req) => {
    await dispatchPatrolPush(req);
  });

  return httpServer;
}
