import type { CctvCamera } from "@shared/cctv";
import { isLoopbackRtspHost, isUnreachablePrivateRtspOnCloud } from "@shared/cctv";
import { buildRtspSource } from "./storage";
import { decryptCameraPassword } from "./credentials";
import {
  PTZ_PRESETS,
  PTZ_TUNNEL_HELP,
  isPtzConnectionRefused,
  sendHikvisionPtzContinuous,
} from "./ptz-hikvision";
import { sendOnvifPtz } from "./ptz-onvif";

export function parseRtspCredentials(rtspUrl: string): { username: string; password: string } {
  try {
    const u = new URL(rtspUrl);
    return {
      username: decodeURIComponent(u.username || "admin"),
      password: decodeURIComponent(u.password || ""),
    };
  } catch {
    return { username: "admin", password: "" };
  }
}

/** VPS tunnel ports → camera HTTP (80 / 8000). */
export function buildPtzHttpBases(camera: CctvCamera): string[] {
  try {
    const host = new URL(camera.rtspUrl.trim()).hostname.toLowerCase();
    if (isLoopbackRtspHost(camera.rtspUrl)) {
      const primary = camera.ptzControlPort ?? 8555;
      const alt = primary === 8555 ? 8556 : primary + 1;
      return [`http://127.0.0.1:${primary}`, `http://127.0.0.1:${alt}`];
    }
    if (
      process.env.NODE_ENV === "production" &&
      isUnreachablePrivateRtspOnCloud(camera.rtspUrl)
    ) {
      return [];
    }
    const httpPort = camera.ptzCameraHttpPort ?? 80;
    return [`http://${host}:${httpPort}`];
  } catch {
    return [];
  }
}

/** Candidate ONVIF/ISAPI logins: stored password first, then RTSP URL password. */
export function ptzCredentialCandidates(
  camera: CctvCamera,
): Array<{ username: string; password: string }> {
  const fromUrl = parseRtspCredentials(buildRtspSource(camera));
  const out: Array<{ username: string; password: string }> = [];
  const user = camera.username?.trim() || fromUrl.username || "admin";
  if (camera.passwordEnc) {
    try {
      const pass = decryptCameraPassword(camera.passwordEnc);
      if (pass) out.push({ username: user, password: pass });
    } catch {
      /* ignore */
    }
  }
  if (fromUrl.password && !out.some((c) => c.password === fromUrl.password)) {
    out.push({ username: fromUrl.username || user, password: fromUrl.password });
  }
  return out;
}

function toOnvifVelocity(action: keyof typeof PTZ_PRESETS): {
  pan: number;
  tilt: number;
  zoom: number;
} {
  const v = PTZ_PRESETS[action] ?? PTZ_PRESETS.stop;
  return {
    pan: Math.max(-1, Math.min(1, v.pan / 100)),
    tilt: Math.max(-1, Math.min(1, v.tilt / 100)),
    zoom: Math.max(-1, Math.min(1, v.zoom / 100)),
  };
}

export async function sendCameraPtz(
  camera: CctvCamera,
  action: "stop" | "left" | "right" | "up" | "down" | "zoom_in" | "zoom_out",
): Promise<{ ok: boolean; message?: string }> {
  if (!camera.isPtz) {
    return { ok: false, message: "This camera is not marked as PTZ." };
  }
  const bases = buildPtzHttpBases(camera);
  if (!bases.length) {
    return {
      ok: false,
      message:
        "PTZ control is not reachable from the server. Run the LAN tunnel with HTTP or use a site VPN.",
    };
  }
  const creds = ptzCredentialCandidates(camera);
  if (!creds.length) {
    return {
      ok: false,
      message:
        "No camera password for PTZ. In Edit camera set Username admin and Password to your EZVIZ ONVIF password (may differ from the RTSP device code).",
    };
  }

  const velocity = toOnvifVelocity(action);
  const vector = PTZ_PRESETS[action] ?? PTZ_PRESETS.stop;
  const channel = camera.ptzChannel ?? 1;
  let lastDetail = "PTZ command failed.";

  for (const httpBase of bases) {
    for (const c of creds) {
      const onvif = await sendOnvifPtz(httpBase, c.username, c.password, velocity);
      if (onvif.ok) return { ok: true };
      lastDetail = onvif.detail ?? lastDetail;
      if (isPtzConnectionRefused(lastDetail)) continue;

      const hik = sendHikvisionPtzContinuous(
        httpBase,
        c.username,
        c.password,
        vector,
        channel,
      );
      if (hik.ok) return { ok: true };
      if (hik.detail && !/404|Not Found|ISAPI/i.test(hik.detail)) {
        lastDetail = hik.detail;
      }
    }
  }

  if (isPtzConnectionRefused(lastDetail)) {
    return { ok: false, message: PTZ_TUNNEL_HELP };
  }
  return { ok: false, message: lastDetail };
}

export async function applyCameraImageFlip(
  camera: CctvCamera,
): Promise<{ ok: boolean; message?: string }> {
  return {
    ok: false,
    message:
      "Use EZVIZ app Image flip, then set Orientation to Normal in OMT. Camera-side ISAPI flip is not available on this model.",
  };
}
