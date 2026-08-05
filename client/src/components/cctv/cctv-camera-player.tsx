import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Hls from "hls.js";
import { AlertCircle, Maximize2, RefreshCw, ScanSearch } from "lucide-react";
import type { CctvAiDetection, CctvRoi } from "@shared/cctv";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api-base";
import { cn } from "@/lib/utils";
import { workstationAuthHeaders } from "@/lib/workstation-session";
import { CctvPtzControls } from "./cctv-ptz-controls";

type CctvCameraPlayerProps = {
  cameraId: number;
  cameraName: string;
  showPtz?: boolean;
  aiEnabled?: boolean;
  vehicleRoi?: CctvRoi | null;
  canEditVehicleRoi?: boolean;
  savingVehicleRoi?: boolean;
  onSaveVehicleRoi?: (roi: CctvRoi | null) => Promise<void> | void;
  className?: string;
};

type DetectionsResponse = {
  aiEnabled: boolean;
  detections: CctvAiDetection[];
  updatedAt: string | null;
  error: string | null;
};

async function probePlaylist(playlistUrl: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await fetch(apiUrl(playlistUrl), {
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
  vehicleRoi = null,
  canEditVehicleRoi = false,
  savingVehicleRoi = false,
  onSaveVehicleRoi,
  className,
}: CctvCameraPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [editingVehicleRoi, setEditingVehicleRoi] = useState(false);
  const [previewVehicleRoi, setPreviewVehicleRoi] = useState(false);
  const [draftVehicleRoi, setDraftVehicleRoi] = useState<CctvRoi | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);

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
    refetchInterval: 1500,
  });

  const detectionsRaw = aiData?.detections ?? [];
  const updatedAtMs = aiData?.updatedAt ? new Date(aiData.updatedAt).getTime() : 0;
  const detectionsFresh =
    updatedAtMs > 0 && Date.now() - updatedAtMs < 10_000 ? detectionsRaw : [];
  const detections = detectionsFresh;
  const overlayRoi = editingVehicleRoi ? draftVehicleRoi : previewVehicleRoi ? vehicleRoi : null;
  const vehicleZoneActive = !!vehicleRoi && !editingVehicleRoi;

  useEffect(() => {
    setPreviewVehicleRoi(false);
    setEditingVehicleRoi(false);
    setDraftVehicleRoi(null);
    drawStartRef.current = null;
  }, [cameraId]);

  function clamp01(n: number) {
    return Math.max(0, Math.min(1, n));
  }

  function eventToNormalized(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  }

  function beginVehicleRoiEdit() {
    setPreviewVehicleRoi(false);
    setDraftVehicleRoi(vehicleRoi);
    setEditingVehicleRoi(true);
  }

  async function saveVehicleRoi(roi: CctvRoi | null) {
    if (!onSaveVehicleRoi) return;
    await onSaveVehicleRoi(roi);
    setEditingVehicleRoi(false);
    setDraftVehicleRoi(null);
    setPreviewVehicleRoi(false);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    setError(null);
    setLoading(true);

    // Absolute on Capacitor local-shell so hls.js XHR hits production, not https://localhost.
    const playlistUrl = apiUrl(`/api/cctv/cameras/${cameraId}/playlist.m3u8`);
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
      const authHeaders = workstationAuthHeaders();
      const hls = new Hls({
        enableWorker: true,
        // Keep near-live without chasing the edge so hard that partial segments tear.
        lowLatencyMode: false,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 5,
        maxLiveSyncPlaybackRate: 1.2,
        xhrSetup: (xhr) => {
          xhr.withCredentials = true;
          for (const [key, value] of Object.entries(authHeaders)) {
            xhr.setRequestHeader(key, value);
          }
        },
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
      ref={rootRef}
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
      {overlayRoi && (
        <div
          className={cn(
            "pointer-events-none absolute z-[4] border-2 bg-cyan-300/10",
            editingVehicleRoi ? "border-cyan-300 border-dashed" : "border-cyan-400",
          )}
          style={{
            left: `${overlayRoi.x * 100}%`,
            top: `${overlayRoi.y * 100}%`,
            width: `${overlayRoi.w * 100}%`,
            height: `${overlayRoi.h * 100}%`,
          }}
        >
          <span className="absolute -top-5 left-0 rounded bg-cyan-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Vehicle area
          </span>
        </div>
      )}
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
        {vehicleZoneActive && !error && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={cn(
              "h-8 gap-1 px-2 text-white hover:bg-cyan-500",
              previewVehicleRoi ? "bg-cyan-500" : "bg-cyan-600/90",
            )}
            title={
              previewVehicleRoi
                ? "Hide vehicle detection area"
                : "Show vehicle detection area"
            }
            aria-pressed={previewVehicleRoi}
            onClick={() => setPreviewVehicleRoi((v) => !v)}
            data-testid={`cctv-vehicle-roi-badge-${cameraId}`}
          >
            <ScanSearch className="h-4 w-4 shrink-0" aria-hidden />
            <span className="text-[10px] font-semibold uppercase tracking-wide">
              Zone
            </span>
          </Button>
        )}
        {aiEnabled && !error && (
          <span
            className="rounded bg-emerald-600/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white"
            data-testid={`cctv-ai-badge-${cameraId}`}
          >
            AI
          </span>
        )}
        {canEditVehicleRoi && !editingVehicleRoi && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 bg-black/60 text-white hover:bg-black/75"
            onClick={beginVehicleRoiEdit}
            title={vehicleZoneActive ? "Edit vehicle detection zone" : "Set vehicle detection zone"}
          >
            {vehicleZoneActive ? "Edit" : "ROI"}
          </Button>
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
      {editingVehicleRoi && (
        <>
          <div
            className="absolute inset-0 z-[6] cursor-crosshair"
            onPointerDown={(e) => {
              const p = eventToNormalized(e.clientX, e.clientY);
              if (!p) return;
              drawStartRef.current = p;
              setDraftVehicleRoi({ x: p.x, y: p.y, w: 0.01, h: 0.01 });
            }}
            onPointerMove={(e) => {
              const start = drawStartRef.current;
              if (!start) return;
              const p = eventToNormalized(e.clientX, e.clientY);
              if (!p) return;
              const x1 = Math.min(start.x, p.x);
              const y1 = Math.min(start.y, p.y);
              const x2 = Math.max(start.x, p.x);
              const y2 = Math.max(start.y, p.y);
              setDraftVehicleRoi({
                x: x1,
                y: y1,
                w: Math.max(0.01, x2 - x1),
                h: Math.max(0.01, y2 - y1),
              });
            }}
            onPointerUp={() => {
              drawStartRef.current = null;
            }}
          />
          <div className="absolute left-3 top-3 z-[7] max-w-sm rounded bg-black/70 px-3 py-2 text-xs text-white">
            Draw the distant vehicle area on the image, then save it.
          </div>
          <div className="absolute bottom-3 left-3 z-[7] flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void saveVehicleRoi(draftVehicleRoi)}
              disabled={!draftVehicleRoi || savingVehicleRoi}
            >
              {savingVehicleRoi ? "Saving..." : "Save vehicle area"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void saveVehicleRoi(null)}
              disabled={savingVehicleRoi}
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="bg-black/60 text-white hover:bg-black/75"
              onClick={() => {
                setEditingVehicleRoi(false);
                setDraftVehicleRoi(null);
                drawStartRef.current = null;
              }}
              disabled={savingVehicleRoi}
            >
              Cancel
            </Button>
          </div>
        </>
      )}
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
