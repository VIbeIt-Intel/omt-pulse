import { createHash, randomBytes } from "node:crypto";

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

async function soapPost(
  url: string,
  bodyInner: string,
  username: string,
  password: string,
): Promise<{ ok: boolean; status: number; text: string }> {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">` +
    `<s:Header>${passwordDigestToken(username, password)}</s:Header>` +
    `<s:Body>${bodyInner}</s:Body></s:Envelope>`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
      body: xml,
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, text: msg };
  } finally {
    clearTimeout(timer);
  }
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
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.token;
  const res = await soapPost(
    `${httpBase.replace(/\/$/, "")}/onvif/Media`,
    "<trt:GetProfiles/>",
    username,
    password,
  );
  if (!res.ok) return null;
  const token = firstProfileToken(res.text);
  if (token) profileCache.set(key, { token, at: Date.now() });
  return token;
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
      `<tptz:Timeout>PT30S</tptz:Timeout>` +
      `</tptz:ContinuousMove>`;
  } else {
    body =
      `<tptz:ContinuousMove>` +
      `<tptz:ProfileToken>${escapeXml(token)}</tptz:ProfileToken>` +
      `<tptz:Velocity><tt:PanTilt x="${pan}" y="${tilt}"/></tptz:Velocity>` +
      `<tptz:Timeout>PT30S</tptz:Timeout>` +
      `</tptz:ContinuousMove>`;
  }

  const res = await soapPost(`${base}/onvif/PTZ`, body, username, password);
  if (res.ok) return { ok: true };
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
