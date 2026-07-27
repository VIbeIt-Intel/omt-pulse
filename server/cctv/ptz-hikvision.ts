import { spawnSync } from "node:child_process";

export type PtzVector = {
  pan: number;
  tilt: number;
  zoom: number;
};

function clampPtz(n: number): number {
  return Math.max(-100, Math.min(100, Math.round(n)));
}

function continuousXml(v: PtzVector): string {
  const pan = clampPtz(v.pan);
  const tilt = clampPtz(v.tilt);
  const zoom = clampPtz(v.zoom);
  return `<?xml version="1.0" encoding="UTF-8"?><PTZData><pan>${pan}</pan><tilt>${tilt}</tilt><zoom>${zoom}</zoom></PTZData>`;
}

function curlPutXml(
  url: string,
  username: string,
  password: string,
  xml: string,
): { ok: boolean; httpCode: string; detail: string } {
  const auth = `${username}:${password}`;
  const result = spawnSync(
    "curl",
    [
      "-sS",
      "--digest",
      "-u",
      auth,
      "-X",
      "PUT",
      url,
      "-H",
      "Content-Type: application/xml",
      "--data-binary",
      xml,
      "--max-time",
      "8",
      "-w",
      "\n%{http_code}",
    ],
    { encoding: "utf8", timeout: 12_000 },
  );
  const out = (result.stdout ?? "") + (result.stderr ?? "");
  const lines = out.trim().split("\n");
  const code = lines[lines.length - 1]?.trim() ?? "";
  const body = lines.slice(0, -1).join("\n").trim();
  if (result.error) {
    return { ok: false, httpCode: code, detail: result.error.message };
  }
  if (code === "200" || code === "204") {
    return { ok: true, httpCode: code, detail: body };
  }
  return {
    ok: false,
    httpCode: code,
    detail: body ? `${code}: ${body.slice(0, 240)}` : `HTTP ${code || "unknown"}`,
  };
}

export function isPtzConnectionRefused(detail: string): boolean {
  return /connection refused|HTTP 000|Failed to connect/i.test(detail);
}

export const PTZ_TUNNEL_HELP =
  "PTZ needs the LAN tunnel with HTTP. On your PC run scripts/cctv-lan-rtsp-tunnel.ps1 (forwards RTSP 8554 and HTTP 8555/8556). Stop any old tunnel window first.";

/** Hikvision / EZVIZ-style ISAPI continuous PTZ (digest auth). */
export function sendHikvisionPtzContinuous(
  httpBase: string,
  username: string,
  password: string,
  vector: PtzVector,
  channel = 1,
): { ok: boolean; detail?: string } {
  const base = httpBase.replace(/\/$/, "");
  const url = `${base}/ISAPI/PTZCtrl/channels/${channel}/continuous`;
  const result = curlPutXml(url, username, password, continuousXml(vector));
  if (result.ok) return { ok: true };
  if (isPtzConnectionRefused(result.detail)) {
    return { ok: false, detail: PTZ_TUNNEL_HELP };
  }
  return { ok: false, detail: result.detail };
}

/** Enable 180° flip on the camera (keeps timestamp/logo readable vs OMT rotate). */
export function enableHikvisionImageFlipCenter(
  httpBase: string,
  username: string,
  password: string,
  channel = 1,
): { ok: boolean; detail?: string } {
  const base = httpBase.replace(/\/$/, "");
  const url = `${base}/ISAPI/Image/channels/${channel}/imageFlip`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><ImageFlip version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema"><enabled>true</enabled><FlipStyle>CENTER</FlipStyle></ImageFlip>`;
  const result = curlPutXml(url, username, password, xml);
  if (result.ok) return { ok: true };
  return { ok: false, detail: result.detail };
}

export const PTZ_PRESETS: Record<string, PtzVector> = {
  stop: { pan: 0, tilt: 0, zoom: 0 },
  left: { pan: -80, tilt: 0, zoom: 0 },
  right: { pan: 80, tilt: 0, zoom: 0 },
  up: { pan: 0, tilt: 80, zoom: 0 },
  down: { pan: 0, tilt: -80, zoom: 0 },
  zoom_in: { pan: 0, tilt: 0, zoom: 80 },
  zoom_out: { pan: 0, tilt: 0, zoom: -80 },
};
