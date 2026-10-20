import type { Express, Request } from "express";
import { z } from "zod";
import webpush from "web-push";
import { isDispatchStaff } from "@shared/user-roles";
import { storage } from "./storage";

const URGENT_PUSH = { urgency: "high" as const, TTL: 3600 };
const QUIET_PUSH = { urgency: "normal" as const, TTL: 3600 };
const LIVE_ALERT_CHANNEL = "omt_live";
const LIVE_ALERT_SOUND = "live_alert";
const PANIC_ALERT_CHANNEL = "omt_panic_loud";
const PANIC_ALERT_SOUND = "alarm_siren";
const CRIME_ALERT_CHANNEL = "omt_chat";
const FIRE_CARD_CHANNEL = "omt_vuur_bell";
const FIRE_CARD_SOUND = "alarm_vuur";
const CRIME_CARD_CHANNEL = "omt_misdaad_tone";
const CRIME_CARD_SOUND = "alarm_misdaad";
/** A group member must be this close to her before their phone can close the panic. */
const PANIC_CLOSE_VICINITY_M = 500;
/** A later vuur report joins an open fire only inside this distance. Farther away is a new fire. */
const FIRE_JOIN_RADIUS_M = 2000;

export const FIRE_CATEGORY_NAME = "Vuur";

export const CRIME_KINDS = {
  stock_theft: "Veediefstal",
  roaming_livestock: "Vee en Wildediere",
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
  dataOnly?: boolean;
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
  wind: z.enum(["n", "ne", "e", "se", "s", "sw", "w", "nw"]).optional(),
  photo: z.object({
    url: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    byteSize: z.number().int().nonnegative().optional(),
  }).optional(),
});

const crimeBodySchema = z.object({
  kind: z.enum(["stock_theft", "roaming_livestock", "burglary", "suspicious_vehicle", "suspicious_person", "other"]),
  note: z.string().trim().max(500).optional(),
  lat: z.number().finite().optional(),
  lng: z.number().finite().optional(),
  locationName: z.string().trim().max(200).optional(),
  photo: z.object({
    url: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    byteSize: z.number().int().nonnegative().optional(),
  }).optional(),
});

function windSentence(wind: string | undefined): string | null {
  const towards: Record<string, string> = {
    n: "noorde",
    ne: "noordooste",
    e: "ooste",
    se: "suidooste",
    s: "suide",
    sw: "suidweste",
    w: "weste",
    nw: "noordweste",
  };
  const word = wind ? towards[wind] : undefined;
  return word ? `Die wind waai na die ${word}.` : null;
}

