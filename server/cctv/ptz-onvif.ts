import { createHash, randomBytes } from "node:crypto";
import http from "node:http";

export type OnvifVelocity = { pan: number; tilt: number; zoom: number };

function clamp01(n: number): number {
  return Math.max(-1, Math.min(1, n));
}

function passwordDigestToken(username: string, password: string): string {
  const nonce = randomBytes(16);
  const created = new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
  const digest = createHash("sha1")
    .update(Buffer.concat([nonce, Buffer.from(created, "utf8"), Buffer.from(password, "utf8")]))
    .digest("base64");
  const nonceB64 = nonce.toString("base64");
  return (
    `<wsse:Security s:mustUnderstand="true" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">` +
    `<wsse:UsernameToken>` +
    `<wsse:Username>${escapeXml(username)}</wsse:Username>` +
    `<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password>` +
    `<wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceB64}</wsse:Nonce>` +
    `<wsu:Created>${created}</wsu:Created>` +
    `</wsse:UsernameToken></wsse:Security>`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const keepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 8,
  keepAliveMsecs: 30_000,
});

function soapPost(
  url: string,
  bodyInner: string,
  username: string,
  password: string,
  timeoutMs = 2500,
): Promise<{ ok: boolean; status: number; text: string }> {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">` +
    `<s:Header>${passwordDigestToken(username, password)}</s:Header>` +
    `<s:Body>${bodyInner}</s:Body></s:Envelope>`;

  return new Promise((resolve) => {
    let settled = false;
    const done = (value: { ok: boolean; status: number; text: string }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      const parsed = new URL(url);
      const req = http.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || 80,
          path: `${parsed.pathname}${parsed.search}`,
          method: "POST",
          agent: keepAliveAgent,
          headers: {
            "Content-Type": "application/soap+xml; charset=utf-8",
            "Content-Length": Buffer.byteLength(xml),
            Connection: "keep-alive",
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => {
            if (chunks.length < 8) chunks.push(c as Buffer);
          });
          res.on("end", () => {
            const status = res.statusCode ?? 0;
            const text = Buffer.concat(chunks).toString("utf8");
            done({ ok: status >= 200 && status < 300, status, text });
          });
        },
      );
      req.on("timeout", () => {
        req.destroy();
        done({ ok: false, status: 0, text: "PTZ request timed out" });
      });
      req.on("error", (err) => {
        done({ ok: false, status: 0, text: err.message });
      });
      req.write(xml);
      req.end();
    } catch (err) {
      done({
        ok: false,
        status: 0,
        text: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function firstProfileToken(profilesXml: string): string | null {
  const m = /<trt:Profiles[^>]*\btoken="([^"]+)"/i.exec(profilesXml);
  if (m?.[1]) return m[1];
  const m2 = /Profiles[^>]*\btoken="([^"]+)"/i.exec(profilesXml);
  return m2?.[1] ?? null;
}

const profileCache = new Map<string, { token: string; at: number }>();

async function resolveProfileToken(
  httpBase: string,
  username: string,
  password: string,
): Promise<string | null> {
  const key = `${httpBase}|${username}`;
  const cached = profileCache.get(key);
  if (cached && Date.now() - cached.at < 60 * 60_000) return cached.token;

  // Return immediately with EZVIZ-common Profile_1; refresh from GetProfiles in background.
  const guessed = "Profile_1";
  profileCache.set(key, { token: guessed, at: Date.now() });
  void soapPost(
    `${httpBase.replace(/\/$/, "")}/onvif/Media`,
    "<trt:GetProfiles/>",
    username,
    password,
    2000,
  ).then((res) => {
    if (!res.ok) return;
    const token = firstProfileToken(res.text);
    if (token) profileCache.set(key, { token, at: Date.now() });
  });
  return guessed;
}

/** Warm profile cache so the first PTZ press is faster. */
export async function warmupOnvifPtz(
  httpBase: string,
  username: string,
  password: string,
): Promise<void> {
  await resolveProfileToken(httpBase.replace(/\/$/, ""), username, password);
}

/** ONVIF ContinuousMove / Stop for EZVIZ and similar (WS-UsernameToken PasswordDigest). */
export async function sendOnvifPtz(
  httpBase: string,
  username: string,
  password: string,
  velocity: OnvifVelocity,
): Promise<{ ok: boolean; detail?: string }> {
  const base = httpBase.replace(/\/$/, "");
  const token = await resolveProfileToken(base, username, password);
  if (!token) {
    return {
      ok: false,
      detail:
        "ONVIF login failed. In the EZVIZ app enable ONVIF and set an ONVIF user/password, then save that password in OMT camera Edit (Username admin). RTSP can keep the device code in the RTSP URL.",
    };
  }

  const pan = clamp01(velocity.pan);
  const tilt = clamp01(velocity.tilt);
  const zoom = clamp01(velocity.zoom);
  const isStop = pan === 0 && tilt === 0 && zoom === 0;

  let body: string;
  if (isStop) {
    body =
      `<tptz:Stop>` +
      `<tptz:ProfileToken>${escapeXml(token)}</tptz:ProfileToken>` +
      `<tptz:PanTilt>true</tptz:PanTilt>` +
      `<tptz:Zoom>true</tptz:Zoom>` +
      `</tptz:Stop>`;
  } else if (zoom !== 0 && pan === 0 && tilt === 0) {
    body =
      `<tptz:ContinuousMove>` +
      `<tptz:ProfileToken>${escapeXml(token)}</tptz:ProfileToken>` +
      `<tptz:Velocity><tt:Zoom x="${zoom}"/></tptz:Velocity>` +
      `<tptz:Timeout>PT8S</tptz:Timeout>` +
      `</tptz:ContinuousMove>`;
  } else {
    body =
      `<tptz:ContinuousMove>` +
      `<tptz:ProfileToken>${escapeXml(token)}</tptz:ProfileToken>` +
      `<tptz:Velocity><tt:PanTilt x="${pan}" y="${tilt}"/></tptz:Velocity>` +
      `<tptz:Timeout>PT8S</tptz:Timeout>` +
      `</tptz:ContinuousMove>`;
  }

  const res = await soapPost(`${base}/onvif/PTZ`, body, username, password, 2500);
  if (res.ok) return { ok: true };

  // Stale guessed Profile_1 — clear cache and retry once with GetProfiles.
  if (/Invalid|Unknown|token|Profile/i.test(res.text)) {
    profileCache.delete(`${base}|${username}`);
    const retryToken = await resolveProfileToken(base, username, password);
    if (retryToken && retryToken !== token) {
      const retryBody = body.replace(escapeXml(token), escapeXml(retryToken));
      const retry = await soapPost(`${base}/onvif/PTZ`, retryBody, username, password, 2500);
      if (retry.ok) return { ok: true };
    }
  }

  if (/NotAuthorized|Unauthorized/i.test(res.text)) {
    return {
      ok: false,
      detail:
        "ONVIF rejected the password. Set camera Username/Password in OMT to the ONVIF account from the EZVIZ app (often different from the RTSP verification code).",
    };
  }
  return {
    ok: false,
    detail: `ONVIF PTZ HTTP ${res.status}: ${res.text.replace(/\s+/g, " ").slice(0, 180)}`,
  };
}
