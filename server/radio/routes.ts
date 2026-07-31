import type { Express, Request, Response } from "express";
import { AccessToken } from "livekit-server-sdk";
import { storage } from "../storage";
import {
  getLiveKitConfig,
  isRadioConfigured,
  privateRadioRoomName,
  radioRoomName,
} from "./config";
import {
  FLOOR_TTL_MS,
  getFloor,
  heartbeatFloor,
  releaseFloor,
  tryAcquireFloor,
} from "./floor";
import {
  acceptPrivateCall,
  endPrivateCall,
  findActivePrivateCallForUser,
  getPrivateCall,
  serializePrivateCall,
  startPrivateCall,
} from "./private-calls";

function requireUser(req: Request, res: Response): boolean {
  if (!req.currentUser) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }
  return true;
}

function displayName(req: Request): string {
  const u = req.currentUser!;
  const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  return name || u.email || u.id;
}

async function userCanJoinCommand(
  userId: string,
  orgId: string,
  commandId: number,
  role: string,
  isSuperadmin: boolean | null | undefined,
): Promise<boolean> {
  if (isSuperadmin || role === "administrator") {
    const cmd = await storage.getCommand(commandId, orgId);
    return !!cmd;
  }
  const mine = await storage.getUserCommands(userId);
  return mine.some((c) => c.id === commandId);
}

