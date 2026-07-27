import type { CctvCamera } from "@shared/cctv";
import { isLoopbackRtspHost, isUnreachablePrivateRtspOnCloud } from "@shared/cctv";
import { buildRtspSource } from "./storage";
import { decryptCameraPassword } from "./credentials";
import { PTZ_PRESETS, PTZ_TUNNEL_HELP, isPtzConnectionRefused } from "./ptz-hikvision";
import { sendOnvifPtz, warmupOnvifPtz } from "./ptz-onvif";

type RouteCache = {
  httpBase: string;
  username: string;
  password: string;
  at: number;
};

const routeCache = new Map<number, RouteCache>();

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

/** VPS tunnel ports → camera HTTP (prefer 8555 / port 80 first). */
export function buildPtzHttpBases(camera: CctvCamera): string[] {
  try {
    const host = new URL(camera.rtspUrl.trim()).hostname.toLowerCase();
    if (isLoopbackRtspHost(camera.rtspUrl)) {
      const primary = camera.ptzControlPort ?? 8555;
      return [`http://127.0.0.1:${primary}`];
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
  // Slightly higher than UI presets so moves feel snappier over tunnel + HLS lag.
  const boost = 1.35;
  return {
    pan: Math.max(-1, Math.min(1, (v.pan / 100) * boost)),
    tilt: Math.max(-1, Math.min(1, (v.tilt / 100) * boost)),
    zoom: Math.max(-1, Math.min(1, (v.zoom / 100) * boost)),
  };
}

export async function warmupCameraPtz(camera: CctvCamera): Promise<void> {
  const bases = buildPtzHttpBases(camera);
  const creds = ptzCredentialCandidates(camera);
  if (!bases[0] || !creds[0]) return;
  await warmupOnvifPtz(bases[0], creds[0].username, creds[0].password);
  routeCache.set(camera.id, {
    httpBase: bases[0],
    username: creds[0].username,
    password: creds[0].password,
    at: Date.now(),
  });
}

export async function sendCameraPtz(
  camera: CctvCamera,
  action: "stop" | "left" | "right" | "up" | "down" | "zoom_in" | "zoom_out",
): Promise<{ ok: boolean; message?: string }> {
  if (!camera.isPtz) {
    return { ok: false, message: "This camera is not marked as PTZ." };
  }

  const velocity = toOnvifVelocity(action);
  const cached = routeCache.get(camera.id);
  if (cached && Date.now() - cached.at < 60 * 60_000) {
    const onvif = await sendOnvifPtz(
      cached.httpBase,
      cached.username,
      cached.password,
      velocity,
    );
    if (onvif.ok) {
      cached.at = Date.now();
      return { ok: true };
    }
    if (!isPtzConnectionRefused(onvif.detail ?? "")) {
      // Keep trying fresh routes below; clear bad cache on auth failure.
      if (/ONVIF rejected|login failed/i.test(onvif.detail ?? "")) {
        routeCache.delete(camera.id);
      }
    }
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

  let lastDetail = "PTZ command failed.";
  for (const httpBase of bases) {
    for (const c of creds) {
      const onvif = await sendOnvifPtz(httpBase, c.username, c.password, velocity);
      if (onvif.ok) {
        routeCache.set(camera.id, {
          httpBase,
          username: c.username,
          password: c.password,
          at: Date.now(),
        });
        return { ok: true };
      }
      lastDetail = onvif.detail ?? lastDetail;
      if (isPtzConnectionRefused(lastDetail)) continue;
    }
  }

  if (isPtzConnectionRefused(lastDetail)) {
    return { ok: false, message: PTZ_TUNNEL_HELP };
  }
  return { ok: false, message: lastDetail };
}

export async function applyCameraImageFlip(
  _camera: CctvCamera,
): Promise<{ ok: boolean; message?: string }> {
  return {
    ok: false,
    message:
      "Use EZVIZ app Image flip, then set Orientation to Normal in OMT. Camera-side ISAPI flip is not available on this model.",
  };
}
