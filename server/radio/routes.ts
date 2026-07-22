import type { Express, Request, Response } from "express";
import { AccessToken } from "livekit-server-sdk";
import { storage } from "../storage";
import {
  getLiveKitConfig,
  isRadioConfigured,
  radioRoomName,
} from "./config";
import {
  FLOOR_TTL_MS,
  getFloor,
  heartbeatFloor,
  releaseFloor,
  tryAcquireFloor,
} from "./floor";

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

    const roomName = radioRoomName(user.organizationId, commandId);
    try {
      const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
        identity: user.id,
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
        identity: user.id,
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
}
