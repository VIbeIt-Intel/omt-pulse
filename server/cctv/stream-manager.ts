import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ffmpegStatic from "ffmpeg-static";

const IDLE_MS = 5 * 60_000;
const START_TIMEOUT_MS = 22_000;

type StreamEntry = {
  proc: ChildProcess;
  dir: string;
  lastAccess: number;
  starting: Promise<void>;
};

type VideoMode = "copy" | "transcode";

const streams = new Map<string, StreamEntry>();

function streamKey(orgId: string, cameraId: number): string {
  return `${orgId}:${cameraId}`;
}

function ffmpegPath(): string | null {
  if (ffmpegStatic && typeof ffmpegStatic === "string") return ffmpegStatic;
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
    "2",
    "-hls_list_size",
    "8",
    "-hls_segment_type",
    "mpegts",
    "-hls_flags",
    "delete_segments+append_list+omit_endlist",
    "-hls_segment_filename",
    segmentPattern,
    playlistPath,
  ];
  return { segmentPattern, playlistPath, args };
}

function videoEncodeArgs(mode: VideoMode): string[] {
  if (mode === "copy") {
    return ["-c:v", "copy"];
  }
  return [
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-tune",
    "zerolatency",
    "-g",
    "48",
    "-sc_threshold",
    "0",
  ];
}

function spawnFfmpeg(rtspUrl: string, outDir: string, mode: VideoMode): ChildProcess {
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
    ...videoEncodeArgs(mode),
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
): Promise<StreamEntry> {
  const key = streamKey(orgId, cameraId);
  const dir = path.join(os.tmpdir(), "omt-cctv", orgId, String(cameraId));
  resetStreamDir(dir);

  const proc = spawnFfmpeg(rtspUrl, dir, mode);
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
  };

  proc.on("exit", () => {
    if (streams.get(key)?.proc === proc) {
      streams.delete(key);
    }
  });

  await starting;
  return entry;
}

async function startStream(orgId: string, cameraId: number, rtspUrl: string): Promise<StreamEntry> {
  const key = streamKey(orgId, cameraId);
  const existing = streams.get(key);
  if (existing) {
    existing.lastAccess = Date.now();
    await existing.starting;
    return existing;
  }

  const forceTranscode = process.env.CCTV_FORCE_TRANSCODE === "1";
  let entry: StreamEntry;

  try {
    if (forceTranscode) {
      entry = await tryStartStreamOnce(orgId, cameraId, rtspUrl, "transcode");
    } else {
      try {
        entry = await tryStartStreamOnce(orgId, cameraId, rtspUrl, "copy");
        console.log(`[cctv] stream ${key} using H.264 passthrough`);
      } catch (copyErr) {
        console.warn(`[cctv] passthrough failed for ${key}, using transcode:`, copyErr);
        streams.delete(key);
        entry = await tryStartStreamOnce(orgId, cameraId, rtspUrl, "transcode");
        console.log(`[cctv] stream ${key} using H.264 transcode (crf 18)`);
      }
    }
  } catch (err) {
    streams.delete(key);
    throw err;
  }

  streams.set(key, entry);
  return entry;
}

export async function touchCctvStream(orgId: string, cameraId: number, rtspUrl: string): Promise<string> {
  const entry = await startStream(orgId, cameraId, rtspUrl);
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
