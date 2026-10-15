import type { Express, Request } from "express";
import { z } from "zod";
import webpush from "web-push";
import { storage } from "./storage";

const URGENT_PUSH = { urgency: "high" as const, TTL: 3600 };
const QUIET_PUSH = { urgency: "normal" as const, TTL: 3600 };
const LIVE_ALERT_CHANNEL = "omt_live";
const LIVE_ALERT_SOUND = "live_alert";
const CRIME_ALERT_CHANNEL = "omt_chat";

export const FIRE_CATEGORY_NAME = "Vuur";

export const CRIME_KINDS = {
  stock_theft: "Veediefstal",
  burglary: "Inbraak",
  suspicious_vehicle: "Verdagte voertuig",
  suspicious_person: "Verdagte persoon",
  other: "Ander misdaad",
} as const;

export type CrimeKind = keyof typeof CRIME_KINDS;

type CommandScope = {
  commandFilter: number[] | undefined;
  defaultStampCommandId: number | null;
  writeAccessCommandIds: number[];
};

type FcmPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
  notificationTag?: string;
  channelId?: string;
  sound?: string;
};

type FarmerRouteCtx = {
  getCommandScope: (req: Request) => Promise<CommandScope>;
  alertAudienceCommandIds: (orgId: string, primaryCommandId: number | null | undefined) => Promise<number[] | undefined>;
  sendFcmBatch: (tokens: string[], payload: FcmPayload) => Promise<void>;
  dedupeByEndpoint: <T extends { endpoint: string }>(subs: T[]) => T[];
  assertWriteCommandAccess: (req: Request, rowCommandId: number | null | undefined) => Promise<boolean>;
};

const fireBodySchema = z.object({
  reporterLat: z.number().finite().optional(),
  reporterLng: z.number().finite().optional(),
  fireLat: z.number().finite().optional(),
  fireLng: z.number().finite().optional(),
  note: z.string().trim().max(500).optional(),
});

const crimeBodySchema = z.object({
  kind: z.enum(["stock_theft", "burglary", "suspicious_vehicle", "suspicious_person", "other"]),
  note: z.string().trim().max(500).optional(),
  lat: z.number().finite().optional(),
  lng: z.number().finite().optional(),
  locationName: z.string().trim().max(200).optional(),
});

