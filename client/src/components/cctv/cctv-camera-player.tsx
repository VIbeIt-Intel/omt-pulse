import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type CctvCameraPlayerProps = {
  cameraId: number;
  cameraName: string;
  className?: string;
};

export function CctvCameraPlayer({ cameraId, cameraName, className }: CctvCameraPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        if (data.response?.code === 502 || data.response?.code === 503) {
          setError("Could not connect to the camera stream. Check the RTSP URL and server FFmpeg.");
        } else {
          setError("Live stream interrupted. Try refreshing or check the camera.");
        }
        hls.destroy();
        hlsRef.current = null;
      });
    }

    void (async () => {
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
  }, [cameraId]);

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
        controls
        aria-label={`Live stream: ${cameraName}`}
      />
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
          <span className="text-sm">Connecting to {cameraName}…</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-4 bg-background/95">
          <Alert variant="destructive" className="max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Stream unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}
