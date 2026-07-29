import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ffmpegStatic from "ffmpeg-static";

import {
  normalizeCctvStreamQuality,
  type CctvStreamQuality,
  type CctvStreamRotation,
} from "@shared/cctv";

const IDLE_MS = 5 * 60_000;
const START_TIMEOUT_MS = 22_000;

type StreamEntry = {
  proc: ChildProcess;
  dir: string;
  lastAccess: number;
  starting: Promise<void>;
  streamRotation: CctvStreamRotation;
  streamQuality: CctvStreamQuality;
};

type VideoMode = "copy" | "transcode";

const streams = new Map<string, StreamEntry>();

function streamKey(orgId: string, cameraId: number): string {
  return `${orgId}:${cameraId}`;
}

/** Latest HLS segment on disk when a live transmux is running (for AI frame grab). */
export function getLatestHlsSegmentPath(orgId: string, cameraId: number): string | null {
  const key = streamKey(orgId, cameraId);
  const entry = streams.get(key);
  if (entry) {
    entry.lastAccess = Date.now();
    const fromEntry = newestTsInDir(entry.dir);
    if (fromEntry) return fromEntry;
  }
  // Stream map can miss briefly after restart; still read segments from disk while viewer is live.
  return newestTsInDir(path.join(os.tmpdir(), "omt-cctv", orgId, String(cameraId)));
}

function newestTsInDir(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const playlist = path.join(dir, "playlist.m3u8");
  if (fs.existsSync(playlist)) {
    let lastRel: string | null = null;
    for (const line of fs.readFileSync(playlist, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.endsWith(".ts")) {
        lastRel = path.basename(trimmed);
      }
    }
    if (lastRel) {
      const full = path.join(dir, lastRel);
      if (fs.existsSync(full)) return full;
    }
  }

  let newest: { full: string; mtime: number } | null = null;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (!newest || st.mtimeMs > newest.mtime) newest = { full, mtime: st.mtimeMs };
    } catch {
      /* ignore */
    }
  }
  return newest?.full ?? null;
}

