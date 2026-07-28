import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Hls from "hls.js";
import { AlertCircle, Maximize2, RefreshCw } from "lucide-react";
import type { CctvAiDetection } from "@shared/cctv";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { workstationAuthHeaders } from "@/lib/workstation-session";
import { CctvPtzControls } from "./cctv-ptz-controls";

type CctvCameraPlayerProps = {
  cameraId: number;
  cameraName: string;
  showPtz?: boolean;
  aiEnabled?: boolean;
  className?: string;
};

type DetectionsResponse = {
  aiEnabled: boolean;
  detections: CctvAiDetection[];
  updatedAt: string | null;
  error: string | null;
};

async function probePlaylist(playlistUrl: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await fetch(playlistUrl, {
    credentials: "include",
    cache: "no-store",
    headers: workstationAuthHeaders(),
  });
  if (res.ok) {
    const text = await res.text();
    if (text.includes("#EXTM3U")) return { ok: true };
    return { ok: false, message: "Server returned an invalid playlist." };
  }
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) return { ok: false, message: body.message };
  } catch {
    /* not JSON */
  }
  return {
    ok: false,
    message:
      res.status === 503
        ? "Streaming is not available on this server."
        : "Could not start the camera stream. Check the RTSP URL and credentials.",
  };
}

export function CctvCameraPlayer({
  cameraId,
  cameraName,
  showPtz = false,
  aiEnabled = false,
  className,
}: CctvCameraPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  const { data: aiData } = useQuery<DetectionsResponse>({
    queryKey: ["/api/cctv/cameras", cameraId, "ai", "detections"],
    queryFn: async () => {
      const res = await fetch(`/api/cctv/cameras/${cameraId}/ai/detections`, {
        credentials: "include",
        cache: "no-store",
        headers: workstationAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to load detections");
      return res.json();
    },
    enabled: aiEnabled && !error,
    refetchInterval: 2000,
  });

  const detections = aiData?.detections ?? [];

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    setError(null);
    setLoading(true);

    const playlistUrl = `/api/cctv/cameras/${cameraId}/playlist.m3u8`;
    const el = video;

    async function attachNative() {
      el.src = playlistUrl;
      try {
        await el.play();
      } catch {
        /* autoplay may be blocked until user gesture — still show frames when ready */
      }
    }

    async function attachHlsJs() {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 3,
        maxLiveSyncPlaybackRate: 1.5,
      });
      hlsRef.current = hls;
      hls.loadSource(playlistUrl);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!cancelled) setLoading(false);
        void el.play().catch(() => undefined);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || cancelled) return;
        setLoading(false);
        setError("Stream playback failed. Try refreshing.");
        hls.destroy();
        hlsRef.current = null;
      });
    }

    void (async () => {
      const probe = await probePlaylist(playlistUrl);
      if (cancelled) return;
      if (!probe.ok) {
        setLoading(false);
        setError(probe.message);
        return;
      }

      if (Hls.isSupported()) {
        await attachHlsJs();
      } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
        el.addEventListener("loadedmetadata", () => {
          if (!cancelled) setLoading(false);
        });
        el.addEventListener("error", () => {
          if (!cancelled) {
            setLoading(false);
            setError("Could not play this stream in your browser.");
          }
        });
        await attachNative();
      } else {
        setLoading(false);
        setError("HLS playback is not supported in this browser.");
      }
    })();

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      el.removeAttribute("src");
      el.load();
    };
  }, [cameraId, reloadNonce]);

  async function enterFullscreen() {
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    await video.requestFullscreen?.().catch(() => undefined);
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-black aspect-video",
        className,
      )}
      data-testid={`cctv-player-${cameraId}`}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        playsInline
        muted
        autoPlay
        aria-label={`Live stream: ${cameraName}`}
      />
      {aiEnabled && detections.length > 0 && !error && (
        <div className="pointer-events-none absolute inset-0 z-[5]" aria-hidden>
          {detections.map((det, idx) => {
            const isPerson = det.label === "person";
            return (
              <div
                key={`${det.label}-${idx}-${det.x.toFixed(3)}`}
                className={
                  isPerson
                    ? "absolute border-2 border-amber-400 bg-amber-400/10"
                    : "absolute border-2 border-emerald-400 bg-emerald-400/10"
                }
                style={{
                  left: `${det.x * 100}%`,
                  top: `${det.y * 100}%`,
                  width: `${det.w * 100}%`,
                  height: `${det.h * 100}%`,
                }}
              >
                <span
                  className={
                    isPerson
                      ? "absolute -top-5 left-0 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                      : "absolute -top-5 left-0 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                  }
                >
                  {det.label} {(det.confidence * 100).toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="absolute right-3 top-3 z-10 flex gap-2">
        {aiEnabled && !error && (
          <span
            className="rounded bg-emerald-600/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white"
            data-testid={`cctv-ai-badge-${cameraId}`}
          >
            AI
          </span>
        )}
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-8 w-8 bg-black/60 text-white hover:bg-black/75"
          onClick={() => setReloadNonce((n) => n + 1)}
          data-testid={`cctv-refresh-${cameraId}`}
          aria-label="Refresh stream"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-8 w-8 bg-black/60 text-white hover:bg-black/75"
          onClick={() => void enterFullscreen()}
          data-testid={`cctv-fullscreen-${cameraId}`}
          aria-label="Toggle fullscreen"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>
      {showPtz && !error && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-10 sm:bottom-4 sm:right-4">
          <CctvPtzControls cameraId={cameraId} overlay />
        </div>
      )}
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
          <RefreshCw className="h-8 w-8 animate-spin" aria-hidden />
          <span className="text-sm">Connecting to {cameraName}…</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-4 bg-background/95">
          <Alert variant="destructive" className="max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Stream unavailable</AlertTitle>
            <AlertDescription className="text-sm leading-relaxed">{error}</AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}