export function registerRadioRoutes(app: Express): void {
  app.get("/api/radio/status", async (req, res) => {
    if (!requireUser(req, res)) return;
    res.json({
      available: isRadioConfigured(),
      floorTtlMs: FLOOR_TTL_MS,
    });
  });

  app.get("/api/radio/channels", async (req, res) => {
    if (!requireUser(req, res)) return;
    const user = req.currentUser!;
    try {
      const channels =
        user.isSuperadmin || user.role === "administrator"
          ? await storage.getCommands(user.organizationId)
          : await storage.getUserCommands(user.id);

      res.json(
        channels.map((c) => ({
          id: c.id,
          name: c.name,
          isCentral: c.isCentral,
          roomName: radioRoomName(user.organizationId, c.id),
        })),
      );
    } catch (err) {
      console.error("[radio] channels:", err);
      res.status(500).json({ message: "Failed to list radio channels" });
    }
  });

  app.post("/api/radio/token", async (req, res) => {
    if (!requireUser(req, res)) return;
    const cfg = getLiveKitConfig();
    if (!cfg) {
      return res.status(503).json({
        message: "Radio is not configured on this server",
        available: false,
      });
    }

    const commandId = Number(req.body?.commandId);
    if (!Number.isFinite(commandId) || commandId <= 0) {
      return res.status(400).json({ message: "commandId required" });
    }

    const user = req.currentUser!;
    const allowed = await userCanJoinCommand(
      user.id,
      user.organizationId,
      commandId,
      user.role,
      user.isSuperadmin,
    );
    if (!allowed) {
      return res.status(403).json({ message: "Not a member of this radio channel" });
    }

    const deviceId =
      typeof req.body?.deviceId === "string" ? req.body.deviceId.trim().slice(0, 80) : "";
    const safeDevice = deviceId.replace(/[^a-zA-Z0-9_-]/g, "") || "web";
    // Unique LiveKit identity per browser tab/device so two open sessions do not
    // kick each other with DUPLICATE_IDENTITY (that was flapping radio online/offline).
    const identity = `${user.id}:${safeDevice}`;

    const roomName = radioRoomName(user.organizationId, commandId);
    try {
      const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
        identity,
        name: displayName(req),
        ttl: "2h",
      });
      at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });
      const token = await at.toJwt();
      res.json({
        token,
        url: cfg.url,
        roomName,
        commandId,
        identity,
      });
    } catch (err) {
      console.error("[radio] token:", err);
      res.status(500).json({ message: "Failed to mint radio token" });
    }
  });

  app.get("/api/radio/floor", async (req, res) => {
    if (!requireUser(req, res)) return;
    const commandId = Number(req.query.commandId);
    if (!Number.isFinite(commandId) || commandId <= 0) {
      return res.status(400).json({ message: "commandId required" });
    }
    const user = req.currentUser!;
    const allowed = await userCanJoinCommand(
      user.id,
      user.organizationId,
      commandId,
      user.role,
      user.isSuperadmin,
    );
    if (!allowed) return res.status(403).json({ message: "Forbidden" });

    const room = radioRoomName(user.organizationId, commandId);
    const holder = getFloor(room);
    res.json({
      holder: holder
        ? {
            userId: holder.userId,
            displayName: holder.displayName,
            expiresAt: holder.expiresAt,
            isMe: holder.userId === user.id,
          }
        : null,
    });
  });

  app.post("/api/radio/floor", async (req, res) => {
    if (!requireUser(req, res)) return;
    const commandId = Number(req.body?.commandId);
    if (!Number.isFinite(commandId) || commandId <= 0) {
      return res.status(400).json({ message: "commandId required" });
    }
    const user = req.currentUser!;
    const allowed = await userCanJoinCommand(
      user.id,
      user.organizationId,
      commandId,
      user.role,
      user.isSuperadmin,
    );
    if (!allowed) return res.status(403).json({ message: "Forbidden" });

    const room = radioRoomName(user.organizationId, commandId);
    const result = tryAcquireFloor(room, user.id, displayName(req));
    if (!result.ok) {
      return res.status(409).json({
        message: "Channel busy",
        holder: {
          userId: result.holder.userId,
          displayName: result.holder.displayName,
          expiresAt: result.holder.expiresAt,
          isMe: false,
        },
      });
    }
    res.json({
      holder: {
        userId: result.holder.userId,
        displayName: result.holder.displayName,
        expiresAt: result.holder.expiresAt,
        isMe: true,
      },
    });
  });

  app.post("/api/radio/floor/heartbeat", async (req, res) => {
    if (!requireUser(req, res)) return;
    const commandId = Number(req.body?.commandId);
    if (!Number.isFinite(commandId) || commandId <= 0) {
      return res.status(400).json({ message: "commandId required" });
    }
    const user = req.currentUser!;
    const room = radioRoomName(user.organizationId, commandId);
    const holder = heartbeatFloor(room, user.id);
    if (!holder) {
      return res.status(409).json({ message: "You do not hold the floor" });
    }
    res.json({
      holder: {
        userId: holder.userId,
        displayName: holder.displayName,
        expiresAt: holder.expiresAt,
        isMe: true,
      },
    });
  });

  app.delete("/api/radio/floor", async (req, res) => {
    if (!requireUser(req, res)) return;
    const commandId = Number(req.body?.commandId ?? req.query.commandId);
    if (!Number.isFinite(commandId) || commandId <= 0) {
      return res.status(400).json({ message: "commandId required" });
    }
    const user = req.currentUser!;
    const room = radioRoomName(user.organizationId, commandId);
    releaseFloor(room, user.id);
    res.json({ ok: true });
  });

  app.post("/api/radio/floor/release", async (req, res) => {
    if (!requireUser(req, res)) return;
    const commandId = Number(req.body?.commandId);
    if (!Number.isFinite(commandId) || commandId <= 0) {
      return res.status(400).json({ message: "commandId required" });
    }
    const user = req.currentUser!;
    const room = radioRoomName(user.organizationId, commandId);
    releaseFloor(room, user.id);
    res.json({ ok: true });
  });

  // --- Private 1:1 radio (control room ↔ single responder) ---

  app.get("/api/radio/private/active", async (req, res) => {
    if (!requireUser(req, res)) return;
    const user = req.currentUser!;
    const call = findActivePrivateCallForUser(user.id);
    if (!call || call.orgId !== user.organizationId) {
      return res.json({ call: null });
    }
    res.json({ call: serializePrivateCall(call, user.id) });
  });

  app.post("/api/radio/private/start", async (req, res) => {
    if (!requireUser(req, res)) return;
    const cfg = getLiveKitConfig();
    if (!cfg) {
      return res.status(503).json({ message: "Radio is not configured on this server" });
    }

    const peerUserId = typeof req.body?.peerUserId === "string" ? req.body.peerUserId.trim() : "";
    if (!peerUserId) {
      return res.status(400).json({ message: "peerUserId required" });
    }

    const user = req.currentUser!;
    if (peerUserId === user.id) {
      return res.status(400).json({ message: "Cannot start a private call with yourself" });
    }

    const peer = await storage.getUserById(peerUserId);
    if (!peer || peer.organizationId !== user.organizationId) {
      return res.status(404).json({ message: "User not found in your organisation" });
    }

    const incidentIdRaw = req.body?.incidentId;
    const incidentId =
      incidentIdRaw == null || incidentIdRaw === ""
        ? null
        : Number(incidentIdRaw);
    if (incidentId != null && (!Number.isFinite(incidentId) || incidentId <= 0)) {
      return res.status(400).json({ message: "invalid incidentId" });
    }

    const roomName = privateRadioRoomName(user.organizationId, user.id, peer.id);
    try {
      const call = startPrivateCall({
        orgId: user.organizationId,
        roomName,
        callerId: user.id,
        callerName: displayName(req),
        calleeId: peer.id,
        calleeName: `${peer.firstName ?? ""} ${peer.lastName ?? ""}`.trim() || peer.email || peer.id,
        incidentId,
      });

      const deviceId =
        typeof req.body?.deviceId === "string" ? req.body.deviceId.trim().slice(0, 80) : "";
      const safeDevice = deviceId.replace(/[^a-zA-Z0-9_-]/g, "") || "web";
      const identity = `${user.id}:${safeDevice}`;
      const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
        identity,
        name: displayName(req),
        ttl: "2h",
      });
      at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });
      const token = await at.toJwt();

      res.json({
        call: serializePrivateCall(call, user.id),
        token,
        url: cfg.url,
        roomName,
        identity,
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "busy_self" || code === "busy_peer") {
        return res.status(409).json({
          message: err instanceof Error ? err.message : "Private radio busy",
        });
      }
      console.error("[radio] private start:", err);
      res.status(500).json({ message: "Failed to start private radio" });
    }
  });

  app.post("/api/radio/private/accept", async (req, res) => {
    if (!requireUser(req, res)) return;
    const cfg = getLiveKitConfig();
    if (!cfg) {
      return res.status(503).json({ message: "Radio is not configured on this server" });
    }

    const callId = typeof req.body?.callId === "string" ? req.body.callId.trim() : "";
    if (!callId) return res.status(400).json({ message: "callId required" });

    const user = req.currentUser!;
    const call = acceptPrivateCall(callId, user.id);
    if (!call || call.orgId !== user.organizationId) {
      return res.status(404).json({ message: "Private call not found or expired" });
    }

    const deviceId =
      typeof req.body?.deviceId === "string" ? req.body.deviceId.trim().slice(0, 80) : "";
    const safeDevice = deviceId.replace(/[^a-zA-Z0-9_-]/g, "") || "web";
    const identity = `${user.id}:${safeDevice}`;
    try {
      const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
        identity,
        name: displayName(req),
        ttl: "2h",
      });
      at.addGrant({
        roomJoin: true,
        room: call.roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });
      const token = await at.toJwt();
      res.json({
        call: serializePrivateCall(call, user.id),
        token,
        url: cfg.url,
        roomName: call.roomName,
        identity,
      });
    } catch (err) {
      console.error("[radio] private accept:", err);
      res.status(500).json({ message: "Failed to join private radio" });
    }
  });

  app.post("/api/radio/private/end", async (req, res) => {
    if (!requireUser(req, res)) return;
    const callId = typeof req.body?.callId === "string" ? req.body.callId.trim() : "";
    if (!callId) return res.status(400).json({ message: "callId required" });
    const user = req.currentUser!;
    const call = endPrivateCall(callId, user.id);
    if (call) releaseFloor(call.roomName, user.id);
    res.json({ ok: true });
  });

  app.post("/api/radio/private/token", async (req, res) => {
    if (!requireUser(req, res)) return;
    const cfg = getLiveKitConfig();
    if (!cfg) {
      return res.status(503).json({ message: "Radio is not configured on this server" });
    }
    const callId = typeof req.body?.callId === "string" ? req.body.callId.trim() : "";
    if (!callId) return res.status(400).json({ message: "callId required" });
    const user = req.currentUser!;
    const call = getPrivateCall(callId);
    if (
      !call ||
      call.orgId !== user.organizationId ||
      (call.callerId !== user.id && call.calleeId !== user.id) ||
      call.status === "ended"
    ) {
      return res.status(404).json({ message: "Private call not found" });
    }

    const deviceId =
      typeof req.body?.deviceId === "string" ? req.body.deviceId.trim().slice(0, 80) : "";
    const safeDevice = deviceId.replace(/[^a-zA-Z0-9_-]/g, "") || "web";
    const identity = `${user.id}:${safeDevice}`;
    try {
      const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
        identity,
        name: displayName(req),
        ttl: "2h",
      });
      at.addGrant({
        roomJoin: true,
        room: call.roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });
      const token = await at.toJwt();
      res.json({
        call: serializePrivateCall(call, user.id),
        token,
        url: cfg.url,
        roomName: call.roomName,
        identity,
      });
    } catch (err) {
      console.error("[radio] private token:", err);
      res.status(500).json({ message: "Failed to mint private radio token" });
    }
  });

  app.get("/api/radio/private/floor", async (req, res) => {
    if (!requireUser(req, res)) return;
    const callId = typeof req.query.callId === "string" ? req.query.callId : "";
    if (!callId) return res.status(400).json({ message: "callId required" });
    const user = req.currentUser!;
    const call = getPrivateCall(callId);
    if (
      !call ||
      call.orgId !== user.organizationId ||
      (call.callerId !== user.id && call.calleeId !== user.id)
    ) {
      return res.status(404).json({ message: "Private call not found" });
    }
    const holder = getFloor(call.roomName);
    res.json({
      holder: holder
        ? {
            userId: holder.userId,
            displayName: holder.displayName,
            expiresAt: holder.expiresAt,
            isMe: holder.userId === user.id,
          }
        : null,
    });
  });

  app.post("/api/radio/private/floor", async (req, res) => {
    if (!requireUser(req, res)) return;
    const callId = typeof req.body?.callId === "string" ? req.body.callId.trim() : "";
    if (!callId) return res.status(400).json({ message: "callId required" });
    const user = req.currentUser!;
    const call = getPrivateCall(callId);
    if (
      !call ||
      call.orgId !== user.organizationId ||
      (call.callerId !== user.id && call.calleeId !== user.id)
    ) {
      return res.status(404).json({ message: "Private call not found" });
    }
    const result = tryAcquireFloor(call.roomName, user.id, displayName(req));
    if (!result.ok) {
      return res.status(409).json({
        message: "Channel busy",
        holder: {
          userId: result.holder.userId,
          displayName: result.holder.displayName,
          expiresAt: result.holder.expiresAt,
          isMe: false,
        },
      });
    }
    res.json({
      holder: {
        userId: result.holder.userId,
        displayName: result.holder.displayName,
        expiresAt: result.holder.expiresAt,
        isMe: true,
      },
    });
  });

  app.post("/api/radio/private/floor/heartbeat", async (req, res) => {
    if (!requireUser(req, res)) return;
    const callId = typeof req.body?.callId === "string" ? req.body.callId.trim() : "";
    if (!callId) return res.status(400).json({ message: "callId required" });
    const user = req.currentUser!;
    const call = getPrivateCall(callId);
    if (!call || (call.callerId !== user.id && call.calleeId !== user.id)) {
      return res.status(404).json({ message: "Private call not found" });
    }
    const holder = heartbeatFloor(call.roomName, user.id);
    if (!holder) return res.status(409).json({ message: "You do not hold the floor" });
    res.json({
      holder: {
        userId: holder.userId,
        displayName: holder.displayName,
        expiresAt: holder.expiresAt,
        isMe: true,
      },
    });
  });

  app.post("/api/radio/private/floor/release", async (req, res) => {
    if (!requireUser(req, res)) return;
    const callId = typeof req.body?.callId === "string" ? req.body.callId.trim() : "";
    if (!callId) return res.status(400).json({ message: "callId required" });
    const user = req.currentUser!;
    const call = getPrivateCall(callId);
    if (call && (call.callerId === user.id || call.calleeId === user.id)) {
      releaseFloor(call.roomName, user.id);
    }
    res.json({ ok: true });
  });
}
