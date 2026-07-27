import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { AlertCircle, Maximize2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { workstationAuthHeaders } from "@/lib/workstation-session";

type CctvCameraPlayerProps = {
  cameraId: number;
  cameraName: string;
  className?: string;
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

export function CctvCameraPlayer({ cameraId, cameraName, className }: CctvCameraPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

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
        xhrSetup(xhr) {
          xhr.withCredentials = true;
        },
      });
      hlsRef.current = hls;
      hls.loadSource(playlistUrl);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        setLoading(false);
        void el.play().catch(() => undefined);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled || !data.fatal) return;
        setLoading(false);
        setError("Live stream interrupted. Try refreshing or check the camera.");
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
      <div className="absolute right-3 top-3 z-10 flex gap-2">
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
