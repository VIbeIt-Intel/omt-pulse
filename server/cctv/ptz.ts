import type { CctvCamera } from "@shared/cctv";
import { isLoopbackRtspHost, isUnreachablePrivateRtspOnCloud } from "@shared/cctv";
import { buildRtspSource } from "./storage";
import { PTZ_PRESETS, sendHikvisionPtzContinuous } from "./ptz-hikvision";

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

/** HTTP base for ISAPI PTZ (tunnel: http://127.0.0.1:8555 → camera port 80). */
export function buildPtzHttpBase(camera: CctvCamera): string | null {
  const port = camera.ptzControlPort ?? 8555;
  try {
    const host = new URL(camera.rtspUrl.trim()).hostname.toLowerCase();
    if (isLoopbackRtspHost(camera.rtspUrl)) {
      return `http://127.0.0.1:${port}`;
    }
    if (
      process.env.NODE_ENV === "production" &&
      isUnreachablePrivateRtspOnCloud(camera.rtspUrl)
    ) {
      return null;
    }
    return `http://${host}:${camera.ptzCameraHttpPort ?? 80}`;
  } catch {
    return null;
  }
}

export function sendCameraPtz(
  camera: CctvCamera,
  action: "stop" | "left" | "right" | "up" | "down" | "zoom_in" | "zoom_out",
): { ok: boolean; message?: string } {
  if (!camera.isPtz) {
    return { ok: false, message: "This camera is not marked as PTZ." };
  }
  const httpBase = buildPtzHttpBase(camera);
  if (!httpBase) {
    return {
      ok: false,
      message:
        "PTZ control is not reachable from the server. Run the LAN tunnel with HTTP (port 8555) or use a site VPN.",
    };
  }
  const rtsp = buildRtspSource(camera);
  const creds = parseRtspCredentials(rtsp);
  if (!creds.password) {
    return { ok: false, message: "Camera credentials are missing for PTZ control." };
  }
  const vector = PTZ_PRESETS[action] ?? PTZ_PRESETS.stop;
  const channel = camera.ptzChannel ?? 1;
  const result = sendHikvisionPtzContinuous(httpBase, creds.username, creds.password, vector, channel);
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.detail ??
        "PTZ command failed. Enable ONVIF/ISAPI on the camera and ensure the HTTP tunnel is running.",
    };
  }
  return { ok: true };
}
