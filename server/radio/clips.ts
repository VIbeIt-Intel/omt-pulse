import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import multer from "multer";
import { storage } from "../storage";

const CLIP_TTL_MS = 24 * 60 * 60 * 1000;
const LISTEN_TTL_MS = 25_000;
const MAX_BYTES = 3 * 1024 * 1024;

const listening = new Map<string, number>();

function clipDir(): string {
  const dir = path.join(process.cwd(), "data", "radio-clips");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listenKey(orgId: string, commandId: number, userId: string): string {
  return `${orgId}:${commandId}:${userId}`;
}

export function markRadioListening(orgId: string, commandId: number, userId: string): void {
  listening.set(listenKey(orgId, commandId, userId), Date.now());
}

export function clearRadioListening(orgId: string, commandId: number, userId: string): void {
  listening.delete(listenKey(orgId, commandId, userId));
}

export function isRadioListening(orgId: string, commandId: number, userId: string): boolean {
  const at = listening.get(listenKey(orgId, commandId, userId));
  return at != null && Date.now() - at < LISTEN_TTL_MS;
}

function sign(id: string, exp: number): string {
  const secret = process.env.SESSION_SECRET || "omt-radio-clip";
  return crypto.createHmac("sha256", secret).update(`${id}.${exp}`).digest("base64url");
}

function tokenOk(id: string, expRaw: string, token: string): boolean {
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = sign(id, exp);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function safeId(id: string): string | null {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) return null;
  return id;
}

function sweepOldClips(): void {
  const dir = clipDir();
  const cutoff = Date.now() - CLIP_TTL_MS;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".wav")) continue;
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}

type FcmSend = (
  tokens: string[],
  payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
    notificationTag?: string;
    dataOnly?: boolean;
  },
) => Promise<void>;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

export function registerRadioClipRoutes(app: Express, sendFcmBatch: FcmSend): void {
  app.post("/api/radio/listening", (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const commandId = Number(req.body?.commandId);
    if (!Number.isFinite(commandId) || commandId <= 0) {
      return res.status(400).json({ message: "commandId required" });
    }
    if (req.body?.active === false) {
      clearRadioListening(req.currentUser.organizationId, commandId, req.currentUser.id);
    } else {
      markRadioListening(req.currentUser.organizationId, commandId, req.currentUser.id);
    }
    res.json({ ok: true });
  });

  app.post("/api/radio/clips", upload.single("audio"), async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const commandId = Number(req.body?.commandId);
    const file = req.file;
    if (!Number.isFinite(commandId) || commandId <= 0) {
      return res.status(400).json({ message: "commandId required" });
    }
    if (!file || file.size < 1000) {
      return res.status(400).json({ message: "Audio too short" });
    }

    const user = req.currentUser;
    const allowed = user.isSuperadmin || user.role === "administrator"
      ? !!(await storage.getCommand(commandId, user.organizationId))
      : (await storage.getUserCommands(user.id)).some((c) => c.id === commandId);
    if (!allowed) return res.status(403).json({ message: "Not a member of this radio channel" });

    const id = crypto.randomUUID();
    const full = path.join(clipDir(), `${id}.wav`);
    fs.writeFileSync(full, file.buffer);
    sweepOldClips();

    const exp = Date.now() + CLIP_TTL_MS;
    const token = sign(id, exp);
    const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "omtpulse.com";
    const protoHeader = req.headers["x-forwarded-proto"];
    const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) || req.protocol || "https";
    const clipUrl = `${proto}://${host}/api/radio/clips/${id}?exp=${exp}&t=${encodeURIComponent(token)}`;

    const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Iemand";
    const title = `RADIO — ${name}`;
    const body = "Stemboodskap op die groep.";

    res.json({ ok: true, id });

    try {
      const tokens = await storage.getFcmTokensByOrg(user.organizationId, user.id, undefined, [commandId]);
      const offline = tokens.filter((row) => !isRadioListening(user.organizationId, commandId, row.userId));
      console.log(`[radio-clip] ${id} tokens=${tokens.length} away=${offline.length}`);
      if (offline.length === 0) return;
      await sendFcmBatch(offline.map((row) => row.token), {
        title,
        body,
        data: { type: "radio", url: "/dashboard", clipUrl },
        notificationTag: `radio-${id}`,
        dataOnly: true,
      });
    } catch (err) {
      console.error("[radio-clip] push failed:", err instanceof Error ? err.message : err);
    }
  });

  app.get("/api/radio/clips/:id", (req: Request, res: Response) => {
    const id = safeId(String(req.params.id ?? ""));
    const exp = typeof req.query.exp === "string" ? req.query.exp : "";
    const token = typeof req.query.t === "string" ? req.query.t : "";
    if (!id || !tokenOk(id, exp, token)) return res.status(404).end();
    const full = path.join(clipDir(), `${id}.wav`);
    if (!fs.existsSync(full)) return res.status(404).end();
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "private, max-age=3600");
    fs.createReadStream(full).pipe(res);
  });
}