function ffmpegPath(): string | null {
  if (ffmpegStatic && typeof ffmpegStatic === "string" && fs.existsSync(ffmpegStatic)) {
    return ffmpegStatic;
  }
  for (const candidate of ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"]) {
    if (candidate === "ffmpeg" || fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function waitForPlaylist(dir: string, timeoutMs: number): Promise<void> {
  const playlist = path.join(dir, "playlist.m3u8");
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(playlist)) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Stream start timed out — check RTSP URL and network reachability"));
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

function hlsOutputArgs(outDir: string): { segmentPattern: string; playlistPath: string; args: string[] } {
  const segmentPattern = path.join(outDir, "seg_%03d.ts");
  const playlistPath = path.join(outDir, "playlist.m3u8");
  const args = [
    "-f",
    "hls",
    "-hls_time",
    "1",
    "-hls_list_size",
    "3",
    "-hls_segment_type",
    "mpegts",
    "-hls_flags",
    "delete_segments+append_list+omit_endlist+independent_segments",
    "-hls_segment_filename",
    segmentPattern,
    playlistPath,
  ];
  return { segmentPattern, playlistPath, args };
}

/** Build -vf chain for orientation + optional downscale (Low only). */
function videoFilters(streamRotation: CctvStreamRotation, streamQuality: CctvStreamQuality): string[] {
  const parts: string[] = [];
  if (streamRotation === "rotate180") parts.push("hflip,vflip");
  if (streamQuality === "low") parts.push("scale='min(854\\,iw)':-2");
  if (!parts.length) return [];
  return ["-vf", parts.join(",")];
}

/**
 * Encode args for quality presets.
 * High: camera-native when copy; CRF 17 / up to ~5 Mbps when encoding.
 * Medium (default): camera-native when copy; CRF 18 / ~3 Mbps when encoding (prior default).
 * Low: always re-encode — max 854p / CRF 28 / ~800 kbps / 12 fps.
 */
function videoEncodeArgs(
  mode: VideoMode,
  streamRotation: CctvStreamRotation,
  streamQuality: CctvStreamQuality,
): string[] {
  if (mode === "copy") {
    return ["-c:v", "copy"];
  }

  const vf = videoFilters(streamRotation, streamQuality);
  const common = [...vf, "-c:v", "libx264", "-tune", "zerolatency", "-sc_threshold", "0"];

  if (streamQuality === "high") {
    return [
      ...common,
      "-preset",
      "veryfast",
      "-crf",
      "17",
      "-maxrate",
      "5M",
      "-bufsize",
      "10M",
      "-g",
      "48",
    ];
  }

  if (streamQuality === "low") {
    return [
      ...common,
      "-preset",
      "veryfast",
      "-crf",
      "28",
      "-maxrate",
      "800k",
      "-bufsize",
      "1600k",
      "-r",
      "12",
      "-g",
      "24",
    ];
  }

  // medium — keep close to the previous default encode path
  return [
    ...common,
    "-preset",
    "fast",
    "-crf",
    "18",
    "-maxrate",
    "3M",
    "-bufsize",
    "6M",
    "-g",
    "48",
  ];
}

function prefersPassthrough(streamQuality: CctvStreamQuality, streamRotation: CctvStreamRotation): boolean {
  if (streamQuality === "low") return false;
  if (streamRotation === "rotate180") return false;
  if (process.env.CCTV_FORCE_TRANSCODE === "1") return false;
  // High + Medium: keep camera bitstream when possible (best practical quality / current default).
  return true;
}

function spawnFfmpeg(
  rtspUrl: string,
  outDir: string,
  mode: VideoMode,
  streamRotation: CctvStreamRotation,
  streamQuality: CctvStreamQuality,
): ChildProcess {
  const bin = ffmpegPath();
  if (!bin) {
    throw new Error("FFmpeg is not available on this server");
  }
  ensureDir(outDir);
  const { args: hlsArgs } = hlsOutputArgs(outDir);

  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-rtsp_transport",
    "tcp",
    "-i",
    rtspUrl,
    "-an",
    ...videoEncodeArgs(mode, streamRotation, streamQuality),
    ...hlsArgs,
  ];

  return spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
}

function resetStreamDir(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function tryStartStreamOnce(
  orgId: string,
  cameraId: number,
  rtspUrl: string,
  mode: VideoMode,
  streamRotation: CctvStreamRotation,
  streamQuality: CctvStreamQuality,
): Promise<StreamEntry> {
  const key = streamKey(orgId, cameraId);
  const dir = path.join(os.tmpdir(), "omt-cctv", orgId, String(cameraId));
  resetStreamDir(dir);

  const proc = spawnFfmpeg(rtspUrl, dir, mode, streamRotation, streamQuality);
  let stderr = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });

  const starting = waitForPlaylist(dir, START_TIMEOUT_MS).catch((err) => {
    proc.kill("SIGTERM");
    const hint = stderr.trim() ? `: ${stderr.trim().split("\n").pop()}` : "";
    throw new Error(`${err instanceof Error ? err.message : String(err)}${hint}`);
  });

  const entry: StreamEntry = {
    proc,
    dir,
    lastAccess: Date.now(),
    starting,
    streamRotation,
    streamQuality,
  };

  proc.on("exit", () => {
    if (streams.get(key)?.proc === proc) {
      streams.delete(key);
    }
  });

  await starting;
  return entry;
}

async function startStream(
  orgId: string,
  cameraId: number,
  rtspUrl: string,
  streamRotation: CctvStreamRotation,
  streamQuality: CctvStreamQuality,
): Promise<StreamEntry> {
  const key = streamKey(orgId, cameraId);
  const existing = streams.get(key);
  if (existing) {
    if (existing.streamRotation === streamRotation && existing.streamQuality === streamQuality) {
      existing.lastAccess = Date.now();
      await existing.starting;
      return existing;
    }
    existing.proc.kill("SIGTERM");
    streams.delete(key);
  }

  const useCopy = prefersPassthrough(streamQuality, streamRotation);
  let entry: StreamEntry;

  try {
    if (!useCopy) {
      entry = await tryStartStreamOnce(orgId, cameraId, rtspUrl, "transcode", streamRotation, streamQuality);
      console.log(`[cctv] stream ${key} using H.264 transcode (${streamQuality})`);
    } else {
      try {
        entry = await tryStartStreamOnce(orgId, cameraId, rtspUrl, "copy", streamRotation, streamQuality);
        console.log(`[cctv] stream ${key} using H.264 passthrough (${streamQuality})`);
      } catch (copyErr) {
        console.warn(`[cctv] passthrough failed for ${key}, using transcode:`, copyErr);
        streams.delete(key);
        entry = await tryStartStreamOnce(orgId, cameraId, rtspUrl, "transcode", streamRotation, streamQuality);
        console.log(`[cctv] stream ${key} using H.264 transcode fallback (${streamQuality})`);
      }
    }
  } catch (err) {
    streams.delete(key);
    throw err;
  }

  streams.set(key, entry);
  return entry;
}

export async function touchCctvStream(
  orgId: string,
  cameraId: number,
  rtspUrl: string,
  streamRotation: CctvStreamRotation = "normal",
  streamQuality: CctvStreamQuality = "medium",
): Promise<string> {
  const quality = normalizeCctvStreamQuality(streamQuality);
  const entry = await startStream(orgId, cameraId, rtspUrl, streamRotation, quality);
  entry.lastAccess = Date.now();
  return path.join(entry.dir, "playlist.m3u8");
}

export function getCctvStreamSegmentPath(orgId: string, cameraId: number, fileName: string): string | null {
  const key = streamKey(orgId, cameraId);
  const entry = streams.get(key);
  if (!entry) return null;
  entry.lastAccess = Date.now();
  const safe = path.basename(fileName);
  if (safe !== fileName || !/^[a-zA-Z0-9._-]+$/.test(safe)) return null;
  const full = path.join(entry.dir, safe);
  if (!full.startsWith(entry.dir)) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}

export function rewritePlaylist(playlistPath: string, cameraId: number): string {
  const raw = fs.readFileSync(playlistPath, "utf8");
  const base = `/api/cctv/cameras/${cameraId}/hls/`;
  return raw
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return line;
      return `${base}${path.basename(trimmed)}`;
    })
    .join("\n");
}

export function stopCctvStream(orgId: string, cameraId: number): void {
  const key = streamKey(orgId, cameraId);
  const entry = streams.get(key);
  if (!entry) return;
  entry.proc.kill("SIGTERM");
  streams.delete(key);
}

export function isFfmpegAvailable(): boolean {
  return !!ffmpegPath();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of streams) {
    if (now - entry.lastAccess > IDLE_MS) {
      entry.proc.kill("SIGTERM");
      streams.delete(key);
      console.log(`[cctv] stopped idle stream ${key}`);
    }
  }
}, 60_000);

process.on("exit", () => {
  for (const entry of streams.values()) {
    entry.proc.kill("SIGTERM");
  }
});