async function placeFromPin(coords: { lat: number; lng: number } | null): Promise<string> {
  if (!coords) return "";
  const fallback = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
  const key = process.env.VITE_GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";
  if (!key) return fallback;
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${coords.lat},${coords.lng}`);
    url.searchParams.set("language", "af");
    url.searchParams.set("key", key);
    const upstream = await fetch(url, { headers: { Referer: "https://omtpulse.com/" } });
    const body = await upstream.json() as { results?: Array<{ formatted_address?: string }> };
    const address = body.results?.[0]?.formatted_address?.trim();
    return address || fallback;
  } catch {
    return fallback;
  }
}

function pair(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = typeof lat === "number" ? lat : Number(lat);
  const ln = typeof lng === "number" ? lng : Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return { lat: la, lng: ln };
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sl = Math.sin(dLat / 2);
  const sln = Math.sin(dLng / 2);
  const x = sl * sl + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sln * sln;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function panicPoint(incident: {
  destinationLat?: number | null;
  destinationLng?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  responderLat?: number | null;
  responderLng?: number | null;
}): { lat: number; lng: number } | null {
  return pair(incident.destinationLat, incident.destinationLng)
    ?? pair(incident.latitude, incident.longitude)
    ?? pair(incident.responderLat, incident.responderLng);
}

/** The phone session stays on Central. Reads and "is there already a vuur" must include the farm group the report is filed under. */
async function phoneCommandIds(req: Request, ctx: FarmerRouteCtx): Promise<number[] | undefined> {
  const scope = await ctx.getCommandScope(req);
  const stamped = await stampCommandId(req, ctx);
  const filter = scope.commandFilter;
  if (!filter) return undefined;
  if (stamped != null && !filter.includes(stamped)) return [...filter, stamped];
  return filter;
}

async function stampCommandId(req: Request, _ctx: FarmerRouteCtx): Promise<number | null> {
  const own = await storage.getUserCommands(req.currentUser!.id);
  // The farmer phone never switches group. Membership also includes Central,
  // and the session default is Central, which hid Mo's fire from Boere George.
  // Use the group she belongs to. Central only when that is her only group.
  const chosen = req.session.activeCommandId;
  if (typeof chosen === "number" && own.some((c) => c.id === chosen && !c.isCentral)) return chosen;
  const field = own.filter((c) => !c.isCentral);
  if (field.length > 0) return field[0]!.id;
  return own.find((c) => c.isCentral)?.id ?? own[0]?.id ?? null;
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
  pushType: "fire" | "crime" | "panic_safe";
  urgent: boolean;
  /** Same loud home-screen alarm as panic. Fire only. */
  alarm?: boolean;
  /** Misdaad draws its own lock-screen card and gate tone. */
  lockScreen?: "crime";
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
        channelId: opts.lockScreen === "crime"
          ? CRIME_CARD_CHANNEL
          : opts.pushType === "fire"
            ? FIRE_CARD_CHANNEL
            : opts.alarm ? PANIC_ALERT_CHANNEL : opts.urgent ? LIVE_ALERT_CHANNEL : CRIME_ALERT_CHANNEL,
        sound: opts.lockScreen === "crime"
          ? CRIME_CARD_SOUND
          : opts.pushType === "fire"
            ? FIRE_CARD_SOUND
            : opts.alarm ? PANIC_ALERT_SOUND : opts.urgent ? LIVE_ALERT_SOUND : undefined,
        dataOnly: opts.alarm === true || opts.lockScreen === "crime",
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
    const commandFilter = await phoneCommandIds(req, ctx);
    const live = await storage.getLiveIncidents(orgId, commandFilter);
    const fires = live
      .filter((inc) => (inc.categoryName ?? "").toLowerCase() === FIRE_CATEGORY_NAME.toLowerCase() && !inc.panicClosedAt)
      .map((inc) => ({
        id: inc.id,
        userId: inc.userId,
        reporterFirstName: inc.responderFirstName,
        reporterLastName: inc.responderLastName,
        description: inc.description,
        locationName: inc.locationName,
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
    const windLine = windSentence(parsed.data.wind);

    const commandFilter = await phoneCommandIds(req, ctx);
    const live = await storage.getLiveIncidents(orgId, commandFilter ?? [commandId]);
    let active: (typeof live)[number] | undefined;
    if (fire) {
      let nearestM = FIRE_JOIN_RADIUS_M;
      for (const inc of live) {
        if ((inc.categoryName ?? "").toLowerCase() !== FIRE_CATEGORY_NAME.toLowerCase() || inc.panicClosedAt) continue;
        const existing = panicPoint(inc);
        if (!existing) continue;
        const metres = haversineM(fire, existing);
        if (metres <= nearestM) {
          nearestM = metres;
          active = inc;
        }
      }
    }

    if (active) {
      const witness = [note ? `${fullName} sien ook hierdie vuur. ${note}` : `${fullName} sien ook hierdie vuur.`, windLine]
        .filter(Boolean)
        .join(" ");
      await storage.createEvidenceNote({
        incidentId: active.id,
        organizationId: orgId,
        authorUserId: userId,
        evidencePhase: "supplementary",
        body: witness,
      });
      if (parsed.data.photo) {
        await storage.createAttachment({
          incidentId: active.id,
          organizationId: orgId,
          uploadedByUserId: userId,
          url: parsed.data.photo.url,
          filename: parsed.data.photo.filename,
          mimeType: parsed.data.photo.mimeType,
          evidencePhase: "scene",
          byteSize: parsed.data.photo.byteSize ?? null,
        });
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
      return res.json({ joined: true, incidentId: active.id, sent: 0, photoStored: Boolean(parsed.data.photo) });
    }

    const category = await ensureNamedCategory(orgId, commandId, FIRE_CATEGORY_NAME, "#ea580c", "red");
    const now = new Date();
    const description = [
      `Vuur — ${fullName}`,
      reporter ? `Rapporteerder: ${reporter.lat.toFixed(5)}, ${reporter.lng.toFixed(5)}` : "Rapporteerder se ligging onbekend",
      fire ? `Vuur: ${fire.lat.toFixed(5)}, ${fire.lng.toFixed(5)}` : "Vuurlokasie onbekend",
      windLine,
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

    if (parsed.data.photo) {
      await storage.createAttachment({
        incidentId: incident.id,
        organizationId: orgId,
        uploadedByUserId: userId,
        url: parsed.data.photo.url,
        filename: parsed.data.photo.filename,
        mimeType: parsed.data.photo.mimeType,
        evidencePhase: "scene",
        byteSize: parsed.data.photo.byteSize ?? null,
      });
    }

    const title = `VUUR — ${fullName}`;
    const body = windLine
      ? `Daar is 'n vuur in die gebied. ${windLine}`
      : "Daar is 'n vuur in die gebied. Maak die app oop — die pin wys op die kaart.";
    const { sent } = await fanOut({
      ctx,
      orgId,
      triggerUserId: userId,
      commandId,
      title,
      body,
      url: `/live-incident?join=${incident.id}`,
      incidentId: incident.id,
      pushType: "fire",
      urgent: true,
      alarm: true,
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

    res.json({ joined: false, incidentId: incident.id, sent, photoStored: Boolean(parsed.data.photo) });
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
    const reporter = incident.userId === req.currentUser.id;
    const stamped = await stampCommandId(req, ctx);
    const ownGroup = stamped != null && incident.commandId === stamped;
    if (!(await ctx.assertWriteCommandAccess(req, incident.commandId)) && !reporter && !ownGroup) {
      return res.status(403).json({ message: "You cannot close this fire" });
    }
    await storage.closePanic(id, orgId);
    res.json({ ok: true });
  });

  app.get("/api/crime", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const orgId = req.currentUser.organizationId;
    const commandFilter = await phoneCommandIds(req, ctx);
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
    const place = parsed.data.locationName?.trim() || await placeFromPin(coords);
    const now = new Date();
    const description = note || kindName;

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

    if (parsed.data.photo) {
      await storage.createAttachment({
        incidentId: incident.id,
        organizationId: orgId,
        uploadedByUserId: userId,
        url: parsed.data.photo.url,
        filename: parsed.data.photo.filename,
        mimeType: parsed.data.photo.mimeType,
        evidencePhase: "scene",
        byteSize: parsed.data.photo.byteSize ?? null,
      });
    }

    const livestock = parsed.data.kind === "roaming_livestock";
    const title = livestock ? `VEE EN WILDEDIERE — ${fullName}` : `MISDAAD — ${kindName}`;
    const headline = note.split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 140) ?? "";
    const body = livestock
      ? `${place ? `${place}. ` : ""}Vee of wildediere het dalk op 'n werf of plaas oorgeloop.`
      : headline
        ? `${fullName}${place ? ` · ${place}` : ""}. ${headline}`
        : `${fullName}${place ? ` · ${place}` : ""}. Maak die app oop vir die verslag.`;
    const { sent } = await fanOut({
      ctx,
      orgId,
      triggerUserId: userId,
      commandId,
      title,
      body,
      url: `/misdaad?report=${incident.id}`,
      incidentId: incident.id,
      pushType: "crime",
      urgent: true,
      lockScreen: "crime",
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

    res.status(201).json({
      incidentId: incident.id,
      sent,
      categoryName: kindName,
      photoStored: Boolean(parsed.data.photo),
    });
  });

  // "Gaan soontoe" uses the same live map as a vuur response. The report stays a
  // normal misdaad until someone responds, then it becomes a live incident with
  // the pin as the destination so /live-incident?join= can draw the route.
  app.post("/api/crime/:id/respond", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid report" });
    const orgId = req.currentUser.organizationId;
    const incident = await storage.getIncident(id, orgId);
    if (!incident) return res.status(404).json({ message: "Report not found" });
    const category = incident.categoryId != null
      ? await storage.getCategory(incident.categoryId, orgId)
      : undefined;
    const crimeNames = new Set(Object.values(CRIME_KINDS).map((n) => n.toLowerCase()));
    if (!category || !crimeNames.has(category.name.toLowerCase())) {
      return res.status(400).json({ message: "Not a crime report" });
    }
    if (incident.userId === req.currentUser.id) {
      return res.status(400).json({ message: "You reported this" });
    }
    const lat = incident.latitude != null ? Number(incident.latitude) : NaN;
    const lng = incident.longitude != null ? Number(incident.longitude) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ message: "This report has no location" });
    }
    if (!incident.isLive) {
      await storage.updateIncident(id, {
        isLive: true,
        liveStartedAt: new Date(),
        liveStartLat: lat,
        liveStartLng: lng,
        destinationLat: lat,
        destinationLng: lng,
        destinationName: category.name,
        latitude: lat,
        longitude: lng,
      }, orgId);
    } else if (incident.destinationLat == null || incident.destinationLng == null) {
      await storage.updateIncident(id, {
        destinationLat: lat,
        destinationLng: lng,
        destinationName: incident.destinationName || category.name,
      }, orgId);
    }
    res.json({ incidentId: id });
  });

  // The phone can say she is safe. It cannot stand the group down.
  app.post("/api/panic/:id/phone-says-safe", async (req, res) => {
    const loaded = await loadOpenPanic(req);
    if ("error" in loaded) return res.status(loaded.error.status).json({ message: loaded.error.message });
    const { incident, orgId, id, user } = loaded;
    if (incident.userId !== user.id) {
      return res.status(403).json({ message: "Only the panicker's phone can send this" });
    }
    const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Iemand";
    const line = `Die foon sê ${name} is veilig. Die paniek is NIE gekanselleer nie. Net iemand van die groep wat naby is, of die kantoor, kan dit toemaak.`;
    const description = incident.description?.trim() ? `${incident.description.trim()}\n${line}` : line;
    await storage.updateIncident(id, { description }, orgId);
    await storage.sendChatMessage(orgId, user.id, null, line);
    storage.createAuditLog({
      userId: user.id,
      organizationId: orgId,
      action: "panic.phone_says_safe",
      description: line,
      entityType: "incident",
      entityId: String(id),
      changes: null,
    }).catch(() => {});
    if (incident.commandId != null) {
      fanOut({
        ctx,
        orgId,
        triggerUserId: user.id,
        commandId: incident.commandId,
        title: "FOON SÊ VEILIG — PANIEK BLY OOP",
        body: line,
        url: `/live-incident?join=${id}`,
        incidentId: id,
        pushType: "panic_safe",
        urgent: true,
      }).catch(() => {});
    }
    res.json({ ok: true, closed: false });
  });

  // Office can close from the desk. A group member can close only when they are nearby. Her phone cannot.
  app.post("/api/panic/:id/close-on-scene", async (req, res) => {
    const loaded = await loadOpenPanic(req);
    if ("error" in loaded) return res.status(loaded.error.status).json({ message: loaded.error.message });
    const { incident, orgId, id, user } = loaded;
    if (incident.userId === user.id) {
      return res.status(403).json({ message: "The panicker's phone cannot close this panic" });
    }
    const office = isDispatchStaff(user.role);
    if (!office) {
      const commands = await storage.getUserCommands(user.id);
      const inGroup = incident.commandId == null
        ? commands.length > 0
        : commands.some((c) => c.id === incident.commandId);
      if (!inGroup) {
        return res.status(403).json({ message: "Only someone in the group can close this panic" });
      }
      const here = pair(req.body?.lat, req.body?.lng);
      const panicAt = panicPoint(incident);
      if (!here || !panicAt) {
        return res.status(400).json({ message: "We can't confirm you are nearby. The office must close this panic." });
      }
      if (haversineM(here, panicAt) > PANIC_CLOSE_VICINITY_M) {
        return res.status(403).json({ message: "You are too far away to close this panic" });
      }
    }
    await storage.updateIncident(id, { closedByUserId: user.id } as any, orgId);
    await storage.closePanic(id, orgId);
    const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Iemand";
    const line = `${name} is op die toneel en het die paniek toegemaak.`;
    storage.createAuditLog({
      userId: user.id,
      organizationId: orgId,
      action: "panic.close_on_scene",
      description: line,
      entityType: "incident",
      entityId: String(id),
      changes: null,
    }).catch(() => {});
    storage.sendChatMessage(orgId, user.id, null, line).catch(() => {});
    if (incident.commandId != null) {
      fanOut({
        ctx,
        orgId,
        triggerUserId: user.id,
        commandId: incident.commandId,
        title: "PANIEK TOE",
        body: line,
        url: "/dashboard",
        incidentId: id,
        pushType: "panic_safe",
        urgent: true,
      }).catch(() => {});
    }
    const orgSubs = await storage.getPushSubscriptionsByOrg(orgId);
    const silent = JSON.stringify({ type: "panic_ack_update", silent: true });
    await Promise.allSettled(
      ctx.dedupeByEndpoint(orgSubs).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            silent,
          );
        } catch (err: unknown) {
          const code = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode: number }).statusCode : 0;
          if (code === 410 || code === 404) await storage.deletePushSubscription(sub.endpoint);
        }
      }),
    );
    res.json({ ok: true, closed: true });
  });
}

async function loadOpenPanic(req: Request) {
  if (!req.currentUser) return { error: { status: 401, message: "Unauthorized" } };
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return { error: { status: 400, message: "Invalid panic" } };
  const orgId = req.currentUser.organizationId;
  const incident = await storage.getIncident(id, orgId);
  if (!incident || !incident.isLive) return { error: { status: 404, message: "Panic not found" } };
  const category = incident.categoryId != null
    ? await storage.getCategory(incident.categoryId, orgId)
    : undefined;
  if ((category?.name ?? "").toLowerCase() !== "panic") {
    return { error: { status: 400, message: "Not a panic" } };
  }
  return { incident, orgId, id, user: req.currentUser };
}