function pair(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function stampCommandId(req: Request, ctx: FarmerRouteCtx): Promise<number | null> {
  const scope = await ctx.getCommandScope(req);
  if (scope.defaultStampCommandId != null) return scope.defaultStampCommandId;
  const userId = req.currentUser!.id;
  const own = await storage.getUserCommands(userId);
  const central = own.find((c) => c.isCentral);
  return central?.id ?? own[0]?.id ?? null;
}

async function ensureNamedCategory(
  orgId: string,
  commandId: number,
  name: string,
  color: string,
  severity: string,
) {
  const scoped = await storage.getCategories(orgId, [commandId]);
  const existing = scoped.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  return storage.createCategory(
    {
      name,
      color,
      description: "Boerevereniging",
      isOther: false,
      isSystem: true,
      severity,
      commandId,
    },
    orgId,
  );
}

async function fanOut(opts: {
  ctx: FarmerRouteCtx;
  orgId: string;
  triggerUserId: string;
  commandId: number;
  title: string;
  body: string;
  url: string;
  incidentId: number;
  pushType: "fire" | "crime";
  urgent: boolean;
}) {
  const commandIds = await opts.ctx.alertAudienceCommandIds(opts.orgId, opts.commandId);
  const payload = JSON.stringify({
    type: opts.pushType,
    title: opts.title,
    body: opts.body,
    incidentId: opts.incidentId,
    url: opts.url,
  });
  const subs = await storage.getPushSubscriptionsByOrg(opts.orgId, opts.triggerUserId, undefined, commandIds);
  const pushedUserIds = new Set<string>();
  let sent = 0;
  await Promise.allSettled(
    opts.ctx.dedupeByEndpoint(subs).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          opts.urgent ? URGENT_PUSH : QUIET_PUSH,
        );
        sent++;
        pushedUserIds.add(sub.userId);
        storage.createNotificationLog({
          organizationId: opts.orgId,
          userId: sub.userId,
          title: opts.title,
          body: opts.body,
          url: opts.url,
          incidentId: opts.incidentId,
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

  try {
    const fcmSubs = await storage.getFcmTokensByOrg(opts.orgId, opts.triggerUserId, undefined, commandIds);
    if (fcmSubs.length > 0) {
      await opts.ctx.sendFcmBatch(fcmSubs.map((s) => s.token), {
        title: opts.title,
        body: opts.body,
        data: { type: opts.pushType, incidentId: String(opts.incidentId), url: opts.url },
        notificationTag: `${opts.pushType}-${opts.incidentId}`,
        channelId: opts.urgent ? LIVE_ALERT_CHANNEL : CRIME_ALERT_CHANNEL,
        sound: opts.urgent ? LIVE_ALERT_SOUND : undefined,
      });
      for (const s of fcmSubs) {
        sent++;
        if (pushedUserIds.has(s.userId)) continue;
        pushedUserIds.add(s.userId);
        storage.createNotificationLog({
          organizationId: opts.orgId,
          userId: s.userId,
          title: opts.title,
          body: opts.body,
          url: opts.url,
          incidentId: opts.incidentId,
        }).catch(() => {});
      }
    }
  } catch { /* best-effort */ }

  try {
    const allActive = await storage.getActiveUsersByOrg(opts.orgId);
    const commandMemberIds = commandIds
      ? await storage.getUserIdsInCommands(opts.orgId, commandIds)
      : null;
    const noPushUsers = allActive.filter(
      (u) =>
        u.id !== opts.triggerUserId
        && !pushedUserIds.has(u.id)
        && (!commandMemberIds || commandMemberIds.has(u.id)),
    );
    await Promise.allSettled(
      noPushUsers.map((u) =>
        storage.createNotificationLog({
          organizationId: opts.orgId,
          userId: u.id,
          title: opts.title,
          body: opts.body,
          url: opts.url,
          incidentId: opts.incidentId,
        }).catch(() => {}),
      ),
    );
  } catch { /* best-effort */ }

  return { sent, found: subs.length };
}

export function registerFarmerRoutes(app: Express, ctx: FarmerRouteCtx) {
  app.get("/api/fire/active", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const orgId = req.currentUser.organizationId;
    const { commandFilter } = await ctx.getCommandScope(req);
    const live = await storage.getLiveIncidents(orgId, commandFilter);
    const fires = live
      .filter((inc) => (inc.categoryName ?? "").toLowerCase() === FIRE_CATEGORY_NAME.toLowerCase() && !inc.panicClosedAt)
      .map((inc) => ({
        id: inc.id,
        userId: inc.userId,
        reporterFirstName: inc.responderFirstName,
        reporterLastName: inc.responderLastName,
        description: inc.description,
        createdAt: inc.createdAt,
        fireLat: inc.destinationLat ?? inc.latitude,
        fireLng: inc.destinationLng ?? inc.longitude,
        reporterLat: inc.liveStartLat,
        reporterLng: inc.liveStartLng,
      }));
    res.json(fires);
  });

  app.post("/api/fire", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const parsed = fireBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid fire report" });

    const { organizationId: orgId, id: userId } = req.currentUser;
    const commandId = await stampCommandId(req, ctx);
    if (commandId == null) {
      return res.status(403).json({ message: "Cannot raise a fire — user has no assigned group" });
    }

    const user = await storage.getUserById(userId);
    const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : "n Boer";
    const reporter = pair(parsed.data.reporterLat, parsed.data.reporterLng);
    const dropped = pair(parsed.data.fireLat, parsed.data.fireLng);
    const fire = dropped ?? reporter;
    const note = parsed.data.note?.trim() || "";

    const { commandFilter } = await ctx.getCommandScope(req);
    const live = await storage.getLiveIncidents(orgId, commandFilter ?? [commandId]);
    const active = live.find(
      (inc) => (inc.categoryName ?? "").toLowerCase() === FIRE_CATEGORY_NAME.toLowerCase() && !inc.panicClosedAt,
    );

    if (active) {
      const witness = note
        ? `${fullName} sien ook hierdie vuur. ${note}`
        : `${fullName} sien ook hierdie vuur.`;
      await storage.createEvidenceNote({
        incidentId: active.id,
        organizationId: orgId,
        authorUserId: userId,
        evidencePhase: "supplementary",
        body: witness,
      });
      if (dropped) {
        await storage.updateIncident(active.id, {
          destinationLat: dropped.lat,
          destinationLng: dropped.lng,
          latitude: dropped.lat,
          longitude: dropped.lng,
        }, orgId);
      }
      storage.createAuditLog({
        userId,
        organizationId: orgId,
        action: "fire.join",
        description: `${fullName} joined active fire #${active.id}`,
        entityType: "incident",
        entityId: String(active.id),
        changes: null,
      }).catch(() => {});
      return res.json({ joined: true, incidentId: active.id, sent: 0 });
    }

    const category = await ensureNamedCategory(orgId, commandId, FIRE_CATEGORY_NAME, "#ea580c", "red");
    const now = new Date();
    const description = [
      `Vuur — ${fullName}`,
      reporter ? `Rapporteerder: ${reporter.lat.toFixed(5)}, ${reporter.lng.toFixed(5)}` : "Rapporteerder se ligging onbekend",
      fire ? `Vuur: ${fire.lat.toFixed(5)}, ${fire.lng.toFixed(5)}` : "Vuurlokasie onbekend",
      note ? note : null,
    ].filter(Boolean).join("\n");

    const incident = await storage.createIncident(
      {
        incidentDate: now.toISOString().slice(0, 10),
        incidentTime: now.toTimeString().slice(0, 5),
        categoryId: category.id,
        description,
        severity: "red",
        latitude: fire?.lat ?? null,
        longitude: fire?.lng ?? null,
        isLive: true,
        liveStartedAt: now,
        liveStartLat: reporter?.lat ?? fire?.lat ?? null,
        liveStartLng: reporter?.lng ?? fire?.lng ?? null,
        destinationLat: fire?.lat ?? null,
        destinationLng: fire?.lng ?? null,
        destinationName: "Vuur",
        commandId,
      },
      orgId,
      userId,
    );

    const title = `VUUR — ${fullName}`;
    const body = "Daar is 'n vuur in die gebied. Maak die app oop — die pin wys op die kaart.";
    const { sent } = await fanOut({
      ctx,
      orgId,
      triggerUserId: userId,
      commandId,
      title,
      body,
      url: "/vuur",
      incidentId: incident.id,
      pushType: "fire",
      urgent: true,
    });

    storage.createAuditLog({
      userId,
      organizationId: orgId,
      action: "fire.alert",
      description: `${fullName} raised a fire`,
      entityType: "incident",
      entityId: String(incident.id),
      changes: null,
    }).catch(() => {});

    res.json({ joined: false, incidentId: incident.id, sent });
  });

  app.post("/api/fire/:id/close", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid fire" });
    const orgId = req.currentUser.organizationId;
    const incident = await storage.getIncident(id, orgId);
    if (!incident) return res.status(404).json({ message: "Fire not found" });
    const category = incident.categoryId != null
      ? await storage.getCategory(incident.categoryId, orgId)
      : undefined;
    if ((category?.name ?? "").toLowerCase() !== FIRE_CATEGORY_NAME.toLowerCase()) {
      return res.status(400).json({ message: "Not a fire" });
    }
    if (!(await ctx.assertWriteCommandAccess(req, incident.commandId))) {
      return res.status(403).json({ message: "You cannot close this fire" });
    }
    await storage.closePanic(id, orgId);
    res.json({ ok: true });
  });

  app.get("/api/crime", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const orgId = req.currentUser.organizationId;
    const { commandFilter } = await ctx.getCommandScope(req);
    const [incidents, categories] = await Promise.all([
      storage.getIncidents(orgId, undefined, commandFilter),
      storage.getCategories(orgId, commandFilter),
    ]);
    const crimeNames = new Set(Object.values(CRIME_KINDS).map((n) => n.toLowerCase()));
    const nameById = new Map(categories.map((c) => [c.id, c.name]));
    const rows = incidents.filter((inc) => {
      const name = inc.categoryId != null ? nameById.get(inc.categoryId) : null;
      return !!name && crimeNames.has(name.toLowerCase());
    }).slice(0, 40);

    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
    const users = await Promise.all(userIds.map((id) => storage.getUserById(id)));
    const nameByUser = new Map(userIds.map((id, i) => [id, users[i]]));

    res.json(rows.map((inc) => {
      const reporter = inc.userId ? nameByUser.get(inc.userId) : undefined;
      return {
        id: inc.id,
        userId: inc.userId,
        categoryName: inc.categoryId != null ? nameById.get(inc.categoryId) ?? null : null,
        description: inc.description,
        locationName: inc.locationName,
        latitude: inc.latitude,
        longitude: inc.longitude,
        createdAt: inc.createdAt,
        reporterFirstName: reporter?.firstName ?? null,
        reporterLastName: reporter?.lastName ?? null,
      };
    }));
  });

  app.post("/api/crime", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const parsed = crimeBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid report" });

    const { organizationId: orgId, id: userId } = req.currentUser;
    const commandId = await stampCommandId(req, ctx);
    if (commandId == null) {
      return res.status(403).json({ message: "Cannot file a report — user has no assigned group" });
    }

    const user = await storage.getUserById(userId);
    const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : "n Boer";
    const kindName = CRIME_KINDS[parsed.data.kind];
    const category = await ensureNamedCategory(orgId, commandId, kindName, "#b45309", "orange");
    const coords = pair(parsed.data.lat, parsed.data.lng);
    const note = parsed.data.note?.trim() || "";
    const place = parsed.data.locationName?.trim() || "";
    const now = new Date();
    const description = [note, place ? `Plek: ${place}` : null].filter(Boolean).join("\n") || kindName;

    const incident = await storage.createIncident(
      {
        incidentDate: now.toISOString().slice(0, 10),
        incidentTime: now.toTimeString().slice(0, 5),
        categoryId: category.id,
        description,
        locationName: place || null,
        severity: "orange",
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        isLive: false,
        commandId,
      },
      orgId,
      userId,
    );

    const title = `MISDAAD — ${kindName}`;
    const body = `${fullName}${place ? ` · ${place}` : ""}. Maak die app oop vir die verslag.`;
    const { sent } = await fanOut({
      ctx,
      orgId,
      triggerUserId: userId,
      commandId,
      title,
      body,
      url: "/misdaad",
      incidentId: incident.id,
      pushType: "crime",
      urgent: false,
    });

    storage.createAuditLog({
      userId,
      organizationId: orgId,
      action: "crime.report",
      description: `${fullName} reported ${kindName}`,
      entityType: "incident",
      entityId: String(incident.id),
      changes: null,
    }).catch(() => {});

    res.status(201).json({ incidentId: incident.id, sent, categoryName: kindName });
  });
}
