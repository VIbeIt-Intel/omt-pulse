import type { CctvCamera } from "@shared/cctv";
import { isLoopbackRtspHost, isUnreachablePrivateRtspOnCloud } from "@shared/cctv";
import { buildRtspSource } from "./storage";
import {
  PTZ_PRESETS,
  PTZ_TUNNEL_HELP,
  enableHikvisionImageFlipCenter,
  sendHikvisionPtzContinuous,
} from "./ptz-hikvision";

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

function cameraCredentials(camera: CctvCamera): { username: string; password: string } | null {
  const rtsp = buildRtspSource(camera);
  const creds = parseRtspCredentials(rtsp);
  if (!creds.password) return null;
  return creds;
}

export function sendCameraPtz(
  camera: CctvCamera,
  action: "stop" | "left" | "right" | "up" | "down" | "zoom_in" | "zoom_out",
): { ok: boolean; message?: string } {
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
  const creds = cameraCredentials(camera);
  if (!creds) {
    return { ok: false, message: "Camera credentials are missing for PTZ control." };
  }
  const vector = PTZ_PRESETS[action] ?? PTZ_PRESETS.stop;
  const channel = camera.ptzChannel ?? 1;
  let lastDetail = PTZ_TUNNEL_HELP;
  for (const httpBase of bases) {
    const result = sendHikvisionPtzContinuous(
      httpBase,
      creds.username,
      creds.password,
      vector,
      channel,
    );
    if (result.ok) return { ok: true };
    lastDetail = result.detail ?? lastDetail;
    if (!/connection refused|HTTP 000|Failed to connect/i.test(lastDetail)) {
      break;
    }
  }
  return {
    ok: false,
    message:
      lastDetail.includes("LAN tunnel") ? lastDetail : `${lastDetail}. ${PTZ_TUNNEL_HELP}`,
  };
}

/** Try camera-side image flip, then caller should set streamRotation to normal. */
export function applyCameraImageFlip(camera: CctvCamera): { ok: boolean; message?: string } {
  const bases = buildPtzHttpBases(camera);
  if (!bases.length) {
    return { ok: false, message: PTZ_TUNNEL_HELP };
  }
  const creds = cameraCredentials(camera);
  if (!creds) {
    return { ok: false, message: "Camera credentials are missing." };
  }
  const channel = camera.ptzChannel ?? 1;
  for (const httpBase of bases) {
    const result = enableHikvisionImageFlipCenter(
      httpBase,
      creds.username,
      creds.password,
      channel,
    );
    if (result.ok) return { ok: true };
  }
  return {
    ok: false,
    message:
      "Could not set flip on the camera via ISAPI. In the EZVIZ app enable Image flip, then set Orientation to Normal in OMT.",
  };
}
