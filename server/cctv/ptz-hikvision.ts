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
  const xml = continuousXml(vector);
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
  if (result.error) {
    return { ok: false, detail: result.error.message };
  }
  if (code === "200" || code === "204") {
    return { ok: true };
  }
  const body = lines.slice(0, -1).join("\n").trim();
  return {
    ok: false,
    detail: body ? `${code}: ${body.slice(0, 200)}` : `HTTP ${code || "unknown"}`,
  };
}

export const PTZ_PRESETS: Record<string, PtzVector> = {
  stop: { pan: 0, tilt: 0, zoom: 0 },
  left: { pan: -55, tilt: 0, zoom: 0 },
  right: { pan: 55, tilt: 0, zoom: 0 },
  up: { pan: 0, tilt: 55, zoom: 0 },
  down: { pan: 0, tilt: -55, zoom: 0 },
  zoom_in: { pan: 0, tilt: 0, zoom: 55 },
  zoom_out: { pan: 0, tilt: 0, zoom: -55 },
};
